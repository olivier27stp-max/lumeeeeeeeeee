import { Router } from 'express';
import { z } from 'zod';
import { requireAuthedClient, isOrgMember, getServiceClient } from '../lib/supabase';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { resolvePublicBaseUrl } from '../lib/helpers';
import { sendSafeError } from '../lib/error-handler';
import { getCompanySettings, buildEmailLayout, senderFor } from './emails';
import { twilioClient } from '../lib/config';
import { getOrgSmsFromNumber, SmsNumberNotProvisionedError, SmsNotInPlanError } from '../lib/twilioProvisioning';

const router = Router();

// ─── Public endpoint Zod schemas (same rules as quotes) ──────────────
const viewTokenRegex = /^[a-zA-Z0-9_-]{16,128}$/;
const signatureDataUrlRegex = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const publicSignSchema = z.object({
  view_token: z.string().regex(viewTokenRegex, 'Invalid view_token.'),
  signer_name: z.string().trim().min(1).max(120),
  signature_data: z.string()
    .max(200_000, 'Signature too large.')
    .regex(signatureDataUrlRegex, 'Signature must be a base64-encoded PNG or JPEG data URL.'),
});

/**
 * Verify the base64 payload of an image data URL decodes to a valid PNG/JPEG
 * by checking the magic bytes. Returns null on success, or an error message.
 */
function validateSignatureMagic(dataUrl: string): string | null {
  const m = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!m) return 'Signature format invalid.';
  const mime = m[1];
  let buf: Buffer;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return 'Signature decode failed.'; }
  if (buf.length < 8) return 'Signature too short.';
  if (mime === 'png') {
    if (
      buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47 ||
      buf[4] !== 0x0d || buf[5] !== 0x0a || buf[6] !== 0x1a || buf[7] !== 0x0a
    ) return 'Signature is not a valid PNG.';
  } else {
    if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return 'Signature is not a valid JPEG.';
  }
  return null;
}

// ─── Shared composition ───────────────────────────────────────────────

interface ComposedAgreementDoc {
  items: Array<{ name: string; qty: number; unit_price_cents: number; total_cents: number }>;
  subtotal_cents: number;
  /** Quote discount (0/absent for jobs) — kept so subtotal + taxes − discount = total on the document. */
  discount_cents?: number;
  discount_percent?: number | null;
  tax_lines: Array<{ label: string; rate: number; amount_cents: number }>;
  total_cents: number;
  client_name: string | null;
  property_address: string | null;
  /** 12-month calendar of service-plan jobs (jobs.job_type = 'recurring'). */
  service_plan?: { year: number; visits: Array<{ month: number; date: string; year?: number }> } | null;
}

/**
 * Compose the contract's money section from the live job (included line
 * items + jobs.tax_lines) — the exact logic the client uses. When the
 * agreement is signed its frozen `snapshot` takes precedence.
 *
 * Agreements are job-only; legacy quote-linked rows (kept as read-only
 * history) are always served from their frozen snapshot instead.
 */
