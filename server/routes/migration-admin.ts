// Console interne des migrations assistées — réservée à l'administrateur
// plateforme Lume (PLATFORM_OWNER_ID), jamais aux admins de workspace client.
// Chaque handler se garde lui-même via requirePlatformAdmin (aucune entrée
// dans ROUTE_PERMISSIONS : ces routes ne font pas partie du RBAC tenant).
// Périmètre volontairement limité aux données de migration : pas de vues
// analytiques inter-tenants (décision produit documentée dans index.ts).

import { Router } from 'express';
import type express from 'express';
import { requireAuthedClient, getServiceClient, buildSupabaseWithAuth } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import {
  validate,
  migrationCreateSchema,
  migrationPatchSchema,
  migrationInvitationSchema,
  migrationStatusChangeSchema,
  migrationMappingDecisionSchema,
  migrationIssueResolveSchema,
  migrationIssueCreateSchema,
  migrationDuplicateDecisionSchema,
  migrationFinalImportSchema,
  migrationMessageSchema,
  migrationStaffMapSchema,
  migrationTemplateSaveSchema,
  migrationTemplateApplySchema,
} from '../lib/validation';
import { platformAdminIds, getBaseUrl } from '../lib/config';
import { assertTransition, canTransition, InvalidTransitionError } from '../lib/migration/state-machine';
import { generateInviteToken, expiryFromNow } from '../lib/migration/tokens';
import { logMigrationAudit, touchMigrationActivity } from '../lib/migration/audit';
import { analyzeMigrationFile, prepareStaging, MIGRATION_BUCKET } from '../lib/migration/pipeline';
import { findDuplicatesForEntity, } from '../lib/migration/duplicates';
import { runDryRun, runFinalImport, rollbackFinalBatch, runPostImportValidation, purgeImportActivityNoise } from '../lib/migration/importer';
import { getCrmConfig } from '../lib/migration/instructions';
import { entityForCategory, normalizeHeader } from '../lib/migration/mapping';
import { DEFAULT_INVITE_TTL_HOURS, IMPORTABLE_CATEGORIES } from '../lib/migration/types';
import type { MigrationRow, MigrationStatus, TargetEntity } from '../lib/migration/types';

const router = Router();

type Authed = NonNullable<Awaited<ReturnType<typeof requireAuthedClient>>>;

/** Garde plateforme : pattern historique du back-office, étendu à une liste
 *  d'admins (platformAdminIds = PLATFORM_OWNER_ID ∪ PLATFORM_ADMIN_IDS). */
async function requirePlatformAdmin(req: express.Request, res: express.Response): Promise<Authed | null> {
  if (platformAdminIds.size === 0) {
    res.status(503).json({ error: 'Console de migration non configurée.' });
    return null;
  }
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  if (!platformAdminIds.has(auth.user.id)) {
    res.status(403).json({ error: 'Accès refusé.' });
    return null;
  }
  return auth;
}

async function getMigration(admin: ReturnType<typeof getServiceClient>, id: string): Promise<MigrationRow | null> {
  const { data, error } = await admin
    .from('data_migrations')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single<MigrationRow>();
  if (error || !data) return null;
  return data;
}

// Sonde d'identité douce pour le gate frontend — ne 401 jamais.
router.get('/migration-admin/check', async (req, res) => {
  try {
    if (platformAdminIds.size === 0) return res.json({ isPlatformAdmin: false });
    const client = buildSupabaseWithAuth(req.header('authorization'));
    const { data } = await client.auth.getUser();
    return res.json({ isPlatformAdmin: !!data?.user?.id && platformAdminIds.has(data.user.id) });
  } catch {
    return res.json({ isPlatformAdmin: false });
  }
});

// ── Liste + filtres + recherche ─────────────────────────────────────────
router.get('/migration-admin/migrations', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const PAGE_SIZE = 20;

    let query = admin
      .from('data_migrations')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (status) query = query.eq('status', status);
    const { data: migrations, error, count } = await query;
    if (error) throw error;

    let rows = (migrations ?? []) as MigrationRow[];

    // Noms d'orgs pour affichage + recherche
    const orgIds = Array.from(new Set(rows.map((m) => m.org_id)));
    const { data: orgs, error: orgErr } = orgIds.length
      ? await admin.from('orgs').select('id, name').in('id', orgIds)
      : { data: [], error: null };
    if (orgErr) throw orgErr;
    const orgNameById = new Map<string, string>((orgs ?? []).map((o: { id: string; name: string }) => [o.id, o.name]));

    if (q) {
      const needle = q.toLowerCase();
      rows = rows.filter((m) =>
        m.id === q ||
        (orgNameById.get(m.org_id) ?? '').toLowerCase().includes(needle) ||
        (m.invited_email ?? '').toLowerCase().includes(needle) ||
        m.source_crm.toLowerCase().includes(needle),
      );
    }

    const enriched = await Promise.all(
      rows.map(async (m) => {
        const [files, staged, issues, invitation, approval] = await Promise.all([
          admin.from('migration_files').select('id', { count: 'exact', head: true }).eq('migration_id', m.id).is('deleted_at', null),
          admin.from('migration_staging_records').select('entity_type').eq('migration_id', m.id),
          admin.from('migration_issues').select('id, severity', { count: 'exact' }).eq('migration_id', m.id).is('resolved_at', null),
          admin.from('migration_invitations').select('expires_at, revoked_at, superseded_at, opened_at, created_at').eq('migration_id', m.id).is('superseded_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          admin.from('migration_approvals').select('decision, created_at, report_version').eq('migration_id', m.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        const counts: Record<string, number> = {};
        for (const r of (staged.data ?? []) as { entity_type: string }[]) {
          counts[r.entity_type] = (counts[r.entity_type] ?? 0) + 1;
        }
        const openIssues = issues.count ?? 0;
        const blocking = ((issues.data ?? []) as { severity: string }[]).filter((i) => i.severity === 'blocking' || i.severity === 'error').length;
        const risk = blocking > 0 ? 'high' : openIssues > 5 ? 'medium' : 'low';
        return {
          ...m,
          org_name: orgNameById.get(m.org_id) ?? null,
          files_count: files.count ?? 0,
          detected_counts: counts,
          open_issues: openIssues,
          risk_level: risk,
          invitation: invitation.data ?? null,
          latest_approval: approval.data ?? null,
        };
      }),
    );

    return res.json({ data: enriched, total: count ?? enriched.length, page, pageSize: PAGE_SIZE });
  } catch (err: any) {
    return sendSafeError(res, err, 'Impossible de charger les migrations.', '[migration-admin]');
  }
});

// ── Création ────────────────────────────────────────────────────────────
router.post('/migration-admin/migrations', validate(migrationCreateSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const body = req.body as Record<string, unknown>;

    const { data: org, error: orgErr } = await admin.from('orgs').select('id, name').eq('id', body.org_id).single();
    if (orgErr || !org) return res.status(404).json({ error: 'Workspace introuvable.' });

    const { data: created, error } = await admin
      .from('data_migrations')
      .insert({
        org_id: body.org_id,
        source_crm: body.source_crm ?? 'other',
        categories: body.categories ?? IMPORTABLE_CATEGORIES,
        priority: body.priority ?? 'normal',
        target_date: body.target_date ?? null,
        internal_notes: body.internal_notes ?? null,
        invited_email: body.invited_email ?? null,
        invited_user_id: body.invited_user_id ?? null,
        assigned_admin: body.assigned_admin ?? auth.user.id,
        assigned_assistant: body.assigned_assistant ?? null,
        created_by: auth.user.id,
      })
      .select()
      .single();
    if (error) throw error;

    await logMigrationAudit(admin, {
      migrationId: created.id,
      action: 'migration.create',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      meta: { org_id: created.org_id, source_crm: created.source_crm },
    });
    return res.status(201).json(created);
  } catch (err: any) {
    return sendSafeError(res, err, 'Création de la migration impossible.', '[migration-admin]');
  }
});

