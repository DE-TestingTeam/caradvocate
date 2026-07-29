import { and, asc, count, eq } from 'drizzle-orm';
import { Router } from 'express';
import { sendChatMessageSchema } from '@caradvocate/shared';
import { chatMessages } from '../db/schema.js';
import { toChatMessage } from '../mappers.js';
import { userIdOf } from '../middleware/currentUser.js';
import { validateBody } from '../middleware/validate.js';
import { nextReply } from '../services/chatReplies.js';

export const chatRouter = Router();

chatRouter.get('/', async (req, res) => {
  const rows = await req.db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.userId, userIdOf(req)))
    .orderBy(asc(chatMessages.createdAt));

  res.json(rows.map(toChatMessage));
});

/**
 * Persists the user's message and a canned assistant reply.
 *
 * Both are written in one transaction so a conversation can never end up with a
 * question and no answer. When the real model call goes in it will need to
 * happen between these two writes, and will want its own failure handling.
 */
chatRouter.post('/', validateBody(sendChatMessageSchema), async (req, res) => {
  const userId = userIdOf(req);

  const [{ value: assistantCount }] = await req.db
    .select({ value: count() })
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, userId), eq(chatMessages.role, 'assistant')));

  const reply = nextReply(Number(assistantCount));

  const result = await req.db.transaction(async (tx) => {
    const [userRow] = await tx
      .insert(chatMessages)
      .values({ userId, role: 'user', text: req.body.text })
      .returning();

    const [assistantRow] = await tx
      .insert(chatMessages)
      .values({
        userId,
        role: 'assistant',
        text: reply.text,
        urgencyLevel: reply.urgency?.level ?? null,
        urgencyText: reply.urgency?.text ?? null,
        ctaLabel: reply.cta?.label ?? null,
        ctaAction: reply.cta?.action ?? null,
      })
      .returning();

    return { userRow, assistantRow };
  });

  res.status(201).json({
    user: toChatMessage(result.userRow),
    assistant: toChatMessage(result.assistantRow),
  });
});
