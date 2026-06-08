import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { validate } from '../lib/validation';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { sendSafeError } from '../lib/error-handler';

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
  referral_code: z.string().trim().max(40).optional().nullable(),
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

function getOwnerEmail(): string {
  return (
    process.env.PLATFORM_OWNER_EMAIL ||
    process.env.SALES_INBOX_EMAIL ||
    'willhebert30@gmail.com'
  );
}

// ── POST /api/public/book-demo ──────────────────────────────
// Plus de persistance en base — la soumission envoie simplement un courriel
// au propriétaire (willhebert30@gmail.com par défaut) + une confirmation au
// prospect. Pas de page admin dans le CRM.
router.post('/public/book-demo', validate(bookDemoSchema), async (req, res) => {
  try {
    const body = req.body as z.infer<typeof bookDemoSchema>;
    const company_name = (body.company_name || body.company || '').trim();
    const industry = (body.industry || 'other') as typeof INDUSTRY_VALUES[number];

    const ip = extractClientIp(req);
    const ua = String(req.headers['user-agent'] || '').slice(0, 500);

    const reference = `LUM-${Date.now().toString(36).toUpperCase()}`;
    const ownerEmail = getOwnerEmail();

    if (!isMailerConfigured()) {
      console.warn('[public/book-demo] mailer not configured — email skipped', { reference, email: body.email });
      // On répond OK quand même pour pas casser le formulaire en dev.
      return res.json({ ok: true, message: 'Demo request received' });
    }

    const submittedAt = new Date().toLocaleString('fr-CA', {
      timeZone: 'America/Toronto',
      dateStyle: 'long',
      timeStyle: 'short',
    });
    const messageBlock = body.message
      ? `<div style="margin:20px 0;padding:16px;border-left:3px solid #3FAF97;background:#f6fbf9">
           <p style="margin:0 0 6px;font-weight:600;color:#1F5F4F">Message du prospect</p>
           <p style="margin:0;white-space:pre-wrap;color:#1a1a1a">${escape(body.message)}</p>
         </div>`
      : '';

    const adminHtml = `
      <div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;color:#1a1a1a">
        <div style="background:#1F5F4F;color:white;padding:20px 24px;border-radius:8px 8px 0 0">
          <p style="margin:0;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85">Nouveau lead — Plateforme Lume</p>
          <h1 style="margin:8px 0 0;font-size:22px">${escape(company_name)}</h1>
          <p style="margin:6px 0 0;font-size:13px;opacity:.85">Réf. <strong>${reference}</strong> · Reçu le ${escape(submittedAt)}</p>
        </div>

        <div style="background:#FFF7E6;border:1px solid #FFD580;padding:14px 18px;font-size:14px">
          <p style="margin:0;color:#5C3A00"><strong>📞 Action requise — appeler le prospect</strong></p>
          <p style="margin:6px 0 0;color:#5C3A00">Réponse promise dans les 24 h.</p>
        </div>

        <table style="border-collapse:collapse;width:100%;margin-top:0;font-size:14px;border:1px solid #e5e7eb;border-top:none">
          <tr><td style="padding:10px 14px;background:#fafafa;width:140px;font-weight:600">Nom</td><td style="padding:10px 14px">${escape(body.full_name)}</td></tr>
          <tr><td style="padding:10px 14px;background:#fafafa;font-weight:600">Entreprise</td><td style="padding:10px 14px">${escape(company_name)}</td></tr>
          <tr><td style="padding:10px 14px;background:#fafafa;font-weight:600">Téléphone</td><td style="padding:10px 14px"><a href="tel:${escape(body.phone)}" style="color:#1F5F4F;text-decoration:none;font-weight:600">${escape(body.phone)}</a></td></tr>
          <tr><td style="padding:10px 14px;background:#fafafa;font-weight:600">Email</td><td style="padding:10px 14px"><a href="mailto:${escape(body.email)}" style="color:#1F5F4F">${escape(body.email)}</a></td></tr>
          <tr><td style="padding:10px 14px;background:#fafafa;font-weight:600">Secteur</td><td style="padding:10px 14px">${escape(industry)}</td></tr>
          <tr><td style="padding:10px 14px;background:#fafafa;font-weight:600">Taille équipe</td><td style="padding:10px 14px">${escape(body.employee_count || '—')}</td></tr>
          <tr><td style="padding:10px 14px;background:#fafafa;font-weight:600">Disponibilités</td><td style="padding:10px 14px">${escape(body.availability || '—')}</td></tr>
          <tr><td style="padding:10px 14px;background:#fafafa;font-weight:600">Source</td><td style="padding:10px 14px">${escape(body.source || '—')}</td></tr>
          <tr><td style="padding:10px 14px;background:#fafafa;font-weight:600">Parrainage (referral)</td><td style="padding:10px 14px">${escape(body.referral_code || '—')}</td></tr>
        </table>

        ${messageBlock}

        <p style="margin-top:24px;font-size:12px;color:#6b7280;text-align:center">
          Référence: <strong>${reference}</strong> · IP: ${escape(ip || '—')} · UA: ${escape(ua.slice(0, 80))}<br/>
          Pour répondre directement au prospect, utilise simplement « Répondre » dans ton client mail.
        </p>
      </div>
    `;

    sendEmail({
      to: ownerEmail,
      replyTo: body.email,
      subject: `[${reference}] Nouveau lead Lume — ${company_name} (${industry})`,
      html: adminHtml,
    }).catch((err) => console.error('[public/book-demo] admin email failed:', err?.message));

    // ── Prospect confirmation email ────────────────────────
    const prospectHtml = `
      <div style="font-family:system-ui,sans-serif;font-size:14px;color:#1a1a1a;max-width:560px">
        <h2 style="color:#1F5F4F;margin-bottom:12px">Merci pour ta demande de démo Lume</h2>
        <p>Bonjour ${escape(body.full_name.split(' ')[0] || '')},</p>
        <p>Nous avons bien reçu ta demande de démo pour <strong>${escape(company_name)}</strong>. Notre équipe te contactera sous <strong>24 h</strong> pour planifier une session adaptée à ton industrie.</p>
        <p style="margin:16px 0 8px"><strong>À quoi t'attendre :</strong></p>
        <ul style="padding-left:18px;line-height:1.6;margin-top:0">
          <li>Une démo personnalisée de 20-30 min</li>
          <li>Adaptée à ton industrie (${escape(industry)})</li>
          <li>Réponses à toutes tes questions, sans engagement</li>
        </ul>
        <div style="margin-top:18px;padding:12px 14px;background:#f6fbf9;border-left:3px solid #3FAF97;font-size:13px">
          <strong>Ta référence :</strong> ${reference}<br/>
          <span style="color:#555">Conserve-la si tu veux nous écrire au sujet de cette demande.</span>
        </div>
        <p style="margin-top:20px;color:#555">Si c'est urgent, écris-nous à ${escape(ownerEmail)}.</p>
        <p style="margin-top:24px">— L'équipe Lume CRM</p>
      </div>
    `;
    sendEmail({
      to: body.email,
      subject: 'Merci pour ta demande de démo Lume',
      html: prospectHtml,
    }).catch((err) => console.error('[public/book-demo] prospect email failed:', err?.message));

    return res.json({ ok: true, message: 'Demo request received' });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to submit demo request.', '[public/book-demo]');
  }
});

export default router;
