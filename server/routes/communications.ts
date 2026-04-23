import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { twilioClient, twilioPhoneNumber, emailFrom } from '../lib/config';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { normalizeE164, findOrCreateConversation } from '../lib/helpers';
import { provisionSmsNumber, getOrgSmsChannel } from '../lib/twilioProvisioning';
import {
  submitA2PBrand,
  submitA2PCampaign,
  refreshA2PStatus,
  canSendToUS,
  type A2PBrandInput,
  type A2PCampaignInput,
} from '../lib/twilioA2P';
import { validate, sendSmsSchema } from '../lib/validation';
import { sanitizeText, sanitizeHtml, sanitizeMessageContent, stripCRLF, logSecurityEvent, checkAnomalies, extractIP } from '../lib/security';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// ── Helpers ──

function ensureMailer() {
  if (!isMailerConfigured()) throw Object.assign(new Error('SMTP not configured.'), { status: 503 });
}

// ═══════════════════════════════════════════════════════════════
// POST /api/communications/send-sms
// Sends SMS, logs to communication_messages, links to job/client
// ═══════════════════════════════════════════════════════════════

router.post('/communications/send-sms', validate(sendSmsSchema), async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId, user } = authed;

    if (!twilioClient) {
      return res.status(503).json({ error: 'SMS is not configured.' });
    }

    const { to, body: rawBody, client_id, job_id } = req.body;
    // Sanitize + strip CRLF to prevent SMS header injection
    const body = stripCRLF(sanitizeText(rawBody));

    const normalizedTo = normalizeE164(to);
    const serviceClient = getServiceClient();

    // A2P 10DLC gate: block outbound SMS to US numbers until brand + campaign are verified.
    // Canadian destinations (+1 with area codes outside US) are allowed regardless.
    if (isUSNumber(normalizedTo)) {
      const allowed = await canSendToUS(orgId);
      if (!allowed) {
        return res.status(403).json({
          error: 'A2P_REGISTRATION_REQUIRED',
          message:
            'US carriers require A2P 10DLC registration before messages can be delivered. Complete the A2P wizard in Settings → SMS Messaging.',
        });
      }
    }

    // Resolve from number: org channel or global fallback
    const channel = await getOrgSmsChannel(orgId);
    const fromNumber = channel?.phone_number || twilioPhoneNumber;
    if (!fromNumber) {
      return res.status(503).json({ error: 'No SMS number configured.' });
    }

    // Run conversation lookup in parallel with Twilio send — independent DB round-trip
    const [twilioMsg, conversation] = await Promise.all([
      twilioClient.messages.create({
        body,
        from: fromNumber,
        to: normalizedTo,
      }),
      findOrCreateConversation(serviceClient, orgId, normalizedTo, client_id),
    ]);

    // Parallelize the two inserts + communication_messages select
    const [, commRes] = await Promise.all([
      serviceClient.from('messages').insert({
        conversation_id: conversation.id,
        org_id: orgId,
        client_id: conversation.client_id || client_id || null,
        phone_number: normalizedTo,
        direction: 'outbound',
        message_text: body,
        status: 'sent',
        provider_message_id: twilioMsg.sid,
        sender_user_id: user.id,
      }),
      serviceClient
        .from('communication_messages')
        .insert({
          org_id: orgId,
          user_id: user.id,
          client_id: client_id || conversation.client_id || null,
          job_id: job_id || null,
          channel_type: 'sms',
          direction: 'outbound',
          provider: 'twilio',
          channel_id: channel?.id || null,
          from_value: fromNumber,
          to_value: normalizedTo,
          body_text: body,
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider_message_id: twilioMsg.sid,
        })
        .select('id')
        .single(),
    ]);

    if (commRes.error) console.error('Failed to log communication:', commRes.error.message);

    return res.json({
      id: commRes.data?.id || null,
      provider_message_id: twilioMsg.sid,
      status: 'sent',
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to send SMS.', '[communications/send-sms]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/communications/send-email
// Sends email via SMTP, logs to communication_messages
// ═══════════════════════════════════════════════════════════════

router.post('/communications/send-email', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId, user } = authed;

    const { to, subject, body, body_html, client_id, job_id, reply_to } = req.body || {};
    if (!to || !subject || (!body && !body_html)) {
      return res.status(400).json({ error: 'to, subject, and body are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    ensureMailer();
    const serviceClient = getServiceClient();

    // Resolve sender identity: user email or org default
    const senderReplyTo = reply_to || user.email || undefined;

    // Sanitize subject (strip CRLF to prevent email header injection) and body
    const safeSubject = stripCRLF(subject);
    const safeBodyHtml = body_html ? sanitizeHtml(body_html) : null;
    const htmlContent = safeBodyHtml || `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;white-space:pre-wrap;">${sanitizeText(body || '').replace(/\n/g, '<br/>')}</div>`;

    // Send via SMTP
    const result = await sendEmail({
      from: emailFrom,
      to,
      replyTo: senderReplyTo,
      subject: safeSubject,
      html: htmlContent,
    });

    if (!result.sent) throw new Error(result.error || 'Email send failed');
    const providerId = result.messageId || null;

    // Log to communication_messages
    const { data: commMsg, error: commErr } = await serviceClient
      .from('communication_messages')
      .insert({
        org_id: orgId,
        user_id: user.id,
        client_id: client_id || null,
        job_id: job_id || null,
        channel_type: 'email',
        direction: 'outbound',
        provider: 'resend',
        from_value: emailFrom,
        to_value: to,
        subject,
        body_text: body || null,
        body_html: htmlContent,
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_message_id: providerId,
        metadata: senderReplyTo ? { reply_to: senderReplyTo } : {},
      })
      .select('id')
      .single();

    if (commErr) console.error('Failed to log communication:', commErr.message);

    return res.json({
      id: commMsg?.id || null,
      provider_message_id: providerId,
      status: 'sent',
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to send email.', '[communications/send-email]');
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/communications/messages
// Fetch communication history for a job or client
// ═══════════════════════════════════════════════════════════════

router.get('/communications/messages', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;

    const { job_id, client_id, limit: rawLimit } = req.query;
    const limitNum = Math.min(Number(rawLimit) || 50, 200);

    const serviceClient = getServiceClient();
    let query = serviceClient
      .from('communication_messages')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limitNum);

    if (job_id) query = query.eq('job_id', String(job_id));
    if (client_id) query = query.eq('client_id', String(client_id));

    const { data, error } = await query;
    if (error) throw error;

    return res.json(data || []);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to fetch communications.', '[communications/messages]');
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/communications/channels
// Get org's communication channels
// ═══════════════════════════════════════════════════════════════

router.get('/communications/channels', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;

    const serviceClient = getServiceClient();
    const { data, error } = await serviceClient
      .from('communication_channels')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('is_default', { ascending: false });

    if (error) throw error;
    return res.json(data || []);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to fetch channels.', '[communications/channels]');
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/communications/settings
// Get org's communication settings
// ═══════════════════════════════════════════════════════════════

router.get('/communications/settings', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;

    const serviceClient = getServiceClient();
    const { data, error } = await serviceClient
      .from('communication_settings')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle();

    if (error) throw error;
    return res.json(data || { sms_enabled: false, email_enabled: true });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to fetch settings.', '[communications/settings]');
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/communications/provision-sms
// Provision a Twilio number for the org (admin only)
// ═══════════════════════════════════════════════════════════════

router.post('/communications/provision-sms', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;

    const { area_code, country } = req.body || {};

    const result = await provisionSmsNumber(orgId, {
      areaCode: area_code,
      country: country || 'CA',
    });

    return res.json(result);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to provision SMS number.', '[communications/provision-sms]');
  }
});

// ═══════════════════════════════════════════════════════════════
// A2P 10DLC (US only) — Brand + Campaign registration
// ═══════════════════════════════════════════════════════════════

// GET /api/communications/a2p/status — current brand + campaign status for this org
router.get('/communications/a2p/status', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;

    const serviceClient = getServiceClient();
    const { data } = await serviceClient
      .from('a2p_registrations')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle();

    return res.json(data || null);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to fetch A2P status.', '[communications/a2p/status]');
  }
});

// POST /api/communications/a2p/submit-brand — submit the brand for vetting
router.post('/communications/a2p/submit-brand', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;

    const input = validateBrandInput(req.body);
    const result = await submitA2PBrand(orgId, input);
    return res.json(result);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to submit A2P brand.', '[communications/a2p/submit-brand]');
  }
});

// POST /api/communications/a2p/submit-campaign — submit the campaign (requires verified brand)
router.post('/communications/a2p/submit-campaign', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;

    const input = validateCampaignInput(req.body);
    const result = await submitA2PCampaign(orgId, input);
    return res.json(result);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to submit A2P campaign.', '[communications/a2p/submit-campaign]');
  }
});

// POST /api/communications/a2p/refresh — poll Twilio for latest status
router.post('/communications/a2p/refresh', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;

    const result = await refreshA2PStatus(orgId);
    return res.json(result);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to refresh A2P status.', '[communications/a2p/refresh]');
  }
});

