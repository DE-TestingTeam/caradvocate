/**
 * Supabase Auth configuration. Sign-in is always required -- there is no bypass mode and no flag
 * that disables it, so an unconfigured deploy fails to boot rather than serving anybody.
 */
import { env } from '../env.js';

function supabaseUrl(): string | undefined {
  return env.SUPABASE_URL;
}

/** Set only on older projects that sign tokens with a shared HS256 secret. */
export function sharedSecret(): string | undefined {
  return env.SUPABASE_JWT_SECRET;
}

/** Whether a verification key is available at all. False means the API cannot authenticate anyone. */
export function isConfigured(): boolean {
  return Boolean(supabaseUrl() || sharedSecret());
}

/**
 * Supabase publishes its signing keys at /auth/v1/.well-known/jwks.json.
 * Returns undefined for shared-secret projects, which verify symmetrically.
 */
export function jwksUrl(): URL | undefined {
  if (env.SUPABASE_JWKS_URL) return new URL(env.SUPABASE_JWKS_URL);
  const base = supabaseUrl();
  if (!base) return undefined;
  return new URL('/auth/v1/.well-known/jwks.json', base);
}

/** Supabase issues tokens with this `iss`, which we pin when we know the URL. */
export function expectedIssuer(): string | undefined {
  const base = supabaseUrl();
  if (!base) return undefined;
  return new URL('/auth/v1', base).toString();
}

/** What the browser needs in order to sign in. Both values are public. */
export function publicAuthConfig(): { supabaseUrl?: string; anonKey?: string } {
  return {
    supabaseUrl: supabaseUrl(),
    anonKey: env.SUPABASE_ANON_KEY,
  };
}

/**
 * Sign-in is mandatory, so an API that cannot verify a token can serve nobody. Checked at boot in
 * every environment rather than production only -- a misconfigured dev server would otherwise 401
 * every request and look like broken auth instead of missing configuration.
 */
export function assertAuthConfigured(): void {
  if (!isConfigured()) {
    throw new Error(
      'Refusing to start: no Supabase Auth configured, and sign-in is required. ' +
        'Set SUPABASE_URL (and SUPABASE_ANON_KEY), or SUPABASE_JWT_SECRET.',
    );
  }
}
