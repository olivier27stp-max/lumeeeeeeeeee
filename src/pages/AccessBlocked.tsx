import { AlertTriangle, LogOut, Mail, RefreshCw, CreditCard } from 'lucide-react';
import { endTrackingAndSignOut } from '../hooks/useLiveLocationTracking';
import { useTranslation } from '../i18n';

export type AccessBlockedReason =
  | 'no_membership'
  | 'no_subscription'
  | 'oauth_failed'
  | 'unknown';

interface AccessBlockedProps {
  reason: AccessBlockedReason;
  userEmail?: string | null;
  detail?: string;
}

type BilingualCopy = { title: string; description: string; hint: string };

const COPY: Record<AccessBlockedReason, { fr: BilingualCopy; en: BilingualCopy }> = {
  no_membership: {
    fr: {
      title: "Aucun compte d'entreprise associé",
      description:
        "Cet email Google n'est lié à aucune organisation Lume CRM. Tu as probablement créé ton compte avec une adresse différente (email/mot de passe).",
      hint: "Déconnecte-toi et reconnecte-toi avec l'email utilisé lors de l'inscription — ou contacte le support si tu penses que c'est une erreur.",
    },
    en: {
      title: 'No business account linked',
      description:
        "This Google email isn't linked to any Lume CRM organization. You probably created your account with a different address (email/password).",
      hint: 'Sign out and sign back in with the email you used at signup — or contact support if you think this is a mistake.',
    },
  },
  no_subscription: {
    fr: {
      title: 'Abonnement requis',
      description:
        "Ton compte existe mais n'a pas d'abonnement actif. Pour accéder au CRM, tu dois compléter ton paiement.",
      hint: 'Clique sur « Compléter mon abonnement » pour finaliser.',
    },
    en: {
      title: 'Subscription required',
      description:
        "Your account exists but doesn't have an active subscription. To access the CRM, you need to complete your payment.",
      hint: 'Click "Complete my subscription" to finish.',
    },
  },
  oauth_failed: {
    fr: {
      title: 'Échec de la connexion Google',
      description:
        "La connexion Google s'est lancée mais n'a pas pu être finalisée. Ça peut venir d'un cookie bloqué, d'une extension de navigateur, ou d'une config OAuth invalide.",
      hint: 'Essaie en navigation privée, ou déconnecte-toi puis reconnecte-toi avec email + mot de passe.',
    },
    en: {
      title: 'Google sign-in failed',
      description:
        "Google sign-in started but couldn't be completed. This can be caused by a blocked cookie, a browser extension, or an invalid OAuth config.",
      hint: 'Try private browsing, or sign out and sign back in with email + password.',
    },
  },
  unknown: {
    fr: {
      title: 'Accès impossible',
      description: "Ton compte n'a pas pu être chargé pour une raison inconnue.",
      hint: 'Déconnecte-toi puis reconnecte-toi. Si le problème persiste, contacte le support.',
    },
    en: {
      title: 'Access unavailable',
      description: "Your account couldn't be loaded for an unknown reason.",
      hint: 'Sign out and sign back in. If the problem persists, contact support.',
    },
  },
};

export default function AccessBlocked({ reason, userEmail, detail }: AccessBlockedProps) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const copy = COPY[reason][fr ? 'fr' : 'en'];

  const handleSignOut = async () => {
    await endTrackingAndSignOut();
    // Hard reload to clear all in-memory state and URL params.
    window.location.href = '/';
  };

  const handleRetry = () => {
    window.location.reload();
  };

  const handleCheckout = () => {
    window.location.href = '/checkout';
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-6 bg-surface">
      <div className="max-w-lg w-full rounded-2xl border border-outline bg-surface-secondary p-8 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-warning-light flex items-center justify-center">
            <AlertTriangle size={24} className="text-warning" />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-text-primary mb-2">{copy.title}</h1>
            <p className="text-sm text-text-secondary leading-relaxed mb-3">{copy.description}</p>
            <p className="text-[13px] text-text-tertiary mb-4">{copy.hint}</p>

            {(userEmail || detail) && (
              <div className="rounded-lg bg-surface px-3 py-2 mb-5 border border-outline">
                {userEmail && (
                  <p className="text-[11px] text-text-tertiary">
                    {fr ? 'Connecté en tant que :' : 'Signed in as:'}{' '}
                    <span className="text-text-primary font-mono">{userEmail}</span>
                  </p>
                )}
                {detail && (
                  <p className="text-[11px] text-text-tertiary mt-1 break-all">
                    {fr ? 'Détail :' : 'Detail:'} <span className="font-mono">{detail}</span>
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {reason === 'no_subscription' && (
                <button
                  onClick={handleCheckout}
                  className="glass-button-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium"
                >
                  <CreditCard size={16} />
                  {fr ? 'Compléter mon abonnement' : 'Complete my subscription'}
                </button>
              )}
              <button
                onClick={handleSignOut}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-outline bg-surface hover:bg-surface-hover text-text-primary transition-colors"
              >
                <LogOut size={16} />
                {fr ? 'Se déconnecter' : 'Sign out'}
              </button>
              <button
                onClick={handleRetry}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-outline bg-surface hover:bg-surface-hover text-text-secondary transition-colors"
              >
                <RefreshCw size={14} />
                {fr ? 'Réessayer' : 'Retry'}
              </button>
              <a
                href="mailto:support@lumecrm.ca"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg text-text-tertiary hover:text-text-primary transition-colors"
              >
                <Mail size={14} />
                {fr ? 'Contacter le support' : 'Contact support'}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
