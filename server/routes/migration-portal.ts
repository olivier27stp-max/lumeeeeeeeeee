// Portail temporaire de migration — côté client du workspace.
// Chaque requête revalide TOUTE la chaîne : jeton (haché, non expiré, non
// révoqué, non remplacé) + session Lume authentifiée + appartenance au bon
// workspace + rôle owner/admin + correspondance avec l'invité prévu. Le jeton
// seul ne suffit jamais ; il voyage dans le header `x-migration-invite` et
// n'est jamais journalisé. Réponses négatives : messages génériques + délai
// aléatoire (pas de fuite d'existence), codes machine pour l'UI.

import { Router } from 'express';
import express from 'express';
import crypto from 'crypto';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { buildSupabaseWithAuth, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { extractIP } from '../lib/security';
import {
  validate,
  migrationPortalApprovalSchema,
  migrationPortalMappingSchema,
  migrationPortalAnswerSchema,
  migrationMessageSchema,
} from '../lib/validation';
import { hashToken, isValidTokenFormat, randomSleep, checkInvitationUsable } from '../lib/migration/tokens';
import { logMigrationAudit, touchMigrationActivity } from '../lib/migration/audit';
import { analyzeMigrationFile, MIGRATION_BUCKET } from '../lib/migration/pipeline';
import { getCrmConfig } from '../lib/migration/instructions';
import { FIELD_CATALOG } from '../lib/migration/mapping';
import {
  CLIENT_MAPPING_EDIT_STATUSES,
  IMPORTABLE_CATEGORIES,
  MAX_FILES_PER_MIGRATION,
  MAX_FILE_SIZE_BYTES,
  MAX_INVITE_FAILED_ATTEMPTS,
  UPLOAD_ALLOWED_STATUSES,
  type MigrationRow,
  type TargetEntity,
} from '../lib/migration/types';
import { looksBinary, sniffIsPdf } from '../lib/migration/analyzer';
import { buildRejectsCsv } from '../lib/migration/rejects';
import { maskNormalizedRecord } from '../lib/migration/masks';
import { IMPORT_ORDER } from '../lib/migration/importer';

const router = Router();

// Phrases de confirmation EXACTES exigées pour approuver l'import final.
export const APPROVAL_SENTENCE_FR =
  "J'ai vérifié l'aperçu de la migration et j'autorise Lume à effectuer l'importation finale dans mon workspace.";
export const APPROVAL_SENTENCE_EN =
  'I have reviewed the migration preview and authorize Lume to perform the final import into my workspace.';

interface PortalContext {
  admin: SupabaseClient;
  migration: MigrationRow;
  invitation: { id: string; expires_at: string; revoked_at: string | null; superseded_at: string | null; opened_at: string | null; failed_attempts: number };
  user: User;
  role: string;
  readOnly: boolean;
}

function deny(res: express.Response, status: number, code: string): null {
  // Messages volontairement génériques — les détails vivent côté UI par code.
  res.status(status).json({ error: 'Accès au portail de migration refusé.', code });
  return null;
}

async function requirePortalAccess(req: express.Request, res: express.Response): Promise<PortalContext | null> {
  const token = req.header('x-migration-invite') ?? '';
  if (!isValidTokenFormat(token)) {
    await randomSleep();
    return deny(res, 404, 'invalid');
  }
  const admin = getServiceClient();
  const { data: invitation, error: invErr } = await admin
    .from('migration_invitations')
    .select('id, migration_id, token_hash, expires_at, revoked_at, superseded_at, opened_at, failed_attempts')
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (invErr) {
    console.error('[migration-portal] invitation lookup failed:', invErr.message);
    return deny(res, 500, 'error');
  }
  if (!invitation) {
    await randomSleep();
    return deny(res, 404, 'invalid');
  }
  const usable = checkInvitationUsable(invitation, MAX_INVITE_FAILED_ATTEMPTS);
  if (!usable.ok) {
    await randomSleep();
    return deny(res, 410, usable.reason ?? 'invalid');
  }

  const { data: migration, error: migErr } = await admin
    .from('data_migrations')
    .select('*')
    .eq('id', invitation.migration_id)
    .is('deleted_at', null)
    .single<MigrationRow>();
  if (migErr || !migration) {
    await randomSleep();
    return deny(res, 404, 'invalid');
  }
  if (migration.status === 'cancelled' || migration.closed_at) {
    await randomSleep();
    return deny(res, 410, 'closed');
  }

  // Authentification Lume obligatoire — le jeton seul ne donne JAMAIS accès.
  const authHeader = req.header('authorization');
  if (!authHeader) return deny(res, 401, 'auth_required');
  let user: User | null = null;
  try {
    const userClient = buildSupabaseWithAuth(authHeader);
    const { data } = await userClient.auth.getUser();
    user = data?.user ?? null;
  } catch {
    user = null;
  }
  if (!user) return deny(res, 401, 'auth_required');

  const bumpAttempts = async () => {
    const { error } = await admin
      .from('migration_invitations')
      .update({ failed_attempts: invitation.failed_attempts + 1 })
      .eq('id', invitation.id);
    if (error) console.error('[migration-portal] attempts bump failed:', error.message);
  };

  // Appartenance au BON workspace (celui de la migration — pas le header x-org-id).
  const { data: membership, error: memErr } = await admin
    .from('memberships')
    .select('role, status')
    .eq('user_id', user.id)
    .eq('org_id', migration.org_id)
    .maybeSingle();
  if (memErr) {
    console.error('[migration-portal] membership lookup failed:', memErr.message);
    return deny(res, 500, 'error');
  }
  const active = membership && (membership.status === 'active' || membership.status === null);
  if (!active) {
    await bumpAttempts();
    await randomSleep();
    return deny(res, 403, 'forbidden');
  }
  const role = String(membership.role ?? '').toLowerCase() === 'manager' ? 'admin' : String(membership.role ?? '').toLowerCase();
  if (role !== 'owner' && role !== 'admin') {
    await bumpAttempts();
    await randomSleep();
    return deny(res, 403, 'role');
  }

  // Correspondance avec l'invité prévu (compte précis ou courriel).
  if (migration.invited_user_id && migration.invited_user_id !== user.id) {
    await bumpAttempts();
    await randomSleep();
    return deny(res, 403, 'wrong_account');
  }
  if (!migration.invited_user_id && migration.invited_email) {
    const email = (user.email ?? '').trim().toLowerCase();
    if (email !== migration.invited_email.trim().toLowerCase()) {
      await bumpAttempts();
      await randomSleep();
      return deny(res, 403, 'wrong_account');
    }
  }

  // Première ouverture : trace + transition invitation_sent → waiting_for_files.
  if (!invitation.opened_at) {
    const { error } = await admin
      .from('migration_invitations')
      .update({ opened_at: new Date().toISOString() })
      .eq('id', invitation.id)
      .is('opened_at', null);
    if (error) console.error('[migration-portal] opened_at update failed:', error.message);
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'invitation.opened', actorId: user.id, actorRole: 'client' });
  }
  if (migration.status === 'invitation_sent') {
    const { error } = await admin
      .from('data_migrations')
      .update({ status: 'waiting_for_files' })
      .eq('id', migration.id)
      .eq('status', 'invitation_sent');
    if (error) console.error('[migration-portal] first-open transition failed:', error.message);
    else migration.status = 'waiting_for_files';
  }

  const readOnly = ['approved', 'ready_for_final_import', 'importing', 'post_import_validation', 'completed', 'completed_with_warnings', 'failed', 'rolled_back'].includes(migration.status);
  return { admin, migration, invitation, user, role, readOnly };
}

