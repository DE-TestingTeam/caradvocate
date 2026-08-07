/**
 * The paywall the Repair Cost Checker sits behind: what the offer is, and a tap on it. There
 * is deliberately no way to lock an account back up -- re-locking would let someone tap twice
 * for one decision and inflate the signal. See services/paywall.ts for why nobody is charged.
 */
import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../middleware/currentUser.js';
import { validateBody } from '../middleware/validate.js';
import { paywallStatusFor, recordUnlock } from '../services/paywall.js';
import type { PaywallStatus } from '@caradvocate/shared';

export const paywallRouter = Router();

/** The offer, plus whether this caller is already past it. */
paywallRouter.get('/', async (req, res) => {
  const status: PaywallStatus = await paywallStatusFor(req.db, userIdOf(req));
  res.json(status);
});

/**
 * Both fields are required rather than defaulted: an unattributed row cannot be read for
 * conversion by entry point or by offer, and a default would attribute every stray call to
 * one screen or one price.
 */
const unlockSchema = z.object({
  source: z.enum(['repair_cost_checker', 'account']),
  model: z.enum(['all_you_can_eat', 'per_incident']),
});

paywallRouter.post('/unlock', validateBody(unlockSchema), async (req, res) => {
  const status: PaywallStatus = await recordUnlock(req.db, userIdOf(req), req.body.source, req.body.model);
  res.json(status);
});