// ── Détail ──────────────────────────────────────────────────────────────
router.get('/migration-admin/migrations/:id', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });

    const [org, invitation, files, columns, mappings, issues, dupes, batches, approvals, messages] = await Promise.all([
      admin.from('orgs').select('id, name').eq('id', migration.org_id).single(),
      admin.from('migration_invitations').select('id, expires_at, revoked_at, superseded_at, opened_at, failed_attempts, created_at').eq('migration_id', migration.id).order('created_at', { ascending: false }).limit(5),
      admin.from('migration_files').select('*').eq('migration_id', migration.id).is('deleted_at', null).order('created_at'),
      admin.from('migration_file_columns').select('*').eq('migration_id', migration.id).order('position'),
      admin.from('migration_field_mappings').select('*').eq('migration_id', migration.id),
      admin.from('migration_issues').select('*').eq('migration_id', migration.id).order('created_at', { ascending: false }).limit(200),
      admin.from('migration_duplicate_candidates').select('*').eq('migration_id', migration.id).order('score', { ascending: false }).limit(500),
      admin.from('migration_import_batches').select('*').eq('migration_id', migration.id).order('created_at', { ascending: false }),
      admin.from('migration_approvals').select('*').eq('migration_id', migration.id).order('created_at', { ascending: false }),
      admin.from('migration_messages').select('*').eq('migration_id', migration.id).order('created_at').limit(200),
    ]);

    const { data: staged } = await admin.from('migration_staging_records').select('entity_type, status').eq('migration_id', migration.id);
    const stagingCounts: Record<string, Record<string, number>> = {};
    for (const r of (staged ?? []) as { entity_type: string; status: string }[]) {
      stagingCounts[r.entity_type] = stagingCounts[r.entity_type] ?? {};
      stagingCounts[r.entity_type][r.status] = (stagingCounts[r.entity_type][r.status] ?? 0) + 1;
    }

    return res.json({
      migration,
      org_name: org.data?.name ?? null,
      invitations: invitation.data ?? [],
      files: files.data ?? [],
      columns: columns.data ?? [],
      mappings: mappings.data ?? [],
      issues: issues.data ?? [],
      duplicates: dupes.data ?? [],
      batches: batches.data ?? [],
      approvals: approvals.data ?? [],
      messages: messages.data ?? [],
      staging_counts: stagingCounts,
      crm_config: getCrmConfig(migration.source_crm),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Impossible de charger la migration.', '[migration-admin]');
  }
});

// ── Mise à jour simple ──────────────────────────────────────────────────
router.patch('/migration-admin/migrations/:id', validate(migrationPatchSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });

    const allowed = ['priority', 'target_date', 'internal_notes', 'invited_email', 'invited_user_id', 'assigned_admin', 'assigned_assistant', 'categories', 'source_crm', 'freeze_start', 'freeze_end'] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) patch[key] = (req.body as Record<string, unknown>)[key];
    }
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Aucun champ modifiable fourni.' });

    const { data, error } = await admin.from('data_migrations').update(patch).eq('id', migration.id).select().single();
    if (error) throw error;
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'migration.update',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      meta: { fields: Object.keys(patch) },
    });
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Mise à jour impossible.', '[migration-admin]');
  }
});

// ── Transition de statut contrôlée ──────────────────────────────────────
router.post('/migration-admin/migrations/:id/status', validate(migrationStatusChangeSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });

    const to = (req.body as { to: MigrationStatus }).to;
    try {
      assertTransition(migration.status, to);
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        return res.status(409).json({ error: `Transition invalide : ${migration.status} → ${to}.` });
      }
      throw err;
    }
    // L'import final et le rollback ne passent JAMAIS par cette route
    // générique : marquer « rolled_back » sans exécuter le rollback réel
    // laisserait les données importées en place (faille attrapée par le
    // test E2E round 4).
    if (to === 'importing' || to === 'post_import_validation' || to === 'rolled_back') {
      return res.status(409).json({ error: 'Cette transition passe par sa route dédiée avec confirmation.' });
    }
    const { data, error } = await admin
      .from('data_migrations')
      .update({ status: to, ...(to === 'cancelled' ? { closed_at: new Date().toISOString() } : {}) })
      .eq('id', migration.id)
      .eq('status', migration.status)
      .select()
      .single();
    if (error) throw error;
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'migration.status',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      meta: { from: migration.status, to },
    });
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Changement de statut impossible.', '[migration-admin]');
  }
});

