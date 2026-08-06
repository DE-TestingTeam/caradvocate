import { http } from './http';

/**
 * The Supabase credentials the browser signs in with, fetched from the server rather than baked in
 * at build time so the two can never disagree about which project they are talking to.
 */
export interface AuthConfig {
  supabaseUrl?: string;
  anonKey?: string;
}

let cached: Promise<AuthConfig> | undefined;

export function getAuthConfig(): Promise<AuthConfig> {
  // An unreachable API leaves us with no credentials, which AuthProvider treats as "not signed in"
  // -- a login screen is a safer failure than an app that renders as though it had a session.
  cached ??= http.get<AuthConfig>('/auth/config').catch(() => ({}) as AuthConfig);

  return cached;
}
