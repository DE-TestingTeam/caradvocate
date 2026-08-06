/**
 * Bearer-token verification. Supabase signs access tokens either asymmetrically (against the
 * project's published JWKS) or, on older projects, with a shared HS256 secret. Both work;
 * JWKS is preferred because the secret never leaves Supabase.
 *
 * Checked: signature, expiry (jose enforces `exp`/`nbf`), issuer -- so a validly-signed token
 * from a *different* project cannot authenticate here -- audience, since Supabase marks
 * signed-in users `authenticated` and anon tokens carry another value, and subject.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { expectedIssuer, jwksUrl, sharedSecret } from './config.js';
import { HttpError } from '../lib/httpError.js';

export interface VerifiedIdentity {
  /** Supabase's user id, the `sub` claim. Stable for the life of the account. */
  supabaseUserId: string;
  email: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Cached across requests: refetching the JWKS per call would be slow and rude. */
let remoteJwks: JWTVerifyGetKey | undefined;

function getJwks(): JWTVerifyGetKey | undefined {
  if (remoteJwks) return remoteJwks;

  const url = jwksUrl();
  if (!url) return undefined;
  // jose handles caching, background rotation and cooldown on failure.
  remoteJwks = createRemoteJWKSet(url);
  return remoteJwks;
}

export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return undefined;
  return token.trim() || undefined;
}

/**
 * The identity behind a token, or a 401. Every rejection reason -- bad signature, expired, wrong
 * issuer, wrong audience, missing claim -- surfaces as the same vague message on purpose: which
 * check failed is not the caller's business, and saying so helps anyone probing for a valid token.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedIdentity> {
  const issuer = expectedIssuer();
  const options = {
    audience: 'authenticated',
    ...(issuer ? { issuer } : {}),
  };

  let payload: JWTPayload;
  try {
    const jwks = getJwks();
    const secret = jwks ? undefined : sharedSecret();
    if (jwks) {
      ({ payload } = await jwtVerify(token, jwks, options));
    } else if (secret) {
      ({ payload } = await jwtVerify(token, new TextEncoder().encode(secret), options));
    } else {
      throw new Error('No verification key configured');
    }
  } catch {
    // Deliberately vague to the client: which check failed is not its business.
    throw HttpError.unauthenticated('Invalid or expired session');
  }

  const supabaseUserId = typeof payload.sub === 'string' ? payload.sub : undefined;
  if (!supabaseUserId) {
    throw HttpError.unauthenticated('Token is missing a subject');
  }

  // Supabase subjects are UUIDs and the column is typed as one, so a malformed token is a 401
  // here rather than a database type error later.
  if (!UUID_PATTERN.test(supabaseUserId)) {
    throw HttpError.unauthenticated('Token subject is not a valid identifier');
  }

  const email = readEmail(payload);
  if (!email) {
    throw HttpError.unauthenticated('Token is missing an email address');
  }

  return { supabaseUserId, email };
}

/**
 * Supabase puts the address in `email`, but some flows carry it only in `user_metadata`, so
 * fall back rather than reject a legitimate session.
 */
function readEmail(payload: JWTPayload): string | undefined {
  if (typeof payload.email === 'string' && payload.email.length > 0) {
    return payload.email.toLowerCase();
  }
  const metadata = payload.user_metadata;
  if (metadata && typeof metadata === 'object' && 'email' in metadata) {
    const value = (metadata as Record<string, unknown>).email;
    if (typeof value === 'string' && value.length > 0) return value.toLowerCase();
  }
  return undefined;
}
