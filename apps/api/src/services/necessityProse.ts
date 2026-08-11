/**
 * The necessity verdict in words.
 *
 * TWO LAYERS, AND THE BOTTOM ONE IS THE REAL ANSWER. `writeNecessityProse` composes a headline,
 * a badge and a body out of the signals in code. Claude then rewrites the body so it reads like
 * a sentence rather than a list. If Claude is not configured, is slow, or fails, the composed
 * body ships as-is -- it is a true, complete answer, not a placeholder, so the fallback path is
 * not a degraded product and nothing has to announce it. This is deliberately unlike Ask CA,
 * where a failed call produces a sentence saying so, because there the model IS the answer.
 *
 * THE MODEL NEVER PICKS THE BAND, THE HEADLINE OR THE BADGE. It is handed the band as settled and
 * given the signal sentences as its only material -- see services/necessity.ts for why. It cannot
 * reach the car's data, the prices, or anything else, so the worst a bad rewrite can do is read
 * poorly; it cannot change the verdict or invent a fact, and the signals travel to the browser
 * beside the prose so an owner can check it against them.
 *
 * IT MUST NOT DIAGNOSE, and is told so in as many words. "Your pads are worn" is a claim about a
 * car nobody here has seen. Everything it may say is a claim about a record: what the owner
 * reported, what other owners of this model reported and at what mileage, what the factory
 * schedule lists, what the owner has already had done.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { NecessityBand } from '@caradvocate/shared';
import { env } from '../env.js';
import type { NecessityFinding } from './necessity.js';

/** Sonnet, like Ask CA. This is a rewrite of supplied sentences, not reasoning over facts. */
const MODEL = 'claude-sonnet-5';

/** Two or three sentences. Room to overrun without room to write an essay. */
const MAX_TOKENS = 400;

/**
 * Low, not medium. Ask CA runs at medium because it decides what to say; this is told what to
 * say and only chooses how to phrase it, and the create request is already waiting on a metered
 * pricing call.
 */
const EFFORT = 'low' as const;

/**
 * The rewrite is a nicety and the composed body is not, so the ceiling is short. Longer would
 * mean an owner staring at a spinner to get the same content in slightly better prose.
 */
const DEADLINE_MS = 8_000;

/** Fixed per band. Written here, never by the model, so an owner sees one of exactly three. */
const VERDICTS: Readonly<
  Record<NecessityBand, { headline: string; badge: string; instruction: string }>
> = {
  holds_up: {
    headline: 'This holds up against your car',
    badge: 'SUPPORTED',
    instruction:
      'Something in this car\'s own record backs the repair up. Say what, and say it plainly. Do not promise the repair is necessary -- only that nothing here contradicts it and something supports it.',
  },
  worth_questioning: {
    headline: 'Worth questioning before you agree',
    badge: 'WORTH ASKING',
    instruction:
      'Something in this car\'s own record sits against the repair. Say what it is and suggest the owner ask the shop about that specific point. Do not say the repair is unnecessary or that the shop is wrong -- neither is known.',
  },
  not_enough: {
    headline: 'Not enough to say either way',
    badge: 'NOT ENOUGH TO SAY',
    instruction:
      'Nothing we hold speaks for or against this repair. Say so directly and say what was missing. Do not fill the gap with general advice about the repair, and do not imply the repair is either fine or suspect.',
  },
};

/** What a `not_enough` verdict was short of, in the owner's terms. */
const SHORTFALLS: Readonly<Record<string, string>> = {
  never_asked:
    'This assessment was created before we started asking what prompted a repair, so there is nothing to weigh it against.',
  nothing_to_check_against:
    'We hold no owner-report pattern for this part on this model, and no manufacturer schedule for this car, so there was nothing independent to check it against.',
  nothing_spoke_either_way:
    'We checked what we hold about this car and this model, and none of it points either way.',
};

export interface NecessityProse {
  headline: string;
  badge: string;
  body: string;
}

/**
 * The fixed headline and badge for a band. Exported for the seed, which must stay offline and
 * deterministic (db/fixtures.ts) and so composes its prose rather than calling a model -- the
 * same three words an owner sees either way, because these were never the model's to choose.
 */
export function necessityVerdict(band: NecessityBand): { headline: string; badge: string } {
  const { headline, badge } = VERDICTS[band];
  return { headline, badge };
}

