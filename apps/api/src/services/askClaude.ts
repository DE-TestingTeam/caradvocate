/**
 * Ask CA, answered by Claude and grounded in the owner's own car.
 *
 * The whole product claim is that it does not invent things: no fabricated
 * valuations, no guessed service intervals, no all-clear it cannot support. A
 * language model is by far the biggest invention risk introduced so far, so most of
 * what follows is structure that makes overclaiming hard rather than merely
 * discouraged:
 *
 *   - Every fact the model may use arrives in the vehicle context block, with its
 *     provenance attached (see vehicleContext.ts). The system prompt forbids going
 *     beyond it.
 *   - The reply shape is constrained by a JSON schema, so `urgency` and the CTA are
 *     values the UI already renders rather than prose we have to parse.
 *   - The CTA label is filled in here, not by the model, so it cannot drift.
 *
 * Configuration decides the mode, as with the auth dev bypass: no ANTHROPIC_API_KEY
 * means Ask CA stays on canned replies and the API says so at startup.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, Severity } from '@caradvocate/shared';
import { env } from '../env.js';

/** The one CTA the UI knows how to render. Fixed here so the model cannot reword it. */
const CTA_LABEL = 'CHECK REPAIR COSTS';

/**
 * Short conversational turns, but `max_tokens` caps thinking *and* text together on
 * Claude Opus 5 -- and thinking is on by default. Sized for headroom so a reply is
 * never truncated mid-sentence; a chat answer will use a fraction of it.
 */
const MAX_TOKENS = 8000;

/**
 * `medium` rather than the default `high`: this is an interactive turn where the
 * facts are handed to the model rather than discovered, and latency is felt by
 * someone waiting on a chat bubble. Raise it if answers get shallow.
 */
const EFFORT = 'medium' as const;

export interface AskInput {
  /** The owner's question. */
  question: string;
  /** Their car, its recalls, complaints, upkeep and history -- see vehicleContext.ts. */
  vehicleContext: string;
  /** Prior turns, oldest first, so follow-ups make sense. */
  history: { role: 'user' | 'assistant'; text: string }[];
}

export type AskReply = Omit<ChatMessage, 'id'>;

/** Test seam, mirroring setRecallFetcherForTesting. The suite must never call the API. */
type Asker = (input: AskInput) => Promise<AskReply>;

let asker: Asker | undefined;

export function setAskerForTesting(next: Asker | undefined): void {
  asker = next;
}

/**
 * True when Ask CA can answer at all.
 *
 * An installed test asker counts: without this the suite could never reach the real
 * code path, because the route checks this before calling out and no key is set in
 * tests. "Configured" means "can produce an answer", not "has a key".
 */
