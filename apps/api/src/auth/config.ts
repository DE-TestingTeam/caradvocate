/**
 * Decides whether the API requires real sign-in.
 *
 * `supabase` mode verifies a bearer token on every request. `dev` mode
 * attributes every request to DEV_USER_EMAIL, which is what makes the
 * zero-setup local path work. The mode is derived from configuration alone, so
 * there is no flag anyone can flip by accident.
 */
import { env } from '../env.js';

export type AuthMode = 'supabase' | 'dev';

/**
 * Test seam. `env` is parsed once at import time, so a test cannot configure
 * Supabase by setting process.env afterwards. These overrides let the suite point
 * verification at a locally generated key set and issuer.
 */
interface AuthOverrides {
  supabaseUrl?: string;
  jwtSecret?: string;
}

let overrides: AuthOverrides = {};

export function setAuthConfigForTesting(next: AuthOverrides): void {
  overrides = next;
}

function supabaseUrl(): string | undefined {
  return overrides.supabaseUrl ?? env.SUPABASE_URL;
}

/** Set only on older projects that sign tokens with a shared HS256 secret. */
export function sharedSecret(): string | undefined {
  return overrides.jwtSecret ?? env.SUPABASE_JWT_SECRET;
}

export function authMode(): AuthMode {
  return supabaseUrl() || sharedSecret() ? 'supabase' : 'dev';
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
export function publicAuthConfig(): { mode: AuthMode; supabaseUrl?: string; anonKey?: string } {
  if (authMode() === 'dev') return { mode: 'dev' };
  return {
    mode: 'supabase',
    supabaseUrl: supabaseUrl(),
    anonKey: env.SUPABASE_ANON_KEY,
  };
}

/**
 * Production must not run on the dev stub. Checked at import time so a
 * misconfigured deploy fails to boot rather than serving one user's data to
 * everyone who connects.
 */
export function assertProductionSafe(): void {
  if (env.NODE_ENV === 'production' && authMode() === 'dev') {
    throw new Error(
      'Refusing to start: NODE_ENV=production with no Supabase Auth configured. ' +
        'Set SUPABASE_URL (and SUPABASE_ANON_KEY), or SUPABASE_JWT_SECRET.',
    );
  }
}
