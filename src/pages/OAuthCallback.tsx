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
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [countdown, setCountdown] = useState(3);

  const success = params.get('success') === 'true';
  const error = params.get('error');
  const appId = params.get('app');

  // Le décompte ne fait QUE décompter. La fonction passée à setCountdown doit
  // rester pure : y appeler navigate() modifiait le routeur pendant le rendu de
  // ce composant, ce que React signale par « Cannot update a component while
  // rendering a different component » (repéré par le robot de recette).
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // La redirection est un effet du compteur arrivé à zéro, pas de sa mise à jour.
  useEffect(() => {
    if (countdown === 0) navigate('/settings/marketplace', { replace: true });
  }, [countdown, navigate]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-surface-card dark:bg-zinc-900 rounded-xl shadow-lg p-8 max-w-md w-full text-center space-y-4">
        {success ? (
          <>
            <CheckCircle className="mx-auto w-16 h-16 text-green-500" />
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">
              {fr ? 'Connexion réussie' : 'Connection successful'}
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              {appId
                ? fr
                  ? `${appId} a été connecté avec succès.`
                  : `${appId} was connected successfully.`
                : fr
                  ? 'Intégration connectée avec succès.'
                  : 'Integration connected successfully.'}
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
                  ? 'Une erreur est survenue lors de la connexion.'
                  : 'An error occurred while connecting.')}
            </p>
          </>
        )}

        <div className="flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          {fr ? `Redirection dans ${countdown}s...` : `Redirecting in ${countdown}s...`}
        </div>

        <button
          onClick={() => navigate('/settings/marketplace', { replace: true })}
          className="mt-2 px-4 py-2 text-sm rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
        >
          {fr ? 'Retourner au Marketplace' : 'Back to Marketplace'}
        </button>
      </div>
    </div>
  );
}
