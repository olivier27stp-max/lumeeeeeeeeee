/**
 * Colonnes des listes (« Gérer les champs ») : réglage PAR UTILISATEUR et PAR
 * OBJET, gardé en base (table_view_preferences, RLS : chacun les siennes) pour
 * suivre la personne d'un appareil à l'autre. Et le tri par un champ
 * personnalisé (RPC cf_ordre_ids).
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import type { ObjetChamp } from './champs/types';

/** Identifiant de colonne : standard (« adresse ») ou champ (« cf:<uuid> »). */
export type IdColonne = string;
export const prefixeChamp = 'cf:';
export const idColonneChamp = (champId: string): IdColonne => `${prefixeChamp}${champId}`;
export const champDeColonne = (id: IdColonne): string | null => (id.startsWith(prefixeChamp) ? id.slice(prefixeChamp.length) : null);

/** `null` = jamais réglé (la liste prend ses colonnes par défaut). */
export async function lireColonnesTableau(objet: ObjetChamp): Promise<IdColonne[] | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase.from('table_view_preferences')
    .select('columns').eq('org_id', orgId).eq('user_id', userId).eq('object_type', objet).maybeSingle();
  if (error) throw error;
  const brut = (data as { columns?: unknown } | null)?.columns;
  return Array.isArray(brut) ? brut.filter((x): x is string => typeof x === 'string') : null;
}

export async function enregistrerColonnesTableau(objet: ObjetChamp, colonnes: IdColonne[]): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error('Session expirée.');
  const { error } = await supabase.from('table_view_preferences').upsert(
    { org_id: orgId, user_id: userId, object_type: objet, columns: colonnes.slice(0, 80) },
    { onConflict: 'org_id,user_id,object_type' },
  );
  if (error) throw error;
}

/** Fiches QUI ONT une valeur pour ce champ, dans l'ordre de la valeur. */
export async function idsTriesParChamp(champId: string, asc: boolean): Promise<string[]> {
  const { data, error } = await supabase.rpc('cf_ordre_ids', { p_field: champId, p_asc: asc });
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((x) => (typeof x === 'string' ? x : String(Object.values(x as object)[0])));
}

/**
 * Une page d'une liste triée par un champ. PostgREST ne sait pas ordonner une
 * table par une valeur liée : on prend les ids filtrés de la liste (ses propres
 * filtres, ordre par défaut), on met d'abord ceux qui ont une valeur dans
 * l'ordre du champ, puis les autres, et on charge la tranche demandée.
 * La séquence est gardée 30 s pour que le défilement reste stable.
 */
const sequences = new Map<string, { a: number; ids: string[] }>();
export async function pageTrieeParChamp<T extends { id: string }>(opts: {
  cle: string; champId: string; asc: boolean; from: number; to: number;
  idsFiltres: () => Promise<string[]>;
  lignes: (ids: string[]) => Promise<T[]>;
}): Promise<{ items: T[]; total: number }> {
  const cle = `${opts.cle}|${opts.champId}|${opts.asc}`;
  let seq = sequences.get(cle);
  if (!seq || Date.now() - seq.a > 30_000 || opts.from === 0) {
    const [filtres, tries] = await Promise.all([opts.idsFiltres(), idsTriesParChamp(opts.champId, opts.asc)]);
    const retenus = new Set(filtres);
    const avec = tries.filter((id) => retenus.has(id));
    const deja = new Set(avec);
    seq = { a: Date.now(), ids: [...avec, ...filtres.filter((id) => !deja.has(id))] };
    sequences.set(cle, seq);
    if (sequences.size > 20) sequences.delete(sequences.keys().next().value as string);
  }
  const tranche = seq.ids.slice(opts.from, opts.to + 1);
  if (tranche.length === 0) return { items: [], total: seq.ids.length };
  const rang = new Map(tranche.map((id, i) => [id, i]));
  const items = (await opts.lignes(tranche)).sort((x, y) => (rang.get(x.id) ?? 0) - (rang.get(y.id) ?? 0));
  return { items, total: seq.ids.length };
}

/** Tous les ids d'une requête filtrée (par paquets de 1000, 5000 au plus). */
export async function tousLesIds(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; from < 5000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    const lot = (data ?? []) as Array<{ id: string }>;
    ids.push(...lot.map((r) => r.id));
    if (lot.length < 1000) break;
  }
  return ids;
}
