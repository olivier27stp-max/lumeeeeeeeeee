import { Router } from 'express';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { emailFrom, twilioClient, getBaseUrl, getTwilioStatusCallbackUrl } from '../lib/config';
import { isSmsOptedOut } from '../lib/notificationHelpers';
import { getOrgSmsFromNumber, SmsNumberNotProvisionedError, SmsNotInPlanError } from '../lib/twilioProvisioning';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { parseOrgId, resolvePublicBaseUrl } from '../lib/helpers';
import { eventBus } from '../lib/eventBus';
import { getConnectedAccount, createDestinationPaymentIntent, getPlatformStripe } from '../lib/stripe-connect';
import { decryptSecret } from '../../src/lib/crypto';
import { sendSafeError } from '../lib/error-handler';
import { recordClientActivity } from '../lib/clientActivity';
import { getCompanyBranding } from '../lib/companyBranding';
import { estEchue } from '../lib/date-seule';

const router = Router();

// ─── Public endpoint Zod schemas ──────────────────────────────
const viewTokenRegex = /^[a-zA-Z0-9_-]{16,128}$/;
// Signature data URL — ONLY PNG/JPEG base64. Rejects data:text/html,
// data:image/svg+xml (SVG can contain <script>/onload), and any other MIME.
// Audit P1-D11.
const signatureDataUrlRegex = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const publicAcceptSchema = z.object({
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
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    if (
      buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47 ||
      buf[4] !== 0x0d || buf[5] !== 0x0a || buf[6] !== 0x1a || buf[7] !== 0x0a
    ) return 'Signature is not a valid PNG.';
  } else {
    // JPEG magic: FF D8 FF
    if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return 'Signature is not a valid JPEG.';
  }
  return null;
}
const publicDepositIntentSchema = z.object({
  view_token: z.string().regex(viewTokenRegex, 'Invalid view_token.'),
});
const publicDepositConfirmSchema = z.object({
  view_token: z.string().regex(viewTokenRegex, 'Invalid view_token.'),
  payment_intent_id: z.string().trim().min(1).max(200),
});
const publicDeclineSchema = z.object({
  view_token: z.string().regex(viewTokenRegex, 'Invalid view_token.'),
  reason: z.string().trim().max(2000).optional().nullable(),
});
const publicRequestChangesSchema = z.object({
  view_token: z.string().regex(viewTokenRegex, 'Invalid view_token.'),
  message: z.string().trim().min(1, 'Message is required.').max(2000),
});
const trackViewSchema = z.object({
  viewer_fingerprint: z.string().trim().max(200).optional().nullable(),
}).passthrough();

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
    const frontendUrl = getBaseUrl();

    // Redirect immediately — tracking writes happen in background (non-critical for UX)
    res.redirect(`${frontendUrl}/quote/${token}`);

    // Fire-and-forget: update invoice + insert view log in parallel
    const bgTasks: Promise<unknown>[] = [
      Promise.resolve(
        serviceClient
          .from('invoices')
          .update({
            is_viewed: true,
            viewed_at: isFirstView ? now : undefined,
            view_count: (invoice.view_count || 0) + 1,
            last_viewed_at: now,
          })
          .eq('id', invoice.id)
      ),
      Promise.resolve(
        serviceClient
          .from('quote_views')
          .insert({
            invoice_id: invoice.id,
            client_id: invoice.client_id,
            ip_address: req.ip || req.headers['x-forwarded-for'] || null,
            user_agent: req.headers['user-agent'] || null,
          })
      ),
    ];

    if (isFirstView) {
      bgTasks.push((async () => {
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
      })());
    }

    Promise.all(bgTasks).catch((err) => {
      console.error('[quotes/view-redirect] background tracking failed:', err?.message || err);
    });
    return;
  } catch (error: any) {
    return sendSafeError(res, error, 'Something went wrong.', '[quotes/view-redirect]');
  }
});