// ── Vue d'ensemble (résout aussi le lien) ───────────────────────────────
router.get('/migration-portal/session', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration } = ctx;

    const [org, files, staged, issues, approval] = await Promise.all([
      admin.from('orgs').select('name').eq('id', migration.org_id).single(),
      admin
        .from('migration_files')
        .select('id, original_name, mime_type, size_bytes, kind, category_detected, row_count, column_count, security_status, parse_status, parse_error, created_at')
        .eq('migration_id', migration.id)
        .is('deleted_at', null)
        .order('created_at'),
      admin.from('migration_staging_records').select('entity_type').eq('migration_id', migration.id),
      admin
        .from('migration_issues')
        .select('id', { count: 'exact', head: true })
        .eq('migration_id', migration.id)
        .eq('client_visible', true)
        .is('resolved_at', null)
        .is('client_answer', null),
      admin.from('migration_approvals').select('decision, report_version, created_at').eq('migration_id', migration.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    const counts: Record<string, number> = {};
    for (const r of (staged.data ?? []) as { entity_type: string }[]) counts[r.entity_type] = (counts[r.entity_type] ?? 0) + 1;

    await logMigrationAudit(admin, { migrationId: migration.id, action: 'portal.view', actorId: ctx.user.id, actorRole: 'client' });
    await touchMigrationActivity(admin, migration.id);

    return res.json({
      migration_id: migration.id,
      workspace_name: org.data?.name ?? '',
      source_crm: migration.source_crm,
      status: migration.status,
      categories: migration.categories,
      importable_categories: IMPORTABLE_CATEGORIES,
      expires_at: ctx.invitation.expires_at,
      read_only: ctx.readOnly,
      can_upload: !ctx.readOnly && UPLOAD_ALLOWED_STATUSES.includes(migration.status),
      can_edit_mappings: !ctx.readOnly && CLIENT_MAPPING_EDIT_STATUSES.includes(migration.status),
      files: files.data ?? [],
      detected_counts: counts,
      open_questions: issues.count ?? 0,
      latest_approval: approval.data ?? null,
      freeze: { start: migration.freeze_start, end: migration.freeze_end, confirmed_at: migration.freeze_confirmed_at },
      user: { email: ctx.user.email ?? '', role: ctx.role },
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Portail indisponible.', '[migration-portal]');
  }
});

// ── Instructions d'exportation ──────────────────────────────────────────
router.get('/migration-portal/instructions', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    return res.json(getCrmConfig(ctx.migration.source_crm));
  } catch (err: any) {
    return sendSafeError(res, err, 'Instructions indisponibles.', '[migration-portal]');
  }
});

