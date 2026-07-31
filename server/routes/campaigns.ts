/**
 * Email marketing campaigns — bulk send to client segments.
 *
 * V1 constraints (documented):
 *   - Max 500 recipients per campaign per send (sync send loop).
 *     For larger lists, recommend Mailchimp/Resend/SES upgrade — use the
 *     /api/campaigns/export/mailchimp.csv endpoint to export to Mailchimp.
 *   - Batches of 50 with 1s sleep between batches (basic rate-limit).
 *   - Unsubscribe link MANDATORY (appended automatically to every email).
 */

import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { getBaseUrl } from '../lib/config';
import { sendSafeError } from '../lib/error-handler';
import { logDataExport } from '../lib/data-export-log';

const router = Router();

const MAX_RECIPIENTS_PER_CAMPAIGN = 500;
const BATCH_SIZE = 50;
const BATCH_SLEEP_MS = 1000;

// ── Helpers ──────────────────────────────────────────────

function unsubscribeSecret(): string {
  return process.env.UNSUBSCRIBE_SIGNING_SECRET
    || process.env.CRON_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || 'fallback-dev-secret-DO-NOT-USE-IN-PROD';
}

export function signUnsubscribeToken(email: string, orgId: string): string {
  const payload = `${orgId}:${email.toLowerCase().trim()}`;
  const sig = crypto.createHmac('sha256', unsubscribeSecret()).update(payload).digest('hex').slice(0, 32);
  return Buffer.from(`${payload}:${sig}`, 'utf8').toString('base64url');
}

export function verifyUnsubscribeToken(token: string): { email: string; orgId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [orgId, email, sig] = parts;
    const expected = crypto.createHmac('sha256', unsubscribeSecret()).update(`${orgId}:${email}`).digest('hex').slice(0, 32);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return { email, orgId };
  } catch {
    return null;
  }
}

function appendUnsubscribeLink(html: string, email: string, orgId: string, lang: 'en' | 'fr' = 'en'): string {
  const url = `${getBaseUrl()}/unsubscribe?token=${signUnsubscribeToken(email, orgId)}`;
  const label = lang === 'fr' ? 'Se désabonner' : 'Unsubscribe';
  const footer = `
    <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb"/>
    <p style="font-size:12px;color:#6b7280;margin-top:12px;text-align:center;font-family:system-ui,sans-serif">
      <a href="${url}" style="color:#6b7280;text-decoration:underline">${label}</a>
    </p>`;
  return html + footer;
}

function appendUnsubscribeText(text: string | null | undefined, email: string, orgId: string): string {
  const url = `${getBaseUrl()}/unsubscribe?token=${signUnsubscribeToken(email, orgId)}`;
  return `${text || ''}\n\n---\nUnsubscribe: ${url}`;
}

const escape = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// ── Resolve recipients for a segment ──────────────────────

async function resolveRecipients(
  admin: ReturnType<typeof getServiceClient>,
  orgId: string,
  segment: string,
  customQuery: any,
): Promise<Array<{ id: string; email: string; first_name?: string | null; last_name?: string | null }>> {
  let query = (admin as any)
    .from('clients_active')
    .select('id, email, first_name, last_name, email_opt_out_at, email_consent_at')
    .eq('org_id', orgId)
    .not('email', 'is', null);

  if (segment === 'recent_clients') {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', ninetyDaysAgo);
  } else if (segment === 'overdue_clients') {
    // Clients with at least one overdue invoice — fetch separately
    const { data: overdueClients } = await (admin as any)
      .from('invoices')
      .select('client_id')
      .eq('org_id', orgId)
      .lt('due_date', new Date().toISOString())
      .in('status', ['sent', 'partial', 'overdue']);
    const ids = Array.from(new Set((overdueClients || []).map((r: any) => r.client_id).filter(Boolean)));
    if (ids.length === 0) return [];
    query = query.in('id', ids);
  } else if (segment === 'custom_query' && customQuery && typeof customQuery === 'object') {
    // V1: only support a simple { ids: string[] } shape
    if (Array.isArray(customQuery.ids) && customQuery.ids.length > 0) {
      query = query.in('id', customQuery.ids);
    }
  }
  // else: 'all_clients' — no extra filter

  const { data, error } = await query.limit(MAX_RECIPIENTS_PER_CAMPAIGN + 50);
  if (error) throw error;

  // Filter out opt-outs (defensive) + lookup global email_opt_outs
  const candidates = (data || []).filter((c: any) => c.email && !c.email_opt_out_at);
  if (candidates.length === 0) return [];

  const emails = candidates.map((c: any) => String(c.email).toLowerCase().trim());
  const { data: optOuts } = await (admin as any)
    .from('email_opt_outs')
    .select('email')
    .in('email', emails)
    .or(`org_id.eq.${orgId},org_id.is.null`);
  const optedOut = new Set((optOuts || []).map((r: any) => r.email));

  return candidates
    .filter((c: any) => !optedOut.has(String(c.email).toLowerCase().trim()))
    .map((c: any) => ({
      id: c.id,
      email: String(c.email).toLowerCase().trim(),
      first_name: c.first_name,
      last_name: c.last_name,
    }));
}

