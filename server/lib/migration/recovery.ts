// Détection et récupération des migrations zombies (audit S7) : l'import
// tourne en tâche de fond dans le process Express — un redéploiement Railway
// au lot 47/300 laissait la migration bloquée en « importing » pour toujours
// (la machine à états n'offre aucune sortie sans batch terminé).
//
// Signal de vie : migration_import_batches.updated_at, rafraîchi par le
// heartbeat de runFinalImport à chaque lot de 200 lignes (trigger
// set_updated_at). Un batch « running » silencieux au-delà du seuil est
// déclaré interrompu ; la migration passe à « failed », d'où l'admin peut
// relancer (failed → ready_for_final_import) — l'import est idempotent, la
// reprise ne duplique rien (migration_import_records + ids déterministes).

import type { SupabaseClient } from '@supabase/supabase-js';
import { logMigrationAudit } from './audit';

/** Import final : heartbeat par lot → 15 min de silence = mort. */
export const FINAL_ZOMBIE_AFTER_MS = 15 * 60 * 1000;
/** Import test (dry-run, pas de heartbeat fin) : 30 min depuis le départ. */
export const TEST_ZOMBIE_AFTER_MS = 30 * 60 * 1000;

export interface ZombieCandidate {
  kind: string;
  started_at: string;
  updated_at: string | null;
}

/** Pur (testable) : un batch « running » est-il un zombie à l'instant nowMs ? */
export function isZombieBatch(batch: ZombieCandidate, nowMs: number): boolean {
  const started = Date.parse(batch.started_at);
  const updated = batch.updated_at ? Date.parse(batch.updated_at) : NaN;
  const lastSign = Math.max(
    Number.isFinite(started) ? started : 0,
    Number.isFinite(updated) ? updated : 0,
  );
  if (lastSign === 0) return true; // dates illisibles : ne jamais bloquer pour l'éternité
  const threshold = batch.kind === 'final' ? FINAL_ZOMBIE_AFTER_MS : TEST_ZOMBIE_AFTER_MS;
  return nowMs - lastSign > threshold;
}

export interface RecoverySummary {
  batchesFailed: number;
  migrationsFailed: number;
}

/**
 * Balaye les lots « running » morts et les migrations coincées en
 * importing/testing sans lot vivant. Idempotent, sûre à répéter.
 */
export async function recoverZombieMigrations(admin: SupabaseClient): Promise<RecoverySummary> {
  const summary: RecoverySummary = { batchesFailed: 0, migrationsFailed: 0 };
  const now = Date.now();

  const { data: running, error } = await admin
    .from('migration_import_batches')
    .select('id, migration_id, kind, started_at, updated_at')
    .eq('status', 'running')
    .limit(100);
  if (error) {
    console.error('[migration-recovery] batches fetch failed:', error.message);
    return summary;
  }

  for (const batch of (running ?? []) as ({ id: string; migration_id: string } & ZombieCandidate)[]) {
    if (!isZombieBatch(batch, now)) continue;
    const { error: failErr } = await admin
      .from('migration_import_batches')
      .update({ status: 'failed', error: 'interrupted_zombie', finished_at: new Date().toISOString() })
      .eq('id', batch.id)
      .eq('status', 'running'); // garde optimiste : un batch qui vient de finir n'est pas touché
    if (failErr) {
      console.error('[migration-recovery] batch fail mark failed:', failErr.message);
      continue;
    }
    summary.batchesFailed += 1;

    const { data: mig, error: migErr } = await admin
      .from('data_migrations')
      .update({ status: 'failed' })
      .eq('id', batch.migration_id)
      .in('status', ['importing', 'testing', 'post_import_validation'])
      .select('id');
    if (migErr) console.error('[migration-recovery] migration fail mark failed:', migErr.message);
    else if ((mig ?? []).length > 0) summary.migrationsFailed += 1;

    await logMigrationAudit(admin, {
      migrationId: batch.migration_id,
      action: 'import.zombie_recovered',
      actorRole: 'system',
      target: `batch:${batch.id}`,
      meta: { kind: batch.kind, silent_since: batch.updated_at ?? batch.started_at },
    });
  }

  // Migrations coincées en importing/testing SANS lot running (le process est
  // mort avant même de créer/mettre à jour le lot) : mêmes seuils, sur
  // last_activity_at/updated_at de la migration.
  const cutoff = new Date(now - TEST_ZOMBIE_AFTER_MS).toISOString();
  const { data: stuck, error: stuckErr } = await admin
    .from('data_migrations')
    .select('id, status, updated_at')
    .in('status', ['importing', 'testing'])
    .lt('updated_at', cutoff)
    .limit(100);
  if (stuckErr) {
    console.error('[migration-recovery] stuck fetch failed:', stuckErr.message);
    return summary;
  }
  for (const m of (stuck ?? []) as { id: string; status: string }[]) {
    const { count: alive } = await admin
      .from('migration_import_batches')
      .select('id', { count: 'exact', head: true })
      .eq('migration_id', m.id)
      .eq('status', 'running');
    if ((alive ?? 0) > 0) continue; // son lot vivant sera jugé par la passe ci-dessus
    const { error: failErr } = await admin
      .from('data_migrations')
      .update({ status: 'failed' })
      .eq('id', m.id)
      .eq('status', m.status);
    if (failErr) {
      console.error('[migration-recovery] stuck fail mark failed:', failErr.message);
      continue;
    }
    summary.migrationsFailed += 1;
    await logMigrationAudit(admin, {
      migrationId: m.id,
      action: 'import.zombie_recovered',
      actorRole: 'system',
      meta: { from_status: m.status, batchless: true },
    });
  }

  return summary;
}