export function askIsConfigured(): boolean {
  return Boolean(asker) || Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * The instructions, kept byte-stable so the cached prefix survives across every
 * request and every user. Nothing per-car goes in here -- that would put volatile
 * content in front of the cache and invalidate it on every turn.
 */
const SYSTEM_PROMPT = `You are CarAdvocate's assistant. You help a car owner work out two things: whether a repair is actually necessary, and whether the price they were quoted is fair. You are on their side, not the shop's.

You will be given a block of facts about this specific car. Those facts are the only thing you know about it.

WHAT YOU MUST NOT DO
- Do not invent recalls, campaign numbers, part prices, labour times, service intervals, or resale values. If a number is not in the facts you were given, you do not have it.
- Do not state a manufacturer's maintenance schedule. This app does not have that data; it is licensed. If the owner has not set an interval for a job, say the interval is not set rather than supplying one.
- Do not diagnose. You cannot see, hear, or drive the car. Describe what the symptom is consistent with, what a mechanic would check, and what to ask them.
- Do not give an all-clear you cannot support. If the facts say a data source could not be reached, that is "unknown", never "nothing wrong".
- Do not repeat a complaint as an established fault.

HOW TO USE THE FACTS
- Recalls are official findings by NHTSA, issued per year/make/model, and repaired free at a dealer. NHTSA cannot tell whether THIS car was already repaired — only the owner's own answer does. If a recall's status is unknown, say it may already have been done and that a dealer can confirm from the VIN.
- Owner complaints are unverified first-hand reports. Cite them as "N owners of this model reported…", never as proof this car is affected. Where a reported mileage range is given and the odometer is known, comparing the two is genuinely useful — say plainly that it is a pattern across owners, not a prediction.
- Upkeep status is arithmetic on intervals the OWNER set and services they logged. Service history is only what they entered; work done elsewhere is missing.
- If a recall carries NHTSA's stop-driving or park-outside advisory and the owner has not said it was repaired, lead with it whatever they asked about. That outranks the question.

STYLE
- Be brief. This renders in a chat bubble: two or three sentences is usually right, and never more than a short paragraph. Answer the question asked and stop.
- Plain language. The reader is not a mechanic.
- Say what you do not know in a sentence, and say what would settle it (a dealer VIN check, an inspection, the campaign number).
- Do not open with pleasantries or restate the question.
- Raise an unrepaired recall unprompted at most ONCE per conversation. If it already appears earlier in this conversation, the owner has been told — do not append it again. Tacking the same recall onto every answer teaches them to ignore it, which is the opposite of what it is for. The stop-driving or park-outside exception above still overrides this: repeat that one every time until they say it was repaired.

THE REPLY FIELDS
- text: your answer.
- urgency: set this ONLY when the facts you were given support it. A stop-driving recall is high. A repeatedly-reported safety component, or an overdue upkeep job, is medium. Something to mention at the next service is low. Set it to null when nothing in the facts justifies one — an invented urgency level is worse than none.
- cta: set to {"action": "start_assessment"} when the owner is asking what a repair should cost or whether a quote is fair, and the Repair Cost Checker would help. Otherwise null. Note its price benchmarks are currently placeholder figures, so do not quote a specific fair price yourself.`;

/**
 * The reply shape, enforced by the API rather than parsed out of prose.
 *
 * `urgency` and `cta` are nullable-and-required rather than optional: a strict schema
 * needs every key present, and an explicit null is a clearer signal than an absent
 * field for "nothing here justifies one".
 */
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: "The answer to show the owner." },
    urgency: {
      anyOf: [
        {
          type: 'object',
          properties: {
            level: { type: 'string', enum: ['low', 'medium', 'high'] },
            text: { type: 'string', description: 'One short line explaining the level.' },
          },
          required: ['level', 'text'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    cta: {
      anyOf: [
        {
          type: 'object',
          properties: { action: { type: 'string', enum: ['start_assessment'] } },
          required: ['action'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
  },
  required: ['text', 'urgency', 'cta'],
  additionalProperties: false,
} as const;

let client: Anthropic | undefined;

function anthropic(): Anthropic {
  // Constructed lazily and reused, so the key is read once and a request that never
  // reaches Ask CA does not need one.
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Answers one question, or throws.
 *
 * The caller decides what a failure means for the conversation -- see routes/chat.ts,
 * which would rather record an honest "could not answer" than leave a question with
 * no reply at all.
 */
export async function askCarAdvocate(input: AskInput): Promise<AskReply> {
  if (asker) return asker(input);
  if (!env.ANTHROPIC_API_KEY) throw new Error('Ask CA is not configured (no ANTHROPIC_API_KEY)');

  const response = await anthropic().beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: MAX_TOKENS,
    // Recommended for Opus 5: a safety classifier can decline a request, and this
    // re-runs it on Anthropic's recommended fallback rather than returning nothing.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: REPLY_SCHEMA },
    },
    // Cached: identical for every user and every turn, so it is the prefix worth
    // keeping stable. Per-car facts go in the messages below, never up here.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: `Here are the facts about my car.\n\n${input.vehicleContext}`,
      },
      { role: 'assistant', content: 'Understood. I will answer using only those facts.' },
      ...input.history.map((turn) => ({ role: turn.role, content: turn.text })),
      { role: 'user' as const, content: input.question },
    ],
  });

  // Checked before reading content: a refusal returns HTTP 200 with empty or partial
  // content, so indexing content[0] would throw or return a fragment.
  if (response.stop_reason === 'refusal') {
    throw new Error('That question was declined by a safety filter. Try rephrasing it.');
  }

  return parseReply(response.content);
}

/**
 * Exported for testing. Pulls the reply out of the response blocks.
 *
 * Defensive despite the schema: a `max_tokens` stop, a fallback boundary block, or a
 * thinking block all mean the text is not simply `content[0]`.
 */
export function parseReply(content: { type: string; text?: string }[]): AskReply {
  const text = content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');

  if (!text.trim()) throw new Error('Ask CA returned an empty response');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Structured outputs should make this impossible; if the shape ever changes,
    // failing loudly beats showing the owner a blob of JSON.
    throw new Error('Ask CA returned a reply that could not be read');
  }

  const record = parsed as Record<string, unknown>;
  const answer = typeof record.text === 'string' ? record.text.trim() : '';
  if (!answer) throw new Error('Ask CA returned a reply with no answer in it');

  const reply: AskReply = { role: 'assistant', text: answer };

  const urgency = record.urgency as { level?: unknown; text?: unknown } | null | undefined;
  if (urgency && isSeverity(urgency.level) && typeof urgency.text === 'string' && urgency.text.trim()) {
    reply.urgency = { level: urgency.level, text: urgency.text.trim() };
  }

  const cta = record.cta as { action?: unknown } | null | undefined;
  if (cta && cta.action === 'start_assessment') {
    // Label supplied here, not by the model, so it matches what the UI renders.
    reply.cta = { label: CTA_LABEL, action: 'start_assessment' };
  }

  return reply;
}

function isSeverity(value: unknown): value is Severity {
  return value === 'low' || value === 'medium' || value === 'high';
}
