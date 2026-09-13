// POST /api/workspaces/create — formulaire de création de workspace.
//
// Un workspace = une compagnie = un company_group + son propre abonnement.
//   - mode 'onboarding' : complète l'org auto-provisionné après paiement
//     (remplace l'ancien assistant 3 étapes) et pose onboarding_done ;
//   - mode 'new' : un propriétaire crée une 2e compagnie → nouvel org dans un
//     NOUVEAU company_group ; le client bascule dessus puis va au /checkout.
// Serveur-autoritaire, idempotent en mode onboarding (safe au retry).

import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { listIndustries } from '../lib/industryPresets';
import { seedOrgComplete } from '../lib/seedOrgDefaults';
import { ensureAutomationPresets } from '../lib/automationPresetSeeder';
import { processInvites } from '../lib/onboarding-invites';
import {
  buildWorkspaceOrgPatch,
  buildWorkspaceSettingsUpsert,
  taxRegionFor,
  type WorkspaceInput,
} from '../lib/workspace-create';

const router = Router();

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalUrl = z.string().trim().max(500).nullable().optional().or(z.literal(''));

const workspaceSchema = z.object({
  mode: z.enum(['onboarding', 'new']),
  company: z.object({
    name: z.string().trim().min(1, 'Company name is required.').max(200),
    industry: z.string().refine((v) => listIndustries().includes(v), { message: 'Unsupported industry.' }),
    employee_count: z.enum(['1', '2-5', '6-15', '16-50', '50+']),
    logo_url: optionalUrl,
    language: z.enum(['fr', 'en']).optional(),
  }),
  profile: z.object({ full_name: optionalText(120) }).nullable().optional(),
  contact: z
    .object({
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
    })
    .nullable()
    .optional(),
  preferences: z
    .object({
      currency: z.enum(['CAD', 'USD']).nullable().optional(),
      timezone: optionalText(80),
      revenue_goal_cents: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
    })
    .nullable()
    .optional(),
  reviews: z
    .object({
      enabled: z.boolean().nullable().optional(),
      google_review_url: optionalUrl,
      facebook_review_url: optionalUrl,
    })
    .nullable()
    .optional(),
  invites: z
    .array(z.object({ email: z.string().trim().email(), role: z.enum(['admin', 'technician', 'sales_rep']) }))
    .max(5)
    .default([]),
});

router.post('/workspaces/create', validate(workspaceSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const userId = auth.user.id;
    const body = req.body as z.infer<typeof workspaceSchema>;
    const input: WorkspaceInput = {
      company: body.company,
      profile: body.profile ?? null,
      contact: body.contact
        ? { ...body.contact, email: body.contact.email || null }
        : null,
      preferences: body.preferences ?? null,
      reviews: body.reviews
        ? {
          enabled: body.reviews.enabled ?? null,
          google_review_url: body.reviews.google_review_url || null,
          facebook_review_url: body.reviews.facebook_review_url || null,
        }
        : null,
    };

    let orgId: string;

    if (body.mode === 'new') {
      // Seul un propriétaire de sa compagnie actuelle peut en ouvrir une autre.
      const { data: mem } = await admin
        .from('memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('org_id', auth.orgId)
        .maybeSingle();
      if (mem?.role !== 'owner') {
        return res.status(403).json({ error: 'Only a company owner can create a new workspace.' });
      }

      // NOUVEAU groupe : sans company_group_id explicite, le trigger DB
      // rattacherait l'org au groupe existant du même créateur (= un bureau
      // de plus, partageant le quota et l'abonnement). Ici on veut une
      // compagnie séparée avec son propre abonnement.
      const { data: newOrg, error: orgErr } = await admin
        .from('orgs')
        .insert({
          ...buildWorkspaceOrgPatch(input),
          created_by: userId,
          company_group_id: crypto.randomUUID(),
        })
        .select('id')
        .single();
      if (orgErr || !newOrg) {
        console.error('[workspaces/create] org insert:', orgErr?.message);
        return res.status(500).json({ error: 'Failed to create workspace.' });
      }
      orgId = newOrg.id;

      const { error: memErr } = await admin
        .from('memberships')
        .insert({ user_id: userId, org_id: orgId, role: 'owner', status: 'active' });
      if (memErr) {
        console.error('[workspaces/create] membership insert:', memErr.message);
        return res.status(500).json({ error: 'Workspace created but failed to attach owner.' });
      }
    } else {
      orgId = auth.orgId;
      const { error } = await admin.from('orgs').update(buildWorkspaceOrgPatch(input)).eq('id', orgId);
      if (error) console.warn('[workspaces/create] orgs update:', error.message);
    }

    // Profil (mode onboarding : nom complet demandé sur la 1re page).
    const fullName = (input.profile?.full_name || '').trim();
    if (fullName) {
      const { error } = await admin.from('profiles').upsert({ id: userId, full_name: fullName }, { onConflict: 'id' });
      if (error) console.warn('[workspaces/create] profile upsert:', error.message);
    }

    // company_settings : nom, industrie, coordonnées, préférences, avis.
    {
      const full = buildWorkspaceSettingsUpsert(input, orgId, userId);
      const { error } = await admin.from('company_settings').upsert(full, { onConflict: 'org_id' });
      if (error) {
        // Schéma en retard (colonne inconnue) : retomber sur le minimum vital.
        console.warn('[workspaces/create] company_settings full upsert failed, retrying minimal:', error.message);
        await admin
          .from('company_settings')
          .upsert({ org_id: orgId, created_by: userId, company_name: input.company.name.trim() }, { onConflict: 'org_id' });
      }
    }

    // Socle complet : catalogue métier, automatisations, taxes de la région.
    const taxRegion = taxRegionFor(input.contact?.address?.province, input.contact?.address?.country);
    const seeded = await seedOrgComplete(admin, orgId, { industry: input.company.industry, taxRegion });
    try {
      await ensureAutomationPresets(admin, orgId, { activateAll: true });
    } catch (e: any) {
      console.warn('[workspaces/create] ensureAutomationPresets:', e?.message);
    }

    const invitesSent = await processInvites(admin, orgId, userId, body.invites, '[workspaces/create]');

    if (body.mode === 'onboarding') {
      const { error } = await admin.from('profiles').update({ onboarding_done: true }).eq('id', userId);
      if (error) console.warn('[workspaces/create] onboarding_done:', error.message);
    }

    return res.json({
      ok: true,
      org_id: orgId,
      mode: body.mode,
      seeded,
      tax_region: taxRegion,
      invites_sent: invitesSent.length,
      // Mode 'new' : pas d'abonnement encore → le client bascule sur l'org
      // puis ouvre /checkout (un abonnement par workspace).
      next: body.mode === 'new' ? '/checkout' : '/day',
    });
  } catch (err: any) {
    console.error('[workspaces/create]', err?.message || err);
    return res.status(500).json({ error: 'Failed to create workspace.' });
  }
});

export default router;
