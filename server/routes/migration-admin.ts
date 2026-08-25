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
} from '../lib/validation';
import { platformAdminIds, getBaseUrl } from '../lib/config';
import { assertTransition, canTransition, InvalidTransitionError } from '../lib/migration/state-machine';
import { generateInviteToken, expiryFromNow } from '../lib/migration/tokens';
import { logMigrationAudit, touchMigrationActivity } from '../lib/migration/audit';
import { analyzeMigrationFile, prepareStaging, MIGRATION_BUCKET } from '../lib/migration/pipeline';
import { findDuplicatesForEntity, } from '../lib/migration/duplicates';
import { runDryRun, runFinalImport, rollbackFinalBatch, runPostImportValidation } from '../lib/migration/importer';
import { getCrmConfig } from '../lib/migration/instructions';
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
        const entities: TargetEntity[] = ['client', 'property', 'job', 'invoice'];
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
