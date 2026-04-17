import React, { useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { motion } from 'motion/react';
import { Mail, Lock, User, ArrowRight, Eye, EyeOff, Check, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { useNavigate } from 'react-router-dom';

export default function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Password strength checks
  const checks = useMemo(() => ({
    length: password.length >= 10,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^a-zA-Z0-9]/.test(password),
  }), [password]);

  const allChecksPassed = Object.values(checks).every(Boolean);
  const passedCount = Object.values(checks).filter(Boolean).length;

  const strengthLabel = passedCount <= 2
    ? t.register.strengthWeak
    : passedCount <= 4
      ? t.register.strengthMedium
      : t.register.strengthStrong;

  const strengthColor = passedCount <= 2
    ? 'bg-red-400'
    : passedCount <= 4
      ? 'bg-yellow-400'
      : 'bg-green-400';

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!fullName.trim()) {
      setMessage({ type: 'error', text: t.register.nameRequired });
      return;
    }

    if (!allChecksPassed) {
      setMessage({ type: 'error', text: t.register.passwordTooWeak });
      return;
    }

    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: t.register.passwordsDoNotMatch });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, fullName: fullName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed.');
      setEmailSent(true);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resend.');
      setMessage({ type: 'success', text: t.register.resendSuccess });
      setResendCooldown(60);
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) { clearInterval(interval); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Confirmation email sent screen
  if (emailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#F8F9FA]">
        <div className="w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card space-y-6 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto">
              <Mail className="text-green-500" size={28} />
            </div>
            <h2 className="text-xl font-light tracking-wide">{t.register.checkYourEmail}</h2>
            <p className="text-sm text-gray-500 font-light">
              {t.register.confirmationSentTo} <span className="font-medium text-gray-700">{email}</span>
            </p>
            <p className="text-xs text-gray-400 font-light">{t.register.clickLinkToActivate}</p>

            {message && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={cn(
                  'p-3 rounded-lg text-xs font-light',
                  message.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                )}
              >
                {message.text}
              </motion.div>
            )}

            <button
              onClick={handleResend}
              disabled={loading || resendCooldown > 0}
              className="glass-button w-full text-sm"
            >
              {resendCooldown > 0
                ? `${t.register.resendIn} ${resendCooldown}s`
                : t.register.resendEmail}
            </button>

            <button
              onClick={() => navigate('/auth')}
              className="text-xs text-gray-500 hover:text-black transition-colors font-light"
            >
              {t.register.backToLogin}
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  const PasswordCheck = ({ passed, label }: { passed: boolean; label: string }) => (
    <div className="flex items-center gap-1.5">
      {passed ? <Check size={12} className="text-green-500" /> : <X size={12} className="text-gray-300" />}
      <span className={cn('text-[11px]', passed ? 'text-green-600' : 'text-gray-400')}>{label}</span>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#F8F9FA]">
      <div className="w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card space-y-6"
        >
          <div className="text-center space-y-2">
            <button
              onClick={() => navigate('/')}
              className="text-[10px] uppercase tracking-widest text-gray-400 hover:text-black transition-colors"
            >
              {t.auth.backToHome}
            </button>
            <h1 className="text-3xl font-extralight tracking-widest">LUME</h1>
            <p className="text-gray-500 font-light text-sm">{t.register.subtitle}</p>
          </div>

          <form onSubmit={handleSignUp} className="space-y-4">
            {/* Full Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider ml-1">{t.register.fullName}</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="glass-input w-full pl-10"
                  placeholder={t.register.fullNamePlaceholder}
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
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

            {/* Password */}
            <div className="space-y-1.5">
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

              {/* Strength indicator */}
              {password.length > 0 && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', strengthColor)}
                        style={{ width: `${(passedCount / 5) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider">{strengthLabel}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <PasswordCheck passed={checks.length} label={t.register.min10Chars} />
                    <PasswordCheck passed={checks.uppercase} label={t.register.uppercase} />
                    <PasswordCheck passed={checks.lowercase} label={t.register.lowercase} />
                    <PasswordCheck passed={checks.number} label={t.register.number} />
                    <PasswordCheck passed={checks.special} label={t.register.specialChar} />
                  </div>
                </motion.div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider ml-1">{t.register.confirmPassword}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input
                  type={showConfirm ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="glass-input w-full pl-10 pr-10"
                  placeholder={t.register.confirmPlaceholder}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <p className="text-[11px] text-red-400 ml-1">{t.register.passwordsDoNotMatch}</p>
              )}
            </div>

            {message && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className={cn(
                  'p-3 rounded-lg text-xs font-light',
                  message.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
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
              {loading ? t.auth.processing : t.register.createMyAccount}
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
              onClick={async () => {
                if (loading) return;
                setLoading(true);
                setMessage(null);
                try {
                  const { error } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: { redirectTo: window.location.origin },
                  });
                  if (error) throw error;
                } catch (error: any) {
                  setMessage({ type: 'error', text: error.message });
                } finally {
                  setLoading(false);
                }
              }}
              disabled={loading}
              className="glass-button flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {t.auth.google}
            </button>
          </div>

          <div className="text-center">
            <button
              onClick={() => navigate('/auth')}
              className="text-xs text-gray-500 hover:text-black transition-colors font-light"
            >
              {t.auth.alreadyHaveAccount} {t.auth.signIn}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