// ── Invitation : générer / révoquer / prolonger ─────────────────────────
router.post('/migration-admin/migrations/:id/invitation', validate(migrationInvitationSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    if (['completed', 'completed_with_warnings', 'cancelled', 'rolled_back'].includes(migration.status)) {
      return res.status(409).json({ error: 'Cette migration est terminée — créez une nouvelle migration pour un nouvel import.' });
    }

    const ttlHours = (req.body as { ttl_hours?: number }).ttl_hours ?? DEFAULT_INVITE_TTL_HOURS;

    // Générer un nouveau lien invalide l'ancien.
    const { error: supErr } = await admin
      .from('migration_invitations')
      .update({ superseded_at: new Date().toISOString() })
      .eq('migration_id', migration.id)
      .is('superseded_at', null);
    if (supErr) throw supErr;

    const { token, tokenHash } = generateInviteToken();
    const { data: invitation, error } = await admin
      .from('migration_invitations')
      .insert({
        migration_id: migration.id,
        token_hash: tokenHash,
        expires_at: expiryFromNow(ttlHours),
        created_by: auth.user.id,
      })
      .select('id, expires_at, created_at')
      .single();
    if (error) throw error;

    if (canTransition(migration.status, 'invitation_sent') && migration.status === 'draft') {
      await admin.from('data_migrations').update({ status: 'invitation_sent' }).eq('id', migration.id).eq('status', 'draft');
    }

    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'invitation.generate',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      meta: { ttl_hours: ttlHours, invitation_id: invitation.id },
    });
    await touchMigrationActivity(admin, migration.id);

    // Le jeton brut n'est renvoyé qu'une seule fois, jamais stocké ni loggé.
    return res.status(201).json({
      invite_url: `${getBaseUrl()}/migration/invite/${token}`,
      expires_at: invitation.expires_at,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Génération de l\'invitation impossible.', '[migration-admin]');
  }
});

router.post('/migration-admin/migrations/:id/invitation/revoke', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });

    const { error } = await admin
      .from('migration_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('migration_id', migration.id)
      .is('revoked_at', null)
      .is('superseded_at', null);
    if (error) throw error;
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'invitation.revoke', actorId: auth.user.id, actorRole: 'platform_admin' });
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Révocation impossible.', '[migration-admin]');
  }
});

router.post('/migration-admin/migrations/:id/invitation/extend', validate(migrationInvitationSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });

    const ttlHours = (req.body as { ttl_hours?: number }).ttl_hours ?? DEFAULT_INVITE_TTL_HOURS;
    const { data, error } = await admin
      .from('migration_invitations')
      .update({ expires_at: expiryFromNow(ttlHours) })
      .eq('migration_id', migration.id)
      .is('revoked_at', null)
      .is('superseded_at', null)
      .select('id, expires_at');
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: 'Aucune invitation active à prolonger.' });
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'invitation.extend',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      meta: { ttl_hours: ttlHours },
    });
    return res.json({ ok: true, expires_at: data[0].expires_at });
  } catch (err: any) {
    return sendSafeError(res, err, 'Prolongation impossible.', '[migration-admin]');
  }
});

// ── Fichiers : rejeter / ré-analyser / téléchargement signé ────────────
router.post('/migration-admin/migrations/:id/files/:fileId/reject', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const { error } = await admin
      .from('migration_files')
      .update({ security_status: 'rejected', security_reason: 'rejected_by_admin' })
      .eq('id', req.params.fileId)
      .eq('migration_id', migration.id);
    if (error) throw error;
    await admin.from('migration_staging_records').delete().eq('file_id', req.params.fileId);
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'file.rejected', actorId: auth.user.id, actorRole: 'platform_admin', target: `file:${req.params.fileId}` });
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Rejet du fichier impossible.', '[migration-admin]');
  }
});

router.post('/migration-admin/migrations/:id/files/:fileId/reanalyze', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'file.reanalyze', actorId: auth.user.id, actorRole: 'platform_admin', target: `file:${req.params.fileId}` });
    void analyzeMigrationFile(admin, migration, req.params.fileId).catch((err) => console.error('[migration-admin] reanalyze failed:', err));
    return res.status(202).json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Ré-analyse impossible.', '[migration-admin]');
  }
});

router.get('/migration-admin/migrations/:id/files/:fileId/download', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const { data: file, error } = await admin
      .from('migration_files')
      .select('storage_path')
      .eq('id', req.params.fileId)
      .eq('migration_id', migration.id)
      .is('deleted_at', null)
      .single();
    if (error || !file) return res.status(404).json({ error: 'Fichier introuvable.' });
    const { data: signed, error: signErr } = await admin.storage.from(MIGRATION_BUCKET).createSignedUrl(file.storage_path, 300);
    if (signErr || !signed) throw signErr ?? new Error('Signature impossible');
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'file.download', actorId: auth.user.id, actorRole: 'platform_admin', target: `file:${req.params.fileId}` });
    return res.json({ url: signed.signedUrl });
  } catch (err: any) {
    return sendSafeError(res, err, 'Téléchargement impossible.', '[migration-admin]');
  }
});

// ── Correspondances / problèmes / doublons ─────────────────────────────
router.post('/migration-admin/migrations/:id/mappings/:mappingId', validate(migrationMappingDecisionSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });

    const body = req.body as { target_entity?: string | null; target_field?: string | null; status: string };
    const patch: Record<string, unknown> = {
      status: body.status,
      decided_by: auth.user.id,
      decided_role: 'platform_admin',
      decided_at: new Date().toISOString(),
    };
    if ('target_entity' in body) patch.target_entity = body.target_entity;
    if ('target_field' in body) patch.target_field = body.target_field;

    const { data, error } = await admin
      .from('migration_field_mappings')
      .update(patch)
      .eq('id', req.params.mappingId)
      .eq('migration_id', migration.id)
      .select()
      .single();
    if (error) throw error;
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'mapping.decide',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      target: `mapping:${req.params.mappingId}`,
      meta: { status: body.status, target_field: body.target_field ?? null },
    });
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Décision de correspondance impossible.', '[migration-admin]');
  }
});

