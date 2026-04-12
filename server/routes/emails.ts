import { Router } from 'express';
import { Resend } from 'resend';
import { requireAuthedClient, isOrgMember, getServiceClient } from '../lib/supabase';
import { parseOrgId, resolvePublicBaseUrl } from '../lib/helpers';
import { resendApiKey, emailFrom } from '../lib/config';
import {
  validate,
  sendInvoiceEmailSchema,
  sendQuoteEmailSchema,
  sendCustomEmailSchema,
} from '../lib/validation';
import { eventBus } from '../lib/eventBus';
import { isOrgAdminOrOwner } from '../lib/supabase';

const router = Router();

// Simple HTML sanitizer — strips script tags and event handlers
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '');
}

// ── Helpers ──

function getResend() {
  if (!resendApiKey) throw Object.assign(new Error('Resend API key is not configured.'), { status: 503 });
  return new Resend(resendApiKey);
}

function formatCurrency(cents: number, currency = 'CAD') {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

interface CompanyInfo {
  company_name?: string | null;
  company_email?: string | null;
  company_phone?: string | null;
  company_address?: string | null;
  company_logo_url?: string | null;
}

async function getCompanySettings(orgId: string): Promise<CompanyInfo> {
  try {
    const serviceClient = getServiceClient();
    const { data } = await serviceClient
      .from('company_settings')
      .select('company_name, email, phone, street1, city, province, postal_code, logo_url')
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) return {};
    const address = [data.street1, data.city, data.province, data.postal_code].filter(Boolean).join(', ') || null;
    return {
      company_name: data.company_name || null,
      company_email: data.email || null,
      company_phone: data.phone || null,
      company_address: address,
      company_logo_url: data.logo_url || null,
    };
  } catch {
    return {};
  }
}

