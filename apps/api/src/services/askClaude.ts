/**
 * Ask CA, answered by Claude and grounded in the owner's own car.
 *
 * The product claim is that it does not invent things, and a language model is the
 * biggest invention risk here, so the structure makes overclaiming hard rather than
 * merely discouraged: every fact the model may use arrives in the vehicle context block
 * with its provenance attached (see vehicleContext.ts) and the system prompt forbids
 * going beyond it; the reply shape is constrained by a JSON schema, so `urgency` and the
 * CTA are values the UI already renders; and the CTA label is filled in here.
 *
 * The reply streams so the owner is not watching a spinner, but streaming deliberately does not
 * weaken any of that: the deltas are a preview, and the object this module returns -- schema-
 * constrained, then re-checked by parseReply -- is what the app renders. Validation sits on the
 * return value precisely so the fast path cannot become the unchecked path.
 *
 * No ANTHROPIC_API_KEY means Ask CA stays on canned replies and says so at startup.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, Severity } from '@caradvocate/shared';
import { env } from '../env.js';
import { createAnswerPreview } from './answerPreview.js';

/** The one CTA the UI knows how to render. Fixed here so the model cannot reword it. */
const CTA_LABEL = 'CHECK REPAIR COSTS';

/**
 * Generous headroom for a short answer. It is not the binding constraint -- replies run 200-450
 * output tokens -- but `max_tokens` caps thinking and text together on Sonnet 5, so leaving room
 * costs nothing and means turning thinking back on cannot silently truncate a reply.
 */
const MAX_TOKENS = 8000;

/**
 * Measured on the seeded Civic, not guessed. With thinking off (below), `medium` grounded its
 * answer in the owner's own recalls, complaints and service history in 6 of 6 runs where `low`
 * managed 5 of 6, and cost about 180ms for it. Grounding is the whole product, so it wins.
 *
 * `high` -- the API default -- has not been measured here and is not obviously worth it: the
 * facts are handed over rather than discovered, and the target output is a short paragraph.
 */
const EFFORT = 'medium' as const;

/**
 * Off, deliberately, and this is the single biggest thing keeping Ask CA quick.
 *
 * Sonnet 5 thinks by default, and on a real question that cost a median 12.3s to the first word
 * -- ranging 5.8s to 16.8s across runs -- against 3.1s with it off. It also roughly doubled the
 * length of every answer, against a style rule asking for two or three sentences. On a greeting
 * it made no difference either way: adaptive correctly declines to think about "hi".
 *
 * What it bought was not nothing: thinking surfaced the owner's own complaint and recall data
 * slightly more often. Raising effort to `medium` recovers that at a fraction of the cost, which
 * is why the two settings are paired -- change one and re-measure the other.
 *
 * Checked before committing to this, because a model that is not thinking can get sloppy: all
 * eight guardrails in scripts/probeAskGuardrails.mts held, and no reply leaked internal tags.
 */
const THINKING = { type: 'disabled' } as const;

export interface AskInput {
  /** The owner's question. */
  question: string;
  /** Their car, its recalls, complaints, upkeep and history -- see vehicleContext.ts. */
  vehicleContext: string;
  /** Prior turns, oldest first, so follow-ups make sense. */
  history: { role: 'user' | 'assistant'; text: string }[];
  /**
   * Called with each newly decoded fragment of the reply's `text` field, for display while the
   * model is still writing. A PREVIEW ONLY -- see askCarAdvocate.
   */
  onTextDelta?: (delta: string) => void;
  /** Aborts the upstream call when the owner closes the tab mid-answer. */
  signal?: AbortSignal;
}