router.post('/migration-admin/migrations/:id/issues', validate(migrationIssueCreateSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const body = req.body as { type: string; severity?: string; title: string; client_visible?: boolean; options?: string[] };
    const { data, error } = await admin
      .from('migration_issues')
      .insert({
        migration_id: migration.id,
        type: body.type,
        severity: body.severity ?? 'warning',
        title: body.title,
        client_visible: body.client_visible ?? true,
        options: body.options ?? [],
      })
      .select()
      .single();
    if (error) throw error;
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'issue.create', actorId: auth.user.id, actorRole: 'platform_admin', target: `issue:${data.id}` });
    return res.status(201).json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Création du problème impossible.', '[migration-admin]');
  }
});

router.post('/migration-admin/migrations/:id/issues/:issueId/resolve', validate(migrationIssueResolveSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const body = req.body as { resolution: string };
    const { data, error } = await admin
      .from('migration_issues')
      .update({ resolution: body.resolution, resolved_by: auth.user.id, resolved_at: new Date().toISOString() })
      .eq('id', req.params.issueId)
      .eq('migration_id', migration.id)
      .select()
      .single();
    if (error) throw error;
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'issue.resolve', actorId: auth.user.id, actorRole: 'platform_admin', target: `issue:${req.params.issueId}` });
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Résolution impossible.', '[migration-admin]');
  }
});

router.post('/migration-admin/migrations/:id/duplicates/:dupId', validate(migrationDuplicateDecisionSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const decision = (req.body as { decision: string }).decision;
    const { data, error } = await admin
      .from('migration_duplicate_candidates')
      .update({ decision, decided_by: auth.user.id, decided_at: new Date().toISOString() })
      .eq('id', req.params.dupId)
      .eq('migration_id', migration.id)
      .select()
      .single();
    if (error) throw error;
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'duplicate.decide',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      target: `duplicate:${req.params.dupId}`,
      meta: { decision },
    });
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Décision sur le doublon impossible.', '[migration-admin]');
  }
});

// ── Analyse globale (relance) ───────────────────────────────────────────
router.post('/migration-admin/migrations/:id/analyze', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const { data: files, error } = await admin
      .from('migration_files')
      .select('id')
      .eq('migration_id', migration.id)
      .eq('kind', 'data')
      .is('deleted_at', null)
      .neq('security_status', 'rejected');
    if (error) throw error;
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'analysis.start', actorId: auth.user.id, actorRole: 'platform_admin', meta: { files: (files ?? []).length } });
    void (async () => {
      for (const f of files ?? []) {
        await analyzeMigrationFile(admin, migration, f.id);
      }
    })().catch((err) => console.error('[migration-admin] analyze all failed:', err));
    return res.status(202).json({ ok: true, files: (files ?? []).length });
  } catch (err: any) {
    return sendSafeError(res, err, 'Analyse impossible.', '[migration-admin]');
  }
});

// ── Import test (dry-run, aucune écriture dans les tables actives) ─────
router.post('/migration-admin/migrations/:id/test-import', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });

    if (migration.status !== 'ready_for_test') {
      if (!canTransition(migration.status, 'ready_for_test')) {
        return res.status(409).json({ error: `L'import test n'est pas disponible depuis le statut « ${migration.status} ».` });
      }
      await admin.from('data_migrations').update({ status: 'ready_for_test' }).eq('id', migration.id).eq('status', migration.status);
      migration.status = 'ready_for_test';
    }
    await admin.from('data_migrations').update({ status: 'testing' }).eq('id', migration.id).eq('status', 'ready_for_test');
    migration.status = 'testing';

    const { data: batch, error: batchErr } = await admin
      .from('migration_import_batches')
      .insert({ migration_id: migration.id, kind: 'test', status: 'running', started_by: auth.user.id })
      .select()
      .single();
    if (batchErr) throw batchErr;

    await logMigrationAudit(admin, { migrationId: migration.id, action: 'import.test.start', actorId: auth.user.id, actorRole: 'platform_admin', target: `batch:${batch.id}` });

    void (async () => {
      try {
        await prepareStaging(admin, migration);
        // détection des doublons contre les données actives (lecture seule)
        const entities: TargetEntity[] = ['client', 'property', 'job', 'quote', 'invoice'];
        for (const entity of entities) {
          const { data: records } = await admin
            .from('migration_staging_records')
            .select('id, normalized, relations')
            .eq('migration_id', migration.id)
            .eq('entity_type', entity)
            .in('status', ['ready', 'duplicate'])
            .limit(20000);
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
            if (dupErr) console.error('[migration-admin] duplicates insert failed:', dupErr.message);
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

        const report = await runDryRun(admin, migration);
        const { error: doneErr } = await admin
          .from('migration_import_batches')
          .update({ status: 'completed', totals: report as unknown as Record<string, unknown>, finished_at: new Date().toISOString() })
          .eq('id', batch.id);
        if (doneErr) console.error('[migration-admin] test batch update failed:', doneErr.message);
        await admin.from('data_migrations').update({ status: 'test_review' }).eq('id', migration.id).eq('status', 'testing');
        await logMigrationAudit(admin, { migrationId: migration.id, action: 'import.test.done', actorRole: 'system', target: `batch:${batch.id}`, meta: { totals: report.totals } });
      } catch (err: any) {
        console.error('[migration-admin] test import failed:', err?.message || err);
        await admin.from('migration_import_batches').update({ status: 'failed', error: 'internal_error', finished_at: new Date().toISOString() }).eq('id', batch.id);
        await admin.from('data_migrations').update({ status: 'failed' }).eq('id', migration.id).eq('status', 'testing');
      }
    })();

    return res.status(202).json({ ok: true, batch_id: batch.id });
  } catch (err: any) {
    return sendSafeError(res, err, 'Import test impossible.', '[migration-admin]');
  }
});