function buildEmailLayout(company: CompanyInfo, bodyHtml: string) {
  const companyName = company.company_name || 'LUME';
  const logoHtml = company.company_logo_url
    ? `<img src="${company.company_logo_url}" alt="${companyName}" style="max-height:48px;max-width:200px;" />`
    : `<span style="font-size:24px;font-weight:700;color:#1a1a2e;letter-spacing:2px;">${companyName}</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Email</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;">
<tr><td align="center" style="padding:32px 16px;">

<!-- Container -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">

<!-- Header -->
<tr>
<td style="padding:24px 32px;border-bottom:1px solid #e5e7eb;text-align:center;">
${logoHtml}
</td>
</tr>

<!-- Body -->
<tr>
<td style="padding:32px;">
${bodyHtml}
</td>
</tr>

<!-- Footer -->
<tr>
<td style="padding:20px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;">
<p style="margin:0;font-size:12px;color:#9ca3af;">
Sent via <strong>LUME</strong>${company.company_name ? ` on behalf of ${company.company_name}` : ''}
</p>
${company.company_phone ? `<p style="margin:4px 0 0;font-size:12px;color:#9ca3af;">${company.company_phone}</p>` : ''}
</td>
</tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── POST /api/emails/send-invoice ──

router.post('/emails/send-invoice', validate(sendInvoiceEmailSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const invoiceId = String(req.body.invoiceId).trim();
    const emailTemplateId = req.body.emailTemplateId ? String(req.body.emailTemplateId).trim() : null;
    const customSubject = req.body.subject ? sanitizeHtml(String(req.body.subject).trim()) : null;
    const customBody = req.body.body ? sanitizeHtml(String(req.body.body).trim()) : null;

    const member = await isOrgMember(client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden.' });

    // Fetch invoice
    const { data: invoice, error: invoiceError } = await client
      .from('invoices')
      .select('id, invoice_number, total_cents, balance_cents, currency, due_date, status, client_id, view_token, created_at')
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (invoiceError || !invoice) return res.status(404).json({ error: 'Invoice not found.' });

    // Fetch client (exclude archived)
    const { data: clientData } = await client
      .from('clients')
      .select('id, first_name, last_name, email')
      .eq('id', invoice.client_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (!clientData?.email) return res.status(400).json({ error: 'Client has no email address.' });

    const clientName = `${clientData.first_name || ''} ${clientData.last_name || ''}`.trim() || 'Client';
    const company = await getCompanySettings(orgId);
    const amountStr = formatCurrency(invoice.total_cents || invoice.balance_cents || 0, invoice.currency || 'CAD');
    const baseUrl = resolvePublicBaseUrl(req);
    const viewUrl = invoice.view_token ? `${baseUrl}/q/${invoice.view_token}` : null;

    // Resolve email subject and body
    let emailSubject = customSubject || `Invoice ${invoice.invoice_number || ''} — ${amountStr}`;
    let bodyHtml = customBody || '';

    // Try to load email template if provided or use default
    if (emailTemplateId) {
      const serviceClient = getServiceClient();
      const { data: tpl } = await serviceClient
        .from('email_templates')
        .select('subject, body')
        .eq('id', emailTemplateId)
        .maybeSingle();
      if (tpl) {
        const templateVars: Record<string, string> = {
          client_name: clientName,
          company_name: company.company_name || '',
          invoice_number: invoice.invoice_number || '',
          invoice_amount: amountStr,
          due_date: formatDate(invoice.due_date),
          payment_link: viewUrl || '',
        };
        emailSubject = customSubject || tpl.subject.replace(/\{(\w+)\}/g, (_, k: string) => templateVars[k] ?? '');
        bodyHtml = customBody || tpl.body.replace(/\{(\w+)\}/g, (_, k: string) => templateVars[k] ?? '');
      }
    }

    // If no custom body and no template, use default layout
    if (!bodyHtml) {
      bodyHtml = `
<h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Invoice ${invoice.invoice_number || ''}</h2>
<p style="margin:0 0 24px;color:#6b7280;">Hello ${clientName},</p>
<p style="margin:0 0 16px;color:#374151;">
  Please find below the details for your invoice.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
<tr style="background-color:#f9fafb;">
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;">Invoice #</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;">${invoice.invoice_number || invoiceId.slice(0, 8)}</td>
</tr>
<tr>
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Amount</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;border-top:1px solid #e5e7eb;font-weight:700;">${amountStr}</td>
</tr>
<tr>
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Due Date</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;border-top:1px solid #e5e7eb;">${formatDate(invoice.due_date)}</td>
</tr>
<tr>
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Status</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;border-top:1px solid #e5e7eb;">${(invoice.status || 'pending').charAt(0).toUpperCase() + (invoice.status || 'pending').slice(1)}</td>
</tr>
</table>

${viewUrl ? `
<div style="text-align:center;margin-bottom:16px;">
  <a href="${viewUrl}" style="display:inline-block;padding:12px 32px;background-color:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
    View Invoice
  </a>
</div>
` : ''}

<p style="margin:0;font-size:13px;color:#9ca3af;">
  If you have any questions, please reply to this email or contact us directly.
</p>`;
    }

    const resend = getResend();
    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: emailFrom,
      to: clientData.email,
      subject: emailSubject,
      html: buildEmailLayout(company, bodyHtml),
    });

    if (emailError) throw new Error(emailError.message);

    // Update invoice status to sent (also set issued_at if not already set)
    const now = new Date().toISOString();
    await client.from('invoices').update({
      issued_at: invoice.status === 'draft' ? now : undefined,
      sent_at: now,
    }).eq('id', invoiceId);

    // Log send event for audit trail
    const serviceClient = getServiceClient();
    try {
      await serviceClient.from('invoice_send_events').insert({
        invoice_id: invoiceId,
        org_id: orgId,
        event_type: invoice.status === 'draft' ? 'sent' : 'resent',
        recipient_email: clientData.email,
        channel: 'email',
        metadata: { subject: emailSubject, email_template_id: emailTemplateId },
      });
    } catch { /* non-critical */ }

    // Log to activity_log with template & subject info
    await serviceClient.from('activity_log').insert({
      org_id: orgId,
      entity_type: 'invoice',
      entity_id: invoiceId,
      event_type: 'invoice_sent',
      actor_id: auth.user.id,
      metadata: {
        invoice_number: invoice.invoice_number,
        client_name: clientName,
        subject_sent: emailSubject,
        email_template_id: emailTemplateId,
        to_email: clientData.email,
      },
    });

    // Emit event
    eventBus.emit('invoice.sent', {
      orgId,
      entityType: 'invoice',
      entityId: invoiceId,
      actorId: auth.user.id,
      metadata: { invoice_number: invoice.invoice_number, client_name: clientName },
    });

    return res.json({ ok: true, emailId: emailResult?.id || null });
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Failed to send invoice email.' });
  }
});

// ── POST /api/emails/send-quote ──

router.post('/emails/send-quote', validate(sendQuoteEmailSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const invoiceId = String(req.body.invoiceId).trim();

    const member = await isOrgMember(client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden.' });

    // Fetch quote (invoices table, quotes are stored as invoices)
    const { data: quote, error: quoteError } = await client
      .from('invoices')
      .select('id, invoice_number, total_cents, balance_cents, currency, due_date, status, client_id, view_token, created_at')
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (quoteError || !quote) return res.status(404).json({ error: 'Quote not found.' });

    // Fetch client (exclude archived)
    const { data: clientData } = await client
      .from('clients')
      .select('id, first_name, last_name, email')
      .eq('id', quote.client_id)
      .is('deleted_at', null)
      .maybeSingle();

    if (!clientData?.email) return res.status(400).json({ error: 'Client has no email address.' });

    const clientName = `${clientData.first_name || ''} ${clientData.last_name || ''}`.trim() || 'Client';
    const company = await getCompanySettings(orgId);
    const amountStr = formatCurrency(quote.total_cents || quote.balance_cents || 0, quote.currency || 'CAD');
    const baseUrl = resolvePublicBaseUrl(req);
    const viewUrl = quote.view_token ? `${baseUrl}/q/${quote.view_token}` : null;

    const bodyHtml = `
<h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Quote ${quote.invoice_number || ''}</h2>
<p style="margin:0 0 24px;color:#6b7280;">Hello ${clientName},</p>
<p style="margin:0 0 16px;color:#374151;">
  We have prepared a quote for your review. Please see the details below.
</p>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;">
<tr style="background-color:#f9fafb;">
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;">Quote #</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;">${quote.invoice_number || invoiceId.slice(0, 8)}</td>
</tr>
<tr>
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Amount</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;border-top:1px solid #e5e7eb;font-weight:700;">${amountStr}</td>
</tr>
<tr>
  <td style="padding:12px 16px;font-size:13px;color:#6b7280;font-weight:600;border-top:1px solid #e5e7eb;">Valid Until</td>
  <td style="padding:12px 16px;font-size:14px;color:#1a1a2e;text-align:right;border-top:1px solid #e5e7eb;">${formatDate(quote.due_date)}</td>
</tr>
</table>

${viewUrl ? `
<div style="text-align:center;margin-bottom:16px;">
  <a href="${viewUrl}" style="display:inline-block;padding:12px 32px;background-color:#4f46e5;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">
    View Quote
  </a>
</div>
` : ''}

<p style="margin:0;font-size:13px;color:#9ca3af;">
  If you have any questions or would like to proceed, please reply to this email or contact us directly.
</p>`;

    const resend = getResend();
    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: emailFrom,
      to: clientData.email,
      subject: `Quote ${quote.invoice_number || ''} — ${amountStr}`,
      html: buildEmailLayout(company, bodyHtml),
    });

    if (emailError) throw new Error(emailError.message);

    // Update status to sent
    await client.from('invoices').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', invoiceId);

    // Emit estimate.sent event
    eventBus.emit('estimate.sent', {
      orgId,
      entityType: 'invoice',
      entityId: invoiceId,
      actorId: auth.user.id,
      metadata: { invoice_number: (quote as any).invoice_number },
    });

    return res.json({ ok: true, emailId: emailResult?.id || null });
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Failed to send quote email.' });
  }
});

// ── POST /api/emails/send-custom ──

router.post('/emails/send-custom', validate(sendCustomEmailSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const member = await isOrgMember(auth.client, auth.user.id, auth.orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden.' });

    // Custom emails require admin/owner role
    const canSend = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
    if (!canSend) return res.status(403).json({ error: 'Only admin or owner can send custom emails.' });

    const { to, subject, html } = req.body;
    const company = await getCompanySettings(auth.orgId);

    const resend = getResend();
    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: emailFrom,
      to,
      subject: sanitizeHtml(subject),
      html: buildEmailLayout(company, sanitizeHtml(html)),
    });

    if (emailError) throw new Error(emailError.message);

    return res.json({ ok: true, emailId: emailResult?.id || null });
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Failed to send email.' });
  }
});

export default router;
