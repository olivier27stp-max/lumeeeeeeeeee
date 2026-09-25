/**
 * Champs personnalisés dans les LISTES (clients, jobs, devis, factures).
 *
 *   const champs = useChampsListe('client', fr);
 *   // barre d'outils : {champs.bouton}
 *   // requête : listClients({ …, champs: champs.filtre })   (clé de rechargement : champs.cle)
 *   // colonne : si champs.colonnes.length, une colonne « Champs » avec <CelluleChamps …/>
 *
 * Les conditions filtrent CÔTÉ BASE (jointures PostgREST, ou ids passés à
 * la RPC des factures) : la pagination et le total restent justes. Les
 * colonnes choisies sont retenues par objet dans ce navigateur (confort
 * d'affichage, pas une donnée). Coupé par le drapeau : rien ne s'affiche.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useChampsPersoActifs } from '../../hooks/useChampsPersoActifs';
import { filtrerParChamps, lireFuseau, lireValeursLot, listerChamps } from '../../lib/champsPersoApi';
import { compilerFiltresListe, FILTRE_VIDE, type FiltreListe } from '../../lib/champs/filtresListe';
import { formaterValeur } from '../../lib/champs/valeurs';
import type { ChampPerso, ObjetChamp, ValeurEnregistree } from '../../lib/champs/types';
import type { Condition } from '../../lib/champs/filtres';
import EditeurConditions, { conditionComplete } from './EditeurConditions';
import { messageChamps } from '../../lib/champs/messages';

const MAX_COLONNES = 4;
const AUCUN_CHAMP: ChampPerso[] = [];
const AUCUNE_VALEUR: Record<string, Record<string, ValeurEnregistree>> = {};
const cleStockage = (objet: ObjetChamp) => `lume.champs.colonnes.${objet}`;

function lireColonnes(objet: ObjetChamp): string[] {
  try {
    const brut = JSON.parse(localStorage.getItem(cleStockage(objet)) || '[]');
    return Array.isArray(brut) ? brut.filter((x) => typeof x === 'string').slice(0, MAX_COLONNES) : [];
  } catch {
    return [];
  }
}

export function useChampsListe(objet: ObjetChamp, fr: boolean) {
  const { isEnabled } = useChampsPersoActifs();
  const { data } = useQuery({
    queryKey: ['champs-perso', objet],
    queryFn: () => listerChamps(objet),
    enabled: isEnabled,
    staleTime: 60_000,
  });
  const { data: fuseau = 'America/Toronto' } = useQuery({ queryKey: ['champs-perso', 'fuseau'], queryFn: lireFuseau, staleTime: 3_600_000, enabled: isEnabled });
  const champs = useMemo(() => (data?.fields ?? AUCUN_CHAMP).filter((c) => !c.archived_at), [data]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [colonnesIds, setColonnesIds] = useState<string[]>(() => lireColonnes(objet));

  const choisirColonnes = (ids: string[]) => {
    setColonnesIds(ids);
    try { localStorage.setItem(cleStockage(objet), JSON.stringify(ids)); } catch { /* navigation privée : on garde en mémoire */ }
  };

  const completes = useMemo(() => conditions.filter(conditionComplete), [conditions]);
  const cle = JSON.stringify(completes);
  const { filtre, erreur } = useMemo((): { filtre: FiltreListe; erreur: string | null } => {
    if (!isEnabled || completes.length === 0) return { filtre: FILTRE_VIDE, erreur: null };
    try {
      return { filtre: compilerFiltresListe(completes, champs, fuseau), erreur: null };
    } catch (err) {
      return { filtre: FILTRE_VIDE, erreur: messageChamps(err instanceof Error ? err.message : String(err), fr) };
    }
    // `cle` résume `completes` ; le fuseau et les champs changent rarement.
  }, [cle, champs, fuseau, isEnabled, fr]); // eslint-disable-line react-hooks/exhaustive-deps

  const colonnes = useMemo(() => colonnesIds.map((id) => champs.find((c) => c.id === id)).filter((c): c is ChampPerso => !!c), [colonnesIds, champs]);

  const bouton = !isEnabled || champs.length === 0 ? null : (
    <BoutonChampsListe
      champs={champs} conditions={conditions} onConditions={setConditions}
      colonnes={colonnesIds} onColonnes={choisirColonnes} erreur={erreur} fr={fr}
    />
  );

  return { actif: isEnabled && champs.length > 0, bouton, filtre, conditions: completes, cle, colonnes, fuseau };
}

/**
 * Pour une liste servie par une RPC (factures) : les ids qui satisfont les
 * conditions (moteur SQL). `null` = aucun filtre de champ.
 */
