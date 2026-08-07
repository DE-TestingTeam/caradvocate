/**
 * Ask CA conversations are not stored AS HISTORY, so there is still no GET here. Persisting
 * and deleting on exit fails exactly when it matters -- a closed tab, a refresh or a crash
 * skips the cleanup, and every miss leaves rows that reappear as history. The client holds the
 * turns while the screen is open and sends them with the next question.
 *
 * Every exchange IS written to `ask_transcripts` for review, which is a different thing and
 * safe for the same reason the above is not: nothing reads those rows back into the app. The
 * write happens after the answer is on the wire and cannot fail the request -- see
 * services/askTranscripts.ts.
 *
 * The tradeoff: history arrives from the client, so an owner could hand the model turns it
 * never produced. That only lets them mislead themselves -- the grounding facts still come
 * from the database on every request.
 *
 * The reply is streamed as server-sent events, because a buffered answer meant the owner
 * watched a typing indicator for the whole generation. Two things about the wire format are
 * load-bearing:
 *
 *   - `delta` events are a PREVIEW. They are unvalidated model output and the client must not
 *     keep them. The `message` event carries the reply that went through the schema and
 *     parseReply, and it always arrives -- on success, on refusal, and on failure.
 *   - Anything that must fail as a real HTTP error has to happen BEFORE the first byte. Once
 *     the stream is open the status line is already 200 and the error envelope is gone, so the
 *     "no vehicle on file" check stays above openStream() where errorHandler can still see it.
 */
import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { sendChatMessageSchema } from '@caradvocate/shared';
import type { ChatMessage } from '@caradvocate/shared';
import { askLimit } from '../middleware/askLimit.js';
import { validateBody } from '../middleware/validate.js';
import {
  askCarAdvocate,
  askIsConfigured,
  MODEL,
  TIMED_OUT,
  type AskReply,
  type AskTiming,
} from '../services/askClaude.js';
import { record, type AskOutcome } from '../services/askTranscripts.js';
import { nextReply } from '../services/chatReplies.js';
import { buildVehicleContext } from '../services/vehicleContext.js';
import { requireOwnVehicle } from './helpers.js';

export const chatRouter = Router();

/**
 * How many prior messages to send on. Enough for a follow-up to make sense without resending a
 * long conversation; the cached system prefix carries the cost. Messages, not exchanges: ten of
 * these is five turns each way.
 */
const HISTORY_MESSAGES = 10;

/** What the owner sees when the model could not be reached. Never a canned answer in disguise. */
const FAILED = 'Something went wrong reaching the assistant, so this question has not been answered. Try again in a moment.';

/** Distinct from FAILED: nothing is broken, it just did not finish, and retrying is reasonable. */
const TOO_SLOW = 'That took too long to answer, so it has been stopped. Try asking again — shorter questions come back faster.';

/**
 * Answers one question. Claude answers when ANTHROPIC_API_KEY is set
 * (services/askClaude.ts); without a key, canned replies.
 *
 * The only write is the QA transcript, and it is the last thing every branch does. Note what is
 * NOT stored: the facts block that grounded the answer. It runs to kilobytes per exchange and is
 * mostly reference data the database still holds, so `ask_transcript_sources` records which
 * blocks the model leaned on instead. A reviewer who needs the exact wording of a block can
 * rebuild it from the transcript's `vehicle_id`.
 */
