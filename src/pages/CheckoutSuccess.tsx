import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, Mail, MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { confirmCheckout, type CheckoutStatus } from '../lib/billingApi';
import { fetchChannels } from '../lib/communicationsApi';
import CheckoutSetup from './CheckoutSetup';

// ── Language detection (public page — no auth context guaranteed) ──
const isFr = (typeof navigator !== 'undefined' && navigator.language || 'fr').toLowerCase().startsWith('fr');

/**
 * CheckoutSuccess — Polls for webhook-confirmed subscription status.
 *
 * After Stripe redirects here, the frontend does NOT activate the subscription.
 * Instead, it polls /api/billing/confirm-checkout which checks if the webhook
 * has already processed the checkout.session.completed event.
 */
export default function CheckoutSuccess() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'polling' | 'success' | 'error'>('polling');
  const [setupData, setSetupData] = useState<CheckoutStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [smsNumber, setSmsNumber] = useState<string | null>(null);
  const [smsPending, setSmsPending] = useState(false);
  const pollCount = useRef(0);
  const maxPolls = 20; // ~40 seconds max wait
  const pollInterval = 2000; // 2 seconds

  useEffect(() => {
    const sessionId = params.get('session_id');
    if (!sessionId) {
      setStatus('error');
      setErrorMsg(isFr ? 'Identifiant de session manquant' : 'Missing session ID');
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function pollForSmsNumber() {
      setSmsPending(true);
      const smsMaxAttempts = 5;
      const smsDelay = 2000;
      for (let i = 0; i < smsMaxAttempts; i++) {
        if (cancelled) return;
        try {
          const channels = await fetchChannels();
          const smsChannel = channels.find(
            (c) => c.channel_type === 'sms' && c.is_default && c.phone_number,
          );
          if (smsChannel?.phone_number) {
            setSmsNumber(smsChannel.phone_number);
            setSmsPending(false);
            return;
          }
        } catch {
          // Ignore transient fetch errors — keep polling
        }
        await new Promise((r) => setTimeout(r, smsDelay));
      }
      // Timeout: leave smsPending=true so UI shows "ready soon, we'll email you"
    }

    async function poll() {
      if (cancelled) return;
      pollCount.current += 1;

      try {
        const result: CheckoutStatus = await confirmCheckout(sessionId!);

        if (cancelled) return;

        if (result.status === 'confirmed') {
          setUserEmail(result.email || '');
          setStatus('success');

          // Auto-sign in only if an active Supabase session already exists
          // (password is no longer persisted in sessionStorage for security).
          const { data: { session } } = await supabase.auth.getSession();
          const signedIn = !!session;

          // Payment-link buyer with no session + no password yet → show the
          // account setup form instead of bouncing to a dashboard they can't reach.
          if (!signedIn && result.needsPassword) {
            if (!cancelled) setSetupData(result);
            return;
          }

          // Clean up sessionStorage
          ['onb_step', 'onb_plan', 'onb_interval', 'onb_name', 'onb_email', 'onb_token', 'onb_uid']
            .forEach(k => sessionStorage.removeItem(k));

          // Poll for SMS channel (pro/enterprise plans) before redirecting
          if (signedIn && !cancelled && result.includesSms) {
            await pollForSmsNumber();
          }

          // Redirect to dashboard after short delay
          setTimeout(() => {
            if (!cancelled) window.location.href = '/';
          }, smsNumber ? 4000 : 3000);
          return;
        }

        // Still processing — poll again if under limit
        if (pollCount.current < maxPolls) {
          timer = setTimeout(poll, pollInterval);
        } else {
          // Timeout — likely webhook is delayed but payment succeeded
          setUserEmail(result.email || '');
          setStatus('success');

          // Sign-in only if an active Supabase session already exists
          // (password is no longer persisted in sessionStorage for security).
          const { data: { session } } = await supabase.auth.getSession();
          const signedIn = !!session;

          // Payment-link buyer with no session + no password yet → show the
          // account setup form instead of bouncing to a dashboard they can't reach.
          if (!signedIn && result.needsPassword) {
            if (!cancelled) setSetupData(result);
            return;
          }
          ['onb_step', 'onb_plan', 'onb_interval', 'onb_name', 'onb_email', 'onb_token', 'onb_uid']
            .forEach(k => sessionStorage.removeItem(k));

          if (signedIn && !cancelled && result.includesSms) {
            await pollForSmsNumber();
          }

          setTimeout(() => {
            if (!cancelled) window.location.href = '/';
          }, 3000);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error('[CheckoutSuccess]', err.message);
        setStatus('error');
        setErrorMsg(err.message);
      }
    }

    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params]);

  if (setupData) {
    return (
      <CheckoutSetup
        sessionId={params.get('session_id') || ''}
        email={setupData.email || ''}
        planName={setupData.planName}
        amountCents={setupData.amountCents}
        interval={setupData.interval}
        currency={setupData.currency}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center max-w-md px-6">

        {status === 'polling' && (
          <>
            <Loader2 className="mx-auto animate-spin text-[#1F5F4F] mb-4" size={40} />
            <h1 className="text-xl font-bold text-gray-900">{isFr ? 'Confirmation de votre paiement…' : 'Confirming your payment...'}</h1>
            <p className="text-sm text-gray-500 mt-2">
              {isFr ? 'Veuillez patienter pendant que nous vérifions votre paiement et configurons votre compte.' : 'Please wait while we verify your payment and set up your account.'}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-400">
              <div className="w-2 h-2 rounded-full bg-[#3FAF97] animate-pulse" />
              {isFr ? 'Vérification avec Stripe…' : 'Verifying with Stripe...'}
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="mx-auto text-[#3FAF97] mb-4" size={48} />
            <h1 className="text-xl font-bold text-gray-900">{isFr ? 'Paiement réussi !' : 'Payment successful!'}</h1>
            <p className="text-sm text-gray-500 mt-2">
              {isFr ? 'Votre compte est prêt. Redirection vers votre tableau de bord…' : 'Your account is ready. Redirecting to your dashboard...'}
            </p>
            {userEmail && (
              <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500 bg-gray-50 rounded-lg px-4 py-3">
                <Mail size={16} className="text-gray-400 shrink-0" />
                <span>{isFr ? <>Un reçu a été envoyé à <strong className="text-gray-700">{userEmail}</strong></> : <>A receipt has been sent to <strong className="text-gray-700">{userEmail}</strong></>}</span>
              </div>
            )}
            {smsNumber && (
              <div className="mt-3 flex items-center justify-center gap-2 text-sm text-[#1F5F4F] bg-[#E8F4F0] rounded-lg px-4 py-3">
                <MessageSquare size={16} className="shrink-0" />
                <span>
                  {isFr ? <>Votre numéro SMS : <strong>{smsNumber}</strong></> : <>Your SMS number: <strong>{smsNumber}</strong></>}
                </span>
              </div>
            )}
            {!smsNumber && smsPending && (
              <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-3">
                <Loader2 size={14} className="animate-spin shrink-0" />
                <span>{isFr ? 'Configuration de votre numéro SMS dédié…' : 'Setting up your dedicated SMS number...'}</span>
              </div>
            )}
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
              <span className="text-red-600 text-xl font-bold">!</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">{isFr ? 'Une erreur est survenue' : 'Something went wrong'}</h1>
            <p className="text-sm text-gray-500 mt-2">
              {errorMsg || (isFr ? 'Votre paiement n’a pas pu être confirmé. Veuillez contacter le soutien.' : 'Your payment could not be confirmed. Please contact support.')}
            </p>
            <button
              onClick={() => navigate('/checkout')}
              className="mt-4 px-6 py-2 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-800"
            >
              {isFr ? 'Réessayer' : 'Try again'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