export function useIdsFiltresChamps(objet: ObjetChamp, conditions: Condition[]): { ids: string[] | null; pret: boolean } {
  const cle = JSON.stringify(conditions);
  const { data, isFetched } = useQuery({
    queryKey: ['champs-perso', 'ids-liste', objet, cle],
    queryFn: () => filtrerParChamps(objet, conditions),
    enabled: conditions.length > 0,
    staleTime: 15_000,
  });
  if (conditions.length === 0) return { ids: null, pret: true };
  return { ids: data ?? null, pret: isFetched };
}

/** Valeurs des fiches affichées (une page), pour la colonne. */
export function useValeursPage(objet: ObjetChamp, ids: string[], actif: boolean) {
  const cle = useMemo(() => [...ids].sort().join(','), [ids]);
  const { data = AUCUNE_VALEUR } = useQuery({
    queryKey: ['champs-perso', 'valeurs-page', objet, cle],
    queryFn: () => lireValeursLot(objet, ids),
    enabled: actif && ids.length > 0,
    staleTime: 30_000,
  });
  return data;
}

export function CelluleChamps({ champs, valeurs, fr, fuseau }: {
  champs: ChampPerso[]; valeurs: Record<string, ValeurEnregistree> | undefined; fr: boolean; fuseau?: string;
}) {
  const remplis = champs.filter((c) => {
    const v = valeurs?.[c.id]?.value;
    return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
  });
  if (remplis.length === 0) return <span className="text-[13px] text-text-tertiary">—</span>;
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {remplis.map((c) => {
        const v = valeurs![c.id]!.value;
        const option = c.field_type === 'dropdown_single' ? c.options.find((o) => o.id === v) : undefined;
        return (
          <span key={c.id} title={c.label}
            className="max-w-full truncate rounded-md px-1.5 py-0.5 text-[11px] text-text-secondary"
            style={{ backgroundColor: option?.color ? `${option.color}26` : 'var(--color-surface-tertiary, rgba(148,163,184,0.15))' }}>
            <span className="text-text-tertiary">{c.label} : </span>{formaterValeur(c, v, fr ? 'fr' : 'en', fuseau)}
          </span>
        );
      })}
    </div>
  );
}

function BoutonChampsListe({ champs, conditions, onConditions, colonnes, onColonnes, erreur, fr }: {
  champs: ChampPerso[]; conditions: Condition[]; onConditions: (c: Condition[]) => void;
  colonnes: string[]; onColonnes: (ids: string[]) => void; erreur: string | null; fr: boolean;
}) {
  const ids = useId();
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOuvert(false); };
    const echap = (e: KeyboardEvent) => { if (e.key === 'Escape') setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    document.addEventListener('keydown', echap);
    return () => { document.removeEventListener('mousedown', fermer); document.removeEventListener('keydown', echap); };
  }, [ouvert]);
  const actives = conditions.filter(conditionComplete).length;
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-haspopup="dialog" aria-expanded={ouvert} onClick={() => setOuvert((o) => !o)}
        className={cn('inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          actives ? 'border-primary/50 bg-primary/5 text-text-primary' : 'border-outline bg-surface-card text-text-secondary hover:text-text-primary')}>
        <SlidersHorizontal size={14} aria-hidden />
        {fr ? 'Champs' : 'Fields'}
        {actives > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white">{actives}</span>}
      </button>
      {ouvert && (
        <div role="dialog" aria-label={fr ? 'Champs personnalisés' : 'Custom fields'}
          className="absolute left-0 top-full z-50 mt-1 w-[min(560px,90vw)] space-y-4 rounded-lg border border-outline bg-surface-elevated p-3 shadow-dropdown">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">{fr ? 'Filtrer par champ' : 'Filter by field'}</p>
            <EditeurConditions champs={champs} conditions={conditions} onChange={onConditions} fr={fr} />
            {erreur && <p role="alert" className="mt-2 text-[12px] text-red-600">{erreur}</p>}
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
              {fr ? `Afficher dans la liste (${MAX_COLONNES} au plus)` : `Show in the list (up to ${MAX_COLONNES})`}
            </p>
            <ul className="grid grid-cols-2 gap-1">
              {champs.map((c) => (
                <li key={c.id}>
                  <label htmlFor={`${ids}-${c.id}`} className="flex items-center gap-2 text-[13px] text-text-primary">
                    <input id={`${ids}-${c.id}`} type="checkbox" className="h-4 w-4 accent-primary" checked={colonnes.includes(c.id)}
                      disabled={!colonnes.includes(c.id) && colonnes.length >= MAX_COLONNES}
                      onChange={(e) => onColonnes(e.target.checked ? [...colonnes, c.id] : colonnes.filter((x) => x !== c.id))} />
                    <span className="truncate">{c.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
