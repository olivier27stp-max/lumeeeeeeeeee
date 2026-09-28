/**
 * Colonnes = formulaire (Rafba, 2026-09-28) : les champs du formulaire de base qui
 * ne sont pas sur la ligne de la liste (produits et services, contrat), lus en UNE
 * requête pour la page affichée.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

const regrouper = (lignes: Array<Record<string, unknown>>, cle: string, valeur: string) => {
  const res: Record<string, string[]> = {};
  for (const l of lignes) {
    const id = String(l[cle] ?? ''); const v = String(l[valeur] ?? '').trim();
    if (id && v) (res[id] ??= []).push(v);
  }
  return res;
};

/** Noms des produits et services de chaque job de la page. */
export async function produitsDesJobs(ids: string[]): Promise<Record<string, string[]>> {
  if (!ids.length) return {};
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.from('job_line_items').select('job_id, name')
    .eq('org_id', orgId).in('job_id', ids).is('deleted_at', null).order('created_at');
  if (error) throw error;
  return regrouper(data ?? [], 'job_id', 'name');
}

/** Statut du contrat de chaque job de la page (le plus récent). */
export async function contratsDesJobs(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.from('job_agreements').select('job_id, status')
    .eq('org_id', orgId).in('job_id', ids).is('deleted_at', null).order('created_at', { ascending: false });
  if (error) throw error;
  const res: Record<string, string> = {};
  for (const l of data ?? []) if (l.job_id && !res[l.job_id]) res[l.job_id] = l.status;
  return res;
}

/** Noms des produits et services de chaque devis de la page. */
export async function produitsDesDevis(ids: string[]): Promise<Record<string, string[]>> {
  if (!ids.length) return {};
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.from('quote_line_items').select('quote_id, name')
    .eq('org_id', orgId).in('quote_id', ids).order('sort_order');
  if (error) throw error;
  return regrouper(data ?? [], 'quote_id', 'name');
}

/** Notes du formulaire (notes spécifiques) de chaque élément de la page, la plus récente d'abord. */
export async function notesDesElements(type: 'job' | 'quote', ids: string[]): Promise<Record<string, string[]>> {
  if (!ids.length) return {};
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.from('specific_notes').select('entity_id, text')
    .eq('org_id', orgId).eq('entity_type', type).in('entity_id', ids).order('created_at', { ascending: false });
  if (error) throw error;
  return regrouper(data ?? [], 'entity_id', 'text');
}