// ── Téléversement (CSV de données, PDF d'archive) ───────────────────────
const rawParser = express.raw({ type: () => true, limit: '26mb' });

function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'fichier';
  return base.replace(/[^\w.\-()\s]/g, '_').slice(0, 80) || 'fichier';
}

router.post('/migration-portal/files', rawParser, async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration, user } = ctx;

    if (ctx.readOnly || !UPLOAD_ALLOWED_STATUSES.includes(migration.status)) {
      return res.status(409).json({ error: 'Le téléversement n\'est plus permis à cette étape.', code: 'upload_closed' });
    }

    const rawName = typeof req.query.name === 'string' ? req.query.name : '';
    const name = sanitizeFileName(rawName);
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    if (!['csv', 'pdf'].includes(ext)) {
      return res.status(415).json({
        error: 'Format non pris en charge. Utilisez des fichiers CSV (données) ou PDF (archive). XLSX/ZIP ne sont pas acceptés en v1.',
        code: 'unsupported_type',
      });
    }
    const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buf.length === 0) return res.status(400).json({ error: 'Fichier vide.', code: 'empty' });
    if (buf.length > MAX_FILE_SIZE_BYTES) {
      return res.status(413).json({ error: 'Fichier trop volumineux (max 25 Mo).', code: 'too_large' });
    }

    // Vérification du contenu réel (jamais l'extension seule).
    const kind = ext === 'pdf' ? 'archive' : 'data';
    if (kind === 'archive' && !sniffIsPdf(buf)) {
      return res.status(415).json({ error: 'Ce fichier n\'est pas un PDF valide.', code: 'not_pdf' });
    }
    if (kind === 'data' && looksBinary(buf)) {
      return res.status(415).json({ error: 'Ce fichier ne semble pas être un CSV texte valide.', code: 'binary' });
    }

    const { count: fileCount } = await admin
      .from('migration_files')
      .select('id', { count: 'exact', head: true })
      .eq('migration_id', migration.id)
      .is('deleted_at', null);
    if ((fileCount ?? 0) >= MAX_FILES_PER_MIGRATION) {
      return res.status(409).json({ error: `Limite de ${MAX_FILES_PER_MIGRATION} fichiers atteinte.`, code: 'too_many_files' });
    }

    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const { data: dup } = await admin
      .from('migration_files')
      .select('id, original_name')
      .eq('migration_id', migration.id)
      .eq('sha256', sha256)
      .is('deleted_at', null)
      .maybeSingle();
    if (dup) {
      return res.status(409).json({ error: `Ce fichier a déjà été téléversé (${dup.original_name}).`, code: 'duplicate_file' });
    }

    const fileId = crypto.randomUUID();
    const storagePath = `${migration.org_id}/${migration.id}/${fileId}/${name}`;
    const mime = kind === 'archive' ? 'application/pdf' : 'text/csv';
    const { error: upErr } = await admin.storage.from(MIGRATION_BUCKET).upload(storagePath, buf, { contentType: mime, upsert: false });
    if (upErr) throw upErr;

    const { data: fileRow, error: insErr } = await admin
      .from('migration_files')
      .insert({
        id: fileId,
        migration_id: migration.id,
        storage_path: storagePath,
        original_name: name,
        mime_type: mime,
        size_bytes: buf.length,
        sha256,
        kind,
        uploaded_by: user.id,
      })
      .select('id, original_name, mime_type, size_bytes, kind, security_status, parse_status, created_at')
      .single();
    if (insErr) throw insErr;

    if (migration.status === 'waiting_for_files') {
      const { error } = await admin
        .from('data_migrations')
        .update({ status: 'files_uploaded' })
        .eq('id', migration.id)
        .eq('status', 'waiting_for_files');
      if (error) console.error('[migration-portal] upload transition failed:', error.message);
      else migration.status = 'files_uploaded';
    }

    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'file.upload',
      actorId: user.id,
      actorRole: 'client',
      target: `file:${fileId}`,
      meta: { name, size_bytes: buf.length, kind },
    });
    await touchMigrationActivity(admin, migration.id);

    // Analyse asynchrone — la progression vit dans migration_files.parse_status.
    void analyzeMigrationFile(admin, migration, fileId).catch((err) => console.error('[migration-portal] analyze failed:', err));

    return res.status(201).json(fileRow);
  } catch (err: any) {
    return sendSafeError(res, err, 'Téléversement impossible.', '[migration-portal]');
  }
});

