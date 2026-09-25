/**
 * Champs personnalisés × pipeline de ventes.
 *
 * Tout ce que le board a besoin de savoir des champs d'opportunité, dans un
 * seul module, pour que PipelineBoard n'ait que quelques points d'insertion :
 *   · useChampsPipeline : champs d'opportunité, champs affichés sur les
 *     cartes (réglage par pipeline), valeurs des deals chargés ;
 *   · ChampsSurCarte : le rendu sur une carte (listes = pastilles colorées) ;
 *   · useFiltreChamps : filtre SQL (cf_filtrer) sur les deals chargés ;
 *   · PanneauChamps : conditions + tri par champ, dans le panneau de filtres ;
 *   · comparerParChamp : le tri (nombre, montant, date).
 * Derrière le drapeau `custom_fields_v2` : coupé, rien ne s'affiche ni ne filtre.
 */
import { useId, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useChampsPersoActifs } from '../../hooks/useChampsPersoActifs';
import {
  filtrerParChamps, lireCartesPipeline, listerChamps, lireValeursLot,
  type ChampPerso, type Condition, type ValeurEnregistree,
} from '../../lib/champsPersoApi';
import { formaterValeur } from '../../lib/champs/valeurs';
import EditeurConditions, { conditionComplete } from './EditeurConditions';

export interface TriChamp { field_id: string; sens: 'asc' | 'desc' }
type Valeurs = Record<string, Record<string, ValeurEnregistree>>;
// Défauts stables (un `= []` ou `= {}` inline change d'identité à chaque rendu).
const AUCUN_ID: string[] = [];
const AUCUNE_VALEUR: Valeurs = {};

export function useChampsPipeline(pipelineId: string | null, dealIds: string[]) {
  const { isEnabled } = useChampsPersoActifs();
  const { data: liste } = useQuery({
    queryKey: ['champs-perso', 'deal'],
    queryFn: () => listerChamps('deal'),
    enabled: isEnabled,
    staleTime: 60_000,
  });
  const champsDeal = useMemo(() => liste?.fields ?? [], [liste]);
  const { data: idsCartes = AUCUN_ID } = useQuery({
    queryKey: ['champs-perso', 'cartes', pipelineId],
    queryFn: () => lireCartesPipeline(pipelineId as string),
    enabled: isEnabled && !!pipelineId,
    staleTime: 60_000,
  });
  const champsCarte = useMemo(
    () => idsCartes.map((id) => champsDeal.find((c) => c.id === id)).filter((c): c is ChampPerso => !!c),
    [idsCartes, champsDeal],
  );
  // Une clé stable : l'ordre des deals change au tri, pas leur ensemble.
  const cleIds = useMemo(() => [...dealIds].sort().join(','), [dealIds]);
  const { data: valeurs = AUCUNE_VALEUR } = useQuery({
    queryKey: ['champs-perso', 'valeurs-deals', cleIds],
    queryFn: () => lireValeursLot('deal', dealIds.slice(0, 2000)),
    enabled: isEnabled && champsDeal.length > 0 && dealIds.length > 0,
    staleTime: 30_000,
  });
  return { actif: isEnabled, champsDeal, champsCarte, valeurs: valeurs as Valeurs };
}

/**
 * Ids retenus par les conditions de champs (SQL, fuseau de l'entreprise).
 * `null` = aucun filtre de champ actif (tout passe).
 */
export function useFiltreChamps(conditions: Condition[], dealIds: string[]): { ids: Set<string> | null; enCours: boolean } {
  const completes = conditions.filter(conditionComplete);
  const cle = JSON.stringify(completes);
  const cleIds = useMemo(() => [...dealIds].sort().join(','), [dealIds]);
  const { data, isFetching } = useQuery({
    queryKey: ['champs-perso', 'filtre-deals', cle, cleIds],
    queryFn: () => filtrerParChamps('deal', completes, dealIds),
    enabled: completes.length > 0 && dealIds.length > 0,
    staleTime: 15_000,
  });
  if (completes.length === 0) return { ids: null, enCours: false };
  return { ids: data ? new Set(data) : new Set<string>(), enCours: isFetching };
}

