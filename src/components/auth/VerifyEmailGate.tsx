import { useEffect, useState } from 'react';
import { Mail, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { endTrackingAndSignOut } from '../../hooks/useLiveLocationTracking';
import { useTranslation } from '../../i18n';

const RESEND_COOLDOWN_SECONDS = 30;

type Props = {
  email: string;
};

/**
 * Hard gate shown when an authenticated user has not yet confirmed their email.
 * Renders in place of the app shell — user cannot interact with the CRM until
 * `email_confirmed_at` is set on the Supabase user.
 */
export default function VerifyEmailGate({ email }: Props) {
  const { t } = useTranslation();
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => (c > 0 ? c - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const onResend = async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      toast.success(t.verifyEmail.gateResendSuccess);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      toast.error(t.verifyEmail.gateResendError);
    } finally {
      setSending(false);
    }
  };

  const onSignOut = async () => {
    try {
      await endTrackingAndSignOut();
    } catch {
      // ignore — onAuthStateChange will tear down the gate
    }
  };

  const resendLabel =
    cooldown > 0
      ? t.verifyEmail.gateResendIn.replace('{seconds}', String(cooldown))
      : t.verifyEmail.gateResend;

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6 bg-surface">
      <div className="w-full max-w-md bg-surface-elevated border border-outline rounded-2xl shadow-sm p-8">
        <div className="flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-5">
            <Mail size={26} className="text-primary" />
          </div>
          <h1 className="text-xl font-bold text-text-primary mb-2">
            {t.verifyEmail.gateTitle}
          </h1>
          <p className="text-sm text-text-secondary leading-relaxed mb-1">
            {t.verifyEmail.gateDesc}
          </p>
          <p className="text-xs text-text-tertiary mb-6">
            {t.verifyEmail.gateCheckSpam}
          </p>

          <div className="w-full px-3 py-2 rounded-lg bg-surface-tertiary text-sm font-medium text-text-primary mb-5 truncate">
            {email}
          </div>

          <button
            onClick={onResend}
            disabled={sending || cooldown > 0}
            className="w-full py-2.5 rounded-lg bg-text-primary text-surface text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? '...' : resendLabel}
          </button>

          <button
            onClick={onSignOut}
            className="mt-4 inline-flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-primary transition-colors"
          >
            <LogOut size={12} />
            <span>
              {t.verifyEmail.gateLoggedInAs} {email} — {t.verifyEmail.gateSignOut}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
