import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { platformOwnerId } from '../lib/config';

const router = Router();

// ── Shared enum (industry) ──────────────────────────────────
const INDUSTRY_VALUES = [
  'landscaping',
  'snow_removal',
  'residential_cleaning',
  'commercial_cleaning',
  'plumbing',
  'electrical',
  'roofing',
  'hvac',
  'window_cleaning',
  'other',
] as const;
const industryEnum = z.enum(INDUSTRY_VALUES);

const phoneRegex = /^[+]?[0-9][0-9\s\-().]{6,19}$/;

// ── Public submission schema ────────────────────────────────
// Backward compatible: accepts legacy `company` alongside `company_name`,
// and legacy `source` values ('landing','contact') in addition to channels.
const bookDemoSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required.').max(200),
  company_name: z.string().trim().min(1).max(200).optional(),
  company: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().toLowerCase().email('Valid email is required.').max(254),
  phone: z.string().trim().min(4, 'Phone is required.').max(40)
    .refine((p) => phoneRegex.test(p.replace(/\s+/g, '')), 'Invalid phone number.'),
  industry: industryEnum.optional(),
  employee_count: z.string().trim().max(40).optional().nullable(),
  source: z.string().trim().max(80).optional().nullable(),
  availability: z.string().trim().max(80).optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
}).refine((d) => !!(d.company_name || d.company), {
  message: 'Company is required.',
  path: ['company_name'],
});

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function extractClientIp(req: Request): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip || null;
}

function getPlatformOwnerEmail(): string {
  return (
    process.env.PLATFORM_OWNER_EMAIL ||
    process.env.SALES_INBOX_EMAIL ||
    'willhebert30@gmail.com'
  );
}

function getAppBaseUrl(): string {
  return (process.env.FRONTEND_URL || process.env.APP_BASE_URL || '').replace(/\/$/, '');
}