router.get('/migration-portal/files', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { data, error } = await ctx.admin
      .from('migration_files')
      .select('id, original_name, mime_type, size_bytes, kind, category_detected, row_count, column_count, security_status, parse_status, parse_error, created_at')
      .eq('migration_id', ctx.migration.id)
      .is('deleted_at', null)
      .order('created_at');
    if (error) throw error;
    return res.json(data ?? []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Liste des fichiers indisponible.', '[migration-portal]');
  }
});

router.delete('/migration-portal/files/:fileId', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration } = ctx;
    if (ctx.readOnly || !UPLOAD_ALLOWED_STATUSES.includes(migration.status)) {
      return res.status(409).json({ error: 'La suppression n\'est plus permise à cette étape.', code: 'locked' });
    }
    const { data: file, error: fErr } = await admin
      .from('migration_files')
      .select('id, storage_path')
      .eq('id', req.params.fileId)
      .eq('migration_id', migration.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (fErr) throw fErr;
    if (!file) return res.status(404).json({ error: 'Fichier introuvable.' });

    // Un fichier déjà utilisé par un import (test/final) ne se supprime plus.
    const { count: used } = await admin
      .from('migration_import_records')
      .select('id', { count: 'exact', head: true })
      .eq('migration_id', migration.id);
    if ((used ?? 0) > 0) {
      return res.status(409).json({ error: 'Un import a déjà utilisé ces fichiers — contactez l\'équipe Lume.', code: 'locked' });
    }

    await admin.from('migration_staging_records').delete().eq('file_id', file.id);
    await admin.from('migration_field_mappings').delete().eq('file_id', file.id);
    await admin.from('migration_file_columns').delete().eq('file_id', file.id);
    const { error: rmErr } = await admin.storage.from(MIGRATION_BUCKET).remove([file.storage_path]);
    if (rmErr) console.error('[migration-portal] storage remove failed:', rmErr.message);
    const { error } = await admin.from('migration_files').update({ deleted_at: new Date().toISOString() }).eq('id', file.id);
    if (error) throw error;

    await logMigrationAudit(admin, { migrationId: migration.id, action: 'file.delete', actorId: ctx.user.id, actorRole: 'client', target: `file:${file.id}` });
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Suppression impossible.', '[migration-portal]');
  }
});

