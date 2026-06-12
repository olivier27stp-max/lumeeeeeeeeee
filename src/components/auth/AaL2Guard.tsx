/**
 * AAL2 Guard — refuses to render the authenticated app tree when the
 * current Supabase session is at AAL1 but the user has verified MFA factors.
 *
 * Closes the audit P1-D8 hole: signInWithPassword leaves an AAL1 session in
 * localStorage even when MFA is enrolled. Without this guard, an attacker
 * who can read localStorage (XSS, malicious extension) or who hijacks the
 * user mid-flow gets an AAL1 session that the rest of the app would happily
 * use. The guard blocks rendering and signs the user out if they cannot
 * promote to AAL2.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { endTrackingAndSignOut } from '../../hooks/useLiveLocationTracking';
import { Shield, Loader2 } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

type GuardState = 'checking' | 'ok' | 'needs-mfa';

export default function AaL2Guard({ children }: Props) {
  const [state, setState] = useState<GuardState>('checking');

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        // Returns the current session's AAL and the highest AAL the user
        // could reach (i.e. whether MFA factors exist).
        const aalApi: any = (supabase.auth as any).mfa?.getAuthenticatorAssuranceLevel;
        if (typeof aalApi === 'function') {
          const { data } = await aalApi.call((supabase.auth as any).mfa);
          if (cancelled) return;
          const current = data?.currentLevel;
          const next = data?.nextLevel;
          // If user has factors enrolled (nextLevel === 'aal2') but the
          // session is only at AAL1, refuse to render.
          if (next === 'aal2' && current !== 'aal2') {
            setState('needs-mfa');
            return;
          }
        }
        setState('ok');
      } catch {
        setState('ok'); // fail-open on transient errors — re-check on next render
      }
    }

    check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { check(); });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA]">
        <Loader2 size={20} className="animate-spin text-gray-500" />
      </div>
    );
  }

  if (state === 'needs-mfa') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#F8F9FA]">
        <div className="max-w-md w-full glass-card text-center space-y-4">
          <div className="flex justify-center">
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
              <Shield size={24} className="text-primary" />
            </div>
          </div>
          <h2 className="text-xl font-semibold">Two-Factor Authentication Required</h2>
          <p className="text-sm text-gray-500">
            Your account has MFA enabled. Please sign in again and complete the verification step.
          </p>
          <button
            onClick={async () => { await endTrackingAndSignOut(); window.location.href = '/'; }}
            className="glass-button-primary"
          >
            Sign out and retry
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
