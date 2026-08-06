/**
 * Refuses a paid endpoint to an owner who has not tapped through the paywall. Not a duplicate
 * of the client gate: that is what the owner sees, this is what makes the tap mean something.
 * A free owner reaching an assessment by URL, a stale tab or a direct API call would
 * otherwise get the feature without deciding to.
 *
 * 402 rather than 403, so the client can tell "you have not unlocked this" from "this is not
 * yours" and offer the paywall instead of an error.
 */
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/httpError.js';
import { userIdOf } from './currentUser.js';
import { isUnlocked } from '../services/paywall.js';

export async function requirePaid(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  let unlocked: boolean;
  try {
    unlocked = await isUnlocked(req.db, userIdOf(req));
  } catch (error) {
    next(error);
    return;
  }

  // Outside the try: next() runs the rest of the chain synchronously, so a downstream throw
  // caught here would call next() twice for one request.
  if (unlocked) {
    next();
    return;
  }
  next(HttpError.paymentRequired());
}