/** What the model actually cost and how long it took. Logged by the caller, never shown. */
export interface AskTiming {
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type AskReply = Omit<ChatMessage, 'id'>;

/** True when Ask CA can answer at all. Without this, the canned replies stand in. */
export function askIsConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * Kept byte-stable so the cached prefix survives across every request and user. Nothing
 * per-car goes in here -- volatile content in front of the cache invalidates every turn.
 */
const SYSTEM_PROMPT = `You are CarAdvocate's assistant. You help a car owner work out two things: whether a repair is actually necessary, and whether the price they were quoted is fair. You are on their side, not the shop's.

You will be given a block of facts about this specific car. Those facts are the only thing you know about it. They are reference material, not a request: having them does not mean the owner wants to hear them.

WHAT YOU MUST NOT DO
- Do not invent recalls, campaign numbers, part prices, labour times, service intervals, or resale values. If a number is not in the facts you were given, you do not have it.
- Do not state a manufacturer's maintenance schedule. This app does not have that data; it is licensed. If the owner has not set an interval for a job, say the interval is not set rather than supplying one.
- Do not diagnose. You cannot see, hear, or drive the car. Describe what the symptom is consistent with, what a mechanic would check, and what to ask them.
- Do not give an all-clear you cannot support. If the facts say a data source could not be reached, that is "unknown", never "nothing wrong".
- Do not repeat a complaint as an established fault.

HOW TO USE THE FACTS
- Recalls are official findings by NHTSA, issued per year/make/model, and repaired free at a dealer. NHTSA cannot tell whether THIS car was already repaired — only the owner's own answer does. If a recall's status is unknown, say it may already have been done and that a dealer can confirm from the VIN. Say a recall affects "your model" or "this year and model", never "your VIN" or "your car" — you were given a list matched on year, make and model, and you have not checked a single VIN against anything. A dealer doing that check is the next step you recommend, not something you have already done.
- Owner complaints are unverified first-hand reports. Cite them as "N owners of this model reported…", never as proof this car is affected. Where a reported mileage range is given and the odometer is known, comparing the two is genuinely useful — say plainly that it is a pattern across owners, not a prediction.
- Upkeep status is arithmetic on intervals the OWNER set and services they logged. Service history is only what they entered; work done elsewhere is missing.
- If a recall carries NHTSA's stop-driving or park-outside advisory and the owner has not said it was repaired, lead with it whatever they said — including a greeting or an unrelated remark. This is the one thing that outranks answering what was asked, because the car should not be moving. No other fact in the block gets this treatment.

STYLE
- Be brief. This renders in a chat bubble: two or three sentences is usually right, and never more than a short paragraph. Answer the question asked and stop.
- Plain language. The reader is not a mechanic.
- Say what you do not know in a sentence, and say what would settle it (a dealer VIN check, an inspection, the campaign number).
- Do not open with pleasantries or restate the question.
- Not every message is a question. If the owner greets you, thanks you, acknowledges an answer, or says anything that is not asking for help, reply in one short line and stop — greet them back, or invite the question. Do NOT summarise their car, list its recalls, mention what other owners report, or raise their upkeep. They have not asked. Answering "hi" with a briefing buries the facts that matter under facts they did not want, and teaches them to skim past you. Wait for the real question. Only the stop-driving or park-outside advisory above overrides this.
- Raise an unrepaired recall unprompted at most ONCE per conversation, and only on a turn where you are genuinely answering a question about the car — never in reply to a greeting or an acknowledgement. If it already appears earlier in this conversation, the owner has been told — do not append it again. Tacking the same recall onto every answer teaches them to ignore it, which is the opposite of what it is for. The stop-driving or park-outside exception above still overrides this: repeat that one every time until they say it was repaired.

THE REPLY FIELDS
- text: your answer.
- urgency: set this ONLY when the facts you were given support it AND this turn is actually about the car. A greeting, a thank-you or an acknowledgement gets null however overdue their upkeep is — an urgency banner on "hi" is noise, and noise is what stops the real one being read. Otherwise: an unrepaired stop-driving recall is high. A repeatedly-reported safety component, or an overdue upkeep job, is medium. Something to mention at the next service is low. Set it to null when nothing in the facts justifies one — an invented urgency level is worse than none.
- cta: set to {"action": "start_assessment"} when the owner is asking what a repair should cost or whether a quote is fair, and the Repair Cost Checker would help. Otherwise null, and never on a greeting. Do not quote a fair price yourself: you were given no pricing at all, and the rule against inventing part prices and labour times applies here.`;

/**
 * The reply shape, enforced by the API rather than parsed out of prose. `urgency` and
 * `cta` are nullable-and-required rather than optional: a strict schema needs every key
 * present, and an explicit null says "nothing justifies one" more clearly than absence.
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
  // Lazy and reused, so a request that never reaches Ask CA does not need a key.
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Answers one question, or throws. The caller decides what a failure means -- see routes/chat.ts.
 *
 * Streams, but the stream is not the answer. `onTextDelta` exists so the owner sees words
 * appearing instead of a spinner; what the app renders is always the object returned here,
 * which has been through the schema and then through parseReply. A partial preview from a turn
 * that ends in a refusal, a `max_tokens` stop or a dropped connection is therefore never the
 * final word -- the caller replaces it. Keeping validation on the return value and not on the
 * deltas is what lets this be fast without loosening anything.
 */
export async function askCarAdvocate(input: AskInput): Promise<{ reply: AskReply; timing: AskTiming }> {
  if (!env.ANTHROPIC_API_KEY) throw new Error('Ask CA is not configured (no ANTHROPIC_API_KEY)');

  const startedAt = Date.now();
  const stream = anthropic().messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: MAX_TOKENS,
    thinking: THINKING,
    // No server-side `fallbacks`: it is documented only for the models carrying elevated
    // safety classifiers (Opus 5, Fable 5), and an unsupported parameter would 400 every
    // request. A refusal surfaces as one, which the stop_reason check below handles.
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: REPLY_SCHEMA },
    },
    // Cached: identical for every user and turn. Per-car facts go in the messages below.
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        /**
         * The breakpoint that matters for cost. Caching is a prefix match, so this caches
         * the system prompt *and* the car's facts -- which are the same on every turn and
         * dwarf the prompt, so without a breakpoint here the bulk of each follow-up is
         * re-read at full price. Only the question and history below it vary.
         *
         * Measured: the system prompt alone is ~1200 tokens, over Sonnet 5's 1024-token
         * minimum, so the prefix caches even for a car with thin facts.
         */
        content: [
          {
            type: 'text' as const,
            text: `Reference material: the facts about my car. This is background, not a question — do not reply to it.\n\n${input.vehicleContext}`,
            cache_control: { type: 'ephemeral' as const },
          },
        ],
      },
      {
        role: 'assistant',
        content: 'Understood. I will use only those facts, and I will wait for your question.',
      },
      ...input.history.map((turn) => ({ role: turn.role, content: turn.text })),
      { role: 'user' as const, content: input.question },
    ],
  });

  // The owner closed the tab: stop paying for an answer nobody will read.
  const abort = () => stream.abort();
  input.signal?.addEventListener('abort', abort, { once: true });

  if (input.onTextDelta) {
    const decode = createAnswerPreview();
    // Deltas are the reply JSON, not prose: `text` is the schema's first property, so its
    // value arrives first and decodes into something worth showing.
    stream.on('text', (delta) => {
      const plain = decode(delta);
      if (plain) input.onTextDelta?.(plain);
    });
  }

  let response;
  try {
    response = await stream.finalMessage();
  } finally {
    input.signal?.removeEventListener('abort', abort);
  }

  // Before reading content: a refusal returns HTTP 200 with empty or partial content.
  if (response.stop_reason === 'refusal') {
    throw new Error('That question was declined by a safety filter. Try rephrasing it.');
  }

  const usage = response.usage;
  return {
    reply: parseReply(response.content),
    timing: {
      ms: Date.now() - startedAt,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * Pulls the reply out of the response blocks. Defensive despite the schema: a `max_tokens`
 * stop or a thinking block means the text is not `content[0]`.
 */
function parseReply(content: { type: string; text?: string }[]): AskReply {
  const text = content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');

  if (!text.trim()) throw new Error('Ask CA returned an empty response');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Structured outputs should make this impossible, but failing loudly beats showing
    // the owner a blob of JSON.
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
