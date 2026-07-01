/**
 * SMS step-up modal — used both to enroll a phone number and to challenge on a
 * sensitive payment action from a new device. One clean screen: enter phone
 * (enroll) → receive SMS → enter the 6-digit code (autofill + auto-submit).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Shield, Loader2, AlertCircle, Check, X, Smartphone } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { enrollStart, enrollVerify, challengeStart, challengeVerify } from '../../lib/mfaSmsApi';

interface SmsStepUpProps {
  mode: 'enroll' | 'challenge';
  phoneHint?: string | null;
  /** Called after the code is verified and the device is trusted. */
  onDone: () => void;
  onCancel: () => void;
}

export default function SmsStepUp({ mode, phoneHint, onDone, onCancel }: SmsStepUpProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  // enroll starts by asking the phone; challenge jumps straight to the code.
  const [step, setStep] = useState<'phone' | 'code' | 'done'>(mode === 'enroll' ? 'phone' : 'code');
  const [phone, setPhone] = useState('');
  const [hint, setHint] = useState<string | null>(phoneHint ?? null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const sentOnce = useRef(false);

  const startCooldown = () => {
    setCooldown(30);
    const t = setInterval(() => setCooldown((c) => { if (c <= 1) { clearInterval(t); return 0; } return c - 1; }), 1000);
  };

  // For a challenge, send the code as soon as the modal opens.
  const sendChallenge = useCallback(async () => {
    if (sentOnce.current) return;
    sentOnce.current = true;
    setBusy(true); setError('');
    try {
      const r = await challengeStart();
      setHint(r.phone_hint || hint);
      startCooldown();
      setTimeout(() => codeRef.current?.focus(), 150);
    } catch (err: any) {
      setError(err?.message || (fr ? "Échec de l'envoi du code." : 'Failed to send the code.'));
    } finally { setBusy(false); }
  }, [fr, hint]);

  useEffect(() => {
    if (mode === 'challenge') sendChallenge();
  }, [mode, sendChallenge]);

  const submitPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await enrollStart(phone);
      setHint(r.phone_hint || null);
      setStep('code');
      startCooldown();
      setTimeout(() => codeRef.current?.focus(), 150);
    } catch (err: any) {
      setError(err?.message || (fr ? 'Numéro invalide ou envoi impossible.' : 'Invalid number or send failed.'));
    } finally { setBusy(false); }
  };

  const verify = async (value: string) => {
    setBusy(true); setError('');
    try {
      if (mode === 'enroll') await enrollVerify(value);
      else await challengeVerify(value);
      setStep('done');
      setTimeout(onDone, 1200);
    } catch (err: any) {
      setError(fr ? 'Code invalide. Réessaie avec le dernier code reçu.' : 'Invalid code. Try the latest code you received.');
      setCode('');
      codeRef.current?.focus();
    } finally { setBusy(false); }
  };

  const onCodeChange = (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (error) setError('');
    if (digits.length === 6 && !busy) verify(digits);
  };

  const resend = async () => {
    if (cooldown > 0) return;
    if (mode === 'enroll') { setStep('phone'); return; }
    sentOnce.current = false;
    await sendChallenge();
  };

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
              {mode === 'enroll'
                ? (fr ? 'Vérification par SMS' : 'SMS verification')
                : (fr ? 'Confirme cette action' : 'Confirm this action')}
            </h3>
            <p className="text-xs text-text-tertiary">
              {mode === 'enroll'
                ? (fr ? 'Protège les actions de paiement de ton compte' : 'Protect your account’s payment actions')
                : (fr ? 'Action sensible sur un nouvel appareil' : 'Sensitive action on a new device')}
            </p>
          </div>
        </div>
        <button onClick={onCancel} className="p-2 hover:bg-surface-secondary rounded-lg transition-colors">
          <X size={16} className="text-text-tertiary" />
        </button>
      </div>

      {step === 'done' && (
        <div className="text-center space-y-3 py-6">
          <div className="mx-auto w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center">
            <Check size={26} className="text-green-600" />
          </div>
          <p className="text-sm font-semibold text-text-primary">{fr ? 'Vérifié ✓' : 'Verified ✓'}</p>
          <p className="text-xs text-text-tertiary">
            {fr ? 'Cet appareil est reconnu pour 30 jours.' : 'This device is trusted for 30 days.'}
          </p>
        </div>
      )}

      {step === 'phone' && (
        <form onSubmit={submitPhone} className="space-y-4">
          <p className="text-sm text-text-secondary flex items-center gap-1.5">
            <Smartphone size={14} /> {fr ? 'Entre ton numéro de mobile — on t’enverra un code.' : 'Enter your mobile number — we’ll text you a code.'}
          </p>
          <input
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={fr ? '+1 514 555 0148' : '+1 555 555 0148'}
            className="glass-input w-full"
            autoFocus
            disabled={busy}
          />
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">
              <AlertCircle size={14} className="shrink-0" /> {error}
            </div>
          )}
          <button type="submit" disabled={busy || phone.trim().length < 8} className="glass-button w-full !bg-primary !text-white !border-primary disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin mx-auto" /> : (fr ? 'Envoyer le code' : 'Send code')}
          </button>
        </form>
      )}

      {step === 'code' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {fr ? 'Entre le code à 6 chiffres envoyé au' : 'Enter the 6-digit code sent to'}{' '}
            <span className="font-semibold text-text-primary">•••• {hint || '••••'}</span>
          </p>
          <div className="relative">
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => onCodeChange(e.target.value)}
              placeholder="000000"
              disabled={busy}
              className="glass-input w-full text-center text-2xl font-mono tracking-[0.5em] py-4 disabled:opacity-60"
              autoFocus
            />
            {busy && <Loader2 size={18} className="animate-spin text-primary absolute right-4 top-1/2 -translate-y-1/2" />}
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">
              <AlertCircle size={14} className="shrink-0" /> {error}
            </div>
          )}
          <div className="flex items-center justify-between text-[12px] text-text-tertiary">
            <span>{fr ? 'Validation automatique.' : 'Verifies automatically.'}</span>
            <button
              type="button"
              onClick={resend}
              disabled={cooldown > 0}
              className="hover:text-text-secondary disabled:opacity-50 transition-colors"
            >
              {cooldown > 0
                ? (fr ? `Renvoyer (${cooldown}s)` : `Resend (${cooldown}s)`)
                : (fr ? 'Renvoyer le code' : 'Resend code')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