// ── Demande d'approbation client ───────────────────────────────────────
router.post('/migration-admin/migrations/:id/request-approval', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    if (migration.status !== 'test_review') {
      return res.status(409).json({ error: 'Un import test complété est requis avant de demander l\'approbation.' });
    }
    const { data: batch } = await admin
      .from('migration_import_batches')
      .select('id, status')
      .eq('migration_id', migration.id)
      .eq('kind', 'test')
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!batch) return res.status(409).json({ error: 'Aucun import test complété.' });

    // Garde-fous anti-perte silencieuse (audit 2026-08-25, Q117) :
    // 1) un fichier tronqué signifie des lignes jamais analysées — on ne fait
    //    pas approuver un rapport incomplet : scinder le fichier d'abord.
    const { data: truncated } = await admin
      .from('migration_files')
      .select('original_name')
      .eq('migration_id', migration.id)
      .eq('parse_error', 'truncated')
      .is('deleted_at', null)
      .limit(5);
    if ((truncated ?? []).length > 0) {
      return res.status(409).json({
        error: `Fichier(s) tronqué(s) (limite de lignes) : ${(truncated ?? []).map((f) => f.original_name).join(', ')} — scindez les exports puis ré-analysez.`,
      });
    }
    // 2) des colonnes « À vérifier » non tranchées = données qui n'entreront
    //    pas dans l'import sans que personne ne l'ait décidé.
    const { count: pendingMappings } = await admin
      .from('migration_field_mappings')
      .select('id', { count: 'exact', head: true })
      .eq('migration_id', migration.id)
      .eq('status', 'needs_review');
    if ((pendingMappings ?? 0) > 0) {
      return res.status(409).json({
        error: `${pendingMappings} colonne(s) « À vérifier » non tranchée(s) — confirmez ou rejetez chaque correspondance avant de demander l'approbation.`,
      });
    }

    const { error } = await admin
      .from('data_migrations')
      .update({ status: 'waiting_for_approval' })
      .eq('id', migration.id)
      .eq('status', 'test_review');
    if (error) throw error;
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'approval.request', actorId: auth.user.id, actorRole: 'platform_admin' });
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Demande d\'approbation impossible.', '[migration-admin]');
  }
});

// ── Import final — confirmation forte, approbation client obligatoire ──
router.post('/migration-admin/migrations/:id/final-import', validate(migrationFinalImportSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });

    if (migration.status !== 'ready_for_final_import') {
      return res.status(409).json({ error: 'La migration doit être « prête pour l\'import final » (approbation client requise).' });
    }
    const { data: org, error: orgErr } = await admin.from('orgs').select('name').eq('id', migration.org_id).single();
    if (orgErr || !org) throw orgErr ?? new Error('org introuvable');
    const confirm = (req.body as { confirm_org_name: string }).confirm_org_name.trim();
    if (confirm !== (org.name ?? '').trim()) {
      return res.status(400).json({ error: 'Le nom du workspace saisi ne correspond pas.' });
    }
    const { data: approval } = await admin
      .from('migration_approvals')
      .select('id, decision, report_version')
      .eq('migration_id', migration.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!approval || approval.decision !== 'approved') {
      return res.status(409).json({ error: 'Aucune approbation client valide.' });
    }
    const { count: blockingCount } = await admin
      .from('migration_issues')
      .select('id', { count: 'exact', head: true })
      .eq('migration_id', migration.id)
      .in('severity', ['blocking', 'error'])
      .is('resolved_at', null);
    if ((blockingCount ?? 0) > 0) {
      return res.status(409).json({ error: `${blockingCount} problème(s) bloquant(s) non résolu(s).` });
    }

    const { error: statusErr } = await admin
      .from('data_migrations')
      .update({ status: 'importing' })
      .eq('id', migration.id)
      .eq('status', 'ready_for_final_import');
    if (statusErr) throw statusErr;
    migration.status = 'importing';

    const { data: batch, error: batchErr } = await admin
      .from('migration_import_batches')
      .insert({ migration_id: migration.id, kind: 'final', status: 'running', started_by: auth.user.id })
      .select()
      .single();
    if (batchErr) throw batchErr;

    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'import.final.start',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      target: `batch:${batch.id}`,
      meta: { approval_id: approval.id, report_version: approval.report_version },
    });

    void (async () => {
      try {
        const report = await runFinalImport(admin, migration, batch.id, auth.user.id);
        await admin
          .from('migration_import_batches')
          .update({ status: 'completed', totals: report as unknown as Record<string, unknown>, finished_at: new Date().toISOString() })
          .eq('id', batch.id);
        await admin.from('data_migrations').update({ status: 'post_import_validation' }).eq('id', migration.id).eq('status', 'importing');
        migration.status = 'post_import_validation';

        const validation = await runPostImportValidation(admin, migration, batch.id);
        // Le fil d'activité ne doit pas être inondé par l'historique migré
        // (triggers AFTER INSERT de 20260747000000) — purge ciblée par lot.
        const noisePurged = await purgeImportActivityNoise(admin, migration, batch.id);
        if (noisePurged > 0) {
          await logMigrationAudit(admin, {
            migrationId: migration.id,
            action: 'import.noise_purged',
            actorRole: 'system',
            target: `batch:${batch.id}`,
            meta: { notifications_purged: noisePurged },
          });
        }
        const finalStatus: MigrationStatus =
          validation.outcome === 'passed' ? 'completed'
          : validation.outcome === 'passed_with_warnings' ? 'completed_with_warnings'
          : 'failed';
        await admin
          .from('data_migrations')
          .update({ status: finalStatus, ...(finalStatus.startsWith('completed') ? { completed_at: new Date().toISOString() } : {}) })
          .eq('id', migration.id)
          .eq('status', 'post_import_validation');

        await logMigrationAudit(admin, {
          migrationId: migration.id,
          action: 'import.final.done',
          actorRole: 'system',
          target: `batch:${batch.id}`,
          meta: { outcome: validation.outcome, totals: report.totals },
        });
        // Trace org-scopée dans le journal d'audit du workspace (append-only).
        const { error: aeErr } = await admin.from('audit_events').insert({
          org_id: migration.org_id,
          actor_id: auth.user.id,
          action: 'create',
          entity_type: 'data_migration',
          entity_id: migration.id,
          metadata: { source_crm: migration.source_crm, totals: report.totals, outcome: validation.outcome },
        });
        if (aeErr) console.error('[migration-admin] audit_events insert failed:', aeErr.message);
      } catch (err: any) {
        console.error('[migration-admin] final import failed:', err?.message || err);
        await admin.from('migration_import_batches').update({ status: 'failed', error: 'internal_error', finished_at: new Date().toISOString() }).eq('id', batch.id);
        await admin.from('data_migrations').update({ status: 'failed' }).eq('id', migration.id).in('status', ['importing', 'post_import_validation']);
      }
    })();

    return res.status(202).json({ ok: true, batch_id: batch.id });
  } catch (err: any) {
    return sendSafeError(res, err, 'Import final impossible.', '[migration-admin]');
  }
});

