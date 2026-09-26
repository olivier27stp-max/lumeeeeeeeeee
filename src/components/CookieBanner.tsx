import { useEffect, useState } from 'react';
import { useTranslation } from '../i18n';
import { Z } from '../lib/zIndex';
import {
  readStoredConsent,
  writeStoredConsent,
  submitCookieConsent,
  type ConsentChoice,
  CURRENT_COOKIE_POLICY_VERSION,
} from '../lib/consentApi';
import { supabase } from '../lib/supabase';

/**
 * Bandeau de témoins — RGPD / Loi 25.
 * - Refuser est aussi simple qu'accepter (deux boutons de même poids).
 * - Ne redemande QUE si la version de la politique change (pas de péremption
 *   par le temps : voir `CURRENT_COOKIE_POLICY_VERSION`).
 *
 * UNE SEULE case à cocher, et c'est délibéré : on ne demande un consentement
 * que là où il pilote vraiment quelque chose.
 *   • « Statistiques » commande le traçage de performance Sentry
 *     (`aConsentiAuxStatistiques()` dans `src/lib/sentry.ts`).
 *   • « Marketing » a disparu : l'application ne charge aucun pixel ni régie
 *     publicitaire. Une case qui ne coupe rien est un décor trompeur — si un
 *     traceur publicitaire arrive un jour, c'est ICI qu'on remet la case, et
 *     le traceur doit la lire avant de se charger.
 *   • « Préférences » a rejoint les strictement nécessaires : langue, thème et
 *     panneaux ouverts sont un stockage que l'utilisateur demande lui-même, il
 *     reste sur son appareil et ne part chez personne.
 */
export function CookieBanner() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [statistiques, setStatistiques] = useState(false);

  useEffect(() => {
    const existing = readStoredConsent();
    if (!existing) setVisible(true);
  }, []);

  async function persist(statsAcceptees: boolean) {
    // `marketing` faux et `preferences` vrai par construction : voir l'en-tête
    // du fichier. On garde les trois champs pour que le journal de
    // consentement continue de décrire l'état réel des quatre finalités.
    const c: ConsentChoice = { analytics: statsAcceptees, marketing: false, preferences: true };
    writeStoredConsent(c);
    setVisible(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id && session.access_token) {
        await submitCookieConsent(c, session.user.id, session.access_token, null);
      }
    } catch { /* non-blocking */ }
  }

  function acceptAll() { persist(true); }
  function rejectAll() { persist(false); }
  function saveGranular() { persist(statistiques); }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={t.cookies.title}
      // Repère stable pour les éléments flottants (bouton d'aide) qui doivent
      // se décaler au-dessus de cette barre plutôt que d'être recouverts.
      data-cookie-banner=""
      style={{ zIndex: Z.cookieBanner }}
      className="fixed bottom-0 left-0 right-0 border-t border-outline bg-surface shadow-2xl"
    >
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex-1">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t.cookies.title}
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              {t.cookies.description}{' '}
              <a href="/privacy" className="underline hover:text-gray-900 dark:hover:text-gray-100">
                {t.cookies.privacyLink}
              </a>.
            </p>

            {expanded && (
              <div className="mt-4 space-y-3 border-t border-gray-200 pt-4 dark:border-gray-800">
                <GranularRow label={t.cookies.essential} desc={t.cookies.essentialDesc} checked disabled />
                <GranularRow label={t.cookies.analytics} desc={t.cookies.analyticsDesc} checked={statistiques} onChange={setStatistiques} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 md:ml-6 md:w-56">
            <button type="button" onClick={acceptAll}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100">
              {t.cookies.acceptAll}
            </button>
            <button type="button" onClick={rejectAll}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800">
              {t.cookies.rejectAll}
            </button>
            {expanded ? (
              <button type="button" onClick={saveGranular}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                {t.cookies.saveChoices}
              </button>
            ) : (
              <button type="button" onClick={() => setExpanded(true)}
                className="text-sm text-gray-600 underline hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
                {t.cookies.customize}
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          {t.cookies.version}: {CURRENT_COOKIE_POLICY_VERSION}
        </p>
      </div>
    </div>
  );
}

function GranularRow(props: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange?.(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-gray-300"
      />
      <div className="flex-1">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{props.label}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{props.desc}</div>
      </div>
    </label>
  );
}
