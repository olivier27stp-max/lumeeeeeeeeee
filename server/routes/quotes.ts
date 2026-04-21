import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { emailFrom, twilioClient, twilioPhoneNumber, getBaseUrl } from '../lib/config';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { parseOrgId, resolvePublicBaseUrl } from '../lib/helpers';
import { eventBus } from '../lib/eventBus';
import { getConnectedAccount, createDestinationPaymentIntent, getPlatformStripe } from '../lib/stripe-connect';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// Separate router for root-level quote redirect (/q/:token)
export const quoteRedirectRouter = Router();

// Public route: client opens quote via unique token
// GET /q/:token — serves a redirect to frontend quote view page
quoteRedirectRouter.get('/q/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).send('Invalid link');

    const serviceClient = getServiceClient();

    // Find the invoice by view_token
    const { data: invoice, error } = await serviceClient
      .from('invoices')
      .select('id, invoice_number, client_id, org_id, is_viewed, view_count')
      .eq('view_token', token)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !invoice) {
      return res.status(404).send('Quote not found');
    }

    const isFirstView = !invoice.is_viewed;
    const now = new Date().toISOString();

    // Update invoice tracking fields
    await serviceClient
      .from('invoices')
      .update({
        is_viewed: true,
        viewed_at: isFirstView ? now : undefined,
        view_count: (invoice.view_count || 0) + 1,
        last_viewed_at: now,
      })
      .eq('id', invoice.id);

    // Log to quote_views table
    await serviceClient
      .from('quote_views')
      .insert({
        invoice_id: invoice.id,
        client_id: invoice.client_id,
        ip_address: req.ip || req.headers['x-forwarded-for'] || null,
        user_agent: req.headers['user-agent'] || null,
      });

    // Create notification only on FIRST view
    if (isFirstView) {
      // Get client name for notification
      let clientName = 'Client';
      if (invoice.client_id) {
        const { data: client } = await serviceClient
          .from('clients')
          .select('first_name, last_name')
          .eq('id', invoice.client_id)
          .is('deleted_at', null)
          .maybeSingle();
        if (client) {
          clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client';
        }
      }

      await serviceClient
        .from('notifications')
        .insert({
          org_id: invoice.org_id,
          type: 'quote_opened',
          title: `${clientName} opened quote ${invoice.invoice_number}`,
          body: `${clientName} has viewed their quote for the first time.`,
          icon: 'eye',
          link: `/invoices/${invoice.id}`,
          reference_id: invoice.id,
        });
    }

    // Redirect to frontend quote view page
    const frontendUrl = getBaseUrl();
    return res.redirect(`${frontendUrl}/quote/${token}`);
  } catch (error: any) {
    return sendSafeError(res, error, 'Something went wrong.', '[quotes/view-redirect]');
  }
});