// ── POST /api/public/book-demo (public) ─────────────────────
router.post('/public/book-demo', validate(bookDemoSchema), async (req, res) => {
  try {
    const body = req.body as z.infer<typeof bookDemoSchema>;
    const company_name = (body.company_name || body.company || '').trim();
    const industry = (body.industry || 'other') as typeof INDUSTRY_VALUES[number];
    const admin = getServiceClient();

    const ip = extractClientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    const { data: inserted, error: insertError } = await admin
      .from('demo_requests')
      .insert({
        full_name: body.full_name,
        company_name,
        email: body.email,
        phone: body.phone,
        industry,
        employee_count: body.employee_count || null,
        source: body.source || null,
        availability: body.availability || null,
        message: body.message || null,
        ip_address: ip,
        user_agent: ua,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[public/book-demo] insert failed:', insertError.message);
      // Still return ok-ish to avoid leaking infra; but actually surface error so client can retry
      return res.status(500).json({ error: 'Unable to save your request. Please try again.' });
    }

    const demoId = inserted?.id;

    // ── Admin notification email ────────────────────────────
    const ownerEmail = getPlatformOwnerEmail();
    const baseUrl = getAppBaseUrl();
    if (isMailerConfigured()) {
      const adminHtml = `
        <h2>Nouvelle demande de démo: ${escape(company_name)}</h2>
        <table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px">
          <tr><td style="padding:6px 12px"><strong>Name</strong></td><td style="padding:6px 12px">${escape(body.full_name)}</td></tr>
          <tr><td style="padding:6px 12px"><strong>Company</strong></td><td style="padding:6px 12px">${escape(company_name)}</td></tr>
          <tr><td style="padding:6px 12px"><strong>Email</strong></td><td style="padding:6px 12px">${escape(body.email)}</td></tr>
          <tr><td style="padding:6px 12px"><strong>Phone</strong></td><td style="padding:6px 12px">${escape(body.phone)}</td></tr>
          <tr><td style="padding:6px 12px"><strong>Industry</strong></td><td style="padding:6px 12px">${escape(industry)}</td></tr>
          <tr><td style="padding:6px 12px"><strong>Team size</strong></td><td style="padding:6px 12px">${escape(body.employee_count || '—')}</td></tr>
          <tr><td style="padding:6px 12px"><strong>Source</strong></td><td style="padding:6px 12px">${escape(body.source || '—')}</td></tr>
          <tr><td style="padding:6px 12px"><strong>Availability</strong></td><td style="padding:6px 12px">${escape(body.availability || '—')}</td></tr>
          <tr><td style="padding:6px 12px;vertical-align:top"><strong>Message</strong></td><td style="padding:6px 12px;white-space:pre-wrap">${escape(body.message || '—')}</td></tr>
        </table>
        ${baseUrl ? `<p style="margin-top:16px"><a href="${baseUrl}/platform-admin/demo-requests/${demoId}">Voir dans le dashboard</a></p>` : ''}
      `;
      sendEmail({
        to: ownerEmail,
        replyTo: body.email,
        subject: `Nouvelle demande de démo: ${company_name}`,
        html: adminHtml,
      }).catch((err) => console.error('[public/book-demo] admin email failed:', err?.message));

      // ── Prospect confirmation email ────────────────────────
      const prospectHtml = `
        <div style="font-family:system-ui,sans-serif;font-size:14px;color:#1a1a1a;max-width:560px">
          <h2 style="color:#1F5F4F;margin-bottom:12px">Merci pour ta demande de démo Lume</h2>
          <p>Bonjour ${escape(body.full_name.split(' ')[0] || '')},</p>
          <p>Nous avons bien reçu ta demande de démo pour <strong>${escape(company_name)}</strong>. Notre équipe te contactera sous <strong>24h</strong> pour planifier une session adaptée à ton industrie.</p>
          <p style="margin-top:16px"><strong>À quoi t'attendre :</strong></p>
          <ul style="padding-left:18px;line-height:1.6">
            <li>Une démo personnalisée de 20-30 min</li>
            <li>Adaptée à ton industrie (${escape(industry)})</li>
            <li>Réponses à toutes tes questions, sans engagement</li>
          </ul>
          <p style="margin-top:20px;color:#555">Si c'est urgent, écris-nous directement à ${escape(ownerEmail)}.</p>
          <p style="margin-top:24px">— L'équipe Lume CRM</p>
        </div>
      `;
      sendEmail({
        to: body.email,
        subject: 'Merci pour ta demande de démo Lume',
        html: prospectHtml,
      }).catch((err) => console.error('[public/book-demo] prospect email failed:', err?.message));
    } else {
      console.warn('[public/book-demo] mailer not configured — emails skipped', { demoId });
    }

    return res.json({ ok: true, message: 'Demo request received' });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to submit demo request.', '[public/book-demo]');
  }
});

// ─── Admin auth helper ───────────────────────────────────────
async function requirePlatformOwner(req: Request, res: Response) {
  if (!platformOwnerId) { res.status(503).json({ error: 'Platform admin not configured.' }); return null; }
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  if (auth.user.id !== platformOwnerId) { res.status(403).json({ error: 'Forbidden.' }); return null; }
  return auth;
}

// ── GET /api/admin/demo-requests ────────────────────────────
router.get('/admin/demo-requests', async (req, res) => {
  try {
    if (!await requirePlatformOwner(req, res)) return;
    const admin = getServiceClient();
    const status = typeof req.query.status === 'string' ? req.query.status : '';

    let q = admin.from('demo_requests').select('*').order('created_at', { ascending: false }).limit(500);
    if (status && ['new', 'contacted', 'demoed', 'converted', 'rejected'].includes(status)) {
      q = q.eq('status', status);
    }
    const { data, error } = await q;
    if (error) throw error;
    return res.json({ requests: data || [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to fetch demo requests.', '[admin/demo-requests]');
  }
});

// ── PATCH /api/admin/demo-requests/:id ──────────────────────
const patchSchema = z.object({
  status: z.enum(['new', 'contacted', 'demoed', 'converted', 'rejected']).optional(),
  notes: z.string().trim().max(8000).optional().nullable(),
});
router.patch('/admin/demo-requests/:id', validate(patchSchema), async (req, res) => {
  try {
    if (!await requirePlatformOwner(req, res)) return;
    const admin = getServiceClient();
    const id = String(req.params.id);
    const update: Record<string, any> = { ...req.body };
    if (update.status === 'contacted') {
      update.contacted_at = new Date().toISOString();
    }
    const { data, error } = await admin
      .from('demo_requests')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ request: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to update demo request.', '[admin/demo-requests/patch]');
  }
});

// ── POST /api/admin/demo-requests/:id/create-account ────────
router.post('/admin/demo-requests/:id/create-account', async (req, res) => {
  try {
    if (!await requirePlatformOwner(req, res)) return;
    const admin = getServiceClient();
    const id = String(req.params.id);

    const { data: row, error: fetchErr } = await admin
      .from('demo_requests')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !row) {
      return res.status(404).json({ error: 'Demo request not found.' });
    }

    const baseUrl = getAppBaseUrl();
    const redirectTo = baseUrl ? `${baseUrl}/auth` : undefined;

    const { data: inviteData, error: inviteErr } = await (admin.auth.admin as any).inviteUserByEmail(row.email, {
      data: {
        from_demo_request: id,
        full_name: row.full_name,
        company_name: row.company_name,
      },
      ...(redirectTo ? { redirectTo } : {}),
    });

    if (inviteErr || !inviteData?.user) {
      console.error('[admin/demo-requests/create-account] invite failed:', inviteErr?.message);
      return res.status(500).json({ error: inviteErr?.message || 'Unable to send invitation.' });
    }

    const userId = inviteData.user.id;
    const actionLink: string | undefined =
      (inviteData as any)?.properties?.action_link || (inviteData as any)?.action_link;

    await admin
      .from('demo_requests')
      .update({
        status: 'converted',
        converted_at: new Date().toISOString(),
        converted_user_id: userId,
      })
      .eq('id', id);

    return res.json({ ok: true, user_id: userId, invitation_url: actionLink });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to create account.', '[admin/demo-requests/create-account]');
  }
});

export default router;