// ── Schemas ───────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(1).max(300),
  body_html: z.string().min(1).max(100_000),
  body_text: z.string().max(100_000).optional().nullable(),
  segment: z.enum(['all_clients', 'recent_clients', 'overdue_clients', 'custom_query']).default('all_clients'),
  custom_query: z.any().optional().nullable(),
});

const patchSchema = createSchema.partial();

const scheduleSchema = z.object({
  scheduled_at: z.string().datetime(),
});

// ── Routes ────────────────────────────────────────────────

// GET /api/campaigns — list
router.get('/campaigns', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data, error } = await auth.client
    .from('email_campaigns')
    .select('*')
    .eq('org_id', auth.orgId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return sendSafeError(res, error, 'Failed to load campaigns.', '[campaigns]');
  return res.json({ campaigns: data || [] });
});

// POST /api/campaigns — admin only, create draft
router.post('/campaigns', validate(createSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  if (!(await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId))) {
    return res.status(403).json({ error: 'Admin role required.' });
  }

  const body = req.body as z.infer<typeof createSchema>;
  const { data, error } = await auth.client
    .from('email_campaigns')
    .insert({
      org_id: auth.orgId,
      created_by: auth.user.id,
      name: body.name,
      subject: body.subject,
      body_html: body.body_html,
      body_text: body.body_text || null,
      segment: body.segment,
      custom_query: body.custom_query || null,
      status: 'draft',
    })
    .select()
    .single();
  if (error) return sendSafeError(res, error, 'Failed to create campaign.', '[campaigns]');
  return res.json({ campaign: data });
});

// PATCH /api/campaigns/:id — admin only, only draft/scheduled
router.patch('/campaigns/:id', validate(patchSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  if (!(await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId))) {
    return res.status(403).json({ error: 'Admin role required.' });
  }

  const { data: existing } = await auth.client
    .from('email_campaigns')
    .select('id, status')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Campaign not found.' });
  if (existing.status !== 'draft' && existing.status !== 'scheduled') {
    return res.status(409).json({ error: 'Cannot edit a campaign in this status.' });
  }

  const patch: Record<string, any> = { ...req.body, updated_at: new Date().toISOString() };
  const { data, error } = await auth.client
    .from('email_campaigns')
    .update(patch)
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .select()
    .single();
  if (error) return sendSafeError(res, error, 'Failed to update campaign.', '[campaigns]');
  return res.json({ campaign: data });
});

// DELETE /api/campaigns/:id — admin only, draft only
router.delete('/campaigns/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  if (!(await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId))) {
    return res.status(403).json({ error: 'Admin role required.' });
  }

  const { data: existing } = await auth.client
    .from('email_campaigns')
    .select('id, status')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Campaign not found.' });
  if (existing.status !== 'draft') {
    return res.status(409).json({ error: 'Only draft campaigns can be deleted.' });
  }

  const { error } = await auth.client
    .from('email_campaigns')
    .delete()
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId);
  if (error) return sendSafeError(res, error, 'Failed to delete campaign.', '[campaigns]');
  return res.json({ ok: true });
});

// POST /api/campaigns/:id/preview-recipients
router.post('/campaigns/:id/preview-recipients', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data: campaign } = await auth.client
    .from('email_campaigns')
    .select('id, segment, custom_query')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  try {
    const admin = getServiceClient();
    const recipients = await resolveRecipients(admin, auth.orgId, campaign.segment, campaign.custom_query);
    return res.json({
      total: recipients.length,
      sample: recipients.slice(0, 10).map((r) => ({
        email: r.email,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
      })),
      max_per_send: MAX_RECIPIENTS_PER_CAMPAIGN,
      over_limit: recipients.length > MAX_RECIPIENTS_PER_CAMPAIGN,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to preview recipients.', '[campaigns]');
  }
});

