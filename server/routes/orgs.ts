import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient, companyOrgIds } from '../lib/supabase';
import { DEFAULT_OFFICE_QUOTA, OFFICE_QUOTA_KEY, resolveOfficeQuota } from '../lib/platformFeatures';
import { ensureAutomationPresets } from '../lib/automationPresetSeeder';
import { copyOfficeSettings, NO_INHERIT, type InheritOptions } from '../lib/office-inheritance';
import {
  buildCompanySettingsInsert,
  buildOrgInsert,
  filterGrantable,
} from '../lib/office-create';
import { decideAccessChange, OFFICE_ROLES, PROFIL_COPIE, type OfficeRole } from '../lib/office-access';
import { resolveInvitePermissions } from './invitations';
import { getDefaultScope } from '../../src/lib/permissions';
import { chiffresDuBureau, periode, totaliser } from '../lib/offices-overview';

const router = Router();

// ─── Validation ──────────────────────────────────────────────────

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const createOfficeSchema = z.object({
  name: z.string().trim().min(1, 'Office name is required.').max(120),
  phone: optionalText(40),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  website: optionalText(300),
  address: z
    .object({
      street1: optionalText(200),
      street2: optionalText(200),
      city: optionalText(120),
      province: optionalText(120),
      postal_code: optionalText(20),
      country: optionalText(60),
    })
    .nullable()
    .optional(),
  inherit: z
    .object({
      branding: z.boolean().default(false),
      taxes: z.boolean().default(false),
      email_templates: z.boolean().default(false),
      tags_sources: z.boolean().default(false),
    })
    .optional(),
  grant_user_ids: z.array(z.string().uuid()).max(50).default([]),
});

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Capacité de bureaux de la compagnie : quota posé par la plateforme
 * (org_features 'office_quota', n'importe quel bureau du groupe), 1 par
 * défaut. Ne dépend plus du forfait depuis 2026-09-17.
 */
export async function getOfficeCapacity(admin: ReturnType<typeof getServiceClient>, officeIds: string[]): Promise<number> {
  // Depuis 2026-09-17 les bureaux ne dépendent plus du forfait ni d'un achat
  // du tenant : 1 bureau par workspace, davantage seulement si la plateforme
  // (Creator Space → Features) a posé un quota. Le forfait et l'abonnement ne
  // sont plus consultés ici.
  if (officeIds.length === 0) return DEFAULT_OFFICE_QUOTA;
  const { data: rows } = await admin
    .from('org_features')
    .select('feature, enabled, metadata')
    .in('org_id', officeIds)
    .eq('feature', OFFICE_QUOTA_KEY);
  return resolveOfficeQuota(rows);
}

async function callerRole(admin: ReturnType<typeof getServiceClient>, userId: string, orgId: string): Promise<string | null> {
  const { data } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle();
  return data?.role ?? null;
}

// ─── GET /orgs/offices/overview ─────────────────────────────────
// Vue d'ensemble d'un propriétaire : les chiffres de chacun de SES bureaux
// (propriétaire actif, même entreprise que le bureau actif) et leur total.
// Chaque bureau est lu avec l'identité de l'appelant et l'en-tête de ce
// bureau : mêmes fonctions et mêmes droits que la page Rapports du bureau.
router.get('/orgs/offices/overview', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    if ((await callerRole(admin, auth.user.id, auth.orgId)) !== 'owner') {
      return res.status(403).json({ error: 'Réservé aux propriétaires.' });
    }
    const { from, to } = periode(req.query.from, req.query.to);

    const { data: actif } = await admin.from('orgs').select('company_group_id').eq('id', auth.orgId).maybeSingle();
    const { data: adhesions, error: eAdh } = await admin
      .from('memberships')
      .select('org_id, orgs!inner(id, name, created_at, deleted_at, archived_at, company_group_id)')
      .eq('user_id', auth.user.id)
      .eq('role', 'owner')
      .eq('status', 'active');
    if (eAdh) throw eAdh;
    const bureaux = (adhesions || [])
      .map((a: any) => a.orgs)
      .filter((o: any) => o && !o.deleted_at && !o.archived_at && (o.id === auth.orgId || (actif?.company_group_id && o.company_group_id === actif.company_group_id)))
      .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    const { data: reglages } = await admin.from('company_settings').select('org_id, company_name').in('org_id', bureaux.map((b: any) => b.id));
    const nom = new Map((reglages || []).filter((r: any) => r.company_name).map((r: any) => [String(r.org_id), String(r.company_name)]));

    const authorization = req.header('authorization') as string;
    const lignes = await Promise.all(bureaux.map(async (b: any) => ({
      org_id: String(b.id),
      name: nom.get(String(b.id)) || String(b.name || ''),
      chiffres: await chiffresDuBureau(authorization, String(b.id), from, to),
    })));
    return res.json({ from, to, offices: lignes, totals: totaliser(lignes.map((l) => l.chiffres)) });
  } catch (err: any) {
    console.error('[orgs/offices/overview]', err?.message);
    return res.status(500).json({ error: 'Impossible de charger la vue d’ensemble des bureaux.' });
  }
});