// POST /api/quotes/:id/track-view — track a view using view_token (public, rate-limited)
router.post('/quotes/:id/track-view', async (req, res) => {
  try {
    const { id } = req.params;
    const serviceClient = getServiceClient();

    // Security: use view_token lookup instead of raw UUID to prevent enumeration
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const query = serviceClient
      .from('invoices')
      .select('id, invoice_number, client_id, org_id, is_viewed, view_count')
      .is('deleted_at', null);

    // Accept either view_token or invoice ID (for backward compat with authed callers)
    const { data: invoice, error } = isUuid
      ? await query.eq('id', id).maybeSingle()
      : await query.eq('view_token', id).maybeSingle();

    if (error || !invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const isFirstView = !invoice.is_viewed;
    const now = new Date().toISOString();

    await serviceClient
      .from('invoices')
      .update({
        is_viewed: true,
        viewed_at: isFirstView ? now : undefined,
        view_count: (invoice.view_count || 0) + 1,
        last_viewed_at: now,
      })
      .eq('id', invoice.id);

    await serviceClient
      .from('quote_views')
      .insert({
        invoice_id: invoice.id,
        client_id: invoice.client_id,
        ip_address: req.ip || req.headers['x-forwarded-for'] || null,
        user_agent: req.headers['user-agent'] || null,
      });

    if (isFirstView) {
      let clientName = 'Client';
      if (invoice.client_id) {
        const { data: client } = await serviceClient
          .from('clients')
          .select('first_name, last_name')
          .eq('id', invoice.client_id)
          .is('deleted_at', null)
          .maybeSingle();
        if (client) {
          clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client';
        }
      }

      await serviceClient
        .from('notifications')
        .insert({
          org_id: invoice.org_id,
          type: 'quote_opened',
          title: `${clientName} opened quote ${invoice.invoice_number}`,
          body: `${clientName} has viewed their quote for the first time.`,
          icon: 'eye',
          link: `/invoices/${invoice.id}`,
          reference_id: invoice.id,
        });
    }

    return res.json({ tracked: true, first_view: isFirstView });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to track view.', '[quotes/track-view]');
  }
});

// ══════════════════════════════════════════════════════════════
// NEW: Quote CRUD + Send routes (dedicated quotes table)
// ══════════════════════════════════════════════════════════════

// ── Send quote via email ──
router.post('/quotes/send-email', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { quoteId, emailSubject, emailBody } = req.body;
    if (!quoteId) return res.status(400).json({ error: 'quoteId is required.' });

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('*, leads(first_name, last_name, email, phone), clients(first_name, last_name, email, phone)')
      .eq('id', quoteId)
      .eq('org_id', auth.orgId)
      .single();
    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    // Resolve recipient email
    const lead = quote.leads as any;
    const client = quote.clients as any;
    const recipientEmail = client?.email || lead?.email;
    const recipientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim()
      : lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : 'Client';

    if (!recipientEmail) return res.status(400).json({ error: 'No email address available for this lead/client.' });

    if (!isMailerConfigured()) return res.status(503).json({ error: 'SMTP not configured.' });

    // Get company info with branding
    const { data: company } = await admin
      .from('company_settings')
      .select('company_name, phone, email, logo_url')
      .eq('org_id', quote.org_id)
      .maybeSingle();

    const companyName = company?.company_name || 'Our Company';
    const companyLogo = company?.logo_url || null;
    const companyPhone = company?.phone || null;
    const companyEmail = company?.email || null;
    const baseUrl = resolvePublicBaseUrl(req);
    const quoteUrl = `${baseUrl}/quote/${quote.view_token}`;
    const totalFormatted = new Intl.NumberFormat('en-CA', { style: 'currency', currency: quote.currency || 'CAD' }).format(quote.total_cents / 100);

    // Use custom email body/subject or default template
    const finalSubject = emailSubject
      ? emailSubject.replace(/\{\{quote_number\}\}/g, quote.quote_number).replace(/\{\{total\}\}/g, totalFormatted).replace(/\{\{company\}\}/g, companyName)
      : `Quote #${quote.quote_number} from ${companyName} — ${totalFormatted}`;

    const customBody = emailBody
      ? emailBody.replace(/\{\{client_name\}\}/g, recipientName).replace(/\{\{quote_number\}\}/g, quote.quote_number).replace(/\{\{total\}\}/g, totalFormatted).replace(/\{\{company\}\}/g, companyName).replace(/\{\{valid_until\}\}/g, quote.valid_until || 'N/A').replace(/\n/g, '<br/>')
      : null;

    const logoBlock = companyLogo
      ? `<div style="margin-bottom:24px;"><img src="${companyLogo}" alt="${companyName}" style="max-height:48px;max-width:180px;object-fit:contain;" /></div>`
      : `<div style="margin-bottom:24px;"><img src="${baseUrl}/lume-logo.png" alt="Lume" style="max-height:40px;object-fit:contain;" /></div>`;

    const depositBlock = quote.deposit_required && quote.deposit_value > 0
      ? `<tr><td style="padding:12px 16px;border-bottom:1px solid #eee;color:#888;font-size:13px;">Deposit Required</td><td style="padding:12px 16px;border-bottom:1px solid #eee;color:#111;text-align:right;font-weight:600;font-size:13px;">${quote.deposit_type === 'percentage' ? `${quote.deposit_value}%` : new Intl.NumberFormat('en-CA', { style: 'currency', currency: quote.currency || 'CAD' }).format(quote.deposit_value)}</td></tr>`
      : '';

    const emailHtml = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 20px;">
        ${logoBlock}
        ${customBody ? `<div style="color:#333;font-size:14px;line-height:1.6;">${customBody}</div>` : `
        <h2 style="color:#111;font-size:18px;font-weight:600;margin:0 0 8px;">Hello ${recipientName},</h2>
        <p style="color:#666;font-size:14px;margin:0 0 24px;">${companyName} has prepared a quote for you.</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">
          <tr><td style="padding:12px 16px;border-bottom:1px solid #eee;color:#888;font-size:13px;">Quote #</td><td style="padding:12px 16px;border-bottom:1px solid #eee;color:#111;text-align:right;font-weight:600;font-size:13px;">${quote.quote_number}</td></tr>
          <tr><td style="padding:12px 16px;border-bottom:1px solid #eee;color:#888;font-size:13px;">Amount</td><td style="padding:12px 16px;border-bottom:1px solid #eee;color:#111;text-align:right;font-weight:700;font-size:15px;">${totalFormatted}</td></tr>
          ${quote.valid_until ? `<tr><td style="padding:12px 16px;border-bottom:1px solid #eee;color:#888;font-size:13px;">Valid Until</td><td style="padding:12px 16px;border-bottom:1px solid #eee;color:#333;text-align:right;font-size:13px;">${new Date(quote.valid_until).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</td></tr>` : ''}
          ${depositBlock}
        </table>
        `}
        <p style="text-align:center;margin:28px 0;">
          <a href="${quoteUrl}" style="display:inline-block;background:#111;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.01em;">View Quote</a>
        </p>
        <p style="color:#888;font-size:13px;margin:24px 0 4px;">Thank you,<br/><strong style="color:#333;">${companyName}</strong></p>
        ${companyPhone || companyEmail ? `<p style="color:#aaa;font-size:12px;margin:0;">${[companyPhone, companyEmail].filter(Boolean).join(' | ')}</p>` : ''}
      </div>
    `;

    await sendEmail({
      from: emailFrom,
      to: recipientEmail,
      subject: finalSubject,
      html: emailHtml,
    });

    // Update quote
    await admin.from('quotes').update({
      sent_via_email_at: new Date().toISOString(),
      last_sent_channel: 'email',
      status: 'sent',
      updated_at: new Date().toISOString(),
    }).eq('id', quoteId).eq('org_id', auth.orgId);

    // Log send
    await admin.from('quote_send_log').insert({
      quote_id: quoteId,
      channel: 'email',
      recipient: recipientEmail,
      sent_by: auth.user.id,
      delivery_status: 'sent',
    });

    // Log status change
    await admin.from('quote_status_history').insert({
      quote_id: quoteId,
      old_status: quote.status,
      new_status: 'sent',
      changed_by: auth.user.id,
      reason: 'Sent via email',
    });

    // Automation: move pipeline deal to Quote Sent
    if (quote.lead_id) {
      const { data: deal } = await admin.from('pipeline_deals')
        .select('id').eq('lead_id', quote.lead_id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (deal) {
        await admin.rpc('set_deal_stage', { p_deal_id: deal.id, p_stage: 'quote_sent' });
      }
    }

    // Emit automation event for quote follow-up workflows
    try {
      await eventBus.emit('quote.sent', {
        orgId: auth.orgId,
        entityType: 'quote',
        entityId: quoteId,
        actorId: auth.user.id,
        metadata: {
          lead_id: quote.lead_id || null,
          channel: 'email',
          quote_number: quote.quote_number || '',
          client_name: quote.client_name || '',
        },
      });
    } catch (e: any) {
      console.error('[quotes] failed to emit quote.sent event:', e.message);
    }

    return res.json({ ok: true, channel: 'email', recipient: recipientEmail });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to send quote email.', '[quotes/send-email]');
  }
});

// ── Send quote via SMS ──
router.post('/quotes/send-sms', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { quoteId } = req.body;
    if (!quoteId) return res.status(400).json({ error: 'quoteId is required.' });

    if (!twilioClient) return res.status(503).json({ error: 'SMS is not configured.' });

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('*, leads(first_name, last_name, phone), clients(first_name, last_name, phone)')
      .eq('id', quoteId)
      .single();
    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    const lead = quote.leads as any;
    const client = quote.clients as any;
    const recipientPhone = client?.phone || lead?.phone;
    const recipientName = client
      ? `${client.first_name || ''} ${client.last_name || ''}`.trim()
      : lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : 'Client';

    if (!recipientPhone) return res.status(400).json({ error: 'No phone number available.' });

    // Format phone to E.164 for Twilio
    let formattedPhone = recipientPhone.replace(/[\s\-\(\)\.]/g, '');
    if (!formattedPhone.startsWith('+')) {
      if (formattedPhone.length === 10) formattedPhone = '+1' + formattedPhone;
      else if (formattedPhone.length === 11 && formattedPhone.startsWith('1')) formattedPhone = '+' + formattedPhone;
      else formattedPhone = '+1' + formattedPhone;
    }

    const { data: company } = await admin
      .from('company_settings')
      .select('company_name')
      .eq('org_id', quote.org_id)
      .maybeSingle();

    const companyName = company?.company_name || 'Our Company';
    const baseUrl = resolvePublicBaseUrl(req);
    const quoteUrl = `${baseUrl}/quote/${quote.view_token}`;
    const totalFormatted = new Intl.NumberFormat('en-CA', { style: 'currency', currency: quote.currency || 'CAD' }).format(quote.total_cents / 100);

    const smsBody = `${companyName} sent you a quote (#${quote.quote_number}) for ${totalFormatted}. View it here: ${quoteUrl}`;

    const twilioMsg = await twilioClient.messages.create({
      body: smsBody,
      from: twilioPhoneNumber,
      to: formattedPhone,
    });

    await admin.from('quotes').update({
      sent_via_sms_at: new Date().toISOString(),
      last_sent_channel: 'sms',
      status: 'sent',
      updated_at: new Date().toISOString(),
    }).eq('id', quoteId);

    await admin.from('quote_send_log').insert({
      quote_id: quoteId,
      channel: 'sms',
      recipient: recipientPhone,
      sent_by: auth.user.id,
      delivery_status: 'sent',
      provider_message_id: twilioMsg.sid,
    });

    await admin.from('quote_status_history').insert({
      quote_id: quoteId,
      old_status: quote.status,
      new_status: 'sent',
      changed_by: auth.user.id,
      reason: 'Sent via SMS',
    });

    // Automation: move pipeline deal to Quote Sent
    if (quote.lead_id) {
      const { data: deal } = await admin.from('pipeline_deals')
        .select('id').eq('lead_id', quote.lead_id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (deal) {
        await admin.rpc('set_deal_stage', { p_deal_id: deal.id, p_stage: 'quote_sent' });
      }
    }

    // Emit automation event for quote follow-up workflows
    try {
      await eventBus.emit('quote.sent', {
        orgId: auth.orgId,
        entityType: 'quote',
        entityId: quoteId,
        actorId: auth.user.id,
        metadata: {
          lead_id: quote.lead_id || null,
          channel: 'sms',
          quote_number: quote.quote_number || '',
          client_name: quote.client_name || '',
        },
      });
    } catch (e: any) {
      console.error('[quotes] failed to emit quote.sent event:', e.message);
    }

    return res.json({ ok: true, channel: 'sms', recipient: recipientPhone });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to send quote SMS.', '[quotes/send-sms]');
  }
});

// ── Convert quote to job ──
router.post('/quotes/convert-to-job', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { quoteId } = req.body;
    if (!quoteId) return res.status(400).json({ error: 'quoteId is required.' });

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes').select('*').eq('id', quoteId).eq('org_id', auth.orgId).single();
    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    if (quote.status === 'converted') return res.status(400).json({ error: 'Quote already converted.' });

    // Create job via RPC
    const { data: rpcResult, error: rpcError } = await auth.client.rpc('rpc_create_job_with_optional_schedule', {
      p_lead_id: quote.lead_id || null,
      p_client_id: quote.client_id || null,
      p_team_id: null,
      p_title: quote.title || `Job from Quote #${quote.quote_number}`,
      p_job_number: null,
      p_job_type: null,
      p_status: 'draft',
      p_address: null,
      p_notes: quote.notes || null,
      p_scheduled_at: null,
      p_end_at: null,
      p_timezone: 'America/Montreal',
    });
    if (rpcError) throw rpcError;
    const jobId = String((rpcResult as any)?.job_id || '');

    // Copy quote line items to job line items
    const { data: quoteItems } = await admin
      .from('quote_line_items').select('*').eq('quote_id', quoteId)
      .eq('item_type', 'service').order('sort_order');

    if (quoteItems && quoteItems.length > 0) {
      const jobLineItems = quoteItems
        .filter((item: any) => !item.is_optional)
        .map((item: any) => ({
          job_id: jobId,
          name: item.name,
          qty: item.quantity,
          unit_price_cents: item.unit_price_cents,
          total_cents: item.total_cents,
          included: true,
        }));
      if (jobLineItems.length > 0) {
        await admin.from('job_line_items').insert(jobLineItems);
      }
    }

    // Update job financials + transfer deposit settings from quote
    await admin.from('jobs').update({
      total_cents: quote.total_cents,
      total_amount: quote.total_cents / 100,
      subtotal: quote.subtotal_cents / 100,
      tax_total: quote.tax_cents / 100,
      total: quote.total_cents / 100,
      deposit_required: quote.deposit_required || false,
      deposit_type: quote.deposit_type || null,
      deposit_value: quote.deposit_value || null,
      require_payment_method: quote.require_payment_method || false,
    }).eq('id', jobId).eq('org_id', auth.orgId);

    // Update quote status to converted
    await admin.from('quotes').update({
      status: 'converted',
      converted_at: new Date().toISOString(),
      job_id: jobId,
      updated_at: new Date().toISOString(),
    }).eq('id', quoteId).eq('org_id', auth.orgId);

    await admin.from('quote_status_history').insert({
      quote_id: quoteId,
      old_status: quote.status,
      new_status: 'converted',
      changed_by: auth.user.id,
      reason: `Converted to job ${jobId}`,
    });

    return res.json({ ok: true, jobId, quoteId });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to convert quote.', '[quotes/convert-to-job]');
  }
});

