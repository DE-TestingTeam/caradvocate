/**
 * Attaches `req.user`. Mounted once, ahead of every route that reads user data.
 *
 * The resolver itself lives in src/auth/resolvers.ts -- this file only defines
 * the contract and the middleware wrapper.
 */
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/httpError.js';
import type { Database } from '../db/index.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

/** How a request is turned into a user. */
export type UserResolver = (req: Request) => Promise<AuthenticatedUser>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      db: Database;
    }
  }
}

export function requireUser(resolve: UserResolver) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.user = await resolve(req);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Narrows `req.user` for route handlers. Throws rather than returning undefined,
 * so a route that somehow ran without the middleware fails loudly.
 */
export function userIdOf(req: Request): string {
  if (!req.user) throw HttpError.unauthenticated();
  return req.user.id;
}
