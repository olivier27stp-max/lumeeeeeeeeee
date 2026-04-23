import { AlertTriangle, LogOut, Mail, RefreshCw, CreditCard } from 'lucide-react';
import { supabase } from '../lib/supabase';

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

const COPY: Record<AccessBlockedReason, { title: string; description: string; hint: string }> = {
  no_membership: {
    title: "Aucun compte d'entreprise associé",
    description:
      "Cet email Google n'est lié à aucune organisation Lume CRM. Tu as probablement créé ton compte avec une adresse différente (email/mot de passe).",
    hint: "Déconnecte-toi et reconnecte-toi avec l'email utilisé lors de l'inscription — ou contacte le support si tu penses que c'est une erreur.",
  },
  no_subscription: {
    title: 'Abonnement requis',
    description:
      "Ton compte existe mais n'a pas d'abonnement actif. Pour accéder au CRM, tu dois compléter ton paiement.",
    hint: 'Clique sur « Compléter mon abonnement » pour finaliser.',
  },
  oauth_failed: {
    title: 'Échec de la connexion Google',
    description:
      "La connexion Google s'est lancée mais n'a pas pu être finalisée. Ça peut venir d'un cookie bloqué, d'une extension de navigateur, ou d'une config OAuth invalide.",
    hint: 'Essaie en navigation privée, ou déconnecte-toi puis reconnecte-toi avec email + mot de passe.',
  },
  unknown: {
    title: 'Accès impossible',
    description: "Ton compte n'a pas pu être chargé pour une raison inconnue.",
    hint: 'Déconnecte-toi puis reconnecte-toi. Si le problème persiste, contacte le support.',
  },
};

export default function AccessBlocked({ reason, userEmail, detail }: AccessBlockedProps) {
  const copy = COPY[reason];

  const handleSignOut = async () => {
    await supabase.auth.signOut();
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
                    Connecté en tant que : <span className="text-text-primary font-mono">{userEmail}</span>
                  </p>
                )}
                {detail && (
                  <p className="text-[11px] text-text-tertiary mt-1 break-all">
                    Détail : <span className="font-mono">{detail}</span>
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
                  Compléter mon abonnement
                </button>
              )}
              <button
                onClick={handleSignOut}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-outline bg-surface hover:bg-surface-hover text-text-primary transition-colors"
              >
                <LogOut size={16} />
                Se déconnecter
              </button>
              <button
                onClick={handleRetry}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg border border-outline bg-surface hover:bg-surface-hover text-text-secondary transition-colors"
              >
                <RefreshCw size={14} />
                Réessayer
              </button>
              <a
                href="mailto:support@lumecrm.ca"
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg text-text-tertiary hover:text-text-primary transition-colors"
              >
                <Mail size={14} />
                Contacter le support
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
