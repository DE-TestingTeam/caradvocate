/**
 * Refuses a paid endpoint to an owner who has not tapped through the paywall.
 *
 * The client gates the routes too, and this is not a duplicate of that: the client
 * gate is what the owner sees, and this is what makes the tap mean something. A free
 * owner who reaches an assessment by typing the URL, keeping a stale tab open, or
 * calling the API directly would otherwise get the paid feature without ever
 * deciding to -- and every one of those is a hole in the data the prototype exists
 * to collect.
 *
 * 402 rather than 403 so the client can tell "you have not unlocked this" apart from
 * "this is not yours", and offer the paywall instead of an error.
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

  // Outside the try on purpose: next() runs the rest of the chain synchronously, so
  // a downstream throw caught here would call next() a second time for one request.
  if (unlocked) {
    next();
    return;
  }
  next(HttpError.paymentRequired());
}
