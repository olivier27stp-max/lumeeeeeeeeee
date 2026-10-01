/**
 * « Voir le détail » d'un chiffre de la page Statistiques : les lignes EXACTES qui le composent
 * (rpc_insights_detail), chacune liée à sa fiche, et leur total — égal au chiffre de la carte.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Drawer } from '../ui/drawer';
import { useTranslation } from '../../i18n';
import { detail, lienDetail, type CarteDetail, type LigneDetail } from '../../lib/statistiquesApi';
import type { Filtres } from '../../lib/statsFiltres';
import type { InsightsRange } from '../../lib/insightsPeriod';
import ErreurCarte from './ErreurCarte';

export interface DemandeDetail {
  carte: CarteDetail;
  cle?: string | null;
  titre: string;
  /** Unité des montants : dollars (défaut), aucune (des lignes comptées) ou jours (délai de paiement). */
  unite?: 'argent' | 'compte' | 'jours';
}

const TYPES: Record<LigneDetail['type'], { fr: string; en: string }> = {
  paiement: { fr: 'Paiement', en: 'Payment' },
  facture: { fr: 'Facture', en: 'Invoice' },
  job: { fr: 'Job', en: 'Job' },
  soumission: { fr: 'Soumission', en: 'Quote' },
  client: { fr: 'Lead', en: 'Lead' },
  deal: { fr: 'Deal', en: 'Deal' },
};

export default function PanneauDetail({ demande, plage, filtres, onFermer }: {
  demande: DemandeDetail | null;
  plage: InsightsRange;
  filtres: Filtres;
  onFermer: () => void;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const locale = fr ? 'fr-CA' : 'en-CA';
  const q = useQuery({
    queryKey: ['stats-detail', demande?.carte, demande?.cle ?? null, plage.from, plage.to, filtres],
    queryFn: () => detail(plage, filtres, demande!.carte, demande!.cle),
    enabled: !!demande,
  });
  const argent = (c: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(c / 100);
  const date = (d: string | null) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(d.length === 10 ? `${d}T12:00:00` : d)) : '—');
  const unite = demande?.unite ?? 'argent';
  const lignes = q.data || [];
  const total = lignes.reduce((s, l) => s + l.cents, 0);
  const valeur = (c: number) => (unite === 'jours' ? `${(c / 100).toLocaleString(locale, { maximumFractionDigits: 1 })} ${fr ? 'j' : 'd'}` : argent(c));
  const resume = unite === 'compte'
    ? `${lignes.length} ${fr ? (lignes.length > 1 ? 'éléments' : 'élément') : lignes.length === 1 ? 'item' : 'items'}`
    : unite === 'jours'
      ? `${fr ? 'Moyenne' : 'Average'} : ${lignes.length ? valeur(total / lignes.length) : '—'} · ${lignes.length} ${fr ? 'factures' : 'invoices'}`
      : `${fr ? 'Total' : 'Total'} : ${argent(total)} · ${lignes.length} ${fr ? (lignes.length > 1 ? 'lignes' : 'ligne') : lignes.length === 1 ? 'row' : 'rows'}`;

  return (
    <Drawer open={!!demande} onClose={onFermer} title={demande?.titre} description={resume} width="lg">
      {q.isError ? <ErreurCarte onRetry={() => q.refetch()} /> : q.isLoading ? (
        <div className="space-y-2 p-1">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 rounded bg-surface-secondary/60 animate-pulse" />)}</div>
      ) : lignes.length === 0 ? (
        <div className="py-10 text-center text-[12.5px] text-text-tertiary">{fr ? 'Aucune ligne pour ce chiffre.' : 'No rows behind this figure.'}</div>
      ) : (
        <ul className="divide-y divide-border-light" data-total-cents={total}>
          {lignes.map((l) => (
            <li key={`${l.type}-${l.id}`}>
              <Link to={lienDetail(l)} onClick={onFermer} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary">
                <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{fr ? TYPES[l.type]?.fr : TYPES[l.type]?.en}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-text-primary">{l.libelle}</span>
                  <span className="block truncate text-[11.5px] text-text-tertiary">{l.sousLibelle} · {date(l.quand)}</span>
                </span>
                {unite !== 'compte' && <span className="shrink-0 text-[13px] font-bold tabular-nums text-text-primary">{valeur(l.cents)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