// ══════════════════════════════════════════════════════════════
// PUBLIC: Get full quote data by view_token (no auth)
// ══════════════════════════════════════════════════════════════

router.get('/quotes/public/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ error: 'Token is required.' });

    const admin = getServiceClient();

    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('id, quote_number, title, status, valid_until, created_at, subtotal_cents, discount_cents, tax_rate_label, tax_cents, total_cents, currency, notes, contract_disclaimer, deposit_required, deposit_type, deposit_value, deposit_cents, deposit_status, require_payment_method, approved_at, declined_at, org_id, view_token, client_id, lead_id')
      .eq('view_token', token)
      .is('deleted_at', null)
      .maybeSingle();

    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    // Company branding
    const { data: companyData } = await admin
      .from('company_settings')
      .select('company_name, logo_url, phone, email, website, street1, city, province, postal_code, country')
      .eq('org_id', quote.org_id)
      .maybeSingle();

    // Line items
    const { data: items } = await admin
      .from('quote_line_items')
      .select('id, name, description, quantity, unit_price_cents, total_cents, is_optional, item_type')
      .eq('quote_id', quote.id)
      .order('sort_order', { ascending: true });

    // Client or lead
    let client = null;
    let lead = null;
    if (quote.client_id) {
      const { data: c } = await admin
        .from('clients')
        .select('first_name, last_name, company, email, phone')
        .eq('id', quote.client_id)
        .is('deleted_at', null)
        .maybeSingle();
      client = c;
    }
    if (quote.lead_id) {
      const { data: l } = await admin
        .from('leads')
        .select('first_name, last_name, company, email, phone')
        .eq('id', quote.lead_id)
        .is('deleted_at', null)
        .maybeSingle();
      lead = l;
    }

    // Signature (if approved)
    let signature = null;
    if (['approved', 'converted'].includes(quote.status)) {
      const { data: sig } = await admin
        .from('quote_attachments')
        .select('file_url, file_name, uploaded_at')
        .eq('quote_id', quote.id)
        .eq('source_type', 'signature')
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sig?.file_url) {
        const signerName = sig.file_name
          ?.replace(/^signature_/, '')
          .replace(/\.png$/, '')
          .replace(/_/g, ' ') || '';
        signature = { signer_name: signerName, signature_url: sig.file_url, signed_at: sig.uploaded_at || quote.approved_at };
      }
    }

    return res.json({
      quote: {
        id: quote.id, quote_number: quote.quote_number, title: quote.title, status: quote.status,
        valid_until: quote.valid_until, created_at: quote.created_at,
        subtotal_cents: Number(quote.subtotal_cents || 0), discount_cents: Number(quote.discount_cents || 0),
        tax_rate_label: quote.tax_rate_label || 'Tax', tax_cents: Number(quote.tax_cents || 0),
        total_cents: Number(quote.total_cents || 0), currency: quote.currency || 'CAD',
        notes: quote.notes, contract_disclaimer: quote.contract_disclaimer,
        deposit_required: quote.deposit_required, deposit_type: quote.deposit_type,
        deposit_value: Number(quote.deposit_value || 0), deposit_cents: Number(quote.deposit_cents || 0),
        deposit_status: quote.deposit_status || null, require_payment_method: quote.require_payment_method || false,
        approved_at: quote.approved_at, declined_at: quote.declined_at,
        org_id: quote.org_id, view_token: quote.view_token,
      },
      company: {
        company_name: companyData?.company_name || 'Business', logo_url: companyData?.logo_url || null,
        phone: companyData?.phone || null, email: companyData?.email || null, website: companyData?.website || null,
        street1: companyData?.street1 || null, city: companyData?.city || null,
        province: companyData?.province || null, postal_code: companyData?.postal_code || null,
        country: companyData?.country || null,
      },
      client, lead,
      items: (items || []).map((i: any) => ({
        id: i.id, name: i.name, description: i.description,
        quantity: Number(i.quantity || 0), unit_price_cents: Number(i.unit_price_cents || 0),
        total_cents: Number(i.total_cents || 0), is_optional: i.is_optional, item_type: i.item_type,
      })),
      signature,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load quote.', '[quotes/public/get]');
  }
});

