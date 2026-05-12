import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { sendEmail, isMailerConfigured } from '../lib/mailer';

const router = Router();

// ── Schema ──────────────────────────────────────────────
// Landing + /contact "Book demo" submissions. Public — no auth.
const bookDemoSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required.').max(200),
  email: z.string().trim().toLowerCase().email('Valid email is required.').max(254),
  phone: z.string().trim().min(4, 'Phone is required.').max(40),
  company: z.string().trim().min(1, 'Company is required.').max(200),
  message: z.string().trim().max(4000).optional().default(''),
  source: z.enum(['landing', 'contact']).default('landing'),
});

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

// ── POST /api/public/book-demo ─────────────────────────
// Sends a notification email to the sales inbox.
// No DB insert yet — existing `leads` table requires org_id (not applicable
// for pre-signup marketing leads). Migrate to dedicated `marketing_leads`
// table later if needed.
router.post('/public/book-demo', validate(bookDemoSchema), async (req, res) => {
  const { full_name, email, phone, company, message, source } = req.body as z.infer<typeof bookDemoSchema>;

  const salesInbox = process.env.SALES_INBOX_EMAIL || process.env.EMAIL_FROM || 'admin@lumecrm.net';

  // If mailer is not configured, still return OK so the form UX does not break
  // — log and move on. Ops can check logs.
  if (!isMailerConfigured()) {
    console.warn('[public/book-demo] mailer not configured — submission logged only', {
      full_name, email, phone, company, source,
    });
    return res.json({ ok: true });
  }

  const html = `
    <h2>New demo request (${escape(source)})</h2>
    <table style="border-collapse:collapse;font-family:system-ui,sans-serif">
      <tr><td style="padding:6px 12px"><strong>Name</strong></td><td style="padding:6px 12px">${escape(full_name)}</td></tr>
      <tr><td style="padding:6px 12px"><strong>Email</strong></td><td style="padding:6px 12px">${escape(email)}</td></tr>
      <tr><td style="padding:6px 12px"><strong>Phone</strong></td><td style="padding:6px 12px">${escape(phone)}</td></tr>
      <tr><td style="padding:6px 12px"><strong>Company</strong></td><td style="padding:6px 12px">${escape(company)}</td></tr>
      <tr><td style="padding:6px 12px;vertical-align:top"><strong>Message</strong></td><td style="padding:6px 12px;white-space:pre-wrap">${escape(message || '—')}</td></tr>
    </table>
  `;

  const result = await sendEmail({
    to: salesInbox,
    replyTo: email,
    subject: `Lume demo request — ${full_name} (${company})`,
    html,
  });

  if (!result.sent) {
    console.error('[public/book-demo] email send failed:', result.error);
    // Return 200 anyway — we don't want to leak infra errors to public.
    // The submission is logged above.
  }

  return res.json({ ok: true });
});

export default router;
