/* ═══════════════════════════════════════════════════════════════
   La sous-navigation de la section Automatisations.

   « Automatisations · Vue d'ensemble · Activité · Réglages globaux », en
   tête des quatre pages. Elle était recopiée dans chacune : la liste avait des
   liens, les deux autres encore des boutons — ni nouvel onglet, ni
   Ctrl+clic, et rien n'annonçait la section courante à un lecteur
   d'écran (audit du 2026-10-01). Un seul composant : les trois pages ne
   peuvent plus diverger.
   ═══════════════════════════════════════════════════════════════ */

import { Link } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { hasPermission } from '../../lib/permissions';
import { Settings } from 'lucide-react';
// « Activité » : l'Historique et les Journaux de TOUT le bureau (constat D-13).

export type SectionAutomatisations = 'liste' | 'apercu' | 'activite' | 'reglages';

const CLASSE_BASE = 'inline-flex items-center gap-1.5 border-b-2 px-3 pb-3 pt-1 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';
const CLASSE_COURANTE = `${CLASSE_BASE} border-primary font-semibold text-primary`;
const CLASSE_AUTRE = `${CLASSE_BASE} border-transparent text-text-secondary transition-colors hover:text-text-primary`;

export default function SousNavigation({ courante, fr }: { courante: SectionAutomatisations; fr: boolean }) {
  /*
   * « Réglages globaux » exige « modifier les automatisations » (route gardée dans App.tsx) : pour
   * un rôle qui ne fait que VOIR, le lien menait à « Accès restreint » (triage de la liste,
   * `12-permissions:102`). On ne montre pas une porte qu'on fermera.
   */
  const acces = usePermissions();
  // Droits pas encore lus : le lien reste (il ne disparaît que pour un rôle CONNU sans le droit).
  const peutModifier = acces.loading || acces.role === 'owner' || hasPermission(acces.permissions, 'automations.update', acces.role ?? undefined);
  const lien = (section: SectionAutomatisations) => ({
    className: section === courante ? CLASSE_COURANTE : CLASSE_AUTRE,
    'aria-current': section === courante ? ('page' as const) : undefined,
  });
  return (
    <div className="flex flex-wrap items-center gap-5 border-b border-border pb-0">
      <span className="pb-3 text-[15px] font-semibold text-text-primary">
        {fr ? 'Automatisation' : 'Automation'}
      </span>
      <nav className="flex items-center gap-1" aria-label={fr ? 'Sections' : 'Sections'}>
        <Link to="/automations" {...lien('liste')}>
          {fr ? 'Automatisations' : 'Workflows'}
        </Link>
        <Link to="/automations/apercu" {...lien('apercu')}>
          {fr ? 'Vue d’ensemble' : 'Overview'}
          <span className="rounded bg-warning-light px-1 py-0.5 text-[9px] font-bold uppercase text-warning">
            {fr ? 'Bêta' : 'Beta'}
          </span>
        </Link>
        <Link to="/automations/activite" {...lien('activite')}>
          {fr ? 'Activité' : 'Activity'}
        </Link>
        {peutModifier && (
          <Link to="/automations/reglages" {...lien('reglages')}>
            <Settings size={13} aria-hidden="true" />
            {fr ? 'Réglages globaux' : 'Global settings'}
          </Link>
        )}
      </nav>
    </div>
  );
}
