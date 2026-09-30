/**
 * Bandeau de filtres de la page Statistiques : UNE période pour toute la page (prédéfinie ou
 * personnalisée), la comparaison à la période précédente, les filtres équipe / technicien /
 * vendeur / client / service (combinables) et l'export. Mêmes pastilles que les listes (FilterPill).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, X } from 'lucide-react';
import FilterPill from '../ui/FilterPill';
import DateRangeInput from '../ui/DateRangeInput';
import { useTranslation } from '../../i18n';
import { INSIGHTS_PERIODS, periodLabel } from '../../lib/insightsPeriod';
import { CLES_FILTRES, type CleFiltre, type EtatStats } from '../../lib/statsFiltres';
import { listTeams } from '../../lib/teamsApi';
import { fetchMembres, rechercherClientsPourDeal } from '../../lib/pipelineVentesApi';
import { listSalespeople } from '../../lib/jobsApi';
import { listPredefinedServices } from '../../lib/servicesApi';

const TOUS = '';

/** Recherche d'un client (des milliers possibles : pas de liste déroulante complète). */
function ChoixClient({ valeur, nomActuel, onChange }: { valeur?: string; nomActuel?: string; onChange: (id: string | undefined, nom?: string) => void }) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const id = useId();
  const [q, setQ] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef<HTMLDivElement>(null);
  const res = useQuery({ queryKey: ['stats-choix-client', q], queryFn: () => rechercherClientsPourDeal(q, 8), enabled: q.trim().length >= 2, staleTime: 30_000 });
  useEffect(() => {
    const fermer = (e: MouseEvent) => { if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, []);
  if (valeur) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1.5 text-[12.5px] font-semibold text-text-primary">
        {fr ? 'Client' : 'Client'} : {nomActuel || '…'}
        <button type="button" aria-label={fr ? 'Retirer le filtre client' : 'Clear client filter'} onClick={() => onChange(undefined)} className="rounded-full p-0.5 hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary">
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  }
  return (
    <div ref={boite} className="relative">
      <label htmlFor={id} className="sr-only">{fr ? 'Filtrer par client' : 'Filter by client'}</label>
      <input
        id={id}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOuvert(true); }}
        onFocus={() => setOuvert(true)}
        placeholder={fr ? 'Client…' : 'Client…'}
        className="w-36 rounded-full bg-surface-secondary px-3 py-1.5 text-[12.5px] text-text-primary placeholder:text-text-tertiary outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary"
      />
      {ouvert && q.trim().length >= 2 && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 w-64 rounded-xl border border-border bg-surface-card p-1.5 shadow-xl">
          {(res.data || []).length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-text-tertiary">{res.isLoading ? '…' : fr ? 'Aucun client' : 'No client'}</div>
          ) : (res.data || []).map((c) => (
            <button key={c.id} type="button" onClick={() => { onChange(c.id, c.nom); setQ(''); setOuvert(false); }}
              className="block w-full rounded-lg px-3 py-2 text-left text-[12.5px] text-text-primary hover:bg-surface-secondary focus-visible:outline-none focus-visible:bg-surface-secondary">
              {c.nom}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BarreFiltres({ etat, onChange, onExporter, exportPret }: {
  etat: EtatStats;
  onChange: (e: EtatStats) => void;
  onExporter: () => void;
  exportPret: boolean;
}) {
  const { language } = useTranslation();
  const fr = language === 'fr';
  const idComparer = useId();
  // Coché tout de suite : l'URL (source de vérité) suit dans une transition du routeur, ce qui
  // laissait la case décochée le temps du rendu suivant.
  const [comparer, setComparer] = useState(etat.comparer);
  useEffect(() => { setComparer(etat.comparer); }, [etat.comparer]);
  const [nomClient, setNomClient] = useState<string | undefined>();

  const equipesQ = useQuery({ queryKey: ['stats-choix-equipes'], queryFn: listTeams, staleTime: 5 * 60_000 });
  const membresQ = useQuery({ queryKey: ['stats-choix-membres'], queryFn: fetchMembres, staleTime: 5 * 60_000 });
  const vendeursQ = useQuery({ queryKey: ['stats-choix-vendeurs'], queryFn: listSalespeople, staleTime: 5 * 60_000 });
  const servicesQ = useQuery({ queryKey: ['stats-choix-services'], queryFn: listPredefinedServices, staleTime: 5 * 60_000 });

  const poser = (k: CleFiltre, v: string | undefined) => onChange({ ...etat, filtres: { ...etat.filtres, [k]: v || undefined } });
  const tous = { value: TOUS, label: fr ? 'Tous' : 'All' };
  const actifs = CLES_FILTRES.filter((k) => etat.filtres[k]).length;

  const optionsPeriode = [
    ...INSIGHTS_PERIODS.map((p) => ({ value: p, label: periodLabel(p, fr) })),
    { value: 'custom', label: fr ? 'Période personnalisée' : 'Custom range' },
  ];

  return (
    <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label={fr ? 'Filtres des statistiques' : 'Statistics filters'}>
      <FilterPill label={fr ? 'Période' : 'Period'} value={etat.periode} options={optionsPeriode}
        onChange={(v) => onChange({ ...etat, periode: v as EtatStats['periode'] })} />
      {etat.periode === 'custom' && (
        <DateRangeInput from={etat.du ?? ''} to={etat.au ?? ''} language={fr ? 'fr' : 'en'} className="w-60"
          onChange={({ from, to }) => onChange({ ...etat, du: from || undefined, au: to || undefined })} />
      )}
      <label htmlFor={idComparer} className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-surface-secondary px-3 py-1.5 text-[12.5px] font-semibold text-text-primary">
        <input id={idComparer} type="checkbox" checked={comparer} onChange={(e) => { setComparer(e.target.checked); onChange({ ...etat, comparer: e.target.checked }); }}
          className="h-3.5 w-3.5 accent-current focus-visible:ring-2 focus-visible:ring-text-tertiary" />
        {fr ? 'Comparer à la période précédente' : 'Compare to previous period'}
      </label>

      <span className="mx-1 hidden h-5 w-px bg-border sm:inline-block" aria-hidden="true" />

      <FilterPill label={fr ? 'Équipe' : 'Team'} value={etat.filtres.equipe ?? TOUS}
        options={[tous, ...(equipesQ.data || []).filter((t) => t.is_active !== false).map((t) => ({ value: t.id, label: t.name, dotColor: t.color_hex || undefined }))]}
        onChange={(v) => poser('equipe', v)} onClear={etat.filtres.equipe ? () => poser('equipe', undefined) : undefined} />
      <FilterPill label={fr ? 'Technicien' : 'Technician'} value={etat.filtres.technicien ?? TOUS}
        options={[tous, ...(membresQ.data || []).map((m) => ({ value: m.id, label: m.name }))]}
        onChange={(v) => poser('technicien', v)} onClear={etat.filtres.technicien ? () => poser('technicien', undefined) : undefined} />
      <FilterPill label={fr ? 'Vendeur' : 'Sales rep'} value={etat.filtres.vendeur ?? TOUS}
        options={[tous, ...(vendeursQ.data || []).map((s) => ({ value: s.id, label: s.label }))]}
        onChange={(v) => poser('vendeur', v)} onClear={etat.filtres.vendeur ? () => poser('vendeur', undefined) : undefined} />
      <FilterPill label="Service" value={etat.filtres.service ?? TOUS}
        options={[tous, ...(servicesQ.data || []).map((s) => ({ value: s.id, label: s.name }))]}
        onChange={(v) => poser('service', v)} onClear={etat.filtres.service ? () => poser('service', undefined) : undefined} />
      <ChoixClient valeur={etat.filtres.client} nomActuel={nomClient}
        onChange={(id, nom) => { setNomClient(nom); poser('client', id); }} />

      {actifs > 0 && (
        <button type="button" onClick={() => onChange({ ...etat, filtres: {} })}
          className="text-[12.5px] font-semibold text-text-secondary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary rounded">
          {fr ? `Retirer les filtres (${actifs})` : `Clear filters (${actifs})`}
        </button>
      )}

      <button type="button" onClick={onExporter} disabled={!exportPret}
        className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-[12.5px] font-semibold text-text-primary hover:bg-surface-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-tertiary">
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        {fr ? 'Exporter (CSV)' : 'Export (CSV)'}
      </button>
    </div>
  );
}
