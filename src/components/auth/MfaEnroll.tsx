/**
 * MFA Enrollment Component
 * Shows QR code for TOTP setup and verification flow.
 * Used in Settings page to enable 2FA.
 */
import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { Shield, Loader2, AlertCircle, Check, Copy, X } from 'lucide-react';

interface MfaEnrollProps {
  onComplete: () => void;
  onCancel: () => void;
}

export default function MfaEnroll({ onComplete, onCancel }: MfaEnrollProps) {
  const [step, setStep] = useState<'loading' | 'scan' | 'verify' | 'done'>('loading');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    enrollFactor();
  }, []);

  const enrollFactor = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Lume CRM Authenticator',
      });

      if (error) throw error;

      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      setFactorId(data.id);
      setStep('scan');
    } catch (err: any) {
      setError(err.message || 'Failed to start MFA enrollment.');
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== 6) return;

    setLoading(true);
    setError('');

    try {
      // Challenge the factor
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });

      if (challengeError) throw challengeError;

      // Verify with the code from the authenticator app
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code,
      });

      if (verifyError) throw verifyError;

      setStep('done');
      setTimeout(() => onComplete(), 1500);
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please try again.');
      setCode('');
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (step === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="text-center space-y-4 py-8">
        <div className="mx-auto w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center">
          <Check size={24} className="text-green-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-text-primary">2FA Enabled</h3>
          <p className="text-sm text-text-tertiary mt-1">
            Your account is now protected with two-factor authentication.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center">
            <Shield size={18} className="text-primary" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-text-primary">Setup Two-Factor Authentication</h3>
            <p className="text-xs text-text-tertiary">
              {step === 'scan' ? 'Step 1: Scan QR code' : 'Step 2: Enter verification code'}
            </p>
          </div>
        </div>
        <button onClick={onCancel} className="p-2 hover:bg-surface-secondary rounded-lg transition-colors">
          <X size={16} className="text-text-tertiary" />
        </button>
      </div>

      {step === 'scan' && (
        <div className="space-y-5">
          <p className="text-sm text-text-secondary">
            Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.)
          </p>

          {/* QR Code */}
          <div className="flex justify-center">
            <div className="bg-surface-card p-4 rounded-2xl border border-border shadow-sm">
              <img src={qrCode} alt="MFA QR Code" className="w-48 h-48" />
            </div>
          </div>

          {/* Manual entry secret */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">
              Or enter this code manually:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-surface-secondary px-3 py-2.5 rounded-xl break-all select-all">
                {secret}
              </code>
              <button
                onClick={copySecret}
                className="p-2.5 border border-border rounded-xl hover:bg-surface-secondary transition-colors"
                title="Copy secret"
              >
                {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} className="text-text-tertiary" />}
              </button>
            </div>
          </div>

          <button
            onClick={() => { setStep('verify'); setTimeout(() => inputRef.current?.focus(), 100); }}
            className="glass-button w-full"
          >
            I've scanned the QR code
          </button>
        </div>
      )}

      {step === 'verify' && (
        <form onSubmit={handleVerify} className="space-y-5">
          <p className="text-sm text-text-secondary">
            Enter the 6-digit code shown in your authenticator app to verify setup.
          </p>

          <div>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, '');
                setCode(v);
                setError('');
              }}
              placeholder="000000"
              className="glass-input w-full text-center text-2xl font-mono tracking-[0.5em] py-4"
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep('scan')}
              className="glass-button flex-1"
              disabled={loading}
            >
              Back
            </button>
            <button
              type="submit"
              disabled={code.length !== 6 || loading}
              className="glass-button flex-1 !bg-primary !text-white !border-primary disabled:opacity-50"
            >
              {loading ? <Loader2 size={14} className="animate-spin mx-auto" /> : 'Verify & Enable'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