// ── Correspondances (aperçus TOUJOURS masqués) ──────────────────────────
router.get('/migration-portal/mappings', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration } = ctx;
    const [cols, maps] = await Promise.all([
      admin
        .from('migration_file_columns')
        .select('id, file_id, position, header, detected_type, empty_ratio, samples_masked')
        .eq('migration_id', migration.id)
        .order('position'),
      admin
        .from('migration_field_mappings')
        .select('id, file_id, column_id, target_entity, target_field, confidence, reason, status')
        .eq('migration_id', migration.id),
    ]);
    if (cols.error) throw cols.error;
    if (maps.error) throw maps.error;
    return res.json({
      columns: cols.data ?? [],
      mappings: maps.data ?? [],
      can_edit: !ctx.readOnly && CLIENT_MAPPING_EDIT_STATUSES.includes(migration.status),
      field_catalog: FIELD_CATALOG,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Correspondances indisponibles.', '[migration-portal]');
  }
});

router.post('/migration-portal/mappings/:mappingId/correct', validate(migrationPortalMappingSchema), async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration, user } = ctx;
    if (ctx.readOnly || !CLIENT_MAPPING_EDIT_STATUSES.includes(migration.status)) {
      return res.status(409).json({ error: 'Les correspondances ne sont plus modifiables à cette étape.', code: 'locked' });
    }
    const body = req.body as { target_entity: string | null; target_field: string | null };
    if (body.target_entity && body.target_field) {
      const fields = FIELD_CATALOG[body.target_entity as TargetEntity] ?? [];
      if (!fields.some((f) => f.field === body.target_field)) {
        return res.status(400).json({ error: 'Champ cible inconnu.' });
      }
    }
    const { data, error } = await admin
      .from('migration_field_mappings')
      .update({
        target_entity: body.target_entity,
        target_field: body.target_field,
        status: body.target_field ? 'corrected' : 'rejected',
        decided_by: user.id,
        decided_role: 'client',
        decided_at: new Date().toISOString(),
      })
      .eq('id', req.params.mappingId)
      .eq('migration_id', migration.id)
      .select('id, target_entity, target_field, status')
      .single();
    if (error) throw error;
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'mapping.client_correct',
      actorId: user.id,
      actorRole: 'client',
      target: `mapping:${req.params.mappingId}`,
      meta: { target_field: body.target_field ?? null },
    });
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Correction impossible.', '[migration-portal]');
  }
});

// ── Questions de l'équipe Lume ──────────────────────────────────────────
router.get('/migration-portal/issues', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { data, error } = await ctx.admin
      .from('migration_issues')
      .select('id, type, severity, title, details_masked, options, client_answer, client_answered_at, resolved_at, created_at')
      .eq('migration_id', ctx.migration.id)
      .eq('client_visible', true)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return res.json(data ?? []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Questions indisponibles.', '[migration-portal]');
  }
});

router.post('/migration-portal/issues/:issueId/answer', validate(migrationPortalAnswerSchema), async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration, user } = ctx;
    if (ctx.readOnly) return res.status(409).json({ error: 'La migration est verrouillée.', code: 'locked' });
    const { data, error } = await admin
      .from('migration_issues')
      .update({ client_answer: (req.body as { answer: string }).answer, client_answered_at: new Date().toISOString() })
      .eq('id', req.params.issueId)
      .eq('migration_id', migration.id)
      .eq('client_visible', true)
      .select('id, client_answer, client_answered_at')
      .single();
    if (error) throw error;
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'issue.client_answer', actorId: user.id, actorRole: 'client', target: `issue:${req.params.issueId}` });
    await touchMigrationActivity(admin, migration.id);
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Réponse impossible.', '[migration-portal]');
  }
});

