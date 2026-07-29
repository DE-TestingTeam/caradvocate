/**
 * ============================================================================
 * TEMPORARY AUTH STUB -- this is the one file real authentication replaces.
 * ============================================================================
 *
 * Every request is currently attributed to the user named by DEV_USER_EMAIL.
 * Nothing else in the codebase knows that: routes only ever read `req.user.id`,
 * and every query filters on it. So swapping this stub for real sessions does
 * not touch route code.
 *
 * To add real auth, replace the body of `resolveUser` with something that:
 *
 *   1. Reads the session token from a signed, httpOnly cookie (or the
 *      Authorization header for API clients).
 *   2. Verifies it -- signature, expiry, revocation.
 *   3. Loads the matching user row.
 *   4. Throws HttpError.unauthenticated() when any of that fails.
 *
 * The rest of the work is additive and lives outside this file: a sessions
 * table, password hashes or an OAuth provider, login/logout/refresh routes, and
 * CSRF protection on cookie-authenticated mutations.
 *
 * Until then the stub refuses to start in production, so it cannot ship by
 * accident.
 */
import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';
import { env } from '../env.js';
import { HttpError } from '../lib/httpError.js';
import type { Database } from '../db/index.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      db: Database;
    }
  }
}

if (env.NODE_ENV === 'production') {
  throw new Error(
    'The dev auth stub (src/middleware/currentUser.ts) cannot run in production. ' +
      'Implement real session verification before deploying.',
  );
}

/** How a request is turned into a user. Real auth replaces this function. */
export type UserResolver = (req: Request) => Promise<AuthenticatedUser>;

export const devUserResolver: UserResolver = async (req) => resolveUser(req.db ?? getDb());

async function resolveUser(db: Database): Promise<AuthenticatedUser> {
  const [row] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, env.DEV_USER_EMAIL))
    .limit(1);

  if (!row) {
    throw HttpError.unauthenticated(
      `Dev user ${env.DEV_USER_EMAIL} not found. Run \`npm run db:seed\` or set DEV_USER_EMAIL.`,
    );
  }

  return row;
}

/**
 * Attaches `req.user`. Mount this ahead of every route that reads user data.
 * A route that forgets to filter by `req.user.id` is the bug this design is
 * meant to make obvious -- see test/isolation.test.ts.
 */
export function requireUser(resolve: UserResolver = devUserResolver) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      req.user = await resolve(req);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Narrows `req.user` for route handlers. Throws rather than returning undefined. */
export function userIdOf(req: Request): string {
  if (!req.user) throw HttpError.unauthenticated();
  return req.user.id;
}
