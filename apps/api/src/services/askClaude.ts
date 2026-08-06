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
import type { ChatCtaPrefill, ChatMessage, ChatSource, ChatSourceKind, Severity } from '@caradvocate/shared';
import { env } from '../env.js';
import { createAnswerPreview } from './answerPreview.js';
import type { CatalogueEntry, VehicleContext } from './vehicleContext.js';

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

/**
 * A hard ceiling on one answer, ours rather than the SDK's.
 *
 * The SDK defaults to a ten-minute timeout and retries twice, so a genuinely stuck call could
 * leave someone watching a typing indicator for half an hour. Measured answers land around 5s
 * with the slowest observed near 17s, so 45s is far outside normal and only fires on a hang.
 *
 * Enforced by aborting the stream rather than by the SDK's own `timeout`, because this has to
 * cover retries too: an SDK-level timeout applies per attempt, and three attempts of 45s is not
 * a 45s ceiling. Surfaced as its own error so the owner is told it took too long, rather than
 * getting the silence reserved for someone who closed the tab.
 */
const DEADLINE_MS = 45_000;

/** Recognised by routes/chat.ts, which turns it into something the owner can act on. */
export const TIMED_OUT = 'Ask CA took too long to answer';

export interface AskInput {
  /** The owner's question. */
  question: string;
  /** Their car, its recalls, complaints, upkeep and history -- see vehicleContext.ts. */
  vehicleContext: VehicleContext;
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

WHEN THEY ASK ABOUT PRICE
- You still must not name a figure. No number, no range, no "usually around", no "expect a few hundred". That rule does not bend, and nothing below softens it.
- But do not answer a price question by leading with what you lack. "I don't have pricing data" describes a limit of this conversation and reads as a limit of the app, which is wrong and sells the owner short: pricing a repair against real figures for their model is precisely what the Repair Cost Checker does. Hand the question over rather than apologising for it, in one short sentence, and set the cta.
- Do not promise what it will say. It prices per year/make/model and does not cover every vehicle, so "that is what the Repair Cost Checker is for" is right and "it will show you the fair price is X" is not.
- If they do not yet know which repair they need, say what would pin it down — and still point them at the checker. Choosing the repair is its first step, not something they must arrive with.

THE REPLY FIELDS
- text: your answer.
- urgency: set this ONLY when the facts you were given support it AND this turn is actually about the car. A greeting, a thank-you or an acknowledgement gets null however overdue their upkeep is — an urgency banner on "hi" is noise, and noise is what stops the real one being read. Otherwise: an unrepaired stop-driving recall is high. A repeatedly-reported safety component, or an overdue upkeep job, is medium. Something to mention at the next service is low. Set it to null when nothing in the facts justifies one — an invented urgency level is worse than none.
- cta: set to {"action": "start_assessment"} whenever the owner asks what a repair should cost, whether a quote they have is fair, or anything else about what they will pay — including when they do not yet know which repair it is. Otherwise null, and never on a greeting. One exception: when they name a job that is plainly NOT in REPAIRS THE COST CHECKER COVERS, leave it null and say the checker does not cover that one. Sending them to a form that cannot help is worse than telling them so.
- cta.repair: when the question is clearly about one of the jobs in REPAIRS THE COST CHECKER COVERS, copy that entry's name EXACTLY as written there, so the checker opens with it already chosen. Character for character — a name you have adjusted or invented will not be recognised and the owner lands on an empty form. Null when the question is not about a specific job on that list, or when you are unsure which of two it is: guessing wrong is worse than leaving it, because a wrong preselection is something they have to notice before they can undo it.
- cta.quotedAmount: the whole dollars the owner said they were quoted, if they said a figure — "they want $640" is 640. Null otherwise. This is only ever THEIR number repeated back into a box they can edit. Never put your own estimate here: you have no pricing, and a number you produced appearing in the form as though they had given it is the worst version of inventing one.
- sources: which parts of the facts block this answer actually rested on, so the owner can see where it came from. List a kind if you used anything from that section — a count you quoted, a date, a status, a campaign number, or a fact you leaned on without naming. If removing that section would have changed a single sentence, list it. Do not list a section you merely had available and did not use. An answer about a recall is ["recalls"], possibly with "vehicle"; one that compares their mileage against what owners report is ["vehicle", "owner_reports"]. A greeting, a thank-you, or anything you answered from general knowledge is [] — claiming their service history informed "hi" is a small lie that makes the whole line worthless. You choose kinds only; the app writes what the owner reads.`;

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
          properties: {
            action: { type: 'string', enum: ['start_assessment'] },
            repair: {
              anyOf: [{ type: 'string' }, { type: 'null' }],
              description: 'Exact repair name copied from the catalogue, when the question is clearly about one of them.',
            },
            quotedAmount: {
              anyOf: [{ type: 'number' }, { type: 'null' }],
              description: 'Whole dollars the owner said they were quoted, if they said one.',
            },
          },
          required: ['action', 'repair', 'quotedAmount'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    /**
     * Kinds only. The model says which parts of the block it leaned on; it never writes the
     * wording or the counts the owner reads, and anything the block did not contain is dropped
     * in parseReply. An enum rather than free text so an unknown source cannot be expressed.
     */
    sources: {
      type: 'array',
      description: 'Which kinds of fact this answer actually drew on. Empty when it drew on none.',
      items: {
        type: 'string',
        enum: ['vehicle', 'recalls', 'owner_reports', 'upkeep', 'service_history'],
      },
    },
  },
  required: ['text', 'urgency', 'cta', 'sources'],
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
            text: `Reference material: the facts about my car. This is background, not a question — do not reply to it.\n\n${input.vehicleContext.text}`,
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

  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    stream.abort();
  }, DEADLINE_MS);

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
  } catch (cause) {
    // An abort reads as a generic request error, so the reason has to come from our own flag.
    if (timedOut) throw new Error(TIMED_OUT);
    throw cause;
  } finally {
    clearTimeout(deadline);
    input.signal?.removeEventListener('abort', abort);
  }

  // Before reading content: a refusal returns HTTP 200 with empty or partial content.
  if (response.stop_reason === 'refusal') {
    throw new Error('That question was declined by a safety filter. Try rephrasing it.');
  }

  const usage = response.usage;
  return {
    reply: parseReply(response.content, input.vehicleContext.sources, input.vehicleContext.repairs),
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
function parseReply(
  content: { type: string; text?: string }[],
  available: ChatSource[],
  catalogue: CatalogueEntry[],
): AskReply {
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

  // Seen once: a reply that stopped mid-sentence at 47 tokens with stop_reason `end_turn`, far
  // short of max_tokens, and not reproduced in eight repeats of the same question. Too thin a
  // signal to guard against -- a punctuation rule would reject legitimate answers -- but logging
  // it turns "someone saw it once" into a frequency, which is what a fix would need.
  if (!/[.!?"')\]]\s*$/.test(answer)) {
    console.warn(`Ask CA: reply may be cut off, ends "${answer.slice(-40)}"`);
  }

  const reply: AskReply = { role: 'assistant', text: answer };

  const urgency = record.urgency as { level?: unknown; text?: unknown } | null | undefined;
  if (urgency && isSeverity(urgency.level) && typeof urgency.text === 'string' && urgency.text.trim()) {
    reply.urgency = { level: urgency.level, text: urgency.text.trim() };
  }

  const cta = record.cta as { action?: unknown; repair?: unknown; quotedAmount?: unknown } | null | undefined;
  if (cta && cta.action === 'start_assessment') {
    // Label supplied here, not by the model, so it matches what the UI renders.
    reply.cta = { label: CTA_LABEL, action: 'start_assessment' };
    const prefill = resolvePrefill(cta.repair, cta.quotedAmount, catalogue);
    if (prefill) reply.cta.prefill = prefill;
  }

  const sources = resolveSources(record.sources, available);
  if (sources.length > 0) reply.sources = sources;

  return reply;
}

/**
 * Turns the kinds the model named into the lines the owner reads.
 *
 * Every kind is looked up in what the facts block actually held, so a kind the block did not
 * contain is dropped rather than shown -- the model cannot cite data it was never given, even
 * if it says it did. Order comes from `available`, not from the model, so the row is stable
 * across turns. Deduplicated because a repeated kind is a duplicate line, not two sources.
 */
function resolveSources(claimed: unknown, available: ChatSource[]): ChatSource[] {
  if (!Array.isArray(claimed)) return [];

  const named = new Set(claimed.filter((kind): kind is ChatSourceKind => typeof kind === 'string'));
  return available.filter((source) => named.has(source.kind));
}

/**
 * Turns a named repair into something the Repair Cost Checker can actually open with.
 *
 * The model names a repair; this finds it in the owner's own catalogue and supplies the id and
 * the catalogue's own wording. A name that does not match is dropped rather than guessed at --
 * fuzzy matching would eventually preselect the wrong job, and a wrong preselection is worse
 * than none, because the owner has to notice it before they can undo it.
 *
 * The quote is bounded rather than trusted. It is meant to be the owner's own figure repeated
 * back, so anything that is not a plausible whole-dollar amount is dropped; the upper bound is
 * a sanity check, not a business rule, because a misread landing in the form would look exactly
 * like the app inventing a price. It is editable either way.
 */
function resolvePrefill(
  named: unknown,
  quoted: unknown,
  catalogue: CatalogueEntry[],
): ChatCtaPrefill | undefined {
  if (typeof named !== 'string' || !named.trim()) return undefined;

  const wanted = named.trim().toLowerCase();
  const match = catalogue.find((entry) => entry.name.toLowerCase() === wanted);
  if (!match) return undefined;

  const prefill: ChatCtaPrefill = { repairId: match.id, repairName: match.name };

  if (typeof quoted === 'number' && Number.isFinite(quoted)) {
    const dollars = Math.round(quoted);
    if (dollars > 0 && dollars <= 100_000) prefill.quoteAmount = dollars;
  }

  return prefill;
}

function isSeverity(value: unknown): value is Severity {
  return value === 'low' || value === 'medium' || value === 'high';
}