// ── Aperçu de l'import test ─────────────────────────────────────────────
router.get('/migration-portal/preview', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { data: batch, error } = await ctx.admin
      .from('migration_import_batches')
      .select('id, kind, status, totals, started_at, finished_at')
      .eq('migration_id', ctx.migration.id)
      .eq('kind', 'test')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!batch) return res.status(404).json({ error: 'Aucun aperçu disponible pour le moment.', code: 'no_preview' });
    return res.json({
      report: batch.totals,
      generated_at: batch.finished_at,
      approval_sentences: { fr: APPROVAL_SENTENCE_FR, en: APPROVAL_SENTENCE_EN },
      can_approve: ctx.migration.status === 'waiting_for_approval',
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Aperçu indisponible.', '[migration-portal]');
  }
});

// ── Aperçu masqué des premières lignes transformées (audit S4) ──────────
// Le client valide la TRANSFORMATION (dates, montants, statuts lisibles),
// la PII reste masquée comme partout ailleurs sur le portail.
router.get('/migration-portal/preview-rows', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration } = ctx;
    const byEntity: Record<string, { row_number: number; status: string; fields: Record<string, string> }[]> = {};
    for (const entity of IMPORT_ORDER) {
      const { data: rows, error } = await admin
        .from('migration_staging_records')
        .select('row_number, status, normalized')
        .eq('migration_id', migration.id)
        .eq('entity_type', entity)
        .in('status', ['ready', 'duplicate', 'imported', 'merged'])
        .order('row_number', { ascending: true })
        .limit(20);
      if (error) throw error;
      if (!rows || rows.length === 0) continue;
      byEntity[entity] = rows.map((r: { row_number: number; status: string; normalized: Record<string, unknown> | null }) => ({
        row_number: r.row_number,
        status: r.status,
        fields: maskNormalizedRecord(r.normalized),
      }));
    }
    return res.json({ by_entity: byEntity });
  } catch (err: any) {
    return sendSafeError(res, err, 'Aperçu des lignes indisponible.', '[migration-portal]');
  }
});

// ── Rapport d'erreurs ligne par ligne (audit S4) ────────────────────────
// Les lignes rejetées contiennent les données DU bureau : il y a droit, c'est
// ce qui lui permet de corriger son fichier. Téléchargement authentifié
// (jeton + session + rôle), jamais envoyé par courriel, et journalisé.
router.get('/migration-portal/rejects.csv', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration } = ctx;
    const { csv, rows } = await buildRejectsCsv(admin, migration.id);
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'rejects.export',
      actorId: ctx.user.id,
      actorRole: 'client',
      meta: { rows },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lignes-en-erreur-${migration.id.slice(0, 8)}.csv"`);
    return res.send(csv);
  } catch (err: any) {
    return sendSafeError(res, err, 'Export des lignes en erreur impossible.', '[migration-portal]');
  }
});

