import * as React from 'react';
import type { Session } from '@supabase/supabase-js';
import { getAuthConfig, type AuthConfig } from './authConfig';
import { getSupabase } from './supabaseClient';
import { setAccessTokenGetter } from './http';
import { clearAllTranscripts } from './chatTranscript';

interface AuthState {
  /** undefined until the server has told us which Supabase project to sign in against. */
  config: AuthConfig | undefined;
  session: Session | null;
  loading: boolean;
  /** True only with a live session. There is no bypass -- see apps/api/src/auth/resolvers.ts. */
  authenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | undefined>(undefined);

/** Throws outside <AuthProvider>, so a component can treat the returned state as always present. */
export function useAuth(): AuthState {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = React.useState<AuthConfig>();
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Every API request reads the current token through this getter, so a refresh
  // is picked up without re-rendering anything.
  const sessionRef = React.useRef<Session | null>(null);
  sessionRef.current = session;
  React.useEffect(() => {
    setAccessTokenGetter(() => sessionRef.current?.access_token);
  }, []);

  React.useEffect(() => {
    let active = true;
    /**
     * Set once the listener exists. It has to live out here, because the subscription is created
     * inside an async function and React only ever sees what the EFFECT returns -- a cleanup
     * returned from the inner `async () => {}` becomes part of its promise and is never called.
     * That is what used to happen here, so the auth listener was never torn down while looking
     * like it was.
     */
    let unsubscribe: (() => void) | undefined;

    (async () => {
      try {
        const resolved = await getAuthConfig();
        if (!active) return;
        setConfig(resolved);

        const supabase = await getSupabase();
        if (!active) return;
        if (!supabase) return;

        /**
         * SUBSCRIBED BEFORE `getSession()` IS ASKED, not after. Between those two lines the
         * provider is blind, and a sign-in landing in that window used to be missed entirely --
         * `getSession()` had already answered "nobody", and the event announcing the new session
         * arrived before there was anything listening for it. The session then existed in
         * Supabase and nowhere else, so `authenticated` stayed false and the redirect off /login,
         * which is driven by that flag, never fired.
         *
         * Subscribing first cannot miss it. The listener also fires INITIAL_SESSION of its own
         * accord, so the `getSession()` below is belt and braces rather than the only source.
         */
        const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
          setSession(next);
        });

        // Unmounted while we were awaiting: nothing will call the cleanup below, so do it here.
        if (!active) {
          subscription.subscription.unsubscribe();
          return;
        }
        unsubscribe = () => subscription.subscription.unsubscribe();

        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
      } catch (cause) {
        // Reaching here at all is a bug somewhere below, but the handling is what matters: an
        // uncaught throw skipped the `setLoading(false)` that used to sit inline, and `loading`
        // has no other way back to false. The whole app then sat on skeletons forever, and
        // /login -- which is NOT behind AuthGate -- rendered a working sign-in form that could
        // never redirect, because its redirect is guarded on `!loading`. Correct credentials,
        // real session, and the page just sat there.
        console.error('Auth initialisation failed; continuing signed out.', cause);
      } finally {
        // Unconditional. Whatever happened above, the app has finished trying, and staying in
        // `loading` is the one outcome with no way out of it.
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const value = React.useMemo<AuthState>(() => {
    /**
     * The client, or an error saying which of the two reasons there isn't one.
     *
     * Worth telling apart: "the server serves no credentials" is a deployment to go and fix,
     * while "we could not reach the server" is usually momentary and the right advice is to try
     * again. They were one message, and it named the wrong one -- which is how a dev server that
     * had been restarted read as a misconfigured project.
     *
     * Both caches evict on failure (see authConfig.ts), so pressing sign-in again genuinely
     * re-asks rather than replaying the first answer.
     */
    const requireClient = async () => {
      const supabase = await getSupabase();
      if (supabase) return supabase;

      const config = await getAuthConfig();
      throw new Error(
        config.unreachable
          ? 'Could not reach the server to start sign-in. Check it is running, then try again.'
          : 'Sign-in is not configured on this server.',
      );
    };

    return {
      config,
      session,
      loading,
      authenticated: session !== null,

      /**
       * The session is taken from the RESPONSE, not just awaited from the listener.
       *
       * Supabase hands it back right here, and the listener is a second delivery of the same
       * fact -- so reading it directly makes `authenticated` true the moment the password is
       * accepted, whether or not the subscription is healthy. That matters because the redirect
       * off /login is driven by `authenticated`: with the listener as the only source, anything
       * that stopped it firing stranded a correctly signed-in owner on the sign-in form. Setting
       * it twice is harmless -- same session object, and React skips the identical re-render.
       */
      signIn: async (email, password) => {
        const supabase = await requireClient();
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
        if (data.session) setSession(data.session);
      },

      signUp: async (email, password) => {
        const supabase = await requireClient();
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw new Error(error.message);
        // Null whenever the project requires email confirmation, which is why the caller shows a
        // "check your inbox" notice rather than assuming there is somewhere to redirect to.
        if (data.session) setSession(data.session);
      },

      signInWithGoogle: async () => {
        const supabase = await requireClient();
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin },
        });
        if (error) throw new Error(error.message);
      },

      signOut: async () => {
        const supabase = await getSupabase();
        await supabase?.auth.signOut();
        // Ask CA transcripts live in this tab's storage, not on the server, so signing out has
        // to clear them here or the next person to sign in on this machine inherits them.
        clearAllTranscripts();
        setSession(null);
      },
    };
  }, [config, session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
