/* /api/onboarding/* — Server-authoritative onboarding completion.
   Handles the rebuilt 3-step wizard payload: profile, business,
   team invites. Idempotent — safe to retry. */

import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { listIndustries, seedOrgFromIndustry } from '../lib/industryPresets';
import { getBaseUrl } from '../lib/config';

const router = Router();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const onboardingSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  language: z.enum(['fr', 'en']).default('fr'),
  photo_url: z.string().trim().url().nullable().optional(),
  company_name: z.string().trim().min(1).max(200),
  industry: z.string().refine((v) => listIndustries().includes(v), {
    message: 'Unsupported industry.',
  }),
  employee_count: z.enum(['1', '2-5', '6-15', '16-50', '50+']),
  address: z.string().trim().max(500).nullable().optional(),
  logo_url: z.string().trim().url().nullable().optional(),
  invites: z
    .array(
      z.object({
        email: z.string().trim().email(),
        role: z.enum(['admin', 'technician', 'sales_rep']),
      }),
    )
    .max(5)
    .default([]),
});

router.post('/onboarding/complete', validate(onboardingSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const admin = getServiceClient();
    const orgId = auth.orgId;
    const userId = auth.user.id;
    const body = req.body as z.infer<typeof onboardingSchema>;

    // 1. Update profile
    {
      const updates: Record<string, any> = { id: userId, full_name: body.full_name };
      if (body.photo_url) updates.avatar_url = body.photo_url;
      const { error } = await admin.from('profiles').upsert(updates, { onConflict: 'id' });
      if (error) console.warn('[onboarding/complete] profile upsert:', error.message);
    }

    // 2. Update org core fields
    {
      const updates: Record<string, any> = {
        name: body.company_name,
        industry: body.industry,
        employee_count: body.employee_count,
      };
      if (body.address !== undefined) updates.address = body.address || null;
      if (body.logo_url !== undefined) updates.logo_url = body.logo_url || null;
      const { error } = await admin.from('orgs').update(updates).eq('id', orgId);
      if (error) console.warn('[onboarding/complete] orgs update:', error.message);
    }

    // 3. Upsert company_settings (mirror company_name + logo for invoice/quote rendering)
    {
      const updates: Record<string, any> = {
        org_id: orgId,
        company_name: body.company_name,
      };
      if (body.logo_url) updates.logo_url = body.logo_url;
      const { error } = await admin
        .from('company_settings')
        .upsert(updates, { onConflict: 'org_id' });
      if (error) console.warn('[onboarding/complete] company_settings upsert:', error.message);
    }

    // 4. Seed industry presets (best-effort)
    try {
      await seedOrgFromIndustry(admin, orgId, body.industry);
    } catch (err: any) {
      console.warn('[onboarding/complete] seedOrgFromIndustry:', err?.message);
    }

    // 5. Process team invites — insert pending invitation rows + send Supabase magic-link.
    //    The full invitations flow lives in /api/invitations/send; we duplicate the
    //    core insert here to avoid an internal HTTP roundtrip during signup.
    const sentInvites: Array<{ email: string; role: string }> = [];
    for (const invite of body.invites) {
      try {
        const email = invite.email.toLowerCase();
        // Skip if a pending invite already exists
        const { data: existing } = await admin
          .from('invitations')
          .select('id')
          .eq('org_id', orgId)
          .eq('email', email)
          .eq('status', 'pending')
          .maybeSingle();
        if (existing) continue;

        const token = crypto.randomBytes(32).toString('hex');
        const token_hash = hashToken(token);
        const { error: insErr } = await admin.from('invitations').insert({
          org_id: orgId,
          email,
          role: invite.role,
          token: null,
          token_hash,
          invited_by: userId,
          status: 'pending',
          expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        });
        if (insErr) {
          console.warn('[onboarding/complete] invitation insert failed:', insErr.message);
          continue;
        }

        // Best-effort: fire Supabase invite email so the recipient can claim the account.
        try {
          const redirectTo = `${getBaseUrl()}/invite/${token}`;
          await (admin.auth.admin as any).inviteUserByEmail(email, {
            data: { invited_to_org: orgId, role: invite.role },
            redirectTo,
          });
        } catch (mailErr: any) {
          console.warn('[onboarding/complete] inviteUserByEmail failed:', mailErr?.message);
        }
        sentInvites.push({ email, role: invite.role });
      } catch (err: any) {
        console.warn('[onboarding/complete] invite loop error:', err?.message);
      }
    }

    // 6. Mark onboarding done
    {
      const { error } = await admin
        .from('profiles')
        .update({ onboarding_done: true })
        .eq('id', userId);
      if (error) console.warn('[onboarding/complete] onboarding_done update:', error.message);
    }

    return res.json({
      ok: true,
      redirect: '/day',
      invites_sent: sentInvites.length,
    });
  } catch (err: any) {
    console.error('[onboarding/complete]', err?.message || err);
    return res.status(500).json({ error: 'Failed to complete onboarding.' });
  }
});

// ── GET /api/me/setup-status ── powers the Setup Checklist widget ──
router.get('/me/setup-status', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const orgId = auth.orgId;

    const [clientsRes, quotesRes, paymentsSettings, twilioRow, membersRes, csRes] =
      await Promise.all([
        admin
          .from('clients')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .is('deleted_at', null),
        admin
          .from('quotes')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .is('deleted_at', null),
        admin
          .from('payment_provider_settings')
          .select('stripe_enabled, stripe_keys_present')
          .eq('org_id', orgId)
          .maybeSingle(),
        admin
          .from('provisioning_events')
          .select('twilio_number, status')
          .eq('org_id', orgId)
          .eq('status', 'success')
          .limit(1)
          .maybeSingle(),
        admin
          .from('memberships')
          .select('user_id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('status', 'active'),
        admin
          .from('company_settings')
          .select('setup_completed, setup_dismissed')
          .eq('org_id', orgId)
          .maybeSingle(),
      ]);

    return res.json({
      clients_count: clientsRes.count || 0,
      quotes_count: quotesRes.count || 0,
      stripe_connected: !!(paymentsSettings.data?.stripe_enabled && paymentsSettings.data?.stripe_keys_present),
      twilio_provisioned: !!twilioRow.data?.twilio_number,
      members_count: membersRes.count || 0,
      setup_completed: !!csRes.data?.setup_completed,
    });
  } catch (err: any) {
    console.error('[me/setup-status]', err?.message);
    return res.status(500).json({ error: 'Failed to load setup status.' });
  }
});

// ── POST /api/me/setup-completed ── mark setup_completed=true ──
router.post('/me/setup-completed', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    await admin
      .from('company_settings')
      .upsert(
        { org_id: auth.orgId, setup_completed: true },
        { onConflict: 'org_id' },
      );
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[me/setup-completed]', err?.message);
    return res.status(500).json({ error: 'Failed to mark setup complete.' });
  }
});

export default router;