// GET /api/campaigns/:id/stats
router.get('/campaigns/:id/stats', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { data: campaign } = await auth.client
    .from('email_campaigns')
    .select('*')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  const { data: recipients } = await auth.client
    .from('email_campaign_recipients')
    .select('id, email, status, error_message, sent_at, opened_at, clicked_at')
    .eq('campaign_id', req.params.id)
    .eq('org_id', auth.orgId)
    .limit(500);

  return res.json({ campaign, recipients: recipients || [] });
});

// POST /api/campaigns/:id/schedule
router.post('/campaigns/:id/schedule', validate(scheduleSchema), async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  if (!(await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId))) {
    return res.status(403).json({ error: 'Admin role required.' });
  }

  const { scheduled_at } = req.body as { scheduled_at: string };
  if (new Date(scheduled_at).getTime() < Date.now() - 60_000) {
    return res.status(400).json({ error: 'scheduled_at must be in the future.' });
  }

  const { data, error } = await auth.client
    .from('email_campaigns')
    .update({ status: 'scheduled', scheduled_at, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .in('status', ['draft', 'scheduled'])
    .select()
    .single();
  if (error) return sendSafeError(res, error, 'Failed to schedule campaign.', '[campaigns]');
  return res.json({ campaign: data });
});

// POST /api/campaigns/:id/send — immediate send
router.post('/campaigns/:id/send', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  if (!(await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId))) {
    return res.status(403).json({ error: 'Admin role required.' });
  }

  if (!isMailerConfigured()) {
    return res.status(503).json({ error: 'Email is not configured on this server (SMTP_USER/SMTP_PASS missing).' });
  }

  const admin = getServiceClient();
  const { data: campaign, error: cErr } = await admin
    .from('email_campaigns')
    .select('*')
    .eq('id', req.params.id)
    .eq('org_id', auth.orgId)
    .maybeSingle();
  if (cErr || !campaign) return res.status(404).json({ error: 'Campaign not found.' });
  if (!['draft', 'scheduled', 'failed'].includes(campaign.status)) {
    return res.status(409).json({ error: `Cannot send a campaign in status "${campaign.status}".` });
  }

  try {
    const summary = await processCampaign(admin, campaign);
    return res.json({ ok: true, ...summary });
  } catch (err: any) {
    console.error('[campaigns/send]', err?.message);
    await admin.from('email_campaigns').update({ status: 'failed' }).eq('id', campaign.id);
    return sendSafeError(res, err, 'Failed to send campaign.', '[campaigns]');
  }
});

// ── Internal: process a single campaign ────────────────────

