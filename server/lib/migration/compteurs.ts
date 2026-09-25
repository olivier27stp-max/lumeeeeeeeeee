// Compteurs de staging (lignes par entité et par statut) pour la fiche d'une
// migration — console interne et portail client.
//
// Avant : les deux routes rapatriaient TOUTES les lignes de staging
// (`select entity_type, status`) pour compter en Node. Deux défauts :
//  - PostgREST plafonne une lecture sans `range` à 1 000 lignes → dès qu'une
//    migration dépasse 1 000 lignes (Vision Lavage : ~2 500), les compteurs
//    affichés étaient faux, sans aucune erreur ;
//  - sous charge (plusieurs migrations, import test en cours), la fiche mettait
//    ~10 s à répondre (constaté le 2026-09-23).
//
// Ici : une fonction SQL `migration_staging_counts` fait le GROUP BY côté base
// (index (migration_id, entity_type, status) déjà en place → index-only scan).
// Tant que le SQL 20260926110000 n'est pas posé, le repli lit par pages de 1 000
// et reste exact — juste plus lent.

import type { SupabaseClient } from '@supabase/supabase-js';

/** entité → statut → nombre de lignes. */
export type CompteursStaging = Record<string, Record<string, number>>;

const PAGE = 1000;
/** 200 pages × 1 000 = 200 000 lignes : au-delà de 30 fichiers × 50 000 lignes, jamais atteint. */
const MAX_PAGES = 200;

let repliSignale = false;

/** La fonction SQL n'existe pas encore (migration non appliquée) : PostgREST
 *  répond PGRST202 (schéma) ou Postgres 42883 (fonction inconnue). */
export function fonctionSqlAbsente(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function|does not exist/i.test(error.message ?? '');
}

export async function compterStaging(admin: SupabaseClient, migrationId: string): Promise<CompteursStaging> {
  const { data, error } = await admin.rpc('migration_staging_counts', { p_migration_id: migrationId });
  if (!error && Array.isArray(data)) {
    const out: CompteursStaging = {};
    for (const r of data as { entity_type: string; status: string; n: number | string }[]) {
      (out[r.entity_type] ??= {})[r.status] = Number(r.n);
    }
    return out;
  }
  if (error) {
    if (fonctionSqlAbsente(error)) {
      if (!repliSignale) {
        repliSignale = true;
        console.warn('[migration-compteurs] migration_staging_counts absente — appliquez le SQL 20260926110000 (repli paginé actif).');
      }
    } else {
      console.error('[migration-compteurs] rpc failed, repli paginé:', error.message);
    }
  }
  return compterParPages(admin, migrationId);
}

/** Repli exact : lecture paginée de (entity_type, status) seulement. */
export async function compterParPages(admin: SupabaseClient, migrationId: string): Promise<CompteursStaging> {
  const out: CompteursStaging = {};
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const offset = page * PAGE;
    const { data, error } = await admin
      .from('migration_staging_records')
      .select('entity_type, status')
      .eq('migration_id', migrationId)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error('[migration-compteurs] staging fetch failed:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data as { entity_type: string; status: string }[]) {
      (out[r.entity_type] ??= {})[r.status] = ((out[r.entity_type] ?? {})[r.status] ?? 0) + 1;
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/** entité → total toutes lignes (forme attendue par `detected_counts` du portail). */
export function totauxParEntite(c: CompteursStaging): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [entity, statuts] of Object.entries(c)) {
    out[entity] = Object.values(statuts).reduce((s, n) => s + n, 0);
  }
  return out;
}

/** Réinitialise l'avertissement « fonction absente » (tests). */
export function reinitialiserCompteurs(): void {
  repliSignale = false;
}
