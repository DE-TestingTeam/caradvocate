/**
 * How a request becomes a user.
 *
 * This is the seam the rest of the API is built around: routes only ever read
 * `req.user.id` and filter every query on it, so swapping resolvers changes who
 * a request belongs to without touching a single route.
 */
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { users } from '../db/schema.js';
import { env } from '../env.js';
import { HttpError } from '../lib/httpError.js';
import { authMode } from './config.js';
import { provisionUser } from './provisionUser.js';
import { extractBearerToken, verifyAccessToken } from './verifyToken.js';
import type { AuthenticatedUser, UserResolver } from '../middleware/currentUser.js';

/** Verifies the bearer token, then provisions or loads the matching profile. */
export const supabaseResolver: UserResolver = async (req: Request): Promise<AuthenticatedUser> => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    throw HttpError.unauthenticated('Sign in to continue');
  }

  const identity = await verifyAccessToken(token);
  const profile = await provisionUser(req.db, identity);
  return { id: profile.id, email: profile.email };
};

/**
 * DEV ONLY. Attributes every request to DEV_USER_EMAIL so the app is usable with
 * no sign-in and no Supabase project. authMode() only selects this when Supabase
 * is unconfigured, and config.ts refuses to boot in production with it active.
 */
export const devResolver: UserResolver = async (req: Request): Promise<AuthenticatedUser> => {
  const [row] = await req.db
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
};

export function defaultResolver(): UserResolver {
  return authMode() === 'supabase' ? supabaseResolver : devResolver;
}
