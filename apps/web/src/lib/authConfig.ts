import { http } from './http';

/**
 * Auth mode comes from the server, not from build-time env vars, so the browser
 * and the API can never disagree about whether sign-in is required.
 */
export interface AuthConfig {
  mode: 'supabase' | 'dev';
  supabaseUrl?: string;
  anonKey?: string;
}

let cached: Promise<AuthConfig> | undefined;

export function getAuthConfig(): Promise<AuthConfig> {
  cached ??= http.get<AuthConfig>('/auth/config').catch(() => {
    // If the API is unreachable we cannot know the mode. Assume sign-in is
    // required: showing a login screen is a safer failure than showing someone
    // an app that silently acts as a default user.
    return { mode: 'supabase' } as AuthConfig;
  });

  return cached;
}
