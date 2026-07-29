import { asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { updateAccountSchema } from '@caradvocate/shared';
import { userFeatures, users } from '../db/schema.js';
import { HttpError } from '../lib/httpError.js';
import { toAccount } from '../mappers.js';
import { userIdOf } from '../middleware/currentUser.js';
import { validateBody } from '../middleware/validate.js';

export const accountRouter = Router();

async function loadAccount(req: Parameters<Parameters<typeof accountRouter.get>[1]>[0]) {
  const userId = userIdOf(req);

  const [user] = await req.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw HttpError.notFound('Account not found');

  const features = await req.db
    .select()
    .from(userFeatures)
    .where(eq(userFeatures.userId, userId))
    .orderBy(asc(userFeatures.position));

  return toAccount(user, features);
}

accountRouter.get('/', async (req, res) => {
  res.json(await loadAccount(req));
});

accountRouter.patch('/', validateBody(updateAccountSchema), async (req, res) => {
  await req.db.update(users).set(req.body).where(eq(users.id, userIdOf(req)));
  res.json(await loadAccount(req));
});
