/**
 * Ask CA conversations are deliberately not stored, so there is no GET here and no chat
 * table. Persisting and deleting on exit fails exactly when it matters -- a closed tab, a
 * refresh or a crash skips the cleanup, and every miss leaves rows that reappear as history.
 * The client holds the turns while the screen is open and sends them with the next question.
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
import { askCarAdvocate, askIsConfigured, TIMED_OUT, type AskReply, type AskTiming } from '../services/askClaude.js';
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
 * Answers one question. Nothing is written to the database. Claude answers when
 * ANTHROPIC_API_KEY is set (services/askClaude.ts); without a key, canned replies.
 */
chatRouter.post('/', askLimit, validateBody(sendChatMessageSchema), async (req, res) => {
  const { text, history } = req.body;

  // Oldest messages drop first: a follow-up refers to what was just said.
  const recent = history.slice(-HISTORY_MESSAGES);

  if (!askIsConfigured()) {
    // Which canned reply comes next is read off the conversation in hand, not a stored count.
    const reply = nextReply(recent.filter((turn: { role: string }) => turn.role === 'assistant').length);
    openStream(res);
    sendMessage(res, text, reply);
    return res.end();
  }

  // Above the stream on purpose: a missing vehicle is a setup problem, and it deserves the
  // error envelope rather than being dressed up as an assistant failure.
  const vehicle = await requireOwnVehicle(req);

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
  } catch (cause) {
    // The owner leaving is not a failure, and there is nobody left to tell.
    if (!aborted.signal.aborted) {
      console.error(`Ask CA failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      // A `delta` preview may already be on screen. Sending the final message replaces it, which
      // is why the client renders from `message` and never from the deltas it has accumulated.
      sendMessage(res, text, { role: 'assistant', text: failureText(cause) });
    }
  }

  res.end();
});

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