// ── Approbation / refus / demande de correction ─────────────────────────
router.post('/migration-portal/approval', validate(migrationPortalApprovalSchema), async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration, user } = ctx;
    if (migration.status !== 'waiting_for_approval') {
      return res.status(409).json({ error: 'Aucune approbation n\'est attendue pour le moment.', code: 'not_awaiting' });
    }
    const body = req.body as { decision: 'approved' | 'refused' | 'changes_requested'; confirmed_text?: string; comment?: string };

    const { data: batch } = await admin
      .from('migration_import_batches')
      .select('id, totals, finished_at')
      .eq('migration_id', migration.id)
      .eq('kind', 'test')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!batch) return res.status(409).json({ error: 'Aucun rapport d\'import test à approuver.', code: 'no_preview' });

    if (body.decision === 'approved') {
      const confirmed = (body.confirmed_text ?? '').trim();
      if (confirmed !== APPROVAL_SENTENCE_FR && confirmed !== APPROVAL_SENTENCE_EN) {
        return res.status(400).json({ error: 'La phrase de confirmation exacte est requise pour approuver.', code: 'confirmation_required' });
      }
    }

    const { data: prevApprovals } = await admin
      .from('migration_approvals')
      .select('report_version')
      .eq('migration_id', migration.id)
      .order('report_version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (prevApprovals?.report_version ?? 0) + 1;

    const ip = extractIP(req);
    const { data: approval, error } = await admin
      .from('migration_approvals')
      .insert({
        migration_id: migration.id,
        report_version: version,
        report: batch.totals ?? {},
        decision: body.decision,
        confirmed_text: body.decision === 'approved' ? (body.confirmed_text ?? '').trim() : null,
        comment: body.comment ?? null,
        user_id: user.id,
        ip_address: ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null,
        user_agent: (req.header('user-agent') ?? '').slice(0, 300) || null,
      })
      .select('id, decision, report_version, created_at')
      .single();
    if (error) throw error;

    const nextStatus = body.decision === 'approved' ? 'approved' : 'test_review';
    const { error: stErr } = await admin
      .from('data_migrations')
      .update({ status: nextStatus })
      .eq('id', migration.id)
      .eq('status', 'waiting_for_approval');
    if (stErr) console.error('[migration-portal] approval transition failed:', stErr.message);

    if (body.decision !== 'approved') {
      const { error: issueErr } = await admin.from('migration_issues').insert({
        migration_id: migration.id,
        type: body.decision === 'refused' ? 'client_refused' : 'client_change_request',
        severity: 'warning',
        title: body.decision === 'refused' ? 'Le client a refusé l\'aperçu.' : 'Le client demande une correction.',
        details_masked: { comment: (body.comment ?? '').slice(0, 500) },
        client_visible: true,
      });
      if (issueErr) console.error('[migration-portal] refusal issue failed:', issueErr.message);
    }

    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: `approval.${body.decision}`,
      actorId: user.id,
      actorRole: 'client',
      meta: { report_version: version },
    });
    // Trace org-scopée conforme (append-only, workspace du client).
    const { error: aeErr } = await admin.from('audit_events').insert({
      org_id: migration.org_id,
      actor_id: user.id,
      action: 'settings_update',
      entity_type: 'data_migration_approval',
      entity_id: approval.id,
      metadata: { decision: body.decision, report_version: version },
      ip_address: ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null,
      user_agent: (req.header('user-agent') ?? '').slice(0, 300) || null,
    });
    if (aeErr) console.error('[migration-portal] audit_events insert failed:', aeErr.message);

    return res.status(201).json(approval);
  } catch (err: any) {
    return sendSafeError(res, err, 'Enregistrement de la décision impossible.', '[migration-portal]');
  }
});

// ── Rapport final ───────────────────────────────────────────────────────
router.get('/migration-portal/report', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration } = ctx;
    if (!['completed', 'completed_with_warnings', 'rolled_back'].includes(migration.status)) {
      return res.status(404).json({ error: 'Le rapport final n\'est pas encore disponible.', code: 'not_ready' });
    }
    const [batch, approval] = await Promise.all([
      admin
        .from('migration_import_batches')
        .select('id, status, totals, started_at, finished_at')
        .eq('migration_id', migration.id)
        .eq('kind', 'final')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('migration_approvals')
        .select('decision, report_version, created_at')
        .eq('migration_id', migration.id)
        .eq('decision', 'approved')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'report.view', actorId: ctx.user.id, actorRole: 'client' });
    return res.json({
      status: migration.status,
      source_crm: migration.source_crm,
      completed_at: migration.completed_at,
      batch: batch.data ?? null,
      approval: approval.data ?? null,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Rapport indisponible.', '[migration-portal]');
  }
});

// ── Messages ────────────────────────────────────────────────────────────
router.get('/migration-portal/messages', async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { data, error } = await ctx.admin
      .from('migration_messages')
      .select('id, author_kind, body, created_at')
      .eq('migration_id', ctx.migration.id)
      .order('created_at')
      .limit(200);
    if (error) throw error;
    return res.json(data ?? []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Messages indisponibles.', '[migration-portal]');
  }
});

router.post('/migration-portal/messages', validate(migrationMessageSchema), async (req, res) => {
  try {
    const ctx = await requirePortalAccess(req, res);
    if (!ctx) return;
    const { admin, migration, user } = ctx;
    const { data, error } = await admin
      .from('migration_messages')
      .insert({ migration_id: migration.id, author_id: user.id, author_kind: 'client', body: (req.body as { body: string }).body })
      .select('id, author_kind, body, created_at')
      .single();
    if (error) throw error;
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'message.send', actorId: user.id, actorRole: 'client' });
    await touchMigrationActivity(admin, migration.id);
    return res.status(201).json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Envoi impossible.', '[migration-portal]');
  }
});

export default router;
