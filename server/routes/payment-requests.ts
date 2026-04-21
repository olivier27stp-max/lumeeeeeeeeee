import { Router } from 'express';
import { sendSafeError } from '../lib/error-handler';
import { requireAuthedClient, isOrgMember, getServiceClient } from '../lib/supabase';
import { parseOrgId, resolvePublicBaseUrl } from '../lib/helpers';
import { emailFrom, twilioClient, twilioPhoneNumber } from '../lib/config';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { getInvoiceForOrg } from '../lib/payments';
import {
  getConnectedAccount,
  createPaymentRequest,
  getPaymentRequestsByInvoice,
  updatePaymentRequestStatus,
} from '../lib/stripe-connect';
import { validate, createPaymentRequestSchema } from '../lib/validation';

const router = Router();

// ── Helpers ──

function formatCurrency(cents: number, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

interface CompanyInfo {
  company_name?: string | null;
  company_logo_url?: string | null;
  email?: string | null;
  phone?: string | null;
}

async function getCompanyInfo(orgId: string): Promise<CompanyInfo> {
  try {
    const admin = getServiceClient();
    const { data } = await admin
      .from('company_settings')
      .select('company_name, logo_url, email, phone')
      .eq('org_id', orgId)
      .maybeSingle();
    if (data) return { company_name: data.company_name, company_logo_url: data.logo_url, email: data.email, phone: data.phone };

    // Fallback to org_billing_settings
    const { data: billing } = await admin
      .from('org_billing_settings')
      .select('company_name, logo_url, email, phone')
      .eq('org_id', orgId)
      .maybeSingle();
    return billing || {};
  } catch {
    return {};
  }
}

async function getClientContact(clientId: string | null, orgId: string) {
  if (!clientId) return null;
  try {
    const admin = getServiceClient();
    const { data } = await admin
      .from('clients')
      .select('id, first_name, last_name, email, phone')
      .eq('id', clientId)
      .eq('org_id', orgId)
      .maybeSingle();
    return data;
  } catch {
    return null;
  }
}

function buildPaymentEmailHtml(params: {
  company: CompanyInfo;
  clientName: string;
  invoiceNumber: string;
  amountFormatted: string;
  paymentUrl: string;
}) {
  const companyName = params.company.company_name || 'LUME';
  const logoHtml = params.company.company_logo_url
    ? `<img src="${params.company.company_logo_url}" alt="${companyName}" style="max-height:48px;max-width:200px;" />`
    : `<span style="font-size:24px;font-weight:700;color:#1a1a2e;letter-spacing:2px;">${companyName}</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
<tr><td style="padding:24px 32px;border-bottom:1px solid #e5e7eb;text-align:center;">${logoHtml}</td></tr>
<tr><td style="padding:32px;">
  <p style="margin:0 0 16px;font-size:16px;color:#1f2937;">Hi ${params.clientName},</p>
  <p style="margin:0 0 24px;font-size:15px;color:#4b5563;">
    A payment of <strong>${params.amountFormatted}</strong> is requested for invoice <strong>${params.invoiceNumber}</strong>.
  </p>
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
    <tr><td style="background-color:#1f2937;border-radius:6px;padding:14px 32px;">
      <a href="${params.paymentUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">
        Pay ${params.amountFormatted}
      </a>
    </td></tr>
  </table>
  <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;">
    Or copy this link: <a href="${params.paymentUrl}" style="color:#374151;word-break:break-all;">${params.paymentUrl}</a>
  </p>
</td></tr>
<tr><td style="padding:20px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
  <p style="margin:0;font-size:12px;color:#9ca3af;">Sent via <strong>LUME</strong>${params.company.company_name ? ` on behalf of ${params.company.company_name}` : ''}</p>
  ${params.company.phone ? `<p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">${params.company.phone}</p>` : ''}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}

// ── Send email notification ──

async function sendPaymentEmail(params: {
  clientEmail: string;
  clientName: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  paymentUrl: string;
  orgId: string;
}) {
  if (!isMailerConfigured()) return { sent: false, reason: 'SMTP not configured' };

  const company = await getCompanyInfo(params.orgId);
  const amountFormatted = formatCurrency(params.amountCents, params.currency);

  const result = await sendEmail({
    from: emailFrom,
    to: params.clientEmail,
    subject: `Payment request — ${amountFormatted} for ${params.invoiceNumber}`,
    html: buildPaymentEmailHtml({
      company,
      clientName: params.clientName,
      invoiceNumber: params.invoiceNumber,
      amountFormatted,
      paymentUrl: params.paymentUrl,
    }),
  });

  if (!result.sent) return { sent: false, reason: result.error || 'Send failed' };
  return { sent: true, emailId: result.messageId || null };
}

// ── Send SMS notification ──

async function sendPaymentSms(params: {
  clientPhone: string;
  clientName: string;
  invoiceNumber: string;
  amountCents: number;
  currency: string;
  paymentUrl: string;
  orgId: string;
}) {
  if (!twilioClient || !twilioPhoneNumber) return { sent: false, reason: 'Twilio not configured' };

  const company = await getCompanyInfo(params.orgId);
  const companyName = company.company_name || 'LUME';
  const amountFormatted = formatCurrency(params.amountCents, params.currency);

  const body = `${companyName}: Payment of ${amountFormatted} requested for invoice ${params.invoiceNumber}. Pay securely here: ${params.paymentUrl}`;

  try {
    const msg = await twilioClient.messages.create({
      body,
      from: twilioPhoneNumber,
      to: normalizeE164(params.clientPhone),
    });
    return { sent: true, sid: msg.sid };
  } catch (err: any) {
    return { sent: false, reason: err?.message || 'SMS failed' };
  }
}

// ── Create payment request from invoice ──

router.post('/payment-requests/create', validate(createPaymentRequestSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const orgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const member = await isOrgMember(auth.client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId.' });

    // sendVia: 'email' | 'sms' | 'both' | 'link_only' (default)
    const sendVia = String(req.body?.sendVia || 'link_only').toLowerCase();

    // Verify invoice exists and belongs to org
    const invoice = await getInvoiceForOrg(auth.client, orgId, invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const balanceCents = Number(invoice.balance_cents || 0);
    if (balanceCents <= 0) return res.status(400).json({ error: 'Invoice has no balance to pay.' });

    // Verify connected account exists and is ready
    const account = await getConnectedAccount(orgId);
    if (!account || !account.charges_enabled) {
      return res.status(400).json({
        error: 'Payment account is not ready. Complete onboarding in Payment Settings first.',
      });
    }

    const currency = String(invoice.currency || 'CAD').toUpperCase();
    const paymentRequest = await createPaymentRequest({
      orgId,
      invoiceId,
      amountCents: balanceCents,
      currency,
    });

    // Build the public payment URL
    const baseUrl = resolvePublicBaseUrl(req);
    const paymentUrl = `${baseUrl}/pay/${paymentRequest.public_token}`;

    // Update the payment request with the URL
    await updatePaymentRequestStatus(paymentRequest.id, 'sent', { payment_url: paymentUrl });

    // ── Send notifications ──
    const notifications: { email?: any; sms?: any } = {};
    const client = await getClientContact(invoice.client_id, orgId);
    const clientName = client ? [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client' : 'Client';

    if ((sendVia === 'email' || sendVia === 'both') && client?.email) {
      notifications.email = await sendPaymentEmail({
        clientEmail: client.email,
        clientName,
        invoiceNumber: invoice.invoice_number || invoiceId,
        amountCents: balanceCents,
        currency,
        paymentUrl,
        orgId,
      });
    }

    if ((sendVia === 'sms' || sendVia === 'both') && client?.phone) {
      notifications.sms = await sendPaymentSms({
        clientPhone: client.phone,
        clientName,
        invoiceNumber: invoice.invoice_number || invoiceId,
        amountCents: balanceCents,
        currency,
        paymentUrl,
        orgId,
      });
    }

    return res.json({
      payment_request: {
        ...paymentRequest,
        status: 'sent',
        payment_url: paymentUrl,
      },
      notifications,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to create payment request.', '[payment-requests/create]');
  }
});

// ── Resend payment request (re-sends notification) ──

router.post('/payment-requests/resend', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const orgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const member = await isOrgMember(auth.client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId.' });

    const sendVia = String(req.body?.sendVia || 'link_only').toLowerCase();

    const requests = await getPaymentRequestsByInvoice(orgId, invoiceId);
    const active = requests.find((r: any) => r.status === 'sent' || r.status === 'pending');

    if (!active) {
      return res.status(404).json({ error: 'No active payment request found for this invoice.' });
    }

    const baseUrl = resolvePublicBaseUrl(req);
    const paymentUrl = `${baseUrl}/pay/${active.public_token}`;

    // Re-send notifications
    const notifications: { email?: any; sms?: any } = {};
    const invoice = await getInvoiceForOrg(auth.client, orgId, invoiceId);

    if (invoice) {
      const client = await getClientContact(invoice.client_id, orgId);
      const clientName = client ? [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Client' : 'Client';

      if ((sendVia === 'email' || sendVia === 'both') && client?.email) {
        notifications.email = await sendPaymentEmail({
          clientEmail: client.email,
          clientName,
          invoiceNumber: invoice.invoice_number || invoiceId,
          amountCents: Number(active.amount_cents),
          currency: active.currency || 'CAD',
          paymentUrl,
          orgId,
        });
      }

      if ((sendVia === 'sms' || sendVia === 'both') && client?.phone) {
        notifications.sms = await sendPaymentSms({
          clientPhone: client.phone,
          clientName,
          invoiceNumber: invoice.invoice_number || invoiceId,
          amountCents: Number(active.amount_cents),
          currency: active.currency || 'CAD',
          paymentUrl,
          orgId,
        });
      }
    }

    return res.json({
      payment_request: { ...active, payment_url: paymentUrl },
      notifications,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to resend payment request.', '[payment-requests/resend]');
  }
});

// ── Get payment request status ──

router.get('/payment-requests/:id/status', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const orgId = parseOrgId(req.query.orgId) || auth.orgId;
    const member = await isOrgMember(auth.client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const invoiceId = req.params.id;
    const requests = await getPaymentRequestsByInvoice(orgId, invoiceId);

    return res.json({ payment_requests: requests });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to fetch payment request status.', '[payment-requests/status]');
  }
});

export default router;
