/* ═══════════════════════════════════════════════════════════════
   Activité des automatisations — à l'échelle du BUREAU.

   Avant, pour répondre à « qu'est-ce que Mme Tremblay a reçu ? », il
   fallait ouvrir chaque automatisation une à une et lire son onglet
   Journaux (constat D-13). Ici : toutes les automatisations du bureau,
   cherchables par client, filtrables par automatisation, statut et dates.

   Les deux mêmes vues que dans l'éditeur (mêmes composants, mêmes routes,
   mêmes définitions) :
   · Historique — une ligne par passage d'un client, résultat en clair ;
   · Journaux   — le détail technique de chaque action.

   `?regle=<id>` ouvre la page filtrée sur une automatisation (lien du
   panneau de statistiques de la liste) ; `?vue=journaux` ouvre les Journaux.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from '../i18n';
import PermissionGate from '../components/PermissionGate';
import SousNavigation from '../components/automations/SousNavigation';
import { OngletHistorique, OngletJournaux, type RegleDuFiltre } from '../components/automations/OngletJournaux';
import { getAutomationRules } from '../lib/automationRulesApi';
import { localizeAutomationName } from '../lib/automationNames';
import { cn } from '../lib/utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AutomationsActivite() {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const [parametres, setParametres] = useSearchParams();
  const vue = parametres.get('vue') === 'journaux' ? 'journaux' : 'historique';
  const regleDemandee = parametres.get('regle') ?? '';
  const regleInitiale = UUID.test(regleDemandee) ? regleDemandee : '';

  /** Les automatisations du bureau, pour le filtre. Illisibles : le filtre manque, les vues restent. */
  const [regles, setRegles] = useState<RegleDuFiltre[] | undefined>(undefined);
  useEffect(() => {
    let vivant = true;
    getAutomationRules()
      .then((liste) => {
        if (!vivant) return;
        setRegles(liste
          .map((r) => ({ id: r.id, nom: `${localizeAutomationName(r.name, language)}${r.deleted_at ? (fr ? ' (corbeille)' : ' (bin)') : ''}` }))
          .sort((a, b) => a.nom.localeCompare(b.nom, fr ? 'fr' : 'en')));
      })
      .catch((e: unknown) => {
        console.error('[activite] automatisations illisibles', e instanceof Error ? e.message : String(e));
        if (vivant) setRegles([]);
      });
    return () => { vivant = false; };
  }, [language, fr]);

  const VUES = [
    { cle: 'historique' as const, fr: 'Historique', en: 'History' },
    { cle: 'journaux' as const, fr: 'Journaux', en: 'Logs' },
  ];
  const choisir = (cle: 'historique' | 'journaux') => {
    const suivant = new URLSearchParams(parametres);
    if (cle === 'journaux') suivant.set('vue', 'journaux'); else suivant.delete('vue');
    setParametres(suivant, { replace: true });
  };

  return (
    <PermissionGate permission="automations.read">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <SousNavigation courante="activite" fr={fr} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[26px] font-bold tracking-tight text-text-primary">
            {fr ? 'Activité des automatisations' : 'Automation activity'}
          </h1>
          <div role="tablist" aria-label={fr ? 'Vues de l’activité' : 'Activity views'} className="inline-flex rounded-lg border border-outline/40 p-0.5">
            {VUES.map((v) => (
              <button
                key={v.cle}
                type="button"
                role="tab"
                aria-selected={vue === v.cle}
                onClick={() => choisir(v.cle)}
                className={cn(
                  'rounded-md px-3 py-1 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  vue === v.cle ? 'bg-surface-tertiary text-text-primary' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {fr ? v.fr : v.en}
              </button>
            ))}
          </div>
        </div>

        {/* Les deux vues attendent la liste des automatisations : le filtre s'ouvre sur la bonne. */}
        {regles !== undefined && (vue === 'historique'
          ? <OngletHistorique fr={fr} regles={regles} regleInitiale={regleInitiale} />
          : <OngletJournaux fr={fr} regles={regles} regleInitiale={regleInitiale} />)}
      </div>
    </PermissionGate>
  );
}