async function composeLiveDoc(admin: any, agreement: any): Promise<ComposedAgreementDoc> {
  const { data: job } = await admin
    .from('jobs')
    .select('id, job_number, subtotal_cents, tax_lines, property_address, client_id')
    .eq('id', agreement.job_id)
    .maybeSingle();

  const { data: rawItems } = await admin
    .from('job_line_items')
    .select('name, qty, unit_price_cents, total_cents, included')
    .eq('job_id', agreement.job_id)
    .order('created_at', { ascending: true });

  const items = (rawItems || [])
    .filter((it: any) => it.included !== false)
    .map((it: any) => ({
      name: it.name || '',
      qty: Number(it.qty || 1),
      unit_price_cents: Number(it.unit_price_cents || 0),
      total_cents: Number(it.total_cents || 0),
    }));

  const computedSubtotal = items.reduce((sum: number, it: any) => sum + it.total_cents, 0);
  // N1.4 — subtotal_cents (entier) fait foi ; on ne repasse plus par la colonne
  // numeric heritee. Repli sur la somme des lignes si le job n'a pas de total.
  const subtotalCents = Number(job?.subtotal_cents) > 0
    ? Number(job.subtotal_cents)
    : computedSubtotal;
  const taxLines = (Array.isArray(job?.tax_lines) ? job.tax_lines : [])
    .filter((tx: any) => tx?.enabled && Number(tx.rate) > 0)
    .map((tx: any) => ({
      label: String(tx.label || tx.code || 'Tax'),
      rate: Number(tx.rate),
      amount_cents: Math.round(subtotalCents * (Number(tx.rate) / 100)),
    }));
  const totalCents = subtotalCents + taxLines.reduce((sum: number, tx: any) => sum + tx.amount_cents, 0);

  let clientName: string | null = null;
  const clientId = agreement.client_id || job?.client_id;
  if (clientId) {
    const { data: c } = await admin
      .from('clients')
      .select('first_name, last_name')
      .eq('id', clientId)
      .maybeSingle();
    if (c) clientName = `${c.first_name || ''} ${c.last_name || ''}`.trim() || null;
  }

  // Service-plan jobs: mirror the 12-month calendar on the contract.
  let servicePlan: ComposedAgreementDoc['service_plan'] = null;
  const { data: sc } = await admin
    .from('service_contracts')
    .select('year, visits')
    .eq('job_id', agreement.job_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sc && Array.isArray(sc.visits)) {
    const visits = sc.visits
      .map((v: any) => ({
        month: Number(v?.month),
        date: String(v?.date || ''),
        ...(Number(v?.year) ? { year: Number(v.year) } : {}),
      }))
      .filter((v: { month: number; date: string }) => v.month >= 1 && v.month <= 12 && Boolean(v.date));
    if (visits.length > 0) servicePlan = { year: Number(sc.year), visits };
  }

  return {
    items,
    subtotal_cents: subtotalCents,
    tax_lines: taxLines,
    total_cents: totalCents,
    client_name: clientName,
    property_address: job?.property_address || null,
    service_plan: servicePlan,
  };
}

/**
 * Next planned visit of a service-plan job (first date >= today), formatted
 * in French for the client-facing confirmation messages (email/SMS) — null
 * when the job has no service plan or all its visits are past.
 */
async function getNextVisitDateFr(admin: any, jobId: string | null): Promise<string | null> {
  if (!jobId) return null;
  const { data: sc } = await admin
    .from('service_contracts')
    .select('visits')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sc || !Array.isArray(sc.visits)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const next = sc.visits
    .map((v: any) => String(v?.date || '').slice(0, 10))
    .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today)
    .sort()[0];
  if (!next) return null;
  const [y, m, d] = next.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ══════════════════════════════════════════════════════════════
// PUBLIC: Get full agreement data by view_token (no auth)
// ══════════════════════════════════════════════════════════════