// ── Rollback du dernier lot final ───────────────────────────────────────
router.post('/migration-admin/migrations/:id/rollback', validate(migrationFinalImportSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    if (!['completed', 'completed_with_warnings', 'failed'].includes(migration.status)) {
      return res.status(409).json({ error: 'Le rollback n\'est possible qu\'après un import final.' });
    }
    const { data: org } = await admin.from('orgs').select('name').eq('id', migration.org_id).single();
    const confirm = (req.body as { confirm_org_name: string }).confirm_org_name.trim();
    if (confirm !== (org?.name ?? '').trim()) {
      return res.status(400).json({ error: 'Le nom du workspace saisi ne correspond pas.' });
    }
    const { data: batch } = await admin
      .from('migration_import_batches')
      .select('id, status')
      .eq('migration_id', migration.id)
      .eq('kind', 'final')
      .in('status', ['completed', 'failed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!batch) return res.status(404).json({ error: 'Aucun lot final à annuler.' });

    const result = await rollbackFinalBatch(admin, batch.id, auth.user.id);
    // Les soft-deletes du rollback re-déclenchent les triggers d'activité
    // (AFTER UPDATE, 20260747000000) — constaté à la répétition volumétrique :
    // 15 000 notifications recréées. Purge ciblée une seconde fois.
    const noisePurged = await purgeImportActivityNoise(admin, migration, batch.id);
    if (noisePurged > 0) {
      await logMigrationAudit(admin, {
        migrationId: migration.id,
        action: 'import.noise_purged',
        actorRole: 'system',
        target: `batch:${batch.id}`,
        meta: { notifications_purged: noisePurged, phase: 'rollback' },
      });
    }
    await admin.from('data_migrations').update({ status: 'rolled_back' }).eq('id', migration.id);
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'import.rollback',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      target: `batch:${batch.id}`,
      meta: result as unknown as Record<string, unknown>,
    });
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return sendSafeError(res, err, 'Rollback impossible.', '[migration-admin]');
  }
});

// ── Fermeture ───────────────────────────────────────────────────────────
router.post('/migration-admin/migrations/:id/close', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const { error: invErr } = await admin
      .from('migration_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('migration_id', migration.id)
      .is('revoked_at', null);
    if (invErr) throw invErr;
    const { error } = await admin.from('data_migrations').update({ closed_at: new Date().toISOString() }).eq('id', migration.id);
    if (error) throw error;
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'migration.close', actorId: auth.user.id, actorRole: 'platform_admin' });
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Fermeture impossible.', '[migration-admin]');
  }
});


// ── Boucle qualité : export des rejets + relance des lignes en erreur ──
router.get('/migration-admin/migrations/:id/rejects.csv', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });

    const { data: files } = await admin
      .from('migration_files')
      .select('id, original_name')
      .eq('migration_id', migration.id);
    const fileName = new Map((files ?? []).map((f: { id: string; original_name: string }) => [f.id, f.original_name]));

    const esc = (v: unknown) => {
      const str = String(v ?? '');
      // anti-injection de formule + guillemets CSV
      const safe = /^[=+\-@\t\r]/.test(str) && !/^-?\d/.test(str) ? `'${str}` : str;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const lines: string[] = ['fichier,ligne,entite,statut,erreur,donnees_source_json'];
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await admin
        .from('migration_staging_records')
        .select('file_id, row_number, entity_type, status, error, payload')
        .eq('migration_id', migration.id)
        .in('status', ['error', 'orphan'])
        .order('file_id')
        .order('row_number')
        .range(offset, offset + 999);
      if (error) throw error;
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        lines.push([
          esc(fileName.get(r.file_id) ?? r.file_id),
          esc(r.row_number),
          esc(r.entity_type),
          esc(r.status),
          esc(r.error ?? ''),
          esc(JSON.stringify(r.payload ?? {})),
        ].join(','));
      }
      if (rows.length < 1000) break;
    }
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'rejects.export',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      meta: { rows: lines.length - 1 },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rejets-migration-${migration.id.slice(0, 8)}.csv"`);
    return res.send(`\uFEFF${lines.join('\n')}`);
  } catch (err: any) {
    return sendSafeError(res, err, 'Export des rejets impossible.', '[migration-admin]');
  }
});

router.post('/migration-admin/migrations/:id/retry-errors', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    // Seules les lignes tombées à l'INSERT (import_failed:*) sont relançables
    // telles quelles ; les erreurs de valeurs exigent un fichier corrigé.
    const { data, error } = await admin
      .from('migration_staging_records')
      .update({ status: 'ready', error: null })
      .eq('migration_id', migration.id)
      .eq('status', 'error')
      .like('error', 'import_failed:%')
      .select('id');
    if (error) throw error;
    const count = (data ?? []).length;
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'staging.retry_errors',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      meta: { rows: count },
    });
    return res.json({ ok: true, reset: count });
  } catch (err: any) {
    return sendSafeError(res, err, 'Relance impossible.', '[migration-admin]');
  }
});

