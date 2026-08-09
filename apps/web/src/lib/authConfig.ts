import { http } from './http';

/**
 * The Supabase credentials the browser signs in with, fetched from the server rather than baked in
 * at build time so the two can never disagree about which project they are talking to.
 */
export interface AuthConfig {
  supabaseUrl?: string;
  anonKey?: string;
  /**
   * True when the request itself failed, as opposed to the server answering with no credentials.
   * The two look identical from here -- both leave us unable to sign anyone in -- but they need
   * different advice, and telling someone sign-in "is not configured" when the real problem was a
   * dropped connection sends them to check a server that is fine.
   */
  unreachable?: boolean;
}

/**
 * Only a SUCCESSFUL fetch is cached. A failure is deliberately not.
 *
 * This used to cache whatever came back, failures included, and that turned a momentary blip into
 * a permanently broken page: the empty config stuck for the life of the tab, `getSupabase()` cached
 * `undefined` on top of it, and every later sign-in threw "not configured" long after the server
 * came back. The only cure was a reload, which is a thing to know rather than a thing to expect
 * anyone to guess.
 *
 * Evicting on failure keeps the useful half of the cache -- concurrent callers still share one
 * in-flight request, so a page load does not fire several -- while letting the next attempt try
 * again. In practice that next attempt is the owner pressing the sign-in button, which is exactly
 * when a retry is wanted.
 */
let cached: Promise<AuthConfig> | undefined;

export function getAuthConfig(): Promise<AuthConfig> {
  cached ??= http
    .get<AuthConfig>('/auth/config')
    .then((config) => config ?? {})
    .catch(() => {
      // Cleared before resolving, so the caller awaiting this one still gets an answer -- it
      // cannot wait forever on a request that already failed -- and the next caller re-asks.
      cached = undefined;

      // Resolved rather than rejected: AuthProvider renders the login screen from this, and a
      // rejection there would surface as an unhandled error instead of a page someone can retry
      // from. A login screen is the safer failure; one that can never work is not.
      return { unreachable: true } satisfies AuthConfig;
    });

  return cached;
}
