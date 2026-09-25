/**
 * Gestes de migration partagés entre la console admin et le bot :
 * l'import test et la demande d'approbation. Extraits tels quels des
 * routes migration-admin (mêmes gardes, mêmes transitions, même audit)
 * pour que le bot n'ait pas une deuxième façon de faire.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { canTransition } from './state-machine';
import { logMigrationAudit } from './audit';
import { prepareStaging } from './pipeline';
import { findDuplicatesForEntity } from './duplicates';
import { runDryRun, ENTITY_LABELS_FR } from './importer';
import type { MigrationRow, TargetEntity, DryRunReport, OnProgression } from './types';

/**
 * Publieur de progression d'un lot : écrit totals.progress sur le lot tant
 * qu'il est « running » (au plus une fois par `intervalleMs`, sauf changement
 * d'étape), sans jamais bloquer ni faire échouer l'import. La console relit
 * la fiche toutes les quelques secondes et affiche la carte « en cours ».
 */
export function creerPublieurProgression(admin: SupabaseClient, batchId: string, intervalleMs = 1500): OnProgression {
  let derniere = 0;
  let derniereEtape = '';
  return (p) => {
    const t = Date.now();
    if (p.etape === derniereEtape && t - derniere < intervalleMs) return;
    derniere = t;
    derniereEtape = p.etape;
    void Promise.resolve(
      admin
        .from('migration_import_batches')
        .update({ totals: { progress: { ...p, updated_at: new Date().toISOString() } } })
        .eq('id', batchId)
        .eq('status', 'running'),
    ).then(({ error }) => {
      if (error) console.error('[migration-execution] progression non publiée:', error.message);
    }).catch((err: unknown) => console.error('[migration-execution] progression non publiée:', err));
  };
}

export type ActeurMigration = { id: string | null; role: 'platform_admin' | 'assistant' | 'system' };

/**
 * Approbation au nom du client, par un admin plateforme (mode autonome : le
 * client n'a rien à faire). Même ligne `migration_approvals` que le portail,
 * mais `confirmed_text` reste null et le commentaire dit qui a approuvé :
 * l'audit ne prétend jamais que le client a tapé la phrase.
 * Réservé au rôle platform_admin ; le bot n'y touche pas (test statique).
 * Renvoie la raison du refus, ou null si l'approbation est enregistrée.
 */
export async function approuverAuNomDuClient(admin: SupabaseClient, migration: MigrationRow, acteur: { id: string; role: 'platform_admin' }, extras: { commentaire?: string | null; ip?: string | null; userAgent?: string | null } = {}): Promise<string | null> {
  if (migration.status !== 'waiting_for_approval') return "Aucune approbation n'est attendue pour le moment.";
  const { data: batch } = await admin
    .from('migration_import_batches').select('id, totals')
    .eq('migration_id', migration.id).eq('kind', 'test').eq('status', 'completed')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!batch) return "Aucun rapport d'import test à approuver.";
  const { data: prev } = await admin.from('migration_approvals').select('report_version').eq('migration_id', migration.id).order('report_version', { ascending: false }).limit(1).maybeSingle();
  const version = (prev?.report_version ?? 0) + 1;
  const commentaire = ["Approuvée par l'équipe Lume au nom du client (mode autonome du bot).", (extras.commentaire ?? '').trim()].filter(Boolean).join(' ').slice(0, 1000);
  const { error } = await admin.from('migration_approvals').insert({
    migration_id: migration.id, report_version: version, report: batch.totals ?? {}, decision: 'approved',
    confirmed_text: null, comment: commentaire, user_id: acteur.id,
    ip_address: extras.ip && /^[0-9a-fA-F:.]+$/.test(extras.ip) ? extras.ip : null,
    user_agent: (extras.userAgent ?? '').slice(0, 300) || null,
  });
  if (error) throw error;
  const { error: stErr } = await admin.from('data_migrations').update({ status: 'approved' }).eq('id', migration.id).eq('status', 'waiting_for_approval');
  if (stErr) throw stErr;
  migration.status = 'approved';
  await admin.from('migration_messages').insert({
    migration_id: migration.id, author_id: acteur.id, author_kind: 'admin',
    body: "L'équipe Lume a validé l'aperçu de votre migration en votre nom : vous n'avez rien à faire. L'import définitif suivra. Si quelque chose ne va pas, écrivez-nous ici.",
  });
  await logMigrationAudit(admin, { migrationId: migration.id, action: 'approval.on_behalf', actorId: acteur.id, actorRole: 'platform_admin', meta: { report_version: version, commentaire: (extras.commentaire ?? '').slice(0, 200) || null } });
  return null;
}

