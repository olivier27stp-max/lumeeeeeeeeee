/* ═══════════════════════════════════════════════════════════════
   Email OAuth Callback Page
   Landing page after connecting a Gmail / Outlook mailbox.
   Shows success/error, then returns to the Messages tab.
   ═══════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n';

const RETURN_TO = '/messages';

export default function EmailOAuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [countdown, setCountdown] = useState(3);

  const success = params.get('success') === 'true';
  const error = params.get('error');
  const provider = params.get('provider');
  const providerName =
    provider === 'gmail'
      ? 'Gmail'
      : provider === 'outlook'
        ? 'Outlook'
        : fr
          ? 'la boîte email'
          : 'the email inbox';

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate(RETURN_TO, { replace: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-surface-card dark:bg-zinc-900 rounded-xl shadow-lg p-8 max-w-md w-full text-center space-y-4">
        {success ? (
          <>
            <CheckCircle className="mx-auto w-16 h-16 text-green-500" />
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
              {fr ? 'Boîte connectée' : 'Inbox connected'}
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              {fr
                ? `${providerName} a été connecté avec succès à vos messages.`
                : `${providerName} was successfully connected to your messages.`}
            </p>
          </>
        ) : (
          <>
            <XCircle className="mx-auto w-16 h-16 text-red-500" />
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
              {fr ? 'Échec de la connexion' : 'Connection failed'}
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              {error ||
                (fr
                  ? 'Une erreur est survenue lors de la connexion de la boîte email.'
                  : 'An error occurred while connecting the email inbox.')}
            </p>
          </>
        )}

        <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          {fr
            ? `Retour aux messages dans ${countdown}s...`
            : `Back to messages in ${countdown}s...`}
        </div>

        <button
          onClick={() => navigate(RETURN_TO, { replace: true })}
          className="mt-2 px-4 py-2 text-sm rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
        >
          {fr ? 'Retour aux messages' : 'Back to messages'}
        </button>
      </div>
    </div>
  );
}