// ══════════════════════════════════════════════════════════════
// PUBLIC: Accept / Decline quote (no auth — uses view_token)
// ══════════════════════════════════════════════════════════════

router.post('/quotes/public/accept', async (req, res) => {
  try {
    const { view_token, signer_name, signature_data } = req.body;
    if (!view_token) return res.status(400).json({ error: 'view_token is required.' });
    if (!signer_name || !signature_data) return res.status(400).json({ error: 'Signature and name are required.' });

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('id, org_id, quote_number, status, valid_until, client_id, lead_id, deposit_required, deposit_type, deposit_value, total_cents, currency, require_payment_method')
      .eq('view_token', view_token)
      .is('deleted_at', null)
      .maybeSingle();

    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    // Check if already responded or expired
    if (['approved', 'declined', 'converted', 'expired'].includes(quote.status)) {
      return res.status(400).json({ error: `Quote is already ${quote.status}.` });
    }
    if (quote.valid_until && new Date(quote.valid_until) < new Date()) {
      return res.status(400).json({ error: 'Quote has expired.' });
    }

    const now = new Date().toISOString();

    // Update quote status
    const depositStatus = quote.deposit_required ? 'pending' : 'not_required';
    await admin.from('quotes').update({
      status: 'approved',
      approved_at: now,
      updated_at: now,
      deposit_status: depositStatus,
    }).eq('id', quote.id);

    // Create payment requirement if deposit is required
    if (quote.deposit_required && quote.deposit_value > 0) {
      const depositCents = quote.deposit_type === 'percentage'
        ? Math.round(quote.total_cents * Number(quote.deposit_value) / 100)
        : Math.round(Number(quote.deposit_value) * 100);

      await admin.from('payment_requirements').insert({
        org_id: quote.org_id,
        entity_type: 'quote',
        entity_id: quote.id,
        requirement_type: 'deposit',
        amount_cents: depositCents,
        currency: quote.currency || 'CAD',
        status: 'pending',
        payment_method_required: quote.require_payment_method || false,
        notes: `Deposit for Quote #${quote.quote_number}`,
      });

      // Update deposit_cents on the quote
      await admin.from('quotes').update({ deposit_cents: depositCents }).eq('id', quote.id);
    }

    // Create payment method requirement if needed
    if (quote.require_payment_method && !quote.deposit_required) {
      await admin.from('payment_requirements').insert({
        org_id: quote.org_id,
        entity_type: 'quote',
        entity_id: quote.id,
        requirement_type: 'payment_method_on_file',
        amount_cents: 0,
        currency: quote.currency || 'CAD',
        status: 'pending',
        payment_method_required: true,
        notes: `Payment method required for Quote #${quote.quote_number}`,
      });
    }

    // Log status change
    await admin.from('quote_status_history').insert({
      quote_id: quote.id,
      old_status: quote.status,
      new_status: 'approved',
      changed_by: null,
      reason: `Accepted by ${signer_name} (electronic signature)`,
    });

    // Store signature in quote_attachments
    await admin.from('quote_attachments').insert({
      quote_id: quote.id,
      file_url: signature_data,
      file_name: `signature_${signer_name.replace(/\s+/g, '_')}.png`,
      file_type: 'image/png',
      uploaded_by: null,
      source_type: 'signature',
    });

    // Resolve client name
    let clientName = signer_name;
    if (quote.client_id) {
      const { data: client } = await admin
        .from('clients').select('first_name, last_name')
        .eq('id', quote.client_id).maybeSingle();
      if (client) clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || signer_name;
    }

    // Create notification
    await admin.from('notifications').insert({
      org_id: quote.org_id,
      type: 'quote_accepted',
      title: `${clientName} accepted quote #${quote.quote_number}`,
      body: `Quote #${quote.quote_number} has been accepted and signed by ${signer_name}.`,
      icon: 'check-circle',
      reference_id: quote.id,
    });

    // Emit event
    eventBus.emit('quote.approved', {
      orgId: quote.org_id,
      entityType: 'quote',
      entityId: quote.id,
      metadata: { quote_number: quote.quote_number, signer_name, accepted_via: 'electronic_signature' },
    });

    // Automation: move pipeline deal to Closed Won
    if (quote.lead_id) {
      const { data: deal } = await admin.from('pipeline_deals')
        .select('id').eq('lead_id', quote.lead_id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (deal) {
        await admin.rpc('set_deal_stage', { p_deal_id: deal.id, p_stage: 'closed_won' });
      }
    }

    return res.json({ ok: true, status: 'approved' });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to accept quote.', '[quotes/public/accept]');
  }
});

// ── Public: Get signature for accepted quote ──
router.get('/quotes/public/signature', async (req, res) => {
  try {
    const view_token = String(req.query.view_token || '').trim();
    if (!view_token) return res.status(400).json({ error: 'view_token is required.' });

    const admin = getServiceClient();
    const { data: quote } = await admin
      .from('quotes')
      .select('id, status, approved_at')
      .eq('view_token', view_token)
      .is('deleted_at', null)
      .maybeSingle();

    if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    if (!['approved', 'converted'].includes(quote.status)) {
      return res.json({ signature_url: null });
    }

    const { data: sig } = await admin
      .from('quote_attachments')
      .select('file_url, file_name, uploaded_at')
      .eq('quote_id', quote.id)
      .eq('source_type', 'signature')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!sig) return res.json({ signature_url: null });

    const signerName = sig.file_name
      ?.replace(/^signature_/, '')
      .replace(/\.png$/, '')
      .replace(/_/g, ' ') || '';

    return res.json({
      signature_url: sig.file_url,
      signer_name: signerName,
      signed_at: sig.uploaded_at || quote.approved_at,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load signature.', '[quotes/public/signature]');
  }
});

// ── Public: Create Stripe payment intent for quote deposit ──
router.post('/quotes/public/deposit-intent', async (req, res) => {
  try {
    const { view_token } = req.body;
    if (!view_token) return res.status(400).json({ error: 'view_token is required.' });

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('id, org_id, quote_number, status, deposit_required, deposit_type, deposit_value, deposit_cents, deposit_status, total_cents, currency, client_id')
      .eq('view_token', view_token)
      .is('deleted_at', null)
      .maybeSingle();

    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });
    if (quote.status !== 'approved') return res.status(400).json({ error: 'Quote must be approved first.' });
    if (!quote.deposit_required || quote.deposit_status === 'paid') {
      return res.status(400).json({ error: 'No deposit payment required.' });
    }

    // Calculate deposit amount (server-side, never trust client)
    let depositCents = Number(quote.deposit_cents || 0);
    if (depositCents <= 0) {
      depositCents = quote.deposit_type === 'percentage'
        ? Math.round(quote.total_cents * Number(quote.deposit_value) / 100)
        : Math.round(Number(quote.deposit_value) * 100);
    }
    if (depositCents <= 0) return res.status(400).json({ error: 'Invalid deposit amount.' });

    const currency = (quote.currency || 'CAD').toLowerCase();

    // Find or verify existing payment requirement
    const { data: existingReq } = await admin
      .from('payment_requirements')
      .select('id, status, notes')
      .eq('entity_type', 'quote')
      .eq('entity_id', quote.id)
      .eq('requirement_type', 'deposit')
      .eq('status', 'pending')
      .maybeSingle();

    const paymentMetadata: Record<string, string> = {
      org_id: quote.org_id,
      quote_id: quote.id,
      entity_type: 'quote_deposit',
      quote_number: quote.quote_number,
      client_id: quote.client_id || '',
      payment_requirement_id: existingReq?.id || '',
    };

    // ── Try 3 payment paths in order of preference ──

    // PATH 1: Stripe Connect (destination charge)
    let connectedAccount;
    try {
      connectedAccount = await getConnectedAccount(quote.org_id);
    } catch {
      connectedAccount = null;
    }

    if (connectedAccount && connectedAccount.charges_enabled) {
      const result = await createDestinationPaymentIntent({
        amountCents: depositCents,
        currency,
        connectedAccountId: connectedAccount.stripe_account_id,
        metadata: paymentMetadata,
      });

      return res.json({
        client_secret: result.clientSecret,
        payment_intent_id: result.paymentIntentId,
        amount_cents: depositCents,
        currency: currency.toUpperCase(),
        publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || '',
      });
    }

    // PATH 2: Org's own Stripe keys (direct charge, only if key is not encrypted)
    const { data: orgSecrets } = await admin
      .from('payment_provider_secrets')
      .select('stripe_publishable_key, stripe_secret_key_enc')
      .eq('org_id', quote.org_id)
      .maybeSingle();

    if (orgSecrets?.stripe_secret_key_enc?.startsWith('sk_') && orgSecrets?.stripe_publishable_key) {
      const Stripe = (await import('stripe')).default;
      const orgStripe = new Stripe(orgSecrets.stripe_secret_key_enc);
      const intent = await orgStripe.paymentIntents.create({
        amount: depositCents,
        currency,
        payment_method_types: ['card'],
        metadata: paymentMetadata,
      });

      return res.json({
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: depositCents,
        currency: currency.toUpperCase(),
        publishable_key: orgSecrets.stripe_publishable_key,
      });
    }

    // PATH 3: Platform Stripe keys (direct charge, simplest fallback)
    const platformSecretKey = process.env.STRIPE_SECRET_KEY;
    const platformPublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

    if (platformSecretKey && platformPublishableKey) {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(platformSecretKey);
      const intent = await stripe.paymentIntents.create({
        amount: depositCents,
        currency,
        payment_method_types: ['card'],
        metadata: paymentMetadata,
      });

      return res.json({
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: depositCents,
        currency: currency.toUpperCase(),
        publishable_key: platformPublishableKey,
      });
    }

    return res.status(503).json({ error: 'No payment provider is configured.' });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to create deposit payment.', '[quotes/public/deposit-intent]');
  }
});