/**
 * Import test (dry-run, aucune écriture dans les tables actives) :
 * staging → doublons contre les données actives → rapport. Synchrone ici
 * (la route l'exécute en arrière-plan ; le bot attend le rapport).
 * Renvoie null si le statut ne permet pas l'import test.
 */
/** Tables d'existants visées par les candidats de doublons qui portent une suppression douce. */
const TABLES_AVEC_DELETED_AT = new Set(['clients', 'properties', 'jobs', 'quotes', 'invoices']);

/**
 * Candidats de doublons périmés — à purger avant chaque détection.
 *
 * Constaté le 2026-09-20 (Vision Lavage) : après le rollback de l'ancienne migration, le bot
 * annonçait encore « 214 doublons à trancher ». Les candidats ne sont jamais recalculés : la
 * détection n'ajoute que les paires inédites (`seen`), et une fiche existante passée en
 * suppression douce laisse son candidat `pending` intact — le compte, le dry-run (fusions) et
 * l'onglet Doublons restent figés sur des fiches disparues.
 *
 * - candidats NON tranchés (pending/review) : supprimés, la détection qui suit les recrée si la
 *   fiche existe toujours ;
 * - candidats tranchés (merge/skip/create_new) : conservés, sauf si la fiche visée n'existe plus
 *   (deleted_at) — la ligne redevient alors une création.
 *
 * prepareStaging vient de remettre les lignes `duplicate` à `ready`, donc les statuts restent
 * cohérents après la purge.
 */
async function purgerCandidatsDoublonsPerimes(admin: SupabaseClient, migrationId: string): Promise<{ recalcules: number; orphelins: number }> {
  const supprimer = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await admin.from('migration_duplicate_candidates').delete().in('id', ids.slice(i, i + 200)).eq('migration_id', migrationId);
      if (error) console.error('[migration-execution] duplicates purge failed:', error.message);
    }
  };

  const { data: nonTranches, error: e1 } = await admin
    .from('migration_duplicate_candidates')
    .select('id')
    .eq('migration_id', migrationId)
    .in('decision', ['pending', 'review'])
    .limit(20000);
  if (e1) console.error('[migration-execution] duplicates pending fetch failed:', e1.message);
  const recalcules = (nonTranches ?? []).map((c: any) => c.id as string);
  await supprimer(recalcules);

  const { data: tranches, error: e2 } = await admin
    .from('migration_duplicate_candidates')
    .select('id, existing_table, existing_id')
    .eq('migration_id', migrationId)
    .in('decision', ['merge', 'skip', 'create_new'])
    .limit(20000);
  if (e2) console.error('[migration-execution] duplicates decided fetch failed:', e2.message);
  const parTable = new Map<string, Array<{ id: string; existing_id: string }>>();
  for (const c of (tranches ?? []) as any[]) {
    if (!TABLES_AVEC_DELETED_AT.has(c.existing_table)) continue;
    const liste = parTable.get(c.existing_table) ?? [];
    liste.push({ id: c.id, existing_id: c.existing_id });
    parTable.set(c.existing_table, liste);
  }
  const orphelins: string[] = [];
  for (const [table, liste] of parTable) {
    const vivants = new Set<string>();
    const ids = Array.from(new Set(liste.map((c) => c.existing_id)));
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin.from(table).select('id').in('id', ids.slice(i, i + 200)).is('deleted_at', null);
      if (error) { console.error(`[migration-execution] duplicates ${table} check failed:`, error.message); ids.slice(i, i + 200).forEach((id) => vivants.add(id)); continue; }
      for (const r of data ?? []) vivants.add((r as any).id);
    }
    for (const c of liste) if (!vivants.has(c.existing_id)) orphelins.push(c.id);
  }
  await supprimer(orphelins);
  return { recalcules: recalcules.length, orphelins: orphelins.length };
}

