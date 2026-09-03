import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { motion } from 'motion/react';
import { Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { useNavigate, useLocation } from 'react-router-dom';
import MfaChallenge from '../components/auth/MfaChallenge';
import { forgotPassword } from '../lib/authApi';

interface AuthProps {
  onBack?: () => void;
}

export default function Auth({ onBack }: AuthProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  // Retour de /reset-password : le courriel est pré-rempli et un message
  // confirme que le nouveau mot de passe est actif.
  const etatRetour = (location.state as { passwordReset?: boolean; email?: string } | null) || null;
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(etatRetour?.email || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string, hint?: string } | null>(
    etatRetour?.passwordReset ? { type: 'success', text: t.auth.passwordUpdatedSignIn } : null,
  );

  // MFA challenge state.
  // Hardening (audit P1-D8): when MFA is enrolled, the AAL1 session that
  // signInWithPassword leaves in localStorage is itself a security boundary.
  // We must NOT render any authenticated UI from it. The App-level guard
  // (`<AaL2Guard />` in App.tsx) refuses to mount the authenticated tree
  // while the current session is AAL1 AND verified MFA factors exist. The
  // user must either finish the MFA challenge below (-> AAL2) or cancel
  // (which signs out).
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Check if user has MFA enrolled — if so, show challenge. The
      // authenticated app tree will NOT render until AAL2 is reached
      // (see AaL2Guard in App.tsx).
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const verifiedFactors = factorsData?.totp?.filter(f => f.status === 'verified') || [];

      if (verifiedFactors.length > 0) {
        setMfaFactorId(verifiedFactors[0].id);
        return;
      }
      // No MFA — send them into the app. Without this the URL stays on /auth,
      // which doesn't exist in the authenticated route tree → NotFound (404).
      navigate('/', { replace: true });
    } catch (error: any) {
      // Signaler l'échec au serveur pour qu'il soit enregistré. L'authentification
      // se fait entièrement ici, dans le navigateur : sans ce signalement, le
      // serveur ne voit JAMAIS un échec de connexion et la détection de force
      // brute n'a aucune donnée (audit 2026-07-31).
      //
      // Fire-and-forget, volontairement : la télémétrie ne doit ni ralentir ni
      // faire échouer l'ouverture de session. On n'envoie ni le mot de passe,
      // ni aucun identifiant — seulement le courriel saisi et un motif court.
      void fetch('/api/auth/login-failed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ email, reason: String(error?.message || 'unknown').slice(0, 120) }),
      }).catch(() => { /* jamais bloquant */ });

      // Un compte créé avec Google n'a pas de mot de passe : Supabase répond
      // « Invalid login credentials », exactement comme pour un mauvais mot de
      // passe. L'indice reste générique (aucune énumération de comptes) mais
      // donne la sortie : bouton Google, ou « mot de passe oublié » pour s'en
      // créer un.
      const identifiantsRefuses = /invalid login credentials/i.test(String(error?.message || ''));
      setMessage({
        type: 'error',
        text: identifiantsRefuses ? t.auth.invalidCredentials : error.message,
        hint: identifiantsRefuses ? t.auth.invalidCredentialsHint : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  // Show MFA challenge screen
  if (mfaFactorId) {
    return (
      <MfaChallenge
        factorId={mfaFactorId}
        onSuccess={() => {
          setMfaFactorId(null);
          // Session is now AAL2 — App.tsx AaL2Guard will allow render.
        }}
        onCancel={async () => {
          await supabase.auth.signOut();
          setMfaFactorId(null);
        }}
      />
    );
  }

  const handleGoogleLogin = async () => {
    if (loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        }
      });

      if (error) throw error;
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-[#F8F9FA]">
      {/* Left visual panel — hidden on small screens */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1400&q=80"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-black/80 via-black/50 to-black/30" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="relative z-10 flex flex-col justify-end p-14 text-white"
        >
          <h2 className="text-4xl font-light leading-tight">
            {t.auth.welcomeBack}
          </h2>
          <p className="mt-4 text-lg font-light text-white/80 max-w-md">
            {t.auth.welcomeTagline}
          </p>
          <div className="mt-8 flex items-center gap-3 text-sm text-white/60">
            <span className="h-px w-12 bg-white/40" />
            {t.auth.companyOS}
          </div>
        </motion.div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="glass-card space-y-8"
        >
          <div className="text-center space-y-2">
            <div className="flex justify-center mb-4">
              <button 
                onClick={onBack}
                className="text-[10px] uppercase tracking-widest text-gray-400 hover:text-black transition-colors"
              >
                {t.auth.backToHome}
              </button>
            </div>
            <h1 className="text-3xl font-extralight tracking-widest">LUME</h1>
            <p className="text-gray-500 font-light text-sm">
              {t.auth.welcomeBack}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider ml-1">{t.auth.emailLabel}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="glass-input w-full pl-10"
                  placeholder={t.auth.emailPlaceholder}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider ml-1">{t.auth.passwordLabel}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="glass-input w-full pl-10 pr-10"
                  placeholder={t.auth.passwordPlaceholder}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {message && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className={cn(
                  "p-3 rounded-lg text-xs font-light",
                  message.type === 'success' ? "bg-success-light text-success" : "bg-danger-light text-danger"
                )}
              >
                {message.text}
                {message.hint && <p className="mt-1.5 text-gray-600">{message.hint}</p>}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="glass-button-primary w-full flex items-center justify-center gap-2 group"
            >
              {loading ? t.auth.processing : t.auth.signIn}
              {!loading && <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />}
            </button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-transparent px-2 text-gray-400 font-light">{t.auth.orContinueWith}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="glass-button flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              {t.auth.google}
            </button>
          </div>

          <div className="text-center space-y-2">
            <button
              onClick={() => navigate('/register')}
              className="text-xs text-gray-500 hover:text-black transition-colors font-light"
            >
              {t.auth.dontHaveAccount} {t.auth.signUp}
            </button>
            <div>
              <button
                onClick={async () => {
                  if (!email.trim()) {
                    setMessage({ type: 'error', text: t.auth.enterYourEmailToResetPassword });
                    return;
                  }
                  setLoading(true);
                  try {
                    // Notre propre lien (voir src/lib/authApi.ts) : celui de
                    // Supabase n'aboutissait à aucun formulaire.
                    await forgotPassword(email);
                    setMessage({ type: 'success', text: t.auth.passwordResetLinkSentToYourEmail });
                  } catch (err: any) {
                    setMessage({ type: 'error', text: err.message });
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors font-light underline"
              >
                {t.auth.forgotPassword}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
      </div>
    </div>
  );
}