router.get('/agreements/public/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || !viewTokenRegex.test(token)) return res.status(400).json({ error: 'Token is required.' });

    const admin = getServiceClient();
    const { data: agreement, error: aErr } = await admin
      .from('job_agreements')
      .select('*')
      .eq('view_token', token)
      .is('deleted_at', null)
      .maybeSingle();
    if (aErr || !agreement) return res.status(404).json({ error: 'Agreement not found.' });

    // Numéro du contrat + client de repli — depuis le job. Les vieilles
    // lignes liées à un devis (historique en lecture seule) gardent leur
    // numéro via le devis.
    let refNumber: string | null = null;
    let entityClientId: string | null = agreement.client_id || null;
    if (agreement.job_id) {
      const { data: job } = await admin
        .from('jobs')
        .select('job_number, client_id')
        .eq('id', agreement.job_id)
        .maybeSingle();
      refNumber = job?.job_number ? String(job.job_number) : null;
      entityClientId = entityClientId || job?.client_id || null;
    } else if (agreement.quote_id) {
      // Legacy read-only row — only reachable when signed (frozen snapshot).
      const { data: quote } = await admin
        .from('quotes')
        .select('quote_number, client_id, lead_id')
        .eq('id', agreement.quote_id)
        .maybeSingle();
      refNumber = quote?.quote_number ? String(quote.quote_number) : null;
      entityClientId = entityClientId || quote?.client_id || quote?.lead_id || null;
    }

    // Company branding (of the agreement's org — multi-tenant safe)
    const { data: companyData } = await admin
      .from('company_settings')
      .select('company_name, logo_url, phone, email, website, street1, city, province, postal_code')
      .eq('org_id', agreement.org_id)
      .maybeSingle();
    let taxRegistrationLines: string[] = [];
    try {
      const { data: taxes } = await admin
        .from('tax_configs')
        .select('name, registration_number')
        .eq('org_id', agreement.org_id)
        .eq('is_active', true)
        .not('registration_number', 'is', null);
      taxRegistrationLines = (taxes || [])
        .filter((t: any) => t.registration_number)
        .map((t: any) => `${t.name} No: ${t.registration_number}`);
    } catch { /* registration_number column may not exist yet */ }

    // Client contact (for the doc header)
    let client: { name: string | null; email: string | null; phone: string | null } = { name: null, email: null, phone: null };
    const clientId = entityClientId;
    if (clientId) {
      const { data: c } = await admin
        .from('clients')
        .select('first_name, last_name, email, phone')
        .eq('id', clientId)
        .maybeSingle();
      if (c) {
        client = {
          name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || null,
          email: c.email || null,
          phone: c.phone || null,
        };
      }
    }

    // Signed → frozen snapshot; otherwise live composition from the job.
    // Legacy quote-linked rows without a snapshot are no longer served.
    if (!agreement.snapshot && !agreement.job_id) {
      return res.status(404).json({ error: 'This agreement is no longer active.' });
    }
    const doc: ComposedAgreementDoc = agreement.snapshot
      ? agreement.snapshot
      : await composeLiveDoc(admin, agreement);

    return res.json({
      agreement: {
        id: agreement.id,
        status: agreement.status,
        require_signature: agreement.require_signature !== false,
        terms: agreement.terms || '',
        created_at: agreement.created_at,
        signer_name: agreement.signer_name || null,
        signature_data: agreement.signature_data || null,
        signed_at: agreement.signed_at || null,
      },
      number: `CTR-${refNumber || agreement.id.slice(0, 6)}`,
      logo_url: agreement.logo_url || companyData?.logo_url || null,
      company: {
        name: companyData?.company_name || 'Business',
        address: [companyData?.street1, companyData?.city, companyData?.province, companyData?.postal_code].filter(Boolean).join(', ') || null,
        phone: companyData?.phone || null,
        email: companyData?.email || null,
        website: companyData?.website || null,
        tax_lines: taxRegistrationLines,
      },
      client,
      doc,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load agreement.', '[agreements/public/get]');
  }
});

// ══════════════════════════════════════════════════════════════
// PUBLIC: Sign agreement (no auth — uses view_token)
// ══════════════════════════════════════════════════════════════

router.post('/agreements/public/sign', async (req, res) => {
  try {
    const parsed = publicSignSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body.', issues: parsed.error.issues.map(i => i.message) });
    }
    const { view_token, signer_name, signature_data } = parsed.data;

    const magicErr = validateSignatureMagic(signature_data);
    if (magicErr) return res.status(400).json({ error: magicErr });

    const admin = getServiceClient();
    const { data: agreement, error: aErr } = await admin
      .from('job_agreements')
      .select('*')
      .eq('view_token', view_token)
      .is('deleted_at', null)
      .maybeSingle();
    if (aErr || !agreement) return res.status(404).json({ error: 'Agreement not found.' });

    if (agreement.status === 'signed') {
      return res.status(400).json({ error: 'Agreement is already signed.' });
    }
    if (agreement.require_signature === false) {
      return res.status(400).json({ error: 'This agreement does not require a signature.' });
    }
    // Agreements are job-only — legacy quote-linked rows are read-only history.
    if (!agreement.job_id) {
      return res.status(400).json({ error: 'This agreement is no longer active. The signed quote itself is the approved contract.' });
    }

    // Freeze the document as signed — the contract must never drift afterwards.
    const snapshot = await composeLiveDoc(admin, agreement);
    const now = new Date().toISOString();

    const { error: upErr } = await admin
      .from('job_agreements')
      .update({
        status: 'signed',
        signer_name,
        signature_data,
        signed_at: now,
        snapshot,
        updated_at: now,
      })
      .eq('id', agreement.id);
    if (upErr) throw upErr;

    // Notify the org.
    let refNumber = '';
    const { data: job } = await admin
      .from('jobs')
      .select('job_number')
      .eq('id', agreement.job_id)
      .maybeSingle();
    refNumber = job?.job_number ? String(job.job_number) : '';
    try {
      await admin.from('notifications').insert({
        org_id: agreement.org_id,
        type: 'agreement_signed',
        title: `${signer_name} signed the contract for job #${refNumber}`.trim(),
        body: `Contract CTR-${refNumber} has been signed by ${signer_name}.`,
        icon: 'check-circle',
        reference_id: agreement.job_id,
      });
    } catch { /* non-critical */ }

    return res.json({ ok: true, status: 'signed' });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to sign agreement.', '[agreements/public/sign]');
  }
});

