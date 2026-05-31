/* ═══════════════════════════════════════════════════════════════
   OAuth Callback Page
   Handles the redirect from OAuth providers after authorization.
   Shows success/error state and auto-redirects to marketplace.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n';

export default function OAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState(3);

  const success = params.get('success') === 'true';
  const error = params.get('error');
  const appId = params.get('app');

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate('/settings/marketplace', { replace: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-lg p-8 max-w-md w-full text-center space-y-4">
        {success ? (
          <>
            <CheckCircle className="mx-auto w-16 h-16 text-green-500" />
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
              {t.oauthCallback.connectionSuccessful}
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              {appId
                ? t.oauthCallback.appConnectedSuccessfully.replace('${appId}', appId)
                : t.oauthCallback.integrationConnectedSuccessfully}
            </p>
          </>
        ) : (
          <>
            <XCircle className="mx-auto w-16 h-16 text-red-500" />
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
              {t.oauthCallback.connectionFailed}
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              {error || t.oauthCallback.errorOccurredDuringConnection}
            </p>
          </>
        )}

        <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t.oauthCallback.redirectingIn.replace('${countdown}', String(countdown))}
        </div>

        <button
          onClick={() => navigate('/settings/marketplace', { replace: true })}
          className="mt-2 px-4 py-2 text-sm rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
        >
          {t.oauthCallback.returnToMarketplace}
        </button>
      </div>
    </div>
  );
}
