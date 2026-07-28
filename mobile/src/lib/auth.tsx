import { Session } from '@supabase/supabase-js';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

type AuthState = {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn: AuthState['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp: AuthState['signUp'] = async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error: error?.message ?? null };
  };

  const signInWithGoogle: AuthState['signInWithGoogle'] = async () => {
    try {
      const redirectTo = AuthSession.makeRedirectUri({ scheme: 'lumecrm', path: 'auth/callback' });

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) return { error: error.message };
      if (!data?.url) return { error: 'Could not start Google sign-in.' };

      // Session PARTAGÉE (pas éphémère) : la fenêtre voit les cookies Google du
      // téléphone → choix de compte en un tap. En éphémère (mode privé), Google
      // exige un login complet et peut refuser (« browser not secure ») — la
      // fenêtre se fermait alors sans jamais revenir dans l'app, silencieusement.
      // Coût : iOS montre une petite confirmation nommant le domaine d'auth.
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success' || !result.url) {
        // Y compris le « cancel » : visible, sinon l'échec est indiagnosticable.
        return {
          error:
            result.type === 'cancel'
              ? 'Connexion Google interrompue — la fenêtre s’est fermée avant la fin.'
              : `Google sign-in failed (${result.type}).`,
        };
      }
      // Un échec côté Supabase/Google revient en deep link avec ?error=… — l'afficher.
      const retErr = new URL(result.url).searchParams.get('error_description') || new URL(result.url).searchParams.get('error');
      if (retErr) return { error: retErr };

      // Extract the auth code from the redirect and exchange it for a session.
      const code = new URL(result.url).searchParams.get('code');
      if (!code) return { error: 'No authorization code returned.' };
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      return { error: exchangeError?.message ?? null };
    } catch (e) {
      return { error: (e as Error).message };
    }
  };

  const signOut: AuthState['signOut'] = async () => {
    await supabase.auth.signOut();
  };

  const resetPassword: AuthState['resetPassword'] = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error: error?.message ?? null };
  };

  return (
    <AuthContext.Provider
      value={{ session, loading, signIn, signUp, signInWithGoogle, signOut, resetPassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