// ── Public: Confirm deposit payment (called after Stripe confirmPayment succeeds) ──
router.post('/quotes/public/deposit-confirm', async (req, res) => {
  try {
    const { view_token, payment_intent_id } = req.body;
    if (!view_token || !payment_intent_id) {
      return res.status(400).json({ error: 'view_token and payment_intent_id are required.' });
    }

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('id, org_id, quote_number, deposit_status, deposit_required')
      .eq('view_token', view_token)
      .is('deleted_at', null)
      .maybeSingle();

    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    // Already paid? Return success idempotently
    if (quote.deposit_status === 'paid') {
      return res.json({ ok: true, status: 'paid' });
    }

    // Verify with Stripe that the payment actually succeeded
    const Stripe = (await import('stripe')).default;
    const platformKey = process.env.STRIPE_SECRET_KEY;
    let intent;
    try {
      const stripe = new Stripe(platformKey!);
      intent = await stripe.paymentIntents.retrieve(payment_intent_id);
    } catch {
      // Try with org keys if platform key doesn't own this intent
      const { data: orgSecrets } = await admin
        .from('payment_provider_secrets')
        .select('stripe_secret_key_enc')
        .eq('org_id', quote.org_id)
        .maybeSingle();
      if (orgSecrets?.stripe_secret_key_enc) {
        const Stripe = (await import('stripe')).default;
        const orgStripe = new Stripe(orgSecrets.stripe_secret_key_enc);
        intent = await orgStripe.paymentIntents.retrieve(payment_intent_id);
      }
    }

    if (!intent || intent.status !== 'succeeded') {
      const status = intent?.status || 'unknown';
      if (status === 'requires_action' || status === 'requires_payment_method') {
        return res.status(402).json({ error: 'Payment requires additional action.', status });
      }
      return res.status(400).json({ error: `Payment not confirmed. Status: ${status}` });
    }

    // Verify the metadata matches this quote
    const intentQuoteId = intent.metadata?.quote_id;
    if (intentQuoteId && intentQuoteId !== quote.id) {
      return res.status(400).json({ error: 'Payment does not match this quote.' });
    }

    // Update quote deposit status
    await admin.from('quotes').update({
      deposit_status: 'paid',
      updated_at: new Date().toISOString(),
    }).eq('id', quote.id);

    // Update payment requirement
    const { data: payReq } = await admin
      .from('payment_requirements')
      .select('id')
      .eq('entity_type', 'quote')
      .eq('entity_id', quote.id)
      .eq('requirement_type', 'deposit')
      .in('status', ['pending', 'authorized'])
      .maybeSingle();

    if (payReq) {
      await admin.from('payment_requirements').update({
        status: 'paid',
        updated_at: new Date().toISOString(),
      }).eq('id', payReq.id);
    }

    // Log status change
    await admin.from('quote_status_history').insert({
      quote_id: quote.id,
      old_status: 'pending',
      new_status: 'paid',
      changed_by: null,
      reason: `Deposit paid via Stripe (${payment_intent_id})`,
    });

    return res.json({ ok: true, status: 'paid' });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to confirm deposit payment.', '[quotes/public/deposit-confirm]');
  }
});

