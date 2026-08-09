import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getAuthConfig } from './authConfig';

/**
 * The Supabase client is created lazily, because its URL and anon key come from the API rather
 * than the bundle. `undefined` when no credentials could be obtained, which leaves the app unable
 * to sign anyone in.
 *
 * A CLIENT IS CACHED; THE ABSENCE OF ONE IS NOT. Caching `undefined` here would undo the retry in
 * authConfig.ts one layer up -- the config would be re-fetched and succeed, and this would keep
 * handing back the `undefined` it resolved to the first time. The two caches have to agree about
 * what is worth keeping, and neither should keep a failure.
 */
let clientPromise: Promise<SupabaseClient | undefined> | undefined;

export function getSupabase(): Promise<SupabaseClient | undefined> {
  clientPromise ??= getAuthConfig().then((config) => {
    if (!config.supabaseUrl || !config.anonKey) {
      clientPromise = undefined;
      return undefined;
    }

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
