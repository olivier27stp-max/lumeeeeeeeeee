/**
 * MFA Challenge Component
 * Shown after successful password login when user has TOTP enrolled.
 * User must enter their 6-digit TOTP code to complete login.
 */
import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Shield, Loader2, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

interface MfaChallengeProps {
  factorId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function MfaChallenge({ factorId, onSuccess, onCancel }: MfaChallengeProps) {
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value.slice(-1);
    setCode(newCode);
    setError('');

    // Auto-advance to next input
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (index === 5 && value) {
      const fullCode = newCode.join('');
      if (fullCode.length === 6) {
        verifyCode(fullCode);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const newCode = pasted.split('');
      setCode(newCode);
      verifyCode(pasted);
    }
  };

  const verifyCode = async (totpCode: string) => {
    setLoading(true);
    setError('');

    try {
      // Create challenge
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });

      if (challengeError) throw challengeError;

      // Verify with TOTP code
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code: totpCode,
      });

      if (verifyError) throw verifyError;

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please try again.');
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-screen flex items-center justify-center p-6 bg-[#F8F9FA]"
    >
      <div className="w-full max-w-md">
        <div className="glass-card space-y-6 text-center">
          <div className="flex justify-center">
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
              <Shield size={24} className="text-primary" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-text-primary">Two-Factor Authentication</h2>
            <p className="text-sm text-text-tertiary">
              Enter the 6-digit code from your authenticator app
            </p>
          </div>

          <div className="flex justify-center gap-2" onPaste={handlePaste}>
            {code.map((digit, i) => (
              <input
                key={i}
                ref={el => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={e => handleChange(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                disabled={loading}
                className="w-11 h-13 text-center text-lg font-mono font-bold
                  border border-border rounded-xl bg-surface-primary
                  focus:border-primary focus:ring-2 focus:ring-primary/20
                  disabled:opacity-50 transition-all"
              />
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-text-tertiary">
              <Loader2 size={14} className="animate-spin" />
              Verifying...
            </div>
          )}

          <button
            onClick={onCancel}
            className="text-sm text-text-tertiary hover:text-text-primary transition-colors"
          >
            Cancel and sign out
          </button>
        </div>
      </div>
    </motion.div>
  );
}
