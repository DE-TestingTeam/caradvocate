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

    (async () => {
      const resolved = await getAuthConfig();
      if (!active) return;
      setConfig(resolved);

      const supabase = await getSupabase();
      if (!active || !supabase) {
        setLoading(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      setLoading(false);

      const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
        setSession(next);
      });

      return () => subscription.subscription.unsubscribe();
    })();

    return () => {
      active = false;
    };
  }, []);

  const value = React.useMemo<AuthState>(() => {
    const requireClient = async () => {
      const supabase = await getSupabase();
      if (!supabase) throw new Error('Sign-in is not configured on this server.');
      return supabase;
    };

    return {
      config,
      session,
      loading,
      authenticated: session !== null,

      signIn: async (email, password) => {
        const supabase = await requireClient();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message);
      },

      signUp: async (email, password) => {
        const supabase = await requireClient();
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw new Error(error.message);
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