// ─── GET /orgs/offices ───────────────────────────────────────────
// Tous les bureaux de la compagnie du bureau actif (page Réglages → Bureaux).
// Owner/admin seulement. Résolu côté serveur : un admin n'est membre que de
// son bureau et ne verrait pas les autres via la RLS.
router.get('/orgs/offices', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const role = await callerRole(admin, auth.user.id, auth.orgId);
    if (role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Only owners and admins can list offices.' });
    }

    const officeIds = await companyOrgIds(admin, auth.orgId);
    const [orgsRes, settingsRes, membersRes, subsRes, myMemRes] = await Promise.all([
      admin.from('orgs').select('id, name, created_at, archived_at').in('id', officeIds),
      admin.from('company_settings').select('org_id, company_name, phone, street1, city, province, logo_url, brand_color, suit_marque_entreprise').in('org_id', officeIds),
      admin.from('memberships').select('org_id').in('org_id', officeIds).eq('status', 'active'),
      admin.from('subscriptions').select('org_id').in('org_id', officeIds).in('status', ['active', 'trialing']),
      admin.from('memberships').select('org_id').eq('user_id', auth.user.id).in('org_id', officeIds).eq('status', 'active'),
    ]);

    const settingsByOrg = new Map<string, any>();
    for (const s of settingsRes.data || []) settingsByOrg.set(String(s.org_id), s);
    const memberCount = new Map<string, number>();
    for (const m of membersRes.data || []) {
      const k = String(m.org_id);
      memberCount.set(k, (memberCount.get(k) || 0) + 1);
    }
    const primaryIds = new Set((subsRes.data || []).map((s: any) => String(s.org_id)));
    const myOrgIds = new Set((myMemRes.data || []).map((m: any) => String(m.org_id)));

    const offices = (orgsRes.data || [])
      .map((o: any) => {
        const s = settingsByOrg.get(String(o.id)) || {};
        return {
          id: o.id,
          name: s.company_name || o.name || '',
          created_at: o.created_at,
          phone: s.phone || '',
          street1: s.street1 || '',
          city: s.city || '',
          province: s.province || '',
          member_count: memberCount.get(String(o.id)) || 0,
          is_primary: primaryIds.has(String(o.id)),
          is_member: myOrgIds.has(String(o.id)),
          is_current: String(o.id) === auth.orgId,
          archived: !!o.archived_at,
          logo_url: s.logo_url || null,
          brand_color: s.brand_color || null,
          suit_marque_entreprise: s.suit_marque_entreprise === true,
        };
      })
      .sort((a: any, b: any) => {
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        return String(a.created_at).localeCompare(String(b.created_at));
      });

    const capacity = await getOfficeCapacity(admin, officeIds);
    return res.json({
      offices,
      capacity,
      used: Math.max(1, officeIds.length),
      can_create: role === 'owner' && officeIds.length < capacity,
      caller_role: role,
    });
  } catch (err: any) {
    console.error('[orgs/offices]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── GET /orgs/offices/grantable-members ─────────────────────────
// Admins actifs du bureau actif : candidats à un accès immédiat au nouveau
// bureau, depuis le formulaire de création. Les propriétaires n'y figurent
// plus : ils reçoivent tous les bureaux du groupe automatiquement (trigger
// propager_proprietaires_bureaux, migration 20260927160000).
router.get('/orgs/offices/grantable-members', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const role = await callerRole(admin, auth.user.id, auth.orgId);
    if (role !== 'owner') {
      return res.status(403).json({ error: 'Only the company owner can create an office.' });
    }

    const { data: rows } = await admin
      .from('memberships')
      .select('user_id, role, full_name, avatar_url')
      .eq('org_id', auth.orgId)
      .eq('status', 'active')
      .eq('role', 'admin')
      .neq('user_id', auth.user.id);

    const members = await Promise.all(
      (rows || []).map(async (m: any) => {
        let email = '';
        try {
          const { data } = await admin.auth.admin.getUserById(m.user_id);
          email = data?.user?.email || '';
        } catch { /* non-fatal */ }
        return {
          user_id: m.user_id,
          role: m.role,
          full_name: m.full_name || '',
          avatar_url: m.avatar_url || null,
          email,
        };
      }),
    );

    return res.json({ members });
  } catch (err: any) {
    console.error('[orgs/offices/grantable-members]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── POST /orgs/create-office ────────────────────────────────────
// Crée un nouvel office (= org) dans la même compagnie que l'org courant.
// Réservé au propriétaire. Le créateur devient owner du nouvel office.
// Bloqué quand la compagnie a déjà atteint son quota de bureaux (1 par défaut,
// relevé uniquement par la plateforme depuis le Creator Space).
// Optionnel : coordonnées, héritage de réglages du bureau actif, accès
// immédiat pour d'autres owners/admins du bureau actif.
router.post('/orgs/create-office', validate(createOfficeSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();

    // Seul le propriétaire de la compagnie peut créer un office.
    const role = await callerRole(admin, auth.user.id, auth.orgId);
    if (role !== 'owner') {
      return res.status(403).json({ error: 'Only the company owner can create an office.' });
    }

    const body = req.body as z.infer<typeof createOfficeSchema>;
    const inherit: InheritOptions = { ...NO_INHERIT, ...(body.inherit || {}) };

    // ── Limite de bureaux (miroir du gate de sièges d'invitations.ts) ──
    // Compagnie = les orgs du company_group du bureau actif.
    const officeIds = await companyOrgIds(admin, auth.orgId);
    const used = Math.max(1, officeIds.length);
    const capacity = await getOfficeCapacity(admin, officeIds);

    if (used >= capacity) {
      return res.status(403).json({
        error: `Office limit reached (${capacity} for this workspace). Contact Lume support to add an office.`,
        code: 'office_limit_reached',
        capacity,
        used,
      });
    }

    // Hérite explicitement du groupe du bureau actif (le trigger DB le ferait
    // par created_by, mais passer le groupe couvre le cas d'un org dont le
    // créateur n'est pas l'owner actuel). NOTE : orgs n'a pas de owner_id —
    // le propriétaire effectif est created_by + memberships.role='owner'.
    const { data: currentOrg } = await admin
      .from('orgs')
      .select('company_group_id')
      .eq('id', auth.orgId)
      .maybeSingle();

    const input = {
      name: body.name,
      phone: body.phone,
      email: body.email || null,
      website: body.website,
      address: body.address,
    };

    const { data: newOrg, error: orgError } = await admin
      .from('orgs')
      .insert(buildOrgInsert(input, auth.user.id, currentOrg?.company_group_id))
      .select('id, name, company_group_id')
      .single();

    if (orgError || !newOrg) {
      console.error('[orgs/create-office] org insert error:', orgError?.message);
      return res.status(500).json({ error: 'Failed to create office.' });
    }

    // Le créateur devient owner du nouvel office.
    const { error: memError } = await admin
      .from('memberships')
      .insert({
        user_id: auth.user.id,
        org_id: newOrg.id,
        role: 'owner',
        status: 'active',
      });

    if (memError) {
      console.error('[orgs/create-office] membership insert error:', memError.message);
      return res.status(500).json({ error: 'Office created but failed to attach owner.' });
    }

    // Seed company_settings (nom + coordonnées) pour que le bureau s'affiche
    // partout (switcher, emails d'invitation, documents) — sinon « sans nom ».
    {
      const full = buildCompanySettingsInsert(input, newOrg.id, auth.user.id);
      const { error: csErr } = await admin.from('company_settings').insert(full);
      if (csErr) {
        // Schéma en retard (colonne inconnue) : on retombe sur le minimum
        // vital plutôt que de laisser un bureau sans nom.
        console.warn('[orgs/create-office] company_settings full insert failed, retrying minimal:', csErr.message);
        await admin
          .from('company_settings')
          .insert({ org_id: newOrg.id, created_by: auth.user.id, company_name: newOrg.name });
      }
    }

    // Filet de sécurité : garantit les 34 presets d'automatisation canoniques
    // même si la fonction DB de seed a divergé (déjà arrivé en prod).
    try {
      await ensureAutomationPresets(admin, newOrg.id, { activateAll: true });
    } catch (seedErr: any) {
      console.warn('[orgs/create-office] ensureAutomationPresets:', seedErr?.message);
    }

    // Héritage des réglages cochés depuis le bureau actif (best-effort).
    let inherited = null;
    if (inherit.branding || inherit.taxes || inherit.email_templates || inherit.tags_sources) {
      inherited = await copyOfficeSettings(admin, auth.orgId, newOrg.id, auth.user.id, inherit);
      for (const w of inherited.warnings) console.warn('[orgs/create-office] inherit:', w);
    }

    // Accès immédiat pour des admins du bureau actif (les autres propriétaires
    // ont déjà été ajoutés par le trigger à l'insertion du créateur).
    let granted: string[] = [];
    if (body.grant_user_ids.length > 0) {
      const { data: sourceMembers } = await admin
        .from('memberships')
        .select('user_id, role, status')
        .eq('org_id', auth.orgId)
        .in('user_id', body.grant_user_ids);
      const rows = filterGrantable(body.grant_user_ids, sourceMembers || [], auth.user.id);
      if (rows.length > 0) {
        const { error: gErr } = await admin
          .from('memberships')
          .insert(rows.map((r) => ({ ...r, org_id: newOrg.id, status: 'active' })));
        if (gErr) console.warn('[orgs/create-office] grant memberships:', gErr.message);
        else granted = rows.map((r) => r.user_id);
      }
    }

    return res.json({ office: newOrg, inherited, granted });
  } catch (err: any) {
    console.error('[orgs/create-office]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── Accès aux bureaux (Réglages → Bureaux → Accès) ──────────────
// Grille personnes × bureaux. Réservé au propriétaire : il est membre de
// tous les bureaux (trigger propager_proprietaires_bureaux), un admin non.

const officeAccessSchema = z.object({
  user_id: z.string().uuid(),
  org_id: z.string().uuid(),
  role: z.enum(OFFICE_ROLES).nullable(),
});

router.get('/orgs/offices/access', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    if ((await callerRole(admin, auth.user.id, auth.orgId)) !== 'owner') {
      return res.status(403).json({ error: 'Only owners can manage office access.' });
    }

    const officeIds = await companyOrgIds(admin, auth.orgId);
    const [orgsRes, settingsRes, memRes] = await Promise.all([
      admin.from('orgs').select('id, name, created_at, deleted_at').in('id', officeIds),
      admin.from('company_settings').select('org_id, company_name').in('org_id', officeIds),
      admin
        .from('memberships')
        .select('user_id, org_id, role, status, full_name, avatar_url, created_at')
        .in('org_id', officeIds),
    ]);
    if (memRes.error) throw memRes.error;

    const nomParOrg = new Map<string, string>();
    for (const s of settingsRes.data || []) if (s.company_name) nomParOrg.set(String(s.org_id), s.company_name);
    const offices = (orgsRes.data || [])
      .filter((o: any) => !o.deleted_at)
      .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((o: any) => ({ id: o.id, name: nomParOrg.get(String(o.id)) || o.name || '', is_current: o.id === auth.orgId }));

    type Personne = {
      user_id: string; full_name: string; avatar_url: string | null; email: string;
      is_owner: boolean; access: Record<string, { role: string; status: string }>;
    };
    const personnes = new Map<string, Personne>();
    for (const m of memRes.data || []) {
      const p: Personne = personnes.get(m.user_id) || {
        user_id: m.user_id, full_name: '', avatar_url: null, email: '', is_owner: false, access: {},
      };
      const status = m.status || 'active';
      p.access[m.org_id] = { role: m.role, status };
      if (!p.full_name && m.full_name) p.full_name = m.full_name;
      if (!p.avatar_url && m.avatar_url) p.avatar_url = m.avatar_url;
      if (m.role === 'owner' && status === 'active') p.is_owner = true;
      personnes.set(m.user_id, p);
    }
    // Seules les personnes encore actives quelque part dans l'entreprise.
    const people = [...personnes.values()].filter((p) => Object.values(p.access).some((a) => a.status === 'active'));
    await Promise.all(people.map(async (p) => {
      try {
        const { data } = await admin.auth.admin.getUserById(p.user_id);
        p.email = data?.user?.email || '';
        if (!p.full_name) p.full_name = (data?.user?.user_metadata as any)?.full_name || '';
      } catch { /* non fatal : la ligne s'affiche avec son nom */ }
    }));
    people.sort((a, b) =>
      Number(b.is_owner) - Number(a.is_owner) || (a.full_name || a.email).localeCompare(b.full_name || b.email, 'fr'));

    return res.json({ offices, people, caller_id: auth.user.id });
  } catch (err: any) {
    console.error('[orgs/offices/access]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

router.put('/orgs/offices/access', validate(officeAccessSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    if ((await callerRole(admin, auth.user.id, auth.orgId)) !== 'owner') {
      return res.status(403).json({ error: 'Only owners can manage office access.' });
    }

    const body = req.body as z.infer<typeof officeAccessSchema>;
    const officeIds = await companyOrgIds(admin, auth.orgId);
    const { data: rows, error: rowsErr } = await admin
      .from('memberships')
      .select('user_id, org_id, role, status, created_at')
      .eq('user_id', body.user_id)
      .in('org_id', officeIds);
    if (rowsErr) throw rowsErr;

    const decision = decideAccessChange({
      callerId: auth.user.id,
      targetUserId: body.user_id,
      targetOrgId: body.org_id,
      groupOrgIds: officeIds,
      rows: rows || [],
      role: body.role,
    });

    if (decision.kind === 'error') {
      return res.status(decision.status).json({ error: decision.error, code: decision.code });
    }
    if (decision.kind === 'noop') return res.json({ ok: true, changed: false });

    if (decision.kind === 'delete') {
      // Suppression de la ligne, pas suspension : la RLS ne regarde pas le
      // statut, seule l'absence de ligne coupe réellement l'accès. Jobs,
      // ventes et historique de la personne restent dans le bureau.
      const { error } = await admin.from('memberships').delete()
        .eq('user_id', body.user_id).eq('org_id', body.org_id);
      if (error) throw error;
      return res.json({ ok: true, changed: true });
    }

    const role: OfficeRole = decision.role;
    const permissions = await resolveInvitePermissions(admin, body.org_id, role, null);

    if (decision.kind === 'update') {
      const { error } = await admin.from('memberships')
        .update({ role, scope: getDefaultScope(role), permissions, permissions_custom: false })
        .eq('user_id', body.user_id).eq('org_id', body.org_id);
      if (error) throw error;
      return res.json({ ok: true, changed: true });
    }

    // insert : même profil (nom, paie, horaire) que le bureau d'origine.
    const { data: source } = await admin.from('memberships')
      .select(PROFIL_COPIE.join(', '))
      .eq('user_id', body.user_id).eq('org_id', decision.source.org_id)
      .maybeSingle();
    const profil: Record<string, unknown> = {};
    for (const col of PROFIL_COPIE) {
      const v = (source as Record<string, unknown> | null)?.[col];
      if (v !== undefined && v !== null) profil[col] = v;
    }
    const { error } = await admin.from('memberships').insert({
      ...profil,
      user_id: body.user_id,
      org_id: body.org_id,
      role,
      scope: getDefaultScope(role),
      permissions,
      status: 'active',
    });
    if (error) throw error;
    return res.json({ ok: true, changed: true });
  } catch (err: any) {
    console.error('[orgs/offices/access PUT]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