/** Comparateur de tri sur un champ (vides toujours en dernier). */
export function comparerParChamp(tri: TriChamp, valeurs: Valeurs) {
  return (a: { id: string }, b: { id: string }) => {
    const va = valeurs[a.id]?.[tri.field_id]?.value;
    const vb = valeurs[b.id]?.[tri.field_id]?.value;
    const vide = (v: unknown) => v === null || v === undefined || v === '';
    if (vide(va) && vide(vb)) return 0;
    if (vide(va)) return 1;
    if (vide(vb)) return -1;
    const na = typeof va === 'number' ? va : Date.parse(String(va));
    const nb = typeof vb === 'number' ? vb : Date.parse(String(vb));
    return tri.sens === 'asc' ? na - nb : nb - na;
  };
}

export function ChampsSurCarte({ champs, valeurs, fr }: { champs: ChampPerso[]; valeurs: Record<string, ValeurEnregistree> | undefined; fr: boolean }) {
  if (champs.length === 0 || !valeurs) return null;
  const remplis = champs.filter((c) => {
    const v = valeurs[c.id]?.value;
    return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
  if (remplis.length === 0) return null;
  return (
    <dl className="mt-2 space-y-1">
      {remplis.map((c) => {
        const v = valeurs[c.id]!.value;
        if (c.field_type === 'dropdown_single' || c.field_type === 'dropdown_multi') {
          const ids = Array.isArray(v) ? v : [String(v)];
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-1">
              <dt className="sr-only">{c.label}</dt>
              {ids.map((id) => {
                const o = c.options.find((x) => x.id === id);
                if (!o) return null;
                return (
                  <dd key={id} title={c.label} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-text-primary"
                    style={{ backgroundColor: `${o.color ?? '#94a3b8'}33` }}>
                    {o.label}
                  </dd>
                );
              })}
            </div>
          );
        }
        return (
          <div key={c.id} className="flex items-baseline justify-between gap-2 text-[11px]">
            <dt className="truncate text-text-tertiary">{c.label}</dt>
            <dd className="truncate text-right font-medium text-text-secondary">{formaterValeur(c, v, fr ? 'fr' : 'en')}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function PanneauChamps({ champs, conditions, onConditions, tri, onTri, fr, enCours }: {
  champs: ChampPerso[]; conditions: Condition[]; onConditions: (c: Condition[]) => void;
  tri: TriChamp | null; onTri: (t: TriChamp | null) => void; fr: boolean; enCours?: boolean;
}) {
  const ids = useId();
  if (champs.length === 0) return null;
  const triables = champs.filter((c) => !c.archived_at && (c.field_type === 'number' || c.field_type === 'monetary' || c.field_type === 'date'));
  return (
    <div className="w-full border-t border-outline pt-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
        {fr ? 'Champs personnalisés' : 'Custom fields'}{enCours && <span className="ml-2 normal-case font-normal">{fr ? 'filtrage…' : 'filtering…'}</span>}
      </p>
      <EditeurConditions champs={champs} conditions={conditions} onChange={onConditions} fr={fr} />
      {triables.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={`${ids}-tri`} className="text-[11px] text-text-tertiary">{fr ? 'Trier par champ' : 'Sort by field'}</label>
          <select id={`${ids}-tri`} value={tri?.field_id ?? ''}
            onChange={(e) => onTri(e.target.value ? { field_id: e.target.value, sens: tri?.sens ?? 'desc' } : null)}
            className="h-8 rounded-md border border-outline bg-surface-card px-2 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <option value="">{fr ? '— tri habituel —' : '— default sort —'}</option>
            {triables.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {tri && (
            <>
              <label htmlFor={`${ids}-sens`} className="sr-only">{fr ? 'Sens du tri' : 'Sort direction'}</label>
              <select id={`${ids}-sens`} value={tri.sens} onChange={(e) => onTri({ ...tri, sens: e.target.value as 'asc' | 'desc' })}
                className="h-8 rounded-md border border-outline bg-surface-card px-2 text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                <option value="desc">{fr ? 'Plus grand / plus récent d’abord' : 'Largest / latest first'}</option>
                <option value="asc">{fr ? 'Plus petit / plus ancien d’abord' : 'Smallest / oldest first'}</option>
              </select>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export { valeurCsv } from '../../lib/champs/valeurs';
