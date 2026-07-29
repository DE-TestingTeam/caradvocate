import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getAuthConfig } from './authConfig';

/**
 * The Supabase client is created lazily, because its URL and anon key come from
 * the API rather than the bundle. In dev mode it is never created at all.
 */
let clientPromise: Promise<SupabaseClient | undefined> | undefined;

export function getSupabase(): Promise<SupabaseClient | undefined> {
  clientPromise ??= getAuthConfig().then((config) => {
    if (config.mode !== 'supabase' || !config.supabaseUrl || !config.anonKey) return undefined;

    return createClient(config.supabaseUrl, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The app has no OAuth callback route; tokens arrive via the session API.
        detectSessionInUrl: true,
      },
    });
  });

  return clientPromise;
}