// ── Helpers ─────────────────────────────────────────────────────────
function isUSNumber(e164: string): boolean {
  // E.164 US/CA both start with +1. We distinguish via the 3-digit area code.
  // Canadian area codes are listed below; everything else on +1 is treated as US.
  if (!e164.startsWith('+1') || e164.length < 5) return false;
  const areaCode = e164.slice(2, 5);
  return !CANADIAN_AREA_CODES.has(areaCode);
}

const CANADIAN_AREA_CODES = new Set<string>([
  '204', '226', '236', '249', '250', '257', '263', '289',
  '306', '343', '354', '365', '367', '368', '382', '387',
  '403', '416', '418', '428', '431', '437', '438', '450', '468', '474',
  '506', '514', '519', '548', '579', '581', '584', '587',
  '604', '613', '639', '647', '672', '683', '705', '709', '742', '753', '778', '780', '782',
  '807', '819', '825', '867', '873', '879',
  '902', '905',
]);

function validateBrandInput(body: any): A2PBrandInput {
  const fields = [
    'legal_business_name', 'ein', 'business_type', 'vertical',
    'street', 'city', 'region', 'postal_code', 'country',
    'website', 'support_email', 'support_phone',
  ];
  for (const f of fields) {
    if (!body?.[f] || typeof body[f] !== 'string' || !body[f].trim()) {
      const err: any = new Error(`Missing required field: ${f}`);
      err.status = 400;
      throw err;
    }
  }
  return {
    legal_business_name: String(body.legal_business_name).trim(),
    ein: String(body.ein).trim(),
    business_type: String(body.business_type).trim(),
    vertical: String(body.vertical).trim(),
    street: String(body.street).trim(),
    city: String(body.city).trim(),
    region: String(body.region).trim(),
    postal_code: String(body.postal_code).trim(),
    country: String(body.country).trim(),
    website: String(body.website).trim(),
    support_email: String(body.support_email).trim(),
    support_phone: String(body.support_phone).trim(),
  };
}

function validateCampaignInput(body: any): A2PCampaignInput {
  if (!body?.use_case || !body?.description) {
    const err: any = new Error('use_case and description are required.');
    err.status = 400;
    throw err;
  }
  const samples = Array.isArray(body.message_samples)
    ? body.message_samples.map((s: any) => String(s || '').trim()).filter(Boolean)
    : [];
  if (samples.length < 2) {
    const err: any = new Error('Provide at least 2 message samples.');
    err.status = 400;
    throw err;
  }
  return {
    use_case: String(body.use_case).trim(),
    description: String(body.description).trim(),
    message_samples: samples.slice(0, 5),
    opt_in_keywords: Array.isArray(body.opt_in_keywords)
      ? body.opt_in_keywords.map((k: any) => String(k || '').trim()).filter(Boolean)
      : ['START'],
    opt_in_message: String(body.opt_in_message || 'You are now subscribed. Reply STOP to unsubscribe.').trim(),
    opt_out_message: String(body.opt_out_message || 'You have been unsubscribed. Reply START to resubscribe.').trim(),
    has_embedded_links: Boolean(body.has_embedded_links),
    has_embedded_phone: Boolean(body.has_embedded_phone),
  };
}

export default router;