// ── Employés historiques : détection + correspondance vers des membres ──
router.get('/migration-admin/migrations/:id/staff', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });

    // En-têtes mappés vers vendeur/assigné par fichier — repli sur le payload
    // brut tant que la normalisation (1er dry-run) n'a pas tourné (banc round 9).
    const [colsRes, mapsRes] = await Promise.all([
      admin.from('migration_file_columns').select('id, header, file_id').eq('migration_id', migration.id),
      admin.from('migration_field_mappings').select('column_id, target_field').eq('migration_id', migration.id).in('target_field', ['salesperson', 'assigned_to']),
    ]);
    if (colsRes.error) throw colsRes.error;
    if (mapsRes.error) throw mapsRes.error;
    const colById2 = new Map((colsRes.data ?? []).map((c: any) => [c.id, c]));
    const staffHeadersByFile = new Map<string, string[]>();
    for (const m of (mapsRes.data ?? []) as any[]) {
      const col = colById2.get(m.column_id) as any;
      if (!col) continue;
      const arr = staffHeadersByFile.get(col.file_id) ?? [];
      arr.push(col.header);
      staffHeadersByFile.set(col.file_id, arr);
    }
    const counts = new Map<string, { label: string; count: number }>();
    for (let offset = 0; ; offset += 1000) {
      const { data: rows, error } = await admin
        .from('migration_staging_records')
        .select('entity_type, normalized, payload, file_id')
        .eq('migration_id', migration.id)
        .in('entity_type', ['job', 'visit'])
        .range(offset, offset + 999);
      if (error) throw error;
      if (!rows || rows.length === 0) break;
      for (const r of rows as { entity_type: string; normalized: Record<string, unknown> | null; payload: Record<string, unknown> | null; file_id: string }[]) {
        let raw = String((r.normalized ?? {})[r.entity_type === 'job' ? 'salesperson' : 'assigned_to'] ?? '').trim();
        if (!raw) {
          for (const header of staffHeadersByFile.get(r.file_id) ?? []) {
            const v = String((r.payload ?? {})[header] ?? '').trim();
            if (v) { raw = v; break; }
          }
        }
        if (!raw) continue;
        const key = raw.toLowerCase();
        const cur = counts.get(key) ?? { label: raw, count: 0 };
        cur.count += 1;
        counts.set(key, cur);
      }
      if (rows.length < 1000) break;
    }
    let mappings: { source_key: string; user_id: string | null }[] = [];
    const { data: existing, error: mapErr } = await admin
      .from('migration_staff_mappings')
      .select('source_key, user_id')
      .eq('migration_id', migration.id);
    if (mapErr) {
      if (/relation|schema cache|does not exist/i.test(mapErr.message)) {
        return res.status(503).json({ error: 'Table migration_staff_mappings absente — appliquez le SQL 20260826000000.', code: 'not_provisioned' });
      }
      throw mapErr;
    }
    mappings = existing ?? [];
    const byKey = new Map(mappings.map((m) => [m.source_key, m.user_id]));
    return res.json({
      staff: Array.from(counts.entries()).map(([key, v]) => ({ source_key: key, label: v.label, count: v.count, user_id: byKey.get(key) ?? null })),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Détection des employés impossible.', '[migration-admin]');
  }
});

router.post('/migration-admin/migrations/:id/staff-map', validate(migrationStaffMapSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const body = req.body as { mappings: { source: string; user_id: string | null }[] };
    const rows = body.mappings.map((m) => ({
      migration_id: migration.id,
      source_key: m.source.trim().toLowerCase(),
      source_label: m.source.trim(),
      user_id: m.user_id,
      created_by: auth.user.id,
    }));
    const { error } = await admin
      .from('migration_staff_mappings')
      .upsert(rows, { onConflict: 'migration_id,source_key' });
    if (error) {
      if (/relation|schema cache|does not exist/i.test(error.message)) {
        return res.status(503).json({ error: 'Table migration_staff_mappings absente — appliquez le SQL 20260826000000.', code: 'not_provisioned' });
      }
      throw error;
    }
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'staff.map',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      meta: { count: rows.length },
    });
    return res.json({ ok: true, saved: rows.length });
  } catch (err: any) {
    return sendSafeError(res, err, 'Enregistrement de la correspondance impossible.', '[migration-admin]');
  }
});

router.get('/migration-admin/migrations/:id/members', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const { data: members, error } = await admin
      .from('memberships')
      .select('user_id, role, full_name, status')
      .eq('org_id', migration.org_id);
    if (error) throw error;
    const active = (members ?? []).filter((m: any) => m.status === 'active' || m.status === null);
    const ids = active.map((m: any) => m.user_id);
    const { data: profiles } = ids.length
      ? await admin.from('profiles').select('id, full_name').in('id', ids)
      : { data: [] };
    const nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));
    return res.json(active.map((m: any) => ({
      user_id: m.user_id,
      role: m.role,
      name: nameById.get(m.user_id) || m.full_name || m.user_id.slice(0, 8),
    })));
  } catch (err: any) {
    return sendSafeError(res, err, 'Membres indisponibles.', '[migration-admin]');
  }
});

// ── Gabarits de correspondance réutilisables par CRM source ──
router.get('/migration-admin/templates', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    let query = admin.from('migration_mapping_templates').select('id, source_crm, name, created_at').order('created_at', { ascending: false }).limit(50);
    if (typeof req.query.source_crm === 'string' && req.query.source_crm) query = query.eq('source_crm', req.query.source_crm);
    const { data, error } = await query;
    if (error) {
      if (/relation|schema cache|does not exist/i.test(error.message)) {
        return res.status(503).json({ error: 'Table migration_mapping_templates absente — appliquez le SQL 20260826000000.', code: 'not_provisioned' });
      }
      throw error;
    }
    return res.json(data ?? []);
  } catch (err: any) {
    return sendSafeError(res, err, 'Gabarits indisponibles.', '[migration-admin]');
  }
});

