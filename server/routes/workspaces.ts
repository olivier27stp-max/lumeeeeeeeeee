// POST /api/workspaces/create — formulaire de création de workspace.
//
// Un workspace = la compagnie de l'utilisateur (un seul par compte) ; ses
// bureaux dépendent du forfait. L'org est auto-provisionné au 1er login :
// cette route la complète après paiement (remplace l'ancien assistant 3
// étapes) et pose onboarding_done. Serveur-autoritaire, idempotent.

import { Router } from 'express';
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

    const orgId = auth.orgId;
    {
      const { error } = await admin.from('orgs').update(buildWorkspaceOrgPatch(input)).eq('id', orgId);
      if (error) console.warn('[workspaces/create] orgs update:', error.message);
    }

    // Profil : nom complet demandé sur la 1re page.
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

    {
      const { error } = await admin.from('profiles').update({ onboarding_done: true }).eq('id', userId);
      if (error) console.warn('[workspaces/create] onboarding_done:', error.message);
    }

    return res.json({
      ok: true,
      org_id: orgId,
      seeded,
      tax_region: taxRegion,
      invites_sent: invitesSent.length,
    });
  } catch (err: any) {
    console.error('[workspaces/create]', err?.message || err);
    return res.status(500).json({ error: 'Failed to create workspace.' });
  }
});

export default router;