export async function processCampaign(admin: ReturnType<typeof getServiceClient>, campaign: any) {
  const recipients = await resolveRecipients(admin, campaign.org_id, campaign.segment, campaign.custom_query);

  if (recipients.length > MAX_RECIPIENTS_PER_CAMPAIGN) {
    throw new Error(
      `Recipient list (${recipients.length}) exceeds V1 limit of ${MAX_RECIPIENTS_PER_CAMPAIGN}. ` +
      `Use the Mailchimp CSV export for larger sends.`
    );
  }
  if (recipients.length === 0) {
    await admin.from('email_campaigns').update({
      status: 'sent', sent_at: new Date().toISOString(), total_recipients: 0, total_sent: 0,
    }).eq('id', campaign.id);
    return { recipients: 0, sent: 0, failed: 0 };
  }

  // Insert recipient rows
  await admin.from('email_campaign_recipients').insert(
    recipients.map((r) => ({
      campaign_id: campaign.id,
      org_id: campaign.org_id,
      client_id: r.id,
      email: r.email,
      status: 'pending' as const,
    }))
  );

  await admin.from('email_campaigns').update({
    status: 'sending', total_recipients: recipients.length, updated_at: new Date().toISOString(),
  }).eq('id', campaign.id);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (r) => {
      const htmlWithUnsub = appendUnsubscribeLink(campaign.body_html, r.email, campaign.org_id);
      const textWithUnsub = appendUnsubscribeText(campaign.body_text, r.email, campaign.org_id);

      const personalisedSubject = campaign.subject
        .replace(/\{\{\s*first_name\s*\}\}/gi, escape(r.first_name || ''))
        .replace(/\{\{\s*last_name\s*\}\}/gi, escape(r.last_name || ''));
      const personalisedHtml = htmlWithUnsub
        .replace(/\{\{\s*first_name\s*\}\}/gi, escape(r.first_name || ''))
        .replace(/\{\{\s*last_name\s*\}\}/gi, escape(r.last_name || ''));

      const result = await sendEmail({
        to: r.email,
        subject: personalisedSubject,
        html: personalisedHtml,
      });

      if (result.sent) {
        sent++;
        await admin.from('email_campaign_recipients').update({
          status: 'sent', sent_at: new Date().toISOString(),
        }).eq('campaign_id', campaign.id).eq('email', r.email);
      } else {
        failed++;
        await admin.from('email_campaign_recipients').update({
          status: 'failed', error_message: (result.error || 'unknown').slice(0, 500),
        }).eq('campaign_id', campaign.id).eq('email', r.email);
      }
      // textWithUnsub currently unused (mailer is HTML-only) — kept for future plain-text fallback
      void textWithUnsub;
    }));

    if (i + BATCH_SIZE < recipients.length) {
      await new Promise((r) => setTimeout(r, BATCH_SLEEP_MS));
    }
  }

  await admin.from('email_campaigns').update({
    status: 'sent',
    sent_at: new Date().toISOString(),
    total_sent: sent,
    total_failed: failed,
    updated_at: new Date().toISOString(),
  }).eq('id', campaign.id);

  return { recipients: recipients.length, sent, failed };
}

// ── Mailchimp CSV export ──────────────────────────────────

router.get('/campaigns/export/mailchimp.csv', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const admin = getServiceClient();
  const { data, error } = await (admin as any)
    .from('clients_active')
    .select('email, first_name, last_name, phone, address, city, country, notes, email_opt_out_at')
    .eq('org_id', auth.orgId)
    .not('email', 'is', null)
    .is('email_opt_out_at', null)
    .limit(50_000);
  if (error) return sendSafeError(res, error, 'Failed to export.', '[campaigns/export]');

  const emails = (data || []).map((c: any) => String(c.email).toLowerCase().trim());
  const { data: optOuts } = await (admin as any)
    .from('email_opt_outs')
    .select('email')
    .in('email', emails.length ? emails : [''])
    .or(`org_id.eq.${auth.orgId},org_id.is.null`);
  const optedOut = new Set((optOuts || []).map((r: any) => r.email));

  const rows = (data || []).filter((c: any) => !optedOut.has(String(c.email).toLowerCase().trim()));

  const csvEscape = (v: any): string => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = ['Email Address', 'First Name', 'Last Name', 'Phone', 'Address', 'City', 'Country', 'Tags', 'Notes'];
  const lines = [header.join(',')];
  for (const c of rows) {
    lines.push([
      csvEscape(c.email),
      csvEscape(c.first_name),
      csvEscape(c.last_name),
      csvEscape(c.phone),
      csvEscape(c.address),
      csvEscape(c.city),
      csvEscape(c.country),
      csvEscape('lume-crm'),
      csvEscape(c.notes),
    ].join(','));
  }

  // N7.7 — cet export fait sortir courriel, telephone, adresse et notes de tous
  // les clients vers un tiers (Mailchimp). Il doit laisser une trace.
  await logDataExport({
    orgId: auth.orgId,
    userId: auth.user.id,
    exportType: 'marketing_list',
    entityType: 'client',
    recordCount: rows.length,
    req,
  });

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="lume-mailchimp-import-${today}.csv"`);
  return res.send(lines.join('\r\n'));
});

// ── Public unsubscribe (no auth) ──────────────────────────

router.post('/public/unsubscribe', async (req, res) => {
  const token = String(req.body?.token || req.query?.token || '');
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return res.status(400).json({ error: 'Invalid or expired unsubscribe token.' });

  try {
    const admin = getServiceClient();
    await admin.rpc('record_email_opt_out', {
      p_email: parsed.email,
      p_org_id: parsed.orgId,
      p_reason: 'user_unsubscribed_via_campaign',
    });
    return res.json({ ok: true, email: parsed.email });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to unsubscribe.', '[unsubscribe]');
  }
});

export default router;
