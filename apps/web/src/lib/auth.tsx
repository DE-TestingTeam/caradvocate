import * as React from 'react';
import type { Session } from '@supabase/supabase-js';
import { getAuthConfig, type AuthConfig } from './authConfig';
import { getSupabase } from './supabaseClient';
import { setAccessTokenGetter } from './http';

interface AuthState {
  /** undefined while we are still asking the server which mode we are in. */
  config: AuthConfig | undefined;
  session: Session | null;
  loading: boolean;
  /** True when the user may use the app: signed in, or dev mode. */
  authenticated: boolean;
  /**
   * True when there is a real session to end. False in dev mode, where requests
   * are attributed to a fixed user and no sign-out is possible. Callers should
   * test this rather than inspecting `config.mode` themselves.
   */
  canSignOut: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = React.createContext<AuthState | undefined>(undefined);

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

      if (resolved.mode === 'dev') {
        // No sign-in required; the API attributes requests to the dev user.
        setLoading(false);
        return;
      }

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
      authenticated: config?.mode === 'dev' || session !== null,
      canSignOut: config?.mode === 'supabase',

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
        setSession(null);
      },
    };
  }, [config, session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
