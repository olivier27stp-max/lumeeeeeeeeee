// Droit à l'effacement (Loi 25) × migration assistée (audit S10) : anonymiser
// un client importé doit aussi purger ses traces côté migration pendant la
// fenêtre de rétention (30 j) — la ligne de staging garde le payload source
// complet (nom, courriel, téléphone) et previous_values peut contenir les
// valeurs comblées lors d'une fusion. Sans ce lien, l'effacement CRM laissait
// une copie intégrale de la personne dans les tables de migration.
//
// Le FICHIER source (CSV au bucket) ne peut pas être édité ligne à ligne : sa
// purge est assurée par la rétention 30 j (cleanup.ts) — documenté dans
// docs/compliance/migration-donnees.md.

import type { SupabaseClient } from '@supabase/supabase-js';
import { logMigrationAudit } from './audit';

export interface ErasureSummary {
  stagingDeleted: number;
  previousValuesScrubbed: number;
}

/**
 * Purge les traces de migration d'une entité effacée/anonymisée : lignes de
 * staging source (payload PII) et previous_values du registre d'import.
 * Ne touche jamais au registre lui-même (idempotence/rollback = ids seulement).
 * Sans effet (0/0) si l'entité ne vient pas d'une migration.
 */
export async function purgeMigrationTracesForEntity(
  admin: SupabaseClient,
  entityTable: string,
  entityId: string,
): Promise<ErasureSummary> {
  const summary: ErasureSummary = { stagingDeleted: 0, previousValuesScrubbed: 0 };

  const { data: records, error } = await admin
    .from('migration_import_records')
    .select('id, migration_id, staging_record_id, previous_values')
    .eq('entity_table', entityTable)
    .eq('entity_id', entityId)
    .limit(50);
  if (error) {
    console.error('[migration-erasure] records fetch failed:', error.message);
    return summary;
  }
  if (!records || records.length === 0) return summary;

  const stagingIds = records.map((r: { staging_record_id: string }) => r.staging_record_id);
  const { data: deleted, error: delErr } = await admin
    .from('migration_staging_records')
    .delete()
    .in('id', stagingIds)
    .select('id');
  if (delErr) console.error('[migration-erasure] staging delete failed:', delErr.message);
  else summary.stagingDeleted = (deleted ?? []).length;

  const withPrev = records.filter((r: { previous_values: unknown }) => r.previous_values != null);
  for (const r of withPrev as { id: string }[]) {
    const { error: scrubErr } = await admin
      .from('migration_import_records')
      .update({ previous_values: null })
      .eq('id', r.id);
    if (scrubErr) {
      if (!/previous_values/i.test(scrubErr.message)) {
        console.error('[migration-erasure] previous_values scrub failed:', scrubErr.message);
      }
    } else summary.previousValuesScrubbed += 1;
  }

  const migrationIds = Array.from(new Set(records.map((r: { migration_id: string }) => r.migration_id)));
  for (const migrationId of migrationIds) {
    await logMigrationAudit(admin, {
      migrationId,
      action: 'erasure.traces_purged',
      actorRole: 'system',
      target: `${entityTable}:${entityId}`,
      meta: { staging_deleted: summary.stagingDeleted, previous_values_scrubbed: summary.previousValuesScrubbed },
    });
  }
  return summary;
}
