import { Router } from 'express';
import { Resend } from 'resend';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { resendApiKey, emailFrom, twilioClient, twilioPhoneNumber } from '../lib/config';
import { parseOrgId, resolvePublicBaseUrl } from '../lib/helpers';
import { eventBus } from '../lib/eventBus';

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
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    return res.redirect(`${frontendUrl}/quote/${token}`);
  } catch (error: any) {
    console.error('Quote view tracking error:', error);
    return res.status(500).send('Something went wrong');
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
    console.error('Track view error:', error);
    return res.status(500).json({ error: 'Failed to track view' });
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

    const { quoteId } = req.body;
    if (!quoteId) return res.status(400).json({ error: 'quoteId is required.' });

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('*, leads(first_name, last_name, email, phone), clients(first_name, last_name, email, phone)')
      .eq('id', quoteId)
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

    if (!resendApiKey) return res.status(503).json({ error: 'Email provider not configured.' });
    const resend = new Resend(resendApiKey);

    // Get company info
    const { data: company } = await admin
      .from('company_settings')
      .select('company_name, phone, email')
      .eq('org_id', quote.org_id)
      .maybeSingle();

    const companyName = company?.company_name || 'Our Company';
    const baseUrl = resolvePublicBaseUrl(req);
    const quoteUrl = `${baseUrl}/quote/${quote.view_token}`;
    const totalFormatted = new Intl.NumberFormat('en-CA', { style: 'currency', currency: quote.currency || 'CAD' }).format(quote.total_cents / 100);

    const emailHtml = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
        <h2>Hello ${recipientName},</h2>
        <p>${companyName} has sent you a quote.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Quote #</td><td style="padding:8px;border:1px solid #ddd;">${quote.quote_number}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Amount</td><td style="padding:8px;border:1px solid #ddd;">${totalFormatted}</td></tr>
          ${quote.valid_until ? `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:600;">Valid Until</td><td style="padding:8px;border:1px solid #ddd;">${quote.valid_until}</td></tr>` : ''}
        </table>
        <p style="text-align:center;margin:30px 0;">
          <a href="${quoteUrl}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">View Quote</a>
        </p>
        <p>Thank you,<br/>${companyName}</p>
      </div>
    `;

    await resend.emails.send({
      from: emailFrom || `${companyName} <onboarding@resend.dev>`,
      to: recipientEmail,
      subject: `Quote #${quote.quote_number} from ${companyName} — ${totalFormatted}`,
      html: emailHtml,
    });

    // Update quote
    await admin.from('quotes').update({
      sent_via_email_at: new Date().toISOString(),
      last_sent_channel: 'email',
      status: 'sent',
      updated_at: new Date().toISOString(),
    }).eq('id', quoteId);

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

    return res.json({ ok: true, channel: 'email', recipient: recipientEmail });
  } catch (error: any) {
    console.error('quote_send_email_failed', error);
    return res.status(500).json({ error: error?.message || 'Failed to send quote email.' });
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
      to: recipientPhone,
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

    return res.json({ ok: true, channel: 'sms', recipient: recipientPhone });
  } catch (error: any) {
    console.error('quote_send_sms_failed', error);
    return res.status(500).json({ error: error?.message || 'Failed to send quote SMS.' });
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
      .from('quotes').select('*').eq('id', quoteId).single();
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

    // Update job financials
    await admin.from('jobs').update({
      total_cents: quote.total_cents,
      total_amount: quote.total_cents / 100,
      subtotal: quote.subtotal_cents / 100,
      tax_total: quote.tax_cents / 100,
      total: quote.total_cents / 100,
    }).eq('id', jobId);

    // Update quote status to converted
    await admin.from('quotes').update({
      status: 'converted',
      converted_at: new Date().toISOString(),
      job_id: jobId,
      updated_at: new Date().toISOString(),
    }).eq('id', quoteId);

    await admin.from('quote_status_history').insert({
      quote_id: quoteId,
      old_status: quote.status,
      new_status: 'converted',
      changed_by: auth.user.id,
      reason: `Converted to job ${jobId}`,
    });

    return res.json({ ok: true, jobId, quoteId });
  } catch (error: any) {
    console.error('quote_convert_failed', error);
    return res.status(500).json({ error: error?.message || 'Failed to convert quote.' });
  }
});

export default router;