router.post('/migration-admin/migrations/:id/save-template', validate(migrationTemplateSaveSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const [cols, maps, files] = await Promise.all([
      admin.from('migration_file_columns').select('id, header, file_id').eq('migration_id', migration.id),
      admin.from('migration_field_mappings').select('column_id, target_entity, target_field, confidence, status').eq('migration_id', migration.id),
      admin.from('migration_files').select('id, category_detected').eq('migration_id', migration.id),
    ]);
    if (cols.error) throw cols.error;
    if (maps.error) throw maps.error;
    if (files.error) throw files.error;
    const colById = new Map((cols.data ?? []).map((c: any) => [c.id, c]));
    const catByFile = new Map((files.data ?? []).map((f: any) => [f.id, f.category_detected]));
    // Indexé par CATÉGORIE de fichier : « Job # » d'un fichier jobs et « Job # »
    // d'un fichier quotes sont deux colonnes différentes (défaut attrapé par le
    // banc round 9 — un gabarit plat écrasait l'une par l'autre).
    const headersMap: Record<string, Record<string, string>> = {};
    for (const m of (maps.data ?? []) as any[]) {
      const usable = m.target_entity && m.target_field &&
        (m.status === 'confirmed' || m.status === 'corrected' || (m.status === 'suggested' && m.confidence >= 70));
      if (!usable) continue;
      const col = colById.get(m.column_id) as any;
      if (!col) continue;
      const category = catByFile.get(col.file_id);
      if (!category) continue;
      headersMap[category] = headersMap[category] ?? {};
      headersMap[category][normalizeHeader(col.header)] = m.target_field;
    }
    const name = (req.body as { name: string }).name.trim();
    const { data, error } = await admin
      .from('migration_mapping_templates')
      .upsert(
        { source_crm: migration.source_crm, name, headers_map: headersMap, created_by: auth.user.id },
        { onConflict: 'source_crm,name' },
      )
      .select('id')
      .single();
    if (error) {
      if (/relation|schema cache|does not exist/i.test(error.message)) {
        return res.status(503).json({ error: 'Table migration_mapping_templates absente — appliquez le SQL 20260826000000.', code: 'not_provisioned' });
      }
      throw error;
    }
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'template.save',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      meta: { template_id: data.id, headers: Object.values(headersMap).reduce((acc, m) => acc + Object.keys(m).length, 0) },
    });
    return res.status(201).json({ ok: true, template_id: data.id, headers: Object.values(headersMap).reduce((acc, m) => acc + Object.keys(m).length, 0) });
  } catch (err: any) {
    return sendSafeError(res, err, 'Sauvegarde du gabarit impossible.', '[migration-admin]');
  }
});

router.post('/migration-admin/migrations/:id/apply-template', validate(migrationTemplateApplySchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const { data: tpl, error: tplErr } = await admin
      .from('migration_mapping_templates')
      .select('id, headers_map')
      .eq('id', (req.body as { template_id: string }).template_id)
      .maybeSingle();
    if (tplErr) {
      if (/relation|schema cache|does not exist/i.test(tplErr.message)) {
        return res.status(503).json({ error: 'Table migration_mapping_templates absente — appliquez le SQL 20260826000000.', code: 'not_provisioned' });
      }
      throw tplErr;
    }
    if (!tpl) return res.status(404).json({ error: 'Gabarit introuvable.' });
    const headersMap = (tpl.headers_map ?? {}) as Record<string, Record<string, string>>;
    const [cols, maps, files] = await Promise.all([
      admin.from('migration_file_columns').select('id, header, file_id').eq('migration_id', migration.id),
      admin.from('migration_field_mappings').select('id, column_id, status').eq('migration_id', migration.id),
      admin.from('migration_files').select('id, category_detected').eq('migration_id', migration.id),
    ]);
    if (cols.error) throw cols.error;
    if (maps.error) throw maps.error;
    if (files.error) throw files.error;
    const colById = new Map((cols.data ?? []).map((c: any) => [c.id, c]));
    const catByFile = new Map((files.data ?? []).map((f: any) => [f.id, f.category_detected]));
    let applied = 0;
    for (const m of (maps.data ?? []) as any[]) {
      if (m.status !== 'suggested' && m.status !== 'needs_review') continue; // ne jamais écraser une décision humaine
      const col = colById.get(m.column_id) as any;
      if (!col) continue;
      const category = catByFile.get(col.file_id);
      const entity = entityForCategory(category ?? null);
      const field = category ? headersMap[category]?.[normalizeHeader(col.header)] : undefined;
      if (!entity || !field) continue;
      const { error } = await admin
        .from('migration_field_mappings')
        .update({
          target_entity: entity,
          target_field: field,
          status: 'confirmed',
          decided_by: auth.user.id,
          decided_role: 'template',
          decided_at: new Date().toISOString(),
        })
        .eq('id', m.id);
      if (error) console.error('[migration-admin] template apply row failed:', error.message);
      else applied += 1;
    }
    await logMigrationAudit(admin, {
      migrationId: migration.id,
      action: 'template.apply',
      actorId: auth.user.id,
      actorRole: 'platform_admin',
      meta: { template_id: tpl.id, applied },
    });
    return res.json({ ok: true, applied });
  } catch (err: any) {
    return sendSafeError(res, err, 'Application du gabarit impossible.', '[migration-admin]');
  }
});

// ── Messages et audit ───────────────────────────────────────────────────
router.post('/migration-admin/migrations/:id/messages', validate(migrationMessageSchema), async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const { data, error } = await admin
      .from('migration_messages')
      .insert({ migration_id: migration.id, author_id: auth.user.id, author_kind: 'admin', body: (req.body as { body: string }).body })
      .select()
      .single();
    if (error) throw error;
    await logMigrationAudit(admin, { migrationId: migration.id, action: 'message.send', actorId: auth.user.id, actorRole: 'platform_admin' });
    return res.status(201).json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Envoi du message impossible.', '[migration-admin]');
  }
});

router.get('/migration-admin/migrations/:id/audit', async (req, res) => {
  try {
    const auth = await requirePlatformAdmin(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const migration = await getMigration(admin, req.params.id);
    if (!migration) return res.status(404).json({ error: 'Migration introuvable.' });
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const PAGE_SIZE = 50;
    const { data, error, count } = await admin
      .from('migration_audit_logs')
      .select('*', { count: 'exact' })
      .eq('migration_id', migration.id)
      .order('created_at', { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (error) throw error;
    return res.json({ data: data ?? [], total: count ?? 0, page, pageSize: PAGE_SIZE });
  } catch (err: any) {
    return sendSafeError(res, err, 'Journal d\'audit indisponible.', '[migration-admin]');
  }
});

export default router;
