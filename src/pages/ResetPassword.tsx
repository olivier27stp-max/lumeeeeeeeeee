import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Lock, ArrowRight, Eye, EyeOff, KeyRound, Mail } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import { resetPassword, forgotPassword, AuthApiError } from '../lib/authApi';
import { passwordMeetsRules } from '../lib/passwordRules';
import PasswordStrength from '../components/auth/PasswordStrength';

/**
 * /reset-password?token=…&email=…
 *
 * Cible du lien « mot de passe oublié ». Rendue telle quelle, connecté ou non
 * (App.tsx l'intercepte avant tout garde) : le lien est souvent ouvert sur un
 * autre appareil que celui qui l'a demandé. Sert aussi à un compte créé avec
 * Google pour se donner un mot de passe et ne plus dépendre de Google.
 */
export default function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const email = (params.get('email') || '').trim().toLowerCase();
  const lienBienForme = /^[a-f0-9]{64}$/.test(token) && email.includes('@');

  const [etat, setEtat] = useState<'formulaire' | 'lien_invalide' | 'lien_expire'>(lienBienForme ? 'formulaire' : 'lien_invalide');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [nouveauLienEnvoye, setNouveauLienEnvoye] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!passwordMeetsRules(password)) {
      setMessage({ type: 'error', text: t.register.passwordTooWeak });
      return;
    }
    if (password !== confirm) {
      setMessage({ type: 'error', text: t.register.passwordsDoNotMatch });
      return;
    }
    setLoading(true);
    try {
      await resetPassword({ email, token, password });
      // Supabase révoque toutes les sessions du compte au changement de mot
      // de passe (vérifié sur staging). Si le lien a été ouvert en étant
      // connecté, cette session est donc déjà morte : on nettoie le local et
      // on repart de la connexion, courriel pré-rempli.
      await supabase.auth.signOut({ scope: 'local' }).catch(() => { /* déjà révoquée */ });
      navigate('/auth', { replace: true, state: { passwordReset: true, email } });
    } catch (err: any) {
      if (err instanceof AuthApiError && err.code === 'expired_link') setEtat('lien_expire');
      else if (err instanceof AuthApiError && err.code === 'invalid_link') setEtat('lien_invalide');
      else setMessage({ type: 'error', text: err?.message || 'Error' });
    } finally {
      setLoading(false);
    }
  };

  const demanderNouveauLien = async () => {
    if (loading || nouveauLienEnvoye) return;
    setLoading(true);
    setMessage(null);
    try {
      await forgotPassword(email);
      setNouveauLienEnvoye(true);
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Error' });
    } finally {
      setLoading(false);
    }
  };

  const Message = () => message && (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className={cn(
        'p-3 rounded-lg text-xs font-light',
        message.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600',
      )}
    >
      {message.text}
    </motion.div>
  );

  const retourConnexion = (
    <button onClick={() => navigate('/auth')} className="text-xs text-gray-500 hover:text-black transition-colors font-light">
      {t.register.backToLogin}
    </button>
  );

  // ── Lien invalide / expiré ──
  if (etat !== 'formulaire') {
    const expire = etat === 'lien_expire';
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#F8F9FA]">
        <div className="w-full max-w-md">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card space-y-6 text-center">
            <div className={cn('w-16 h-16 rounded-full flex items-center justify-center mx-auto', expire ? 'bg-yellow-50' : 'bg-red-50')}>
              {expire ? <Mail className="text-yellow-500" size={28} /> : <KeyRound className="text-red-500" size={28} />}
            </div>
            <h2 className="text-xl font-light tracking-wide">{expire ? t.auth.resetExpiredLink : t.auth.resetInvalidLink}</h2>
            {expire && email && (
              <p className="text-sm text-gray-500 font-light">
                {nouveauLienEnvoye ? t.auth.resetNewLinkSent : t.auth.resetFor.replace('{email}', email)}
              </p>
            )}
            <Message />
            {expire && email && !nouveauLienEnvoye && (
              <button onClick={demanderNouveauLien} disabled={loading} className="glass-button w-full text-sm">
                {loading ? t.auth.processing : t.auth.resetRequestNewLink}
              </button>
            )}
            {retourConnexion}
          </motion.div>
        </div>
      </div>
    );
  }

  // ── Formulaire ──
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#F8F9FA]">
      <div className="w-full max-w-md">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-extralight tracking-widest">LUME</h1>
            <p className="text-gray-700 font-light text-sm">{t.auth.resetTitle}</p>
            <p className="text-gray-400 font-light text-xs">{t.auth.resetFor.replace('{email}', email)}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider ml-1">{t.auth.newPasswordLabel}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="glass-input w-full pl-10 pr-10"
                  placeholder={t.auth.passwordPlaceholder}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <PasswordStrength password={password} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider ml-1">{t.register.confirmPassword}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="glass-input w-full pl-10 pr-10"
                  placeholder={t.register.confirmPlaceholder}
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {confirm.length > 0 && password !== confirm && (
                <p className="text-[11px] text-red-400 ml-1">{t.register.passwordsDoNotMatch}</p>
              )}
            </div>

            <Message />

            <button
              type="submit"
              disabled={loading}
              className="glass-button-primary w-full flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t.auth.processing : t.auth.resetSubmit}
              {!loading && <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />}
            </button>
          </form>

          <div className="text-center">{retourConnexion}</div>
        </motion.div>
      </div>
    </div>
  );
}