/**
 * The verdict as three fields ready for the assessment row.
 *
 * Never throws and never leaves the caller without prose: every failure below falls through to
 * the composed body. An assessment must not fail to save because a language model was busy.
 */
export async function writeNecessityProse(finding: NecessityFinding): Promise<NecessityProse> {
  const verdict = VERDICTS[finding.band];
  const body = composeBody(finding);

  if (!env.ANTHROPIC_API_KEY) return { ...verdict, body };

  try {
    const rewritten = await rewrite(finding, body);
    return { headline: verdict.headline, badge: verdict.badge, body: rewritten ?? body };
  } catch (error) {
    // Logged, not surfaced: the owner is about to be shown a complete answer either way, and a
    // silent swallow would let a permanently broken key go unnoticed for weeks.
    console.warn('Necessity prose fell back to the composed body:', describe(error));
    return { headline: verdict.headline, badge: verdict.badge, body };
  }
}

/**
 * The body written in code: the signals, in the order the rules produced them, plus a sentence
 * saying what was missing when the band fell short.
 *
 * This is the answer. The rewrite above only makes it read better, which is why the two are
 * interchangeable and why nothing tells the owner which one they got.
 */
export function composeBody(finding: NecessityFinding): string {
  const sentences = finding.signals.map((signal) => signal.detail);

  const shortfall = shortfallSentence(finding);
  if (shortfall) sentences.push(shortfall);

  // Only possible if every rule stayed silent, which the shortfall above covers -- but a verdict
  // card with an empty body would be the one failure mode worth a guard.
  if (sentences.length === 0) {
    return 'We could not find anything about this car to weigh this repair against.';
  }

  return sentences.join(' ');
}

/**
 * What was missing, when that is not already said. `never_asked` is the one shortfall the signals
 * themselves state -- there is exactly one signal in that case and it says the same thing -- so
 * adding it would say it twice, in both the composed body and the rewrite.
 */
function shortfallSentence(finding: NecessityFinding): string | undefined {
  if (!finding.shortfall || finding.shortfall === 'never_asked') return undefined;
  return SHORTFALLS[finding.shortfall];
}

let client: Anthropic | undefined;

function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    body: {
      type: 'string',
      description: 'Two to four short sentences for the car owner. Plain text, no formatting.',
    },
  },
  required: ['body'],
  additionalProperties: false,
} as const;

/**
 * The rules, as prohibitions rather than requests -- the same posture as askClaude.ts, and for
 * the same reason: this text goes out over a paid verdict and there is no reviewer between the
 * model and the owner.
 */
const SYSTEM_PROMPT = `You rewrite a finished verdict about a car repair so the car's owner can read it easily.

You are given: the verdict, which is already decided, and the facts it was decided from. Rewrite the facts into two to four short sentences addressed to the owner.

Rules:
- Use ONLY the facts you are given. Do not add any figure, part, symptom, price, date or mileage that is not in them.
- Do not diagnose. You have never seen this car. You may say what a record shows; you may not say what is wrong with the vehicle.
- Do not change the verdict, soften it, or strengthen it. It is settled.
- Do not say a repair is or is not necessary. That is not the claim being made.
- Owner reports about a model are reports, not proof of a fault on this car. Do not present them as proof.
- No recommendations beyond what the verdict itself says, and no reassurance ("nothing to worry about") of any kind.
- Second person, plain words, no jargon, no bullet points, no headings, no markdown.`;

/** The rewritten body, or undefined if the model gave back nothing usable. */
async function rewrite(finding: NecessityFinding, composed: string): Promise<string | undefined> {
  const verdict = VERDICTS[finding.band];

  const facts = finding.signals
    .map((signal) => `- [${signal.stance}] ${signal.detail}`)
    .join('\n');
  const shortfall = shortfallSentence(finding);

  const response = await anthropic().messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema: REWRITE_SCHEMA } },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: `Verdict: ${verdict.headline}
${verdict.instruction}

Facts it was decided from:
${facts}${shortfall ? `\n- [neutral] ${shortfall}` : ''}

For reference, these facts joined together read as: ${composed}`,
        },
      ],
    },
    { timeout: DEADLINE_MS },
  );

  if (response.stop_reason === 'refusal') return undefined;

  const text = response.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => (block as { text: string }).text)
    .join('');

  if (!text.trim()) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  const body = (parsed as { body?: unknown }).body;
  if (typeof body !== 'string' || body.trim().length === 0) return undefined;
  return body.trim();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
