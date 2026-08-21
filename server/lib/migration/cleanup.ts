// Nettoyage automatisé des artefacts de migration : fichiers sources supprimés
// 30 jours après la fermeture, staging purgé, jetons expirés anonymisés.
// Ne touche JAMAIS aux entités actives importées ni aux journaux d'audit.

import type { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { logMigrationAudit } from './audit';
import { MIGRATION_BUCKET } from './pipeline';

const FILE_RETENTION_DAYS = 30;
const INVITATION_RETENTION_DAYS = 90;

export interface CleanupSummary {
  migrationsProcessed: number;
  filesDeleted: number;
  stagingPurged: number;
  invitationsAnonymized: number;
}

export async function runMigrationCleanup(admin: SupabaseClient): Promise<CleanupSummary> {
  const summary: CleanupSummary = { migrationsProcessed: 0, filesDeleted: 0, stagingPurged: 0, invitationsAnonymized: 0 };
  const cutoff = new Date(Date.now() - FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Migrations terminées/annulées depuis plus de 30 jours
  const { data: migrations, error: migErr } = await admin
    .from('data_migrations')
    .select('id, status, completed_at, closed_at, updated_at')
    .in('status', ['completed', 'completed_with_warnings', 'rolled_back', 'cancelled', 'failed'])
    .limit(200);
  if (migErr) {
    console.error('[migration-cleanup] migrations fetch failed:', migErr.message);
    return summary;
  }

  for (const mig of migrations ?? []) {
    const doneAt = mig.closed_at ?? mig.completed_at ?? mig.updated_at;
    if (!doneAt || doneAt > cutoff) continue;
    summary.migrationsProcessed += 1;

    // fichiers sources → storage + soft-delete de la rangée
    const { data: files, error: fErr } = await admin
      .from('migration_files')
      .select('id, storage_path')
      .eq('migration_id', mig.id)
      .is('deleted_at', null);
    if (fErr) {
      console.error('[migration-cleanup] files fetch failed:', fErr.message);
      continue;
    }
    for (const file of files ?? []) {
      const { error: rmErr } = await admin.storage.from(MIGRATION_BUCKET).remove([file.storage_path]);
      if (rmErr && !/not.*found/i.test(rmErr.message)) {
        console.error('[migration-cleanup] storage remove failed:', rmErr.message);
        continue;
      }
      const { error: delErr } = await admin
        .from('migration_files')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', file.id);
      if (delErr) console.error('[migration-cleanup] file soft-delete failed:', delErr.message);
      else summary.filesDeleted += 1;
    }

    // staging purgé (les données importées vivent dans les tables actives)
    const { error: stErr, count } = await admin
      .from('migration_staging_records')
      .delete({ count: 'exact' })
      .eq('migration_id', mig.id);
    if (stErr) console.error('[migration-cleanup] staging purge failed:', stErr.message);
    else summary.stagingPurged += count ?? 0;

    if (summary.filesDeleted > 0 || (count ?? 0) > 0) {
      await logMigrationAudit(admin, {
        migrationId: mig.id,
        action: 'cleanup.run',
        actorRole: 'system',
        meta: { filesDeleted: summary.filesDeleted, stagingPurged: count ?? 0 },
      });
    }
  }

  // Jetons expirés depuis longtemps : anonymiser le hash (la rangée reste pour l'audit)
  const invCutoff = new Date(Date.now() - INVITATION_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: staleInvs, error: invErr } = await admin
    .from('migration_invitations')
    .select('id, token_hash')
    .lt('expires_at', invCutoff)
    .not('token_hash', 'like', 'purged:%')
    .limit(500);
  if (invErr) {
    console.error('[migration-cleanup] invitations fetch failed:', invErr.message);
    return summary;
  }
  for (const inv of staleInvs ?? []) {
    const { error } = await admin
      .from('migration_invitations')
      .update({ token_hash: `purged:${crypto.randomUUID()}` })
      .eq('id', inv.id);
    if (error) console.error('[migration-cleanup] invitation anonymize failed:', error.message);
    else summary.invitationsAnonymized += 1;
  }

  return summary;
}
