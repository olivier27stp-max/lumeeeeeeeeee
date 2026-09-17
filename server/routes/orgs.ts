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
      admin.from('orgs').select('id, name, created_at').in('id', officeIds),
      admin.from('company_settings').select('org_id, company_name, phone, street1, city, province').in('org_id', officeIds),
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
// Owners/admins actifs du bureau actif (sauf l'appelant) : candidats à un
// accès immédiat au nouveau bureau, depuis le formulaire de création.
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
      .in('role', ['owner', 'admin'])
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

    // Accès immédiat pour d'autres owners/admins du bureau actif.
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

export default router;