// Validation first, then the throttle. The throttle exists to bound what the model costs, and a
// malformed request never reaches the model -- charging it against the owner's allowance would
// let a buggy client lock them out of a feature it never actually spent anything on.
chatRouter.post('/', validateBody(sendChatMessageSchema), askLimit, async (req, res) => {
  const { text, history } = req.body;

  // Oldest messages drop first: a follow-up refers to what was just said.
  const recent = history.slice(-HISTORY_MESSAGES);

  // Above the stream, and above the canned branch, on purpose. A missing vehicle is a setup
  // problem and deserves the error envelope rather than being dressed up as an assistant
  // failure -- and that has to hold whether or not a key is configured. It used to be checked
  // only on the configured path, so a developer running without a key and without a car got
  // confident canned answers about a vehicle that did not exist.
  const vehicle = await requireOwnVehicle(req);

  // Every branch below records the exchange through this, so the shared identity of the
  // conversation is stated once. Recording is deliberately the last thing each branch does.
  const transcript = (outcome: AskOutcome, reply: AskReply | null, extra: TranscriptExtra = {}) =>
    record(req.db, {
      userId: vehicle.userId,
      vehicleId: vehicle.id,
      question: text,
      reply,
      outcome,
      historyMessages: recent.length,
      ...extra,
    });

  if (!askIsConfigured()) {
    // Which canned reply comes next is read off the conversation in hand, not a stored count.
    const reply = nextReply(recent.filter((turn: { role: string }) => turn.role === 'assistant').length);
    openStream(res);
    sendMessage(res, text, reply);
    // Recorded, though no model wrote it. A row that is absent is indistinguishable from a
    // question nobody asked; `outcome: 'canned'` says plainly that this one is not evidence.
    await transcript('canned', reply);
    return res.end();
  }

  const aborted = new AbortController();
  // 'close' also fires on a normal finish, so only abort while an answer is still in flight.
  req.on('close', () => {
    if (!res.writableEnded) aborted.abort();
  });

  openStream(res);

  try {
    const vehicleContext = await buildVehicleContext(req.db, vehicle);
    const { reply, timing } = await askCarAdvocate({
      question: text,
      vehicleContext,
      history: recent,
      signal: aborted.signal,
      onTextDelta: (delta) => sendEvent(res, 'delta', { text: delta }),
    });

    logTiming(timing);
    sendMessage(res, text, reply);
    // After the answer is on the wire, on purpose: a QA write must never sit between the model
    // finishing and the owner reading it.
    await transcript('answered', reply, { model: MODEL, timing });
  } catch (cause) {
    // The owner leaving is not a failure, and there is nobody left to tell.
    if (aborted.signal.aborted) {
      // Still worth a row. Nobody saw an answer, so there is none to store, but a climbing
      // abandoned rate is the clearest signal that answers are taking too long.
      await transcript('abandoned', null, { model: MODEL });
    } else {
      console.error(`Ask CA failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      // A `delta` preview may already be on screen. Sending the final message replaces it, which
      // is why the client renders from `message` and never from the deltas it has accumulated.
      const reply: AskReply = { role: 'assistant', text: failureText(cause) };
      sendMessage(res, text, reply);
      // The sentence the owner actually got, under the outcome that explains it -- so a review
      // queue can separate "the model refused" from "the vendor was down" without parsing prose.
      await transcript(outcomeOf(cause), reply, { model: MODEL });
    }
  }

  res.end();
});

/** The per-branch half of a transcript: what varies between a canned reply and a real call. */
type TranscriptExtra = { model?: string; timing?: AskTiming };

/**
 * The machine-readable counterpart to failureText: same three cases, so the stored outcome and
 * the sentence the owner read can never describe different failures.
 */
function outcomeOf(cause: unknown): AskOutcome {
  if (!(cause instanceof Error)) return 'failed';
  if (cause.message === TIMED_OUT) return 'timed_out';
  if (cause.message.includes('declined')) return 'declined';
  return 'failed';
}

/**
 * Which sentence the owner gets. A safety-filter refusal already explains itself and says to
 * rephrase, so it is passed through as-is; a timeout is worth distinguishing from a breakage
 * because the advice differs; everything else is the same honest admission that no answer came.
 */
function failureText(cause: unknown): string {
  if (!(cause instanceof Error)) return FAILED;
  if (cause.message === TIMED_OUT) return TOO_SLOW;
  if (cause.message.includes('declined')) return cause.message;
  return FAILED;
}

/**
 * Opens the event stream. `no-transform` and the nginx hint keep an intermediary from buffering
 * the whole response and undoing the point of streaming.
 */
function openStream(res: Response): void {
  res.status(201);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/**
 * `destroyed` as well as `writableEnded`: a disconnect leaves the response un-ended but its
 * socket gone, and writing to that throws where nothing is listening to catch it.
 *
 * JSON.stringify keeps each frame on one line, which is what makes the blank-line framing safe --
 * a newline inside the answer is escaped as `\\n` and never looks like a frame boundary.
 */
function sendEvent(res: Response, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * The turn as the client should keep it. Ids exist for React keys and nothing else -- there is
 * no row to address.
 */
function sendMessage(res: Response, question: string, reply: AskReply): void {
  sendEvent(res, 'message', {
    user: { id: randomUUID(), role: 'user', text: question } satisfies ChatMessage,
    assistant: { id: randomUUID(), ...reply } satisfies ChatMessage,
  });
}

/**
 * One line per answer. There is no telemetry here and no test suite, so this is the only way to
 * tell whether a change to effort or to the facts block actually moved anything. `cacheRead`
 * near zero across a conversation means the prefix is being invalidated -- see askClaude.ts.
 */
function logTiming(timing: AskTiming): void {
  console.log(
    `Ask CA: ${timing.ms}ms in=${timing.inputTokens} out=${timing.outputTokens} ` +
      `cacheRead=${timing.cacheReadTokens} cacheWrite=${timing.cacheWriteTokens}`,
  );
}