// POST /api/quotes/:id/track-view — track a view using view_token (public, rate-limited)
router.post('/quotes/:id/track-view', async (req, res) => {
  try {
    const { id } = req.params;
    const serviceClient = getServiceClient();

    // SECURITY 2026-05-12: only accept lookup by view_token. The previous
    // implementation also accepted a raw UUID as the document ID for
    // "backward compat with authed callers" — but the route is public, so
    // any anon could enumerate invoices and spam notifications by POSTing
    // /api/quotes/{any-uuid}/track-view. Token-only closes that.
    //
    // 2026-09-06 : le garde qui rejetait tout identifiant « en forme d'UUID »
    // a été retiré. `quotes.view_token` et `invoices.view_token` SONT des
    // UUID (gen_random_uuid()) : il rejetait donc 100 % des jetons
    // légitimes. Vérifié en prod : 10 documents envoyés, 0 ouverture
    // enregistrée, 0 notification « le client a ouvert votre devis ».
    // La sécurité tient déjà par la recherche ci-dessous, qui ne compare
    // QUE view_token — un identifiant de document, même deviné, ne
    // correspond à rien.
    if (!id) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const { data: invoice, error } = await serviceClient
      .from('invoices')
      .select('id, invoice_number, client_id, org_id, is_viewed, view_count')
      .is('deleted_at', null)
      .eq('view_token', id)
      .maybeSingle();

    if (error || !invoice) {
      // Pas une facture — le token peut appartenir à un devis (table quotes).
      // Avant, ce chemin 404ait toujours: aucune ouverture de devis n'était
      // jamais enregistrée ni notifiée.
      const { data: quote } = await serviceClient
        .from('quotes')
        .select('id, quote_number, client_id, lead_id, org_id, is_viewed, view_count')
        .is('deleted_at', null)
        .eq('view_token', id)
        .maybeSingle();

      if (!quote) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      const firstQuoteView = !quote.is_viewed;
      const nowIso = new Date().toISOString();

      await serviceClient
        .from('quotes')
        .update({
          is_viewed: true,
          viewed_at: firstQuoteView ? nowIso : undefined,
          view_count: (quote.view_count || 0) + 1,
          last_viewed_at: nowIso,
        })
        .eq('id', quote.id);

      const contactId = quote.client_id || quote.lead_id;
      await serviceClient
        .from('quote_views')
        .insert({
          quote_id: quote.id,
          client_id: contactId,
          ip_address: req.ip || req.headers['x-forwarded-for'] || null,
          user_agent: req.headers['user-agent'] || null,
        });

      if (contactId) void recordClientActivity(serviceClient, contactId);

      if (firstQuoteView) {
        let contactName = 'Client';
        if (contactId) {
          const { data: contact } = await serviceClient
            .from('clients')
            .select('first_name, last_name')
            .eq('id', contactId)
            .is('deleted_at', null)
            .maybeSingle();
          if (contact) {
            contactName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Client';
          }
        }

        await serviceClient
          .from('notifications')
          .insert({
            org_id: quote.org_id,
            type: 'quote_opened',
            title: `${contactName} opened quote ${quote.quote_number}`,
            body: `${contactName} has viewed their quote for the first time.`,
            icon: 'eye',
            link: `/quotes/${quote.id}`,
            reference_id: quote.id,
          });
      }

      return res.json({ tracked: true, first_view: firstQuoteView });
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

    // Client opened a quote/invoice link — stamp last activity (fire-and-forget).
    void recordClientActivity(serviceClient, invoice.client_id);

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
      .select('*, lead:clients!quotes_lead_id_fkey(first_name, last_name, email, phone), client:clients!quotes_client_id_fkey(first_name, last_name, email, phone)')
      .eq('id', quoteId)
      .eq('org_id', auth.orgId)
      .single();
    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    // Resolve recipient email
    const lead = quote.lead as any;
    const client = quote.client as any;
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

    // Le résultat DOIT être lu : `sendEmail` ne lève jamais, donc un appel nu
    // laissait passer tous les effets de bord ci-dessous alors qu'aucun
    // courriel n'était parti — statut avancé, `delivery_status: 'sent'` écrit
    // en dur, deal poussé dans le pipeline, relances automatiques déclenchées,
    // et une réponse HTTP 200 affirmant l'envoi. Le client n'avait rien reçu,
    // l'org voyait « envoyé » partout.
    const emailResult = await sendEmail({
      from: emailFrom,
      to: recipientEmail,
      subject: finalSubject,
      html: emailHtml,
    });
    if (!emailResult.sent) {
      return res.status(502).json({
        error: 'Le courriel n’a pas pu être envoyé. La soumission n’a pas été marquée comme envoyée.',
        code: 'email_send_failed',
        detail: emailResult.error,
      });
    }

    // Update quote — a sent quote is awaiting the client's response.
    // Only pre-response statuses advance; re-sending an approved/converted/
    // declined/expired/archived quote must not knock it back into circulation.
    const advanceStatus = ['draft', 'awaiting_response', 'changes_requested'].includes(quote.status);
    await admin.from('quotes').update({
      sent_via_email_at: new Date().toISOString(),
      last_sent_channel: 'email',
      ...(advanceStatus ? { status: 'awaiting_response' } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', quoteId).eq('org_id', auth.orgId);

    // Log send — `delivery_status` était écrit en dur à 'sent', y compris quand
    // rien n'était parti. On n'atteint désormais cette ligne qu'après un envoi
    // confirmé, mais la valeur reste dérivée du résultat réel.
    await admin.from('quote_send_log').insert({
      quote_id: quoteId,
      channel: 'email',
      recipient: recipientEmail,
      sent_by: auth.user.id,
      delivery_status: emailResult.sent ? 'sent' : 'failed',
    });

    // Log status change
    if (advanceStatus && quote.status !== 'awaiting_response') {
      await admin.from('quote_status_history').insert({
        quote_id: quoteId,
        old_status: quote.status,
        new_status: 'awaiting_response',
        changed_by: auth.user.id,
        reason: 'Sent via email',
      });
    }

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
      .select('*, lead:clients!quotes_lead_id_fkey(first_name, last_name, phone), client:clients!quotes_client_id_fkey(first_name, last_name, phone)')
      .eq('id', quoteId)
      .eq('org_id', auth.orgId) // tenant guard — never send another org's quote from their Twilio number
      .single();
    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    const lead = quote.lead as any;
    const client = quote.client as any;
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

    // Conformité CASL : un destinataire ayant répondu STOP ne doit plus rien
    // recevoir de cette org — y compris les devis.
    if (await isSmsOptedOut(admin, quote.org_id, formattedPhone)) {
      return res.status(409).json({
        error: 'This recipient has opted out of SMS from your organization.',
        code: 'sms_opted_out',
      });
    }

    let fromNumber: string;
    try {
      fromNumber = await getOrgSmsFromNumber(quote.org_id);
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

    const smsStatusCallback = getTwilioStatusCallbackUrl();
    const twilioMsg = await twilioClient.messages.create({
      body: smsBody,
      from: fromNumber,
      to: formattedPhone,
      // Accusé de réception Twilio (sinon le statut reste figé à « envoyé »).
      ...(smsStatusCallback ? { statusCallback: smsStatusCallback } : {}),
    });

    // Only pre-response statuses advance — same rule as the email route.
    const advanceStatus = ['draft', 'awaiting_response', 'changes_requested'].includes(quote.status);
    await admin.from('quotes').update({
      sent_via_sms_at: new Date().toISOString(),
      last_sent_channel: 'sms',
      ...(advanceStatus ? { status: 'awaiting_response' } : {}),
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

    if (advanceStatus && quote.status !== 'awaiting_response') {
      await admin.from('quote_status_history').insert({
        quote_id: quoteId,
        old_status: quote.status,
        new_status: 'awaiting_response',
        changed_by: auth.user.id,
        reason: 'Sent via SMS',
      });
    }

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
    if (quote.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved quotes can be converted to a job.' });
    }

    // Un devis « plan de service » devient un job récurrent (colonnes absentes
    // tant que la migration quote_service_plans n'est pas appliquée → one_off).
    const isServicePlan = quote.quote_type === 'service_plan'
      && quote.service_plan && Array.isArray(quote.service_plan.visits)
      && quote.service_plan.visits.length > 0;

    // Create job via RPC
    const { data: rpcResult, error: rpcError } = await auth.client.rpc('rpc_create_job_with_optional_schedule', {
      p_lead_id: quote.lead_id || null,
      p_client_id: quote.client_id || null,
      p_team_id: null,
      p_title: quote.title || `Job from Quote #${quote.quote_number}`,
      p_job_number: null,
      p_job_type: isServicePlan ? 'recurring' : null,
      p_status: 'draft',
      p_address: null,
      p_notes: quote.notes || null,
      p_scheduled_at: null,
      p_end_at: null,
      p_timezone: 'America/Montreal',
    });
    if (rpcError) throw rpcError;
    const jobId = String((rpcResult as any)?.job_id || '');

    // Contrat de service du plan : mêmes visites que sur la soumission —
    // rien à ressaisir. Non-bloquant.
    if (isServicePlan && jobId) {
      try {
        await admin.from('service_contracts').insert({
          org_id: auth.orgId,
          job_id: jobId,
          client_id: quote.client_id || quote.lead_id || null,
          title: quote.title || `Service plan — Quote #${quote.quote_number}`,
          year: Number(quote.service_plan.year) || new Date().getFullYear(),
          visits: quote.service_plan.visits,
          status: 'active',
          created_by: auth.user.id,
        });
      } catch (contractErr: any) {
        console.error('[quotes/convert-to-job] service contract skipped:', contractErr?.message);
      }
    }

    // Copy quote line items to job line items
    const { data: quoteItems } = await admin
      .from('quote_line_items').select('*').eq('quote_id', quoteId)
      .eq('item_type', 'service').order('sort_order');

    if (quoteItems && quoteItems.length > 0) {
      const jobLineItems = quoteItems
        .filter((item: any) => !item.is_optional)
        .map((item: any) => ({
          job_id: jobId,
          org_id: auth.orgId,
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
    // N1.7 — on n'ecrit QUE les cents. Les colonnes numeric heritees
    // (total, total_amount, subtotal, tax_total) sont recalculees par le
    // trigger sync_jobs_legacy_money ; les ecrire ici creerait une 2e source.
    await admin.from('jobs').update({
      total_cents: quote.total_cents,
      subtotal_cents: quote.subtotal_cents,
      tax_cents: quote.tax_cents,
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

    // Sales map: the quote's pin (🩵 Suivi) becomes 🟢 Fermé/close and is linked
    // to the new job. Matched by quote_id so it works even though the new job has
    // no address yet. Non-blocking — never fail the conversion on pin sync.
    try {
      const nowIso = new Date().toISOString();
      const { data: house } = await admin
        .from('field_house_profiles')
        .select('id')
        .eq('org_id', auth.orgId)
        .eq('quote_id', quoteId)
        .is('deleted_at', null)
        .maybeSingle();
      if (house) {
        await admin.from('field_house_profiles')
          .update({ current_status: 'sale', job_id: jobId, last_activity_at: nowIso, updated_at: nowIso })
          .eq('id', house.id);
        await admin.from('field_pins')
          .update({ status: 'sale', pin_color: '#22C55E', updated_at: nowIso })
          .eq('house_id', house.id);
        await admin.from('field_pin_entity_links').upsert({
          org_id: auth.orgId, house_id: house.id,
          entity_type: 'job', entity_id: jobId, linked_at: nowIso,
        }, { onConflict: 'org_id,house_id,entity_type,entity_id' });
        await admin.from('field_house_events').insert({
          org_id: auth.orgId, house_id: house.id, user_id: auth.user.id,
          event_type: 'sale', note_text: `Devis converti en job ${jobId}`,
          metadata: { quote_id: quoteId, job_id: jobId },
        });
      }
    } catch (pinErr) {
      console.warn('[quotes/convert-to-job] pin sync failed (non-blocking):', pinErr);
    }

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
    const companyData = await getCompanyBranding(
      admin,
      quote.org_id,
      'company_name, logo_url, phone, email, website, street1, city, province, postal_code, country, brand_color',
    );

    // Line items
    const { data: items } = await admin
      .from('quote_line_items')
      .select('id, name, description, quantity, unit_price_cents, discount_type, discount_value, total_cents, is_optional, item_type')
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
        .from('clients')
        .select('first_name, last_name, company, email, phone')
        .eq('id', quote.lead_id)
        .is('deleted_at', null)
        .maybeSingle();
      lead = l;
    }

    // Type + service plan — best-effort: colonnes absentes tant que la
    // migration quote_service_plans n'est pas appliquée.
    let quoteType: string = 'one_off';
    let servicePlan: any = null;
    try {
      const { data: planRow } = await admin
        .from('quotes')
        .select('quote_type, service_plan')
        .eq('id', quote.id)
        .maybeSingle();
      if (planRow) {
        quoteType = planRow.quote_type || 'one_off';
        servicePlan = planRow.service_plan || null;
      }
    } catch { /* migration pending */ }

    // Photos en haut du devis (section 'images' → JSON array d'URLs)
    let images: string[] = [];
    try {
      const { data: imgSection } = await admin
        .from('quote_sections')
        .select('content')
        .eq('quote_id', quote.id)
        .eq('section_type', 'images')
        .eq('enabled', true)
        .maybeSingle();
      if (imgSection?.content) {
        const parsed = JSON.parse(imgSection.content);
        if (Array.isArray(parsed)) images = parsed.filter((u: any) => typeof u === 'string');
      }
    } catch { /* pas de section images */ }

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
        quote_type: quoteType, service_plan: servicePlan,
      },
      images,
      company: {
        company_name: companyData?.company_name || 'Business',
        // Toujours le logo d'entreprise (Réglages → Détails de l'entreprise).
        logo_url: companyData?.logo_url || null,
        phone: companyData?.phone || null, email: companyData?.email || null, website: companyData?.website || null,
        street1: companyData?.street1 || null, city: companyData?.city || null,
        province: companyData?.province || null, postal_code: companyData?.postal_code || null,
        country: companyData?.country || null,
        // Accent des documents client. null = encre noire, le défaut.
        brand_color: companyData?.brand_color || null,
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
    const parsed = publicAcceptSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body.', issues: parsed.error.issues.map(i => i.message) });
    }
    const { view_token, signer_name, signature_data } = parsed.data;

    // Magic-byte validation — defense in depth against attackers who satisfy
    // the regex with a non-image payload (e.g. base64-encoded HTML/SVG).
    const magicErr = validateSignatureMagic(signature_data);
    if (magicErr) return res.status(400).json({ error: magicErr });

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('id, org_id, quote_number, status, valid_until, client_id, lead_id, deposit_required, deposit_type, deposit_value, total_cents, currency, require_payment_method')
      .eq('view_token', view_token)
      .is('deleted_at', null)
      .maybeSingle();

    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    // Check if already responded, archived or expired
    if (['approved', 'declined', 'converted', 'expired', 'archived'].includes(quote.status)) {
      return res.status(400).json({ error: `Quote is already ${quote.status}.` });
    }
    // Date civile contre date civile : le dernier jour de validité compte
    // encore. `new Date('AAAA-MM-JJ')` est minuit UTC, soit la veille au soir
    // à Montréal — le devis était refusé toute sa dernière journée.
    if (estEchue(quote.valid_until)) {
      return res.status(400).json({ error: 'Quote has expired.' });
    }

    const now = new Date().toISOString();

    // Update quote status
    const depositStatus = quote.deposit_required ? 'pending' : 'not_required';
    const { error: acceptErr } = await admin.from('quotes').update({
      status: 'approved',
      approved_at: now,
      updated_at: now,
      deposit_status: depositStatus,
    }).eq('id', quote.id);
    if (acceptErr) {
      console.error('[quotes/public/accept] status update failed:', acceptErr.message);
      return res.status(500).json({ error: 'Could not record acceptance. Please retry.' });
    }

    // Create payment requirement if deposit is required
    if (quote.deposit_required && quote.deposit_value > 0) {
      const depositCents = quote.deposit_type === 'percentage'
        ? Math.round(quote.total_cents * Number(quote.deposit_value) / 100)
        : Math.round(Number(quote.deposit_value) * 100);

      const { error: depReqErr } = await admin.from('payment_requirements').insert({
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
      if (depReqErr) console.error('[quotes/public/accept] deposit payment_requirement insert failed:', depReqErr.message);

      // Update deposit_cents on the quote
      await admin.from('quotes').update({ deposit_cents: depositCents }).eq('id', quote.id);
    }

    // Create payment method requirement if needed
    if (quote.require_payment_method && !quote.deposit_required) {
      const { error: pmReqErr } = await admin.from('payment_requirements').insert({
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
      if (pmReqErr) console.error('[quotes/public/accept] payment_method requirement insert failed:', pmReqErr.message);
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
    const { error: sigErr } = await admin.from('quote_attachments').insert({
      quote_id: quote.id,
      file_url: signature_data,
      file_name: `signature_${signer_name.replace(/\s+/g, '_')}.png`,
      file_type: 'image/png',
      uploaded_by: null,
      source_type: 'signature',
    });
    if (sigErr) {
      console.error('[quotes/public/accept] signature insert failed:', sigErr.message);
      return res.status(500).json({ error: 'Could not record acceptance. Please retry.' });
    }

    // Notification « Devis approuvé » : émise par le trigger DB sur le
    // changement de statut (migration 20260747000000).

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
    const parsed = publicDepositIntentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body.', issues: parsed.error.issues.map(i => i.message) });
    }
    const { view_token } = parsed.data;

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

    // Idempotency key scopes the retry window per minute
    const idemBucket = Math.floor(Date.now() / 60_000);
    const depositIdempotencyKey = `quote-deposit-${quote.id}-${depositCents}-${idemBucket}`;

    if (orgSecrets?.stripe_secret_key_enc && orgSecrets?.stripe_publishable_key) {
      // Always decrypt the encrypted column first. The previous startsWith('sk_') check
      // was applied to the ciphertext (which never starts with 'sk_'), so this branch
      // was dead and deposits silently fell through to the platform account (F-01/F-02).
      let decryptedSecret: string | null = null;
      try {
        decryptedSecret = decryptSecret(orgSecrets.stripe_secret_key_enc);
      } catch (decErr: any) {
        console.error('[quotes/public/deposit-intent] failed to decrypt org Stripe secret', {
          org_id: quote.org_id,
          error: decErr?.message,
        });
        return res.status(500).json({ error: 'Payment provider is misconfigured. Please contact support.' });
      }

      // Sanity check on the DECRYPTED value — real Stripe secrets begin with sk_.
      if (!decryptedSecret || !decryptedSecret.startsWith('sk_')) {
        console.error('[quotes/public/deposit-intent] decrypted Stripe secret does not look valid', {
          org_id: quote.org_id,
        });
        return res.status(500).json({ error: 'Payment provider is misconfigured. Please contact support.' });
      }

      const Stripe = (await import('stripe')).default;
      const orgStripe = new Stripe(decryptedSecret);
      const intent = await orgStripe.paymentIntents.create({
        amount: depositCents,
        currency,
        payment_method_types: ['card'],
        metadata: paymentMetadata,
      }, {
        idempotencyKey: depositIdempotencyKey,
      });

      return res.json({
        client_secret: intent.client_secret,
        payment_intent_id: intent.id,
        amount_cents: depositCents,
        currency: currency.toUpperCase(),
        publishable_key: orgSecrets.stripe_publishable_key,
      });
    }

    // No Connect account and no org-level Stripe keys configured — refuse rather than
    // silently routing the deposit to the platform account (F-02).
    return res.status(503).json({
      error: 'This business has not finished connecting a payment provider. Deposit cannot be collected yet.',
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to create deposit payment.', '[quotes/public/deposit-intent]');
  }
});

// ── Public: Confirm deposit payment (called after Stripe confirmPayment succeeds) ──
router.post('/quotes/public/deposit-confirm', async (req, res) => {
  try {
    const parsed = publicDepositConfirmSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request body.', issues: parsed.error.issues.map(i => i.message) });
    }
    const { view_token, payment_intent_id } = parsed.data;

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
        // La colonne est CHIFFRÉE : la passer telle quelle à Stripe donnait une
        // clé invalide, donc ce repli n'a jamais fonctionné. Même correction
        // qu'en haut dans deposit-intent.
        const Stripe = (await import('stripe')).default;
        const orgStripe = new Stripe(decryptSecret(orgSecrets.stripe_secret_key_enc));
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
    const parsed = publicDeclineSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }
    const { view_token, reason } = parsed.data;

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('id, org_id, quote_number, status, client_id, lead_id')
      .eq('view_token', view_token)
      .is('deleted_at', null)
      .maybeSingle();

    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    if (['approved', 'declined', 'converted', 'archived'].includes(quote.status)) {
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

    // Sales map: le pin n'est volontairement PAS repeint ici — un refus de
    // devis ne change jamais le statut du pin (règle : seuls le client et
    // l'assignation d'une job pilotent le pin). Le rep peut marquer « Pas
    // intéressé » manuellement sur la carte.

    // L'événement « Devis refusé » est créé par le trigger DB au changement
    // de statut (migration 20260747000000) — on l'enrichit ici avec la
    // raison donnée par le client, que le trigger ne peut pas connaître.
    if (reason) {
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      const { data: notif } = await admin.from('notifications')
        .select('id, body')
        .eq('org_id', quote.org_id)
        .eq('type', 'quote_declined')
        .eq('reference_id', quote.id)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (notif) {
        await admin.from('notifications').update({
          body: `${notif.body ? `${notif.body} — ` : ''}« ${reason} »`.slice(0, 300),
        }).eq('id', notif.id);
      }
    }

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

// ── Public: client requests changes on a quote (no auth — uses view_token) ──
router.post('/quotes/public/request-changes', async (req, res) => {
  try {
    const parsed = publicRequestChangesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }
    const { view_token, message } = parsed.data;

    const admin = getServiceClient();
    const { data: quote, error: qErr } = await admin
      .from('quotes')
      .select('id, org_id, quote_number, status, client_id, lead_id')
      .eq('view_token', view_token)
      .is('deleted_at', null)
      .maybeSingle();

    if (qErr || !quote) return res.status(404).json({ error: 'Quote not found.' });

    if (['approved', 'declined', 'converted', 'expired', 'archived'].includes(quote.status)) {
      return res.status(400).json({ error: `Quote is already ${quote.status}.` });
    }

    const now = new Date().toISOString();

    const { error: updErr } = await admin.from('quotes').update({
      status: 'changes_requested',
      changes_requested_at: now,
      updated_at: now,
    }).eq('id', quote.id);
    if (updErr) {
      console.error('[quotes/public/request-changes] status update failed:', updErr.message);
      return res.status(500).json({ error: 'Failed to request changes.' });
    }

    await admin.from('quote_status_history').insert({
      quote_id: quote.id,
      old_status: quote.status,
      new_status: 'changes_requested',
      changed_by: null,
      reason: `Changes requested by client: ${message}`,
    });

    // L'événement « Modifications demandées » est créé par le trigger DB au
    // changement de statut (migration 20260747000000) — on l'enrichit ici
    // avec le message du client, que le trigger ne peut pas connaître.
    {
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      const { data: notif } = await admin.from('notifications')
        .select('id, body')
        .eq('org_id', quote.org_id)
        .eq('type', 'quote_changes_requested')
        .eq('reference_id', quote.id)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (notif) {
        await admin.from('notifications').update({
          body: `${notif.body ? `${notif.body} — ` : ''}« ${message} »`.slice(0, 300),
        }).eq('id', notif.id);
      }
    }

    eventBus.emit('quote.changes_requested', {
      orgId: quote.org_id,
      entityType: 'quote',
      entityId: quote.id,
      metadata: { quote_number: quote.quote_number, message },
    });

    return res.json({ ok: true, status: 'changes_requested' });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to request changes.', '[quotes/public/request-changes]');
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

    if (!['approved', 'awaiting_response', 'changes_requested', 'draft'].includes(quote.status)) {
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

    // Copy quote line items to invoice items. Optional items are excluded —
    // only items the client actually accepted end up on the invoice.
    const { data: quoteItems } = await admin
      .from('quote_line_items').select('*').eq('quote_id', quoteId)
      .eq('item_type', 'service').order('sort_order');

    let copiedSubtotalCents = 0;
    if (quoteItems && quoteItems.length > 0) {
      const copiable = quoteItems.filter((item: any) => !item.is_optional);
      const invoiceItems = copiable.map((item: any) => ({
        invoice_id: invoiceId,
        description: item.name + (item.description ? ` — ${item.description}` : ''),
        qty: Number(item.quantity) || 1,
        unit_price_cents: item.unit_price_cents,
        line_total_cents: item.total_cents,
      }));
      copiedSubtotalCents = copiable.reduce((s: number, i: any) => s + Number(i.total_cents || 0), 0);
      if (invoiceItems.length > 0) {
        await admin.from('invoice_items').insert(invoiceItems);
      }
    }

    // Recompute invoice totals from the actually-copied items so excluded
    // optional items don't inflate the amount due — AND carry the quote's
    // discount over (otherwise a discounted, client-approved quote would be
    // invoiced at full price). Scale the quote's discount + tax to the copied
    // subtotal so the invoice reproduces the quote the client accepted; with no
    // optional items excluded the factor is 1 and the totals match exactly.
    const qSubtotal = Number(quote.subtotal_cents || 0);
    const effectiveSubtotal = copiedSubtotalCents || qSubtotal;
    const factor = qSubtotal > 0 ? effectiveSubtotal / qSubtotal : 1;
    const effectiveDiscount = Math.min(effectiveSubtotal, Math.round(Number(quote.discount_cents || 0) * factor));
    const effectiveTax = Math.round(Number(quote.tax_cents || 0) * factor);
    const effectiveTotal = Math.max(0, effectiveSubtotal - effectiveDiscount + effectiveTax);

    await admin.from('invoices').update({
      subtotal_cents: effectiveSubtotal,
      discount_cents: effectiveDiscount,
      tax_cents: effectiveTax,
      total_cents: effectiveTotal,
      balance_cents: effectiveTotal,
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