export async function lancerImportTest(admin: SupabaseClient, migration: MigrationRow, acteur: ActeurMigration): Promise<{ batchId: string; report: DryRunReport } | null> {
  if (migration.status !== 'ready_for_test') {
    if (!canTransition(migration.status, 'ready_for_test')) return null;
    await admin.from('data_migrations').update({ status: 'ready_for_test' }).eq('id', migration.id).eq('status', migration.status);
    migration.status = 'ready_for_test';
  }
  await admin.from('data_migrations').update({ status: 'testing' }).eq('id', migration.id).eq('status', 'ready_for_test');
  migration.status = 'testing';
  const { data: batch, error: batchErr } = await admin
    .from('migration_import_batches')
    .insert({ migration_id: migration.id, kind: 'test', status: 'running', started_by: acteur.id ?? migration.created_by })
    .select()
    .single();
  if (batchErr) throw batchErr;
  await logMigrationAudit(admin, { migrationId: migration.id, action: 'import.test.start', actorId: acteur.id, actorRole: acteur.role, target: `batch:${batch.id}` });
  const publier = creerPublieurProgression(admin, batch.id);
  try {
    publier({ etape: 'Préparation des lignes (normalisation des fichiers)', entity: null, processed: 0, total: 0, entites_faites: 0, entites_total: 0 });
    await prepareStaging(admin, migration);
    publier({ etape: 'Purge des doublons périmés', entity: null, processed: 0, total: 0, entites_faites: 0, entites_total: 0 });
    const purge = await purgerCandidatsDoublonsPerimes(admin, migration.id);
    if (purge.recalcules || purge.orphelins) {
      await logMigrationAudit(admin, { migrationId: migration.id, action: 'import.test.duplicates_purge', actorRole: 'system', target: `batch:${batch.id}`, meta: purge });
    }
    // Même liste que main (fb3a0342) : les taxes importées sont dédoublonnées contre les taxes actives.
    const entities: TargetEntity[] = ['tax_config', 'client', 'property', 'billing_property', 'job', 'quote', 'invoice', 'payment'];
    for (const entity of entities) {
      const { data: records } = await admin
        .from('migration_staging_records')
        .select('id, normalized, relations')
        .eq('migration_id', migration.id)
        .eq('entity_type', entity)
        .in('status', ['ready', 'duplicate'])
        .limit(20000);
      publier({ etape: `Recherche de doublons — ${ENTITY_LABELS_FR[entity] ?? entity}`, entity, processed: 0, total: records?.length ?? 0, entites_faites: entities.indexOf(entity), entites_total: entities.length });
      if (!records || records.length === 0) continue;
      const matches = await findDuplicatesForEntity(admin, migration.org_id, entity, records as any);
      if (matches.length === 0) continue;
      const { data: existing } = await admin
        .from('migration_duplicate_candidates')
        .select('staging_record_id, existing_table, existing_id')
        .eq('migration_id', migration.id);
      const seen = new Set((existing ?? []).map((e: any) => `${e.staging_record_id}|${e.existing_table}|${e.existing_id}`));
      const fresh = matches.filter((m) => !seen.has(`${m.stagingRecordId}|${m.existingTable}|${m.existingId}`));
      if (fresh.length > 0) {
        const { error: dupErr } = await admin.from('migration_duplicate_candidates').insert(
          fresh.map((m) => ({
            migration_id: migration.id,
            staging_record_id: m.stagingRecordId,
            existing_table: m.existingTable,
            existing_id: m.existingId,
            match_reasons: m.matchReasons,
            score: m.score,
            decision: m.score >= 90 ? 'pending' : 'review',
          })),
        );
        if (dupErr) console.error('[migration-execution] duplicates insert failed:', dupErr.message);
        const dupIds = fresh.filter((m) => m.score >= 75).map((m) => m.stagingRecordId);
        for (let i = 0; i < dupIds.length; i += 200) {
          await admin
            .from('migration_staging_records')
            .update({ status: 'duplicate' })
            .in('id', dupIds.slice(i, i + 200))
            .eq('migration_id', migration.id);
        }
      }
    }
    const report = await runDryRun(admin, migration, publier);
    const { error: doneErr } = await admin
      .from('migration_import_batches')
      .update({ status: 'completed', totals: report as unknown as Record<string, unknown>, finished_at: new Date().toISOString() })
      .eq('id', batch.id);
    if (doneErr) console.error('[migration-execution] test batch update failed:', doneErr.message);
    await admin.from('data_migrations').update({ status: 'test_review' }).eq('id', migration.id).eq('status', 'testing');
    migration.status = 'test_review';
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'import.test.done', actorRole: 'system', target: `batch:${batch.id}`, meta: { totals: report.totals } });
    return { batchId: batch.id, report };
  } catch (err: any) {
    console.error('[migration-execution] test import failed:', err?.message || err);
    await admin.from('migration_import_batches').update({ status: 'failed', error: 'internal_error', finished_at: new Date().toISOString() }).eq('id', batch.id);
    await admin.from('data_migrations').update({ status: 'failed' }).eq('id', migration.id).eq('status', 'testing');
    migration.status = 'failed';
    throw err;
  }
}

