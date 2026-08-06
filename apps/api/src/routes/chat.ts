/**
 * Ask CA conversations are deliberately not stored, so there is no GET here and no chat
 * table. Persisting and deleting on exit fails exactly when it matters -- a closed tab, a
 * refresh or a crash skips the cleanup, and every miss leaves rows that reappear as history.
 * The client holds the turns while the screen is open and sends them with the next question.
 *
 * The tradeoff: history arrives from the client, so an owner could hand the model turns it
 * never produced. That only lets them mislead themselves -- the grounding facts still come
 * from the database on every request.
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { sendChatMessageSchema } from '@caradvocate/shared';
import type { ChatMessage } from '@caradvocate/shared';
import { validateBody } from '../middleware/validate.js';
import { askCarAdvocate, askIsConfigured } from '../services/askClaude.js';
import { nextReply } from '../services/chatReplies.js';
import { buildVehicleContext } from '../services/vehicleContext.js';
import { requireOwnVehicle } from './helpers.js';

export const chatRouter = Router();

/**
 * How many prior turns to send on. Enough for a follow-up to make sense without resending a
 * long conversation; the cached system prefix carries the cost.
 */
const HISTORY_TURNS = 10;

/**
 * Answers one question. Nothing is written to the database. Claude answers when
 * ANTHROPIC_API_KEY is set (services/askClaude.ts); without a key, canned replies.
 */
chatRouter.post('/', validateBody(sendChatMessageSchema), async (req, res) => {
  const { text, history } = req.body;

  // Oldest turns drop first: a follow-up refers to what was just said.
  const recent = history.slice(-HISTORY_TURNS);
  const reply = await replyTo(req, text, recent);

  // Ids exist for React keys and nothing else -- there is no row to address.
  res.status(201).json({
    user: { id: randomUUID(), role: 'user', text } satisfies ChatMessage,
    assistant: { id: randomUUID(), ...reply } satisfies ChatMessage,
  });
});

/**
 * Produces the assistant's reply, whatever happens. With no key, the canned replies stand
 * in. With a key, the question goes to Claude grounded in this owner's car -- and if that
 * fails, the owner gets a sentence saying so rather than a canned answer dressed up as a
 * real one.
 */
async function replyTo(
  req: Parameters<typeof requireOwnVehicle>[0],
  question: string,
  history: { role: 'user' | 'assistant'; text: string }[],
) {
  if (!askIsConfigured()) {
    // Which canned reply comes next is read off the conversation in hand, not a stored count.
    return nextReply(history.filter((turn) => turn.role === 'assistant').length);
  }

  // Outside the try: a missing vehicle is a setup problem, and "something went wrong
  // reaching the assistant" would hide it.
  const vehicle = await requireOwnVehicle(req);

  try {
    return await askCarAdvocate({
      question,
      vehicleContext: await buildVehicleContext(req.db, vehicle),
      history,
    });
  } catch (cause) {
    console.error(`Ask CA failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return {
      role: 'assistant' as const,
      text:
        cause instanceof Error && cause.message.includes('declined')
          ? cause.message
          : 'Something went wrong reaching the assistant, so this question has not been answered. Try again in a moment.',
    };
  }
}
