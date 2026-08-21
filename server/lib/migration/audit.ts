// Journal d'audit des migrations. Toujours lire { error } (supabase-js ne throw
// jamais) ; l'échec d'audit ne doit jamais faire échouer l'opération métier.
// Interdit dans meta : jetons (même hachés), PII complète, contenu de fichier.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface MigrationAuditEntry {
  migrationId: string;
  action: string; // ex. 'migration.create', 'invitation.generate', 'file.upload', 'import.final.start'
  actorId?: string | null;
  actorRole?: 'platform_admin' | 'client' | 'assistant' | 'system';
  target?: string | null; // ex. 'file:<uuid>', 'mapping:<uuid>'
  meta?: Record<string, unknown>;
}

export async function logMigrationAudit(admin: SupabaseClient, entry: MigrationAuditEntry): Promise<void> {
  try {
    const { error } = await admin.from('migration_audit_logs').insert({
      migration_id: entry.migrationId,
      action: entry.action,
      actor_id: entry.actorId ?? null,
      actor_role: entry.actorRole ?? 'system',
      target: entry.target ?? null,
      meta: entry.meta ?? {},
    });
    if (error) console.error('[migration-audit] insert failed:', error.message);
  } catch (err) {
    console.error('[migration-audit] unexpected failure:', err);
  }
}

/** Rafraîchit last_activity_at sans toucher au reste (fire-and-forget). */
export async function touchMigrationActivity(admin: SupabaseClient, migrationId: string): Promise<void> {
  const { error } = await admin
    .from('data_migrations')
    .update({ last_activity_at: new Date().toISOString() })
    .eq('id', migrationId);
  if (error) console.error('[migration-audit] touch activity failed:', error.message);
}