router.post('/quotes/public/decline', async (req, res) => {
  try {
    const { view_token, reason } = req.body;
    if (!view_token) return res.status(400).json({ error: 'view_token is required.' });

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('id, org_id, quote_number, status, client_id, lead_id')
      .eq('view_token', view_token)
      .is('deleted_at', null)
      .maybeSingle();

    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    if (['approved', 'declined', 'converted'].includes(quote.status)) {
      return res.status(400).json({ error: `Quote is already ${quote.status}.` });
    }

    const now = new Date().toISOString();

    await admin.from('quotes').update({
      status: 'declined',
      declined_at: now,
      updated_at: now,
    }).eq('id', quote.id);

    await admin.from('quote_status_history').insert({
      quote_id: quote.id,
      old_status: quote.status,
      new_status: 'declined',
      changed_by: null,
      reason: reason || 'Declined by client',
    });

    // Resolve client name
    let clientName = 'Client';
    if (quote.client_id) {
      const { data: client } = await admin
        .from('clients').select('first_name, last_name')
        .eq('id', quote.client_id).maybeSingle();
      if (client) clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client';
    } else if (quote.lead_id) {
      const { data: lead } = await admin
        .from('leads').select('first_name, last_name')
        .eq('id', quote.lead_id).maybeSingle();
      if (lead) clientName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Client';
    }

    await admin.from('notifications').insert({
      org_id: quote.org_id,
      type: 'quote_declined',
      title: `${clientName} declined quote #${quote.quote_number}`,
      body: reason ? `Reason: ${reason}` : `Quote #${quote.quote_number} was declined.`,
      icon: 'x-circle',
      reference_id: quote.id,
    });

    eventBus.emit('quote.declined', {
      orgId: quote.org_id,
      entityType: 'quote',
      entityId: quote.id,
      metadata: { quote_number: quote.quote_number, reason },
    });

    // Automation: move pipeline deal to Closed Lost
    if (quote.lead_id) {
      const { data: deal } = await admin.from('pipeline_deals')
        .select('id').eq('lead_id', quote.lead_id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (deal) {
        await admin.rpc('set_deal_stage', { p_deal_id: deal.id, p_stage: 'closed_lost' });
      }
    }

    return res.json({ ok: true, status: 'declined' });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to decline quote.', '[quotes/public/decline]');
  }
});

// ══════════════════════════════════════════════════════════════
// Convert approved quote to invoice (Feature 13)
// ══════════════════════════════════════════════════════════════

router.post('/quotes/convert-to-invoice', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { quoteId } = req.body;
    if (!quoteId) return res.status(400).json({ error: 'quoteId is required.' });

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes').select('*').eq('id', quoteId).eq('org_id', auth.orgId).single();
    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    if (!['approved', 'sent', 'awaiting_response', 'action_required'].includes(quote.status)) {
      return res.status(400).json({ error: `Cannot convert quote with status "${quote.status}".` });
    }

    // Create invoice via RPC
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    const dueDateStr = dueDate.toISOString().slice(0, 10);

    const { data: rpcResult, error: rpcError } = await auth.client.rpc('rpc_create_invoice_draft', {
      p_client_id: quote.client_id || null,
      p_subject: quote.title || `From Quote #${quote.quote_number}`,
      p_due_date: dueDateStr,
    });
    if (rpcError) throw rpcError;
    const invoiceRow = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    const invoiceId = String(invoiceRow?.id || '');
    if (!invoiceId) throw new Error('Invoice created but id is missing.');

    // Copy quote line items to invoice items
    const { data: quoteItems } = await admin
      .from('quote_line_items').select('*').eq('quote_id', quoteId)
      .eq('item_type', 'service').order('sort_order');

    if (quoteItems && quoteItems.length > 0) {
      const invoiceItems = quoteItems
        .filter((item: any) => !item.is_optional)
        .map((item: any) => ({
          invoice_id: invoiceId,
          description: item.name + (item.description ? ` — ${item.description}` : ''),
          qty: Number(item.quantity) || 1,
          unit_price_cents: item.unit_price_cents,
          line_total_cents: item.total_cents,
        }));
      if (invoiceItems.length > 0) {
        await admin.from('invoice_items').insert(invoiceItems);
      }
    }

    // Update invoice totals
    await admin.from('invoices').update({
      subtotal_cents: quote.subtotal_cents,
      tax_cents: quote.tax_cents,
      total_cents: quote.total_cents,
      balance_cents: quote.total_cents,
      notes: quote.notes,
    }).eq('id', invoiceId).eq('org_id', auth.orgId);

    // Mark quote as converted
    await admin.from('quotes').update({
      status: 'converted',
      converted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', quoteId).eq('org_id', auth.orgId);

    await admin.from('quote_status_history').insert({
      quote_id: quoteId,
      old_status: quote.status,
      new_status: 'converted',
      changed_by: auth.user.id,
      reason: `Converted to invoice ${invoiceId}`,
    });

    return res.json({ ok: true, invoiceId, quoteId });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to convert quote to invoice.', '[quotes/convert-to-invoice]');
  }
});

export default router;
