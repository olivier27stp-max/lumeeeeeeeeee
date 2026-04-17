import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { motion } from 'motion/react';
import { Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { useNavigate } from 'react-router-dom';
import MfaChallenge from '../components/auth/MfaChallenge';

interface AuthProps {
  onBack?: () => void;
}

export default function Auth({ onBack }: AuthProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // MFA challenge state
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Check if user has MFA enrolled — if so, show challenge
      const { data: factorsData } = await supabase.auth.mfa.listFactors();
      const verifiedFactors = factorsData?.totp?.filter(f => f.status === 'verified') || [];

      if (verifiedFactors.length > 0) {
        // User has MFA — show challenge screen
        setMfaFactorId(verifiedFactors[0].id);
        return;
      }
      // No MFA — login completes normally via Supabase session
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
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
          // Session is now fully authenticated — App.tsx will detect it
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
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#F8F9FA]">
      <div className="w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
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
                    const { error } = await supabase.auth.resetPasswordForEmail(email, {
                      redirectTo: `${window.location.origin}/settings`,
                    });
                    if (error) throw error;
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
  );
}