// ══════════════════════════════════════════════════════════════
// AUTHED: Email the agreement (public link) to the job's client
// ══════════════════════════════════════════════════════════════

const sendAgreementSchema = z.object({
  agreementId: z.string().uuid('Invalid agreementId.'),
});

router.post('/emails/send-agreement', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { client, orgId } = auth;

    const parsed = sendAgreementSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body.' });
    const { agreementId } = parsed.data;

    const member = await isOrgMember(client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden.' });

    const { data: agreement, error: aErr } = await client
      .from('job_agreements')
      .select('id, org_id, job_id, client_id, status, require_signature, view_token, sent_at')
      .eq('id', agreementId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (aErr || !agreement) return res.status(404).json({ error: 'Agreement not found.' });
    // Agreements are job-only — legacy quote-linked rows are read-only history.
    if (!agreement.job_id) {
      return res.status(400).json({ error: 'This agreement is no longer active. The signed quote itself is the approved contract.' });
    }

    const admin = getServiceClient();
    let refNumber = '';
    let refTitle: string | null = null;
    let entityClientId: string | null = agreement.client_id || null;
    const { data: job } = await admin
      .from('jobs')
      .select('job_number, title, client_id')
      .eq('id', agreement.job_id)
      .maybeSingle();
    refNumber = job?.job_number ? String(job.job_number) : '';
    refTitle = job?.title || null;
    entityClientId = entityClientId || job?.client_id || null;

    const clientId = entityClientId;
    if (!clientId) return res.status(400).json({ error: 'No client on this agreement.' });
    const { data: clientData } = await admin
      .from('clients')
      .select('first_name, last_name, email')
      .eq('id', clientId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!clientData?.email) return res.status(400).json({ error: 'Client has no email address.' });

    if (!isMailerConfigured()) return res.status(503).json({ error: 'SMTP is not configured.' });

    const clientName = `${clientData.first_name || ''} ${clientData.last_name || ''}`.trim() || 'Client';
    const company = await getCompanySettings(orgId);
    const baseUrl = resolvePublicBaseUrl(req);
    const viewUrl = `${baseUrl}/contract/${agreement.view_token}`;
    const number = `CTR-${refNumber}`.replace(/-$/, '');
    const requireSig = agreement.require_signature !== false;
    const nextVisitDate = await getNextVisitDateFr(admin, agreement.job_id);

    const bodyHtml = `
<h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Contrat ${number}</h2>
<p style="margin:0 0 24px;color:#6b7280;">Bonjour ${clientName},</p>
<p style="margin:0 0 16px;color:#374151;">
  ${requireSig
    ? 'Voici votre contrat. Vous pouvez le consulter et le signer en ligne ci-dessous.'
    : 'Voici votre contrat. Vous pouvez le consulter ci-dessous.'}
</p>
${nextVisitDate ? `<p style="margin:0 0 16px;color:#374151;"><strong>Prochaine visite : ${nextVisitDate}.</strong></p>` : ''}
${refTitle ? `<p style="margin:0 0 16px;color:#6b7280;font-size:13px;">${String(refTitle).replace(/</g, '&lt;')}</p>` : ''}
<div style="text-align:center;margin-bottom:16px;">
  <a href="${viewUrl}" style="display:inline-block;padding:12px 32px;background-color:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
    ${requireSig ? 'Voir et signer le contrat' : 'Voir le contrat'}
  </a>
</div>
<p style="margin:0;font-size:13px;color:#9ca3af;">Pour toute question, répondez à ce courriel.</p>`;

    const emailResult = await sendEmail({
      ...senderFor(company),
      to: clientData.email,
      subject: `Contrat ${number}${company.company_name ? ` — ${company.company_name}` : ''}`,
      html: buildEmailLayout(company, bodyHtml),
    });
    if (!emailResult.sent) throw new Error(emailResult.error || 'Email send failed');

    // draft → sent (a signed agreement stays signed)
    if (agreement.status !== 'signed') {
      await admin
        .from('job_agreements')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', agreement.id);
    }

    return res.json({ ok: true, emailId: emailResult?.messageId || null });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to send agreement email.', '[emails/send-agreement]');
  }
});