/**
 * Demande d'approbation au client, avec les gardes anti-perte silencieuse
 * de la route (fichier tronqué, colonnes « À vérifier » non tranchées).
 * Renvoie la raison du refus, ou null si la demande est partie.
 */
export async function demanderApprobation(admin: SupabaseClient, migration: MigrationRow, acteur: ActeurMigration): Promise<string | null> {
  if (migration.status !== 'test_review') return "Un import test complété est requis avant de demander l'approbation.";
  const { data: batch } = await admin
    .from('migration_import_batches')
    .select('id, status')
    .eq('migration_id', migration.id)
    .eq('kind', 'test')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!batch) return 'Aucun import test complété.';
  const { data: truncated } = await admin
    .from('migration_files')
    .select('original_name')
    .eq('migration_id', migration.id)
    .eq('parse_error', 'truncated')
    .is('deleted_at', null)
    .limit(5);
  if ((truncated ?? []).length > 0) {
    return `Fichier(s) tronqué(s) (limite de lignes) : ${(truncated ?? []).map((f) => f.original_name).join(', ')} — scindez les exports puis ré-analysez.`;
  }
  const { count: pendingMappings } = await admin
    .from('migration_field_mappings')
    .select('id', { count: 'exact', head: true })
    .eq('migration_id', migration.id)
    .eq('status', 'needs_review');
  if ((pendingMappings ?? 0) > 0) {
    return `${pendingMappings} colonne(s) « À vérifier » non tranchée(s) — confirmez ou rejetez chaque correspondance avant de demander l'approbation.`;
  }
  const { error } = await admin
    .from('data_migrations')
    .update({ status: 'waiting_for_approval' })
    .eq('id', migration.id)
    .eq('status', 'test_review');
  if (error) throw error;
  migration.status = 'waiting_for_approval';
  await logMigrationAudit(admin, { migrationId: migration.id, action: 'approval.request', actorId: acteur.id, actorRole: acteur.role });
  return null;
}
