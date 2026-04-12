import { Router } from 'express';
import { Resend } from 'resend';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { twilioClient, twilioPhoneNumber, resendApiKey, emailFrom } from '../lib/config';
import { normalizeE164, findOrCreateConversation } from '../lib/helpers';
import { provisionSmsNumber, getOrgSmsChannel } from '../lib/twilioProvisioning';
import { validate, sendSmsSchema } from '../lib/validation';
import { sanitizeText, sanitizeHtml, logSecurityEvent, checkAnomalies, extractIP } from '../lib/security';

const router = Router();

// ── Helpers ──

function getResend() {
  if (!resendApiKey) throw Object.assign(new Error('Email provider not configured.'), { status: 503 });
  return new Resend(resendApiKey);
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
    const body = sanitizeText(rawBody);

    const normalizedTo = normalizeE164(to);
    const serviceClient = getServiceClient();

    // Resolve from number: org channel or global fallback
    const channel = await getOrgSmsChannel(orgId);
    const fromNumber = channel?.phone_number || twilioPhoneNumber;
    if (!fromNumber) {
      return res.status(503).json({ error: 'No SMS number configured.' });
    }

    // Send via Twilio
    const twilioMsg = await twilioClient.messages.create({
      body,
      from: fromNumber,
      to: normalizedTo,
    });

    // Also maintain existing conversations table
    const conversation = await findOrCreateConversation(serviceClient, orgId, normalizedTo, client_id);

    await serviceClient.from('messages').insert({
      conversation_id: conversation.id,
      org_id: orgId,
      client_id: conversation.client_id || client_id || null,
      phone_number: normalizedTo,
      direction: 'outbound',
      message_text: body,
      status: 'sent',
      provider_message_id: twilioMsg.sid,
      sender_user_id: user.id,
    });

    // Log to unified communication_messages
    const { data: commMsg, error: commErr } = await serviceClient
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
      .single();

    if (commErr) console.error('Failed to log communication:', commErr.message);

    return res.json({
      id: commMsg?.id || null,
      provider_message_id: twilioMsg.sid,
      status: 'sent',
    });
  } catch (error: any) {
    console.error('Communications SMS error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to send SMS.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/communications/send-email
// Sends email via Resend, logs to communication_messages
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

    const resend = getResend();
    const serviceClient = getServiceClient();

    // Resolve sender identity: user email or org default
    const senderReplyTo = reply_to || user.email || undefined;

    const safeBodyHtml = body_html ? sanitizeHtml(body_html) : null;
    const htmlContent = safeBodyHtml || `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;white-space:pre-wrap;">${sanitizeText(body || '').replace(/\n/g, '<br/>')}</div>`;

    // Send via Resend
    const result = await resend.emails.send({
      from: emailFrom,
      to: [to],
      replyTo: senderReplyTo,
      subject,
      html: htmlContent,
    });

    const providerId = (result.data as any)?.id || null;

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
    console.error('Communications email error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to send email.' });
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
    console.error('Communications list error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to fetch communications.' });
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
    return res.status(500).json({ error: error?.message || 'Failed to fetch channels.' });
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
    return res.status(500).json({ error: error?.message || 'Failed to fetch settings.' });
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
    console.error('SMS provisioning error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to provision SMS number.' });
  }
});

export default router;
