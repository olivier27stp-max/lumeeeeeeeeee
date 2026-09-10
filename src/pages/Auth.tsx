import React, { useId, useState } from 'react';
import { supabase } from '../lib/supabase';
import { motion, useReducedMotion } from 'motion/react';
import { Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { useNavigate, useLocation } from 'react-router-dom';
import MfaChallenge from '../components/auth/MfaChallenge';
import { forgotPassword } from '../lib/authApi';
import { cibleApresConnexion, CLE_NEXT } from '../lib/routesSansSession';

interface AuthProps {
  onBack?: () => void;
}

export default function Auth({ onBack }: AuthProps) {
  const { t, language } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
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
      // `next` : la page protégée demandée avant la connexion (audit n°7).
      navigate(cibleApresConnexion(location.search), { replace: true });
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
          navigate(cibleApresConnexion(location.search), { replace: true });
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
      // Google revient sur l'origine (liste blanche Supabase) : on garde la
      // destination dans sessionStorage, App.tsx la rejoue à l'arrivée.
      const cible = cibleApresConnexion(location.search);
      try { if (cible !== '/') sessionStorage.setItem(CLE_NEXT, cible); } catch { /* stockage indisponible */ }
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
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-6 bg-[#0b1220]">
      {/* L'illustration couvre tout l'écran ; zoom très lent (coupé si
          l'utilisateur a réduit les animations). Zoomée de 12 % pour cacher
          le cadre dessiné sur les bords en format paysage. */}
      <motion.img
        src="/auth-hero.webp"
        alt=""
        initial={{ scale: 1.12 }}
        animate={{ scale: reduceMotion ? 1.12 : 1.16 }}
        transition={{ duration: 20, ease: 'easeOut' }}
        className="absolute inset-0 w-full h-full object-cover object-[center_40%] origin-[center_40%]"
      />
      {/* Voile dégradé depuis le bas : assombrit la moitié basse (nuages,
          ponton) pour que le texte blanc ressorte, sans salir le ciel clair. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/5 pointer-events-none" />

      {/* Accroche en bas à gauche — grands écrans seulement */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="hidden lg:flex absolute left-14 bottom-12 z-10 flex-col text-white max-w-sm drop-shadow-[0_2px_16px_rgba(0,0,0,0.6)]"
      >
          <h2 className="text-4xl font-extrabold leading-none tracking-tight">
            {t.auth.welcomeBack}
          </h2>
          <p className="mt-4 text-lg font-medium text-white/85 max-w-sm">
            {t.auth.welcomeTagline}
          </p>
          <div className="mt-7 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.15em] text-white/60">
            <span className="h-0.5 w-9 bg-white/70" />
            {t.auth.companyOS}
          </div>
      </motion.div>

      {/* Formulaire sans panneau : seuls les champs et boutons flottent sur
          l'image. Un flou doux derrière (sans bordure ni fond visible) garde
          les libellés blancs lisibles quand ils tombent sur le ciel clair. */}
      <div className="w-full max-w-md relative z-10 isolate before:content-[''] before:absolute before:-inset-x-12 before:-inset-y-10 before:-z-10 before:pointer-events-none before:bg-black/15 before:backdrop-blur-md before:[mask-image:radial-gradient(closest-side,#000_35%,transparent_100%)]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className="space-y-8"
        >
          <div className="text-center space-y-2">
            <div className="flex justify-center mb-4">
              <button
                onClick={() => {
                  // onBack ne changeait qu'un state interne sans changer l'URL
                  // (/auth restait affiché) → bouton sans effet. On navigue
                  // explicitement vers l'accueil ; onBack reste appelé au cas où
                  // un parent en dépend.
                  onBack?.();
                  navigate('/');
                }}
                className="text-[10px] uppercase tracking-widest text-white/75 hover:text-white transition-colors drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]"
              >
                {t.auth.backToHome}
              </button>
            </div>
            <h1 className="text-3xl font-black tracking-[0.3em] text-white" style={{ textShadow: '0 2px 14px rgba(0,0,0,0.55)' }}>LUME</h1>
            {/* Déjà affiché en bas à gauche sur grand écran : pas de doublon */}
            <p className="text-white/80 font-medium text-sm lg:hidden drop-shadow-[0_1px_8px_rgba(0,0,0,0.6)]">
              {t.auth.welcomeBack}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor={`${id}-email`} className="text-xs font-medium text-white/80 uppercase tracking-wider ml-1 drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]">{t.auth.emailLabel}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  id={`${id}-email`}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 h-12 rounded border-2 border-gray-900 bg-white text-sm shadow-[2px_2px_0_rgba(20,20,20,0.12)] focus:outline-none focus:shadow-[3px_3px_0_rgba(20,20,20,0.20)] transition-shadow"
                  placeholder={t.auth.emailPlaceholder}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor={`${id}-password`} className="text-xs font-medium text-white/80 uppercase tracking-wider ml-1 drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]">{t.auth.passwordLabel}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  id={`${id}-password`}
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 h-12 rounded border-2 border-gray-900 bg-white text-sm shadow-[2px_2px_0_rgba(20,20,20,0.12)] focus:outline-none focus:shadow-[3px_3px_0_rgba(20,20,20,0.20)] transition-shadow"
                  placeholder={t.auth.passwordPlaceholder}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? (language === 'fr' ? 'Masquer le mot de passe' : 'Hide password') : (language === 'fr' ? 'Afficher le mot de passe' : 'Show password')}
                  aria-pressed={showPassword}
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
              className="w-full h-12 rounded bg-gray-900 text-white text-sm font-bold uppercase tracking-wide flex items-center justify-center gap-2 group shadow-[3px_3px_0_rgba(20,20,20,0.18)] hover:shadow-[4px_4px_0_rgba(20,20,20,0.24)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[2px_2px_0_rgba(20,20,20,0.18)] disabled:opacity-50 transition-all"
            >
              {loading ? t.auth.processing : t.auth.signIn}
              {!loading && <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />}
            </button>
          </form>

          <div className="flex items-center gap-3 text-xs uppercase">
            <span aria-hidden="true" className="flex-1 border-t-2 border-dotted border-white/55" />
            <span className="text-white/80 font-semibold tracking-wide drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]">{t.auth.orContinueWith}</span>
            <span aria-hidden="true" className="flex-1 border-t-2 border-dotted border-white/55" />
          </div>

          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="h-12 rounded border-2 border-gray-900 bg-white text-sm font-semibold text-gray-900 flex items-center justify-center gap-2 shadow-[2px_2px_0_rgba(20,20,20,0.12)] hover:shadow-[3px_3px_0_rgba(20,20,20,0.18)] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50 transition-all"
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
              className="text-xs text-white/80 hover:text-white transition-colors font-light drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]"
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
                className="text-xs text-white/65 hover:text-white transition-colors font-light underline drop-shadow-[0_1px_6px_rgba(0,0,0,0.6)]"
              >
                {t.auth.forgotPassword}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