// ══════════════════════════════════════════════════════════════
// AUTHED: Text the agreement (public link) to the job's client
// ══════════════════════════════════════════════════════════════

const sendAgreementSmsSchema = z.object({
  agreementId: z.string().uuid('Invalid agreementId.'),
});

router.post('/agreements/send-sms', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { client, orgId } = auth;

    const parsed = sendAgreementSmsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request body.' });
    const { agreementId } = parsed.data;

    if (!twilioClient) return res.status(503).json({ error: 'SMS is not configured.' });

    const member = await isOrgMember(client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden.' });

    const admin = getServiceClient();
    // Tenant guard — never send another org's contract from their Twilio number.
    const { data: agreement, error: aErr } = await admin
      .from('job_agreements')
      .select('id, org_id, job_id, client_id, status, require_signature, view_token')
      .eq('id', agreementId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (aErr || !agreement) return res.status(404).json({ error: 'Agreement not found.' });
    // Agreements are job-only — legacy quote-linked rows are read-only history.
    if (!agreement.job_id) {
      return res.status(400).json({ error: 'This agreement is no longer active. The signed quote itself is the approved contract.' });
    }

    const { data: job } = await admin
      .from('jobs')
      .select('job_number, client_id')
      .eq('id', agreement.job_id)
      .maybeSingle();
    const clientId = agreement.client_id || job?.client_id;
    if (!clientId) return res.status(400).json({ error: 'No client on this agreement.' });

    const { data: clientData } = await admin
      .from('clients')
      .select('first_name, last_name, phone')
      .eq('id', clientId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!clientData?.phone) return res.status(400).json({ error: 'Client has no phone number.' });

    // Format phone to E.164 for Twilio (same normalization as quotes/send-sms)
    let formattedPhone = String(clientData.phone).replace(/[\s\-().]/g, '');
    if (!formattedPhone.startsWith('+')) {
      if (formattedPhone.length === 10) formattedPhone = '+1' + formattedPhone;
      else if (formattedPhone.length === 11 && formattedPhone.startsWith('1')) formattedPhone = '+' + formattedPhone;
      else formattedPhone = '+1' + formattedPhone;
    }

    const { data: company } = await admin
      .from('company_settings')
      .select('company_name')
      .eq('org_id', agreement.org_id)
      .maybeSingle();
    const companyName = company?.company_name || 'Notre entreprise';
    const baseUrl = resolvePublicBaseUrl(req);
    const viewUrl = `${baseUrl}/contract/${agreement.view_token}`;
    const number = `CTR-${job?.job_number ? String(job.job_number) : agreement.id.slice(0, 6)}`;
    const requireSig = agreement.require_signature !== false;
    const nextVisitDate = await getNextVisitDateFr(admin, agreement.job_id);

    const smsBody =
      `${companyName} — voici votre contrat ${number}` +
      (requireSig ? ', à consulter et signer en ligne : ' : ' : ') +
      viewUrl +
      (nextVisitDate ? ` Prochaine visite : ${nextVisitDate}.` : '');

    let fromNumber: string;
    try {
      fromNumber = await getOrgSmsFromNumber(agreement.org_id);
    } catch (e) {
      if (e instanceof SmsNumberNotProvisionedError) {
        return res.status(409).json({
          error: 'Your organization does not have an SMS number yet. Provision one in Settings → Messaging.',
          code: 'sms_not_provisioned',
        });
      }
      if (e instanceof SmsNotInPlanError) {
        return res.status(403).json({
          error: 'Your current plan does not include SMS. Upgrade to Scale or Autopilot to send messages.',
          code: 'plan_excludes_sms',
        });
      }
      throw e;
    }

    await twilioClient.messages.create({
      body: smsBody,
      from: fromNumber,
      to: formattedPhone,
    });

    // draft → sent (a signed agreement stays signed)
    if (agreement.status !== 'signed') {
      await admin
        .from('job_agreements')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', agreement.id);
    }

    return res.json({ ok: true, channel: 'sms', recipient: clientData.phone });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to send agreement SMS.', '[agreements/send-sms]');
  }
});

export default router;
