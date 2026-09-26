/**
 * Champs personnalisés dans les LISTES (clients, jobs, devis, factures) :
 * le FILTRE (« Filtrer par champ »). Les colonnes, elles, passent par
 * « Gérer les champs » (colonnes.tsx).
 *
 *   const champs = useChampsListe('client', fr);
 *   // barre d'outils : {champs.bouton}
 *   // requête : listClients({ …, champs: champs.filtre })   (clé de rechargement : champs.cle)
 *
 * Les conditions filtrent CÔTÉ BASE (jointures PostgREST, ou ids passés à
 * la RPC des factures) : la pagination et le total restent justes.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useChampsPersoActifs } from '../../hooks/useChampsPersoActifs';
import { filtrerParChamps, lireFuseau, lireValeursLot, listerChamps } from '../../lib/champsPersoApi';
import { compilerFiltresListe, FILTRE_VIDE, type FiltreListe } from '../../lib/champs/filtresListe';
import type { ChampPerso, ObjetChamp, ValeurEnregistree } from '../../lib/champs/types';
import type { Condition } from '../../lib/champs/filtres';
import EditeurConditions, { conditionComplete } from './EditeurConditions';
import { messageChamps } from '../../lib/champs/messages';

const AUCUN_CHAMP: ChampPerso[] = [];
const AUCUNE_VALEUR: Record<string, Record<string, ValeurEnregistree>> = {};

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

  const bouton = !isEnabled || champs.length === 0 ? null : (
    <BoutonFiltreChamps champs={champs} conditions={conditions} onConditions={setConditions} erreur={erreur} fr={fr} />
  );

  return { actif: isEnabled && champs.length > 0, bouton, filtre, conditions: completes, cle, fuseau };
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

function BoutonFiltreChamps({ champs, conditions, onConditions, erreur, fr }: {
  champs: ChampPerso[]; conditions: Condition[]; onConditions: (c: Condition[]) => void; erreur: string | null; fr: boolean;
}) {
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
        className={cn('inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          actives ? 'border-primary/50 bg-primary/5 text-text-primary' : 'border-outline bg-surface-card text-text-secondary hover:text-text-primary')}>
        <SlidersHorizontal size={14} aria-hidden />
        {fr ? 'Filtrer par champ' : 'Filter by field'}
        {actives > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-white">{actives}</span>}
      </button>
      {ouvert && (
        <div role="dialog" aria-label={fr ? 'Filtrer par champ personnalisé' : 'Filter by custom field'}
          className="absolute left-0 top-full z-50 mt-1 w-[min(420px,90vw)] rounded-lg border border-outline bg-surface-elevated p-3 shadow-dropdown">
          <EditeurConditions champs={champs} conditions={conditions} onChange={onConditions} fr={fr} />
          {erreur && <p role="alert" className="mt-2 text-[12px] text-red-600">{erreur}</p>}
        </div>
      )}
    </div>
  );
}
