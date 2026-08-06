/**
 * How a request becomes a user -- the seam the rest of the API is built around. Routes only read
 * `req.user.id` and filter every query on it, so swapping resolvers changes who a request
 * belongs to without touching a route.
 *
 * There is one resolver and no bypass: a verified Supabase token is the only way to be anybody.
 * A tokenless request is a 401 in every environment.
 */
import type { Request } from 'express';
import { HttpError } from '../lib/httpError.js';
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

export function defaultResolver(): UserResolver {
  return supabaseResolver;
}
