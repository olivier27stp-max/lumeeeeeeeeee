/**
 * MFA Enrollment — single-screen, guided 2FA setup.
 *
 * Professional flow:
 *  - One screen: scan the QR (or copy the key) AND enter the code, no
 *    confusing "I've scanned" intermediate step that loses people.
 *  - The 6-digit field is autofill-friendly (autoComplete="one-time-code")
 *    so the OS / password app can fill the TOTP, and it auto-submits as soon
 *    as 6 digits are present — so there is always a clear continuation.
 *  - Bilingual (fr/en), clear success state.
 * Used in Settings and in the invite-member 2FA prompt.
 */
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Shield, Loader2, AlertCircle, Check, Copy, X, Smartphone, KeyRound } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface MfaEnrollProps {
  onComplete: () => void;
  onCancel: () => void;
}

export default function MfaEnroll({ onComplete, onCancel }: MfaEnrollProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [step, setStep] = useState<'loading' | 'setup' | 'done' | 'fatal'>('loading');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { enrollFactor(); }, []);

  const enrollFactor = async () => {
    try {
      // Remove any half-finished unverified factor from a previous attempt so
      // Supabase doesn't reject the new enrollment ("factor already exists").
      try {
        const { data: list } = await supabase.auth.mfa.listFactors();
        const stale = (list?.totp || []).filter((f) => f.status === 'unverified');
        for (const f of stale) await supabase.auth.mfa.unenroll({ factorId: f.id });
      } catch {}

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Lume CRM ${new Date().toISOString()}`,
      });
      if (error) throw error;

      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFactorId(data.id);
      setStep('setup');
      setTimeout(() => inputRef.current?.focus(), 200);
    } catch (err: any) {
      setError(err.message || (fr ? "Impossible de démarrer l'activation de la 2FA." : 'Failed to start MFA enrollment.'));
      setStep('fatal');
    }
  };

  const verify = async (oneTimeCode: string) => {
    setVerifying(true);
    setError('');
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: oneTimeCode,
      });
      if (verifyError) throw verifyError;
      setStep('done');
      setTimeout(onComplete, 1400);
    } catch (err: any) {
      setError(fr ? 'Code invalide. Réessaie avec le code actuel de ton app.' : 'Invalid code. Try the current code from your app.');
      setCode('');
      inputRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const onCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (error) setError('');
    if (digits.length === 6 && !verifying) verify(digits); // auto-submit
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  // ── Loading ──
  if (step === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
        <p className="text-xs text-text-tertiary">{fr ? 'Préparation…' : 'Preparing…'}</p>
      </div>
    );
  }

  // ── Fatal error (couldn't start enrollment) ──
  if (step === 'fatal') {
    return (
      <div className="space-y-5 py-4 text-center">
        <div className="mx-auto w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center">
          <AlertCircle size={22} className="text-red-600" />
        </div>
        <p className="text-sm text-text-secondary">{error}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="glass-button flex-1">{fr ? 'Fermer' : 'Close'}</button>
          <button onClick={() => { setStep('loading'); enrollFactor(); }} className="glass-button flex-1 !bg-primary !text-white !border-primary">
            {fr ? 'Réessayer' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  // ── Success ──
  if (step === 'done') {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="mx-auto w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center">
          <Check size={26} className="text-green-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-text-primary">{fr ? '2FA activée 🎉' : '2FA enabled 🎉'}</h3>
          <p className="text-sm text-text-tertiary mt-1">
            {fr ? 'Ton compte est maintenant protégé.' : 'Your account is now protected.'}
          </p>
        </div>
      </div>
    );
  }

  // ── Setup (single screen: scan + enter code) ──
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
            <Shield size={18} className="text-primary" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">
              {fr ? 'Activer la double authentification' : 'Enable two-factor authentication'}
            </h3>
            <p className="text-xs text-text-tertiary">
              {fr ? 'Protège les actions sensibles de ton compte' : 'Protect sensitive actions on your account'}
            </p>
          </div>
        </div>
        <button onClick={onCancel} className="p-2 hover:bg-surface-secondary rounded-lg transition-colors">
          <X size={16} className="text-text-tertiary" />
        </button>
      </div>

      {/* Step 1 — scan */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">1</span>
          <p className="text-sm font-medium text-text-primary">
            {fr ? 'Scanne le code avec ton app d’authentification' : 'Scan the code with your authenticator app'}
          </p>
        </div>
        <p className="text-[12px] text-text-tertiary flex items-center gap-1.5 pl-7">
          <Smartphone size={13} /> Google Authenticator · Authy · 1Password · {fr ? 'app Mots de passe' : 'Passwords app'}
        </p>

        <div className="flex justify-center">
          <div className="bg-white p-4 rounded-2xl border border-border shadow-sm">
            <img src={qrCode} alt="QR 2FA" className="w-44 h-44" />
          </div>
        </div>

        {/* Manual key (collapsible) */}
        <div className="pl-7">
          <button
            type="button"
            onClick={() => setShowManual((s) => !s)}
            className="text-[12px] text-text-tertiary hover:text-text-secondary inline-flex items-center gap-1.5 transition-colors"
          >
            <KeyRound size={13} />
            {fr ? 'Impossible de scanner ? Saisir la clé à la main' : "Can't scan? Enter the key manually"}
          </button>
          {showManual && (
            <div className="flex items-center gap-2 mt-2">
              <code className="flex-1 text-xs font-mono bg-surface-secondary px-3 py-2.5 rounded-xl break-all select-all">{secret}</code>
              <button
                type="button"
                onClick={copySecret}
                className="p-2.5 border border-border rounded-xl hover:bg-surface-secondary transition-colors"
                title={fr ? 'Copier' : 'Copy'}
              >
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-text-tertiary" />}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Step 2 — enter code */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-primary text-white text-[11px] font-bold flex items-center justify-center">2</span>
          <p className="text-sm font-medium text-text-primary">
            {fr ? 'Entre le code à 6 chiffres affiché dans l’app' : 'Enter the 6-digit code shown in the app'}
          </p>
        </div>

        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="000000"
            disabled={verifying}
            className="glass-input w-full text-center text-2xl font-mono tracking-[0.5em] py-4 disabled:opacity-60"
            autoFocus
          />
          {verifying && (
            <Loader2 size={18} className="animate-spin text-primary absolute right-4 top-1/2 -translate-y-1/2" />
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        <p className="text-[12px] text-text-tertiary text-center">
          {fr ? 'La validation se fait automatiquement.' : 'It verifies automatically.'}
        </p>
      </div>
    </div>
  );
}
