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
 * Ask CA conversations are deliberately not stored.
 *
 * The conversation clears when the owner leaves the screen, and the reliable way to
 * honour that is to never write it down. The alternative -- persist, then delete on
 * exit -- fails exactly when it matters: a closed tab, a refresh, a crash or a dropped
 * connection all skip the cleanup, and every miss leaves rows that reappear as history
 * on the next visit. The failure mode of the cleanup is the feature not happening.
 *
 * So there is no GET here and no chat table. The client holds the turns for as long as
 * the screen is open and sends them with the next question; when the screen goes, so do
 * they. Cross-user leakage also stops being possible, because there is nothing to leak.
 *
 * The tradeoff, stated plainly: history now arrives from the client, so an owner could
 * hand the model turns it never produced. That only lets them mislead themselves about
 * their own car -- the grounding facts still come from the database on every request --
 * and it is a smaller risk than a transcript that outlives the screen it was typed on.
 */

/**
 * How many prior turns to send on. Enough for a follow-up to make sense without
 * resending a long conversation every time; the cached system prefix carries the cost.
 */
const HISTORY_TURNS = 10;

/**
 * Answers one question. Nothing is written to the database.
 *
 * Ask CA answers with Claude when ANTHROPIC_API_KEY is set, grounded in this owner's
 * own car (see services/askClaude.ts). Without a key it falls back to canned replies,
 * the same configuration-decides-the-mode shape as the auth dev bypass.
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
 * Produces the assistant's reply, whatever happens.
 *
 * Three paths, and the ordering matters. With no key configured, the canned replies
 * stand in. With a key, the question goes to Claude grounded in this owner's car. If
 * that call fails -- network, rate limit, a declined question -- the owner gets an
 * honest sentence saying so rather than a canned answer dressed up as a real one:
 * pretending a fallback is an answer is exactly the kind of quiet fiction the rest of
 * this app refuses.
 */
async function replyTo(
  req: Parameters<typeof requireOwnVehicle>[0],
  question: string,
  history: { role: 'user' | 'assistant'; text: string }[],
) {
  if (!askIsConfigured()) {
    // Which canned reply comes next is now read off the conversation in hand rather
    // than a stored count, which is the same thing without the table.
    return nextReply(history.filter((turn) => turn.role === 'assistant').length);
  }

  // Deliberately outside the try: a missing vehicle is a setup problem, and answering
  // "something went wrong reaching the assistant" would hide it.
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
