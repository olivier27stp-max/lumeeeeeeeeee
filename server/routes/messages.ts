import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { getServiceClient } from '../lib/supabase';
import { twilioClient, twilioPhoneNumber, twilioAuthToken, Twilio } from '../lib/config';
import { normalizeE164, findOrCreateConversation, resolvePublicBaseUrl } from '../lib/helpers';
import { validate, messageSendSchema } from '../lib/validation';
import { logSecurityEvent, sanitizeText, checkAnomalies, extractIP } from '../lib/security';

const router = Router();

// POST /api/messages/send — Send SMS via Twilio
router.post('/messages/send', validate(messageSendSchema), async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { client: userClient, orgId, user } = authed;

    if (!twilioClient) {
      return res.status(503).json({ error: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.' });
    }

    const { phone_number, message_text, client_id, client_name } = req.body || {};
    if (!phone_number || !message_text) {
      return res.status(400).json({ error: 'phone_number and message_text are required.' });
    }

    const normalizedPhone = normalizeE164(phone_number);
    const serviceClient = getServiceClient();

    // Find or create conversation
    const conversation = await findOrCreateConversation(serviceClient, orgId, normalizedPhone, client_id, client_name);

    // Send via Twilio
    const twilioMessage = await twilioClient.messages.create({
      body: message_text,
      from: twilioPhoneNumber,
      to: normalizedPhone,
    });

    // Save message to database
    const { data: message, error: msgError } = await serviceClient
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        org_id: orgId,
        client_id: conversation.client_id || client_id || null,
        phone_number: normalizedPhone,
        direction: 'outbound',
        message_text,
        status: 'sent',
        provider_message_id: twilioMessage.sid,
        sender_user_id: user.id,
      })
      .select('*')
      .single();

    if (msgError) throw msgError;

    return res.json(message);
  } catch (error: any) {
    console.error('SMS send error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to send SMS.' });
  }
});

// In-memory dedup set to prevent double processing from Twilio retries
const recentMessageSids = new Set<string>();
function markSidProcessed(sid: string) {
  recentMessageSids.add(sid);
  setTimeout(() => recentMessageSids.delete(sid), 60_000); // expire after 60s
}

// POST /api/messages/inbound — Twilio webhook for incoming SMS
router.post('/messages/inbound', (req, res) => {
  const sendTwiml = () => {
    res.status(200).set('Content-Type', 'text/xml');
    return res.send('<Response></Response>');
  };

  console.log('[SMS Inbound] Received webhook:', {
    from: req.body?.From,
    body: req.body?.Body?.substring(0, 50),
    sid: req.body?.MessageSid,
  });

  // ── Strict signature validation — NEVER skip in production ──

  if (!twilioAuthToken) {
    console.error('[SMS Inbound] Twilio auth token not configured');
    logSecurityEvent({
      event_type: 'twilio_webhook_no_auth',
      severity: 'high',
      source: 'webhook',
      ip_address: extractIP(req),
      details: { path: '/api/messages/inbound' },
    });
    return sendTwiml();
  }

  const twilioSignature = req.headers['x-twilio-signature'] as string;
  if (!twilioSignature) {
    console.warn('[SMS Inbound] Missing x-twilio-signature header');
    logSecurityEvent({
      event_type: 'twilio_webhook_missing_signature',
      severity: 'high',
      source: 'webhook',
      ip_address: extractIP(req),
      user_agent: req.headers['user-agent'],
      details: { path: '/api/messages/inbound' },
    });
    return sendTwiml();
  }

  // Validate signature — NO bypass allowed
  const baseUrl = process.env.TWILIO_WEBHOOK_BASE_URL
    || process.env.PUBLIC_BASE_URL
    || process.env.FRONTEND_URL
    || resolvePublicBaseUrl(req);
  const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/messages/inbound`;
  const isValid = Twilio.validateRequest(twilioAuthToken, twilioSignature, webhookUrl, req.body || {});
  if (!isValid) {
    console.warn('[SMS Inbound] Signature validation FAILED. URL:', webhookUrl);
    logSecurityEvent({
      event_type: 'twilio_webhook_invalid_signature',
      severity: 'critical',
      source: 'webhook',
      ip_address: extractIP(req),
      user_agent: req.headers['user-agent'],
      details: { path: '/api/messages/inbound', url_used: webhookUrl },
    });
    return sendTwiml();
  }

  const { From, Body: rawBody, MessageSid } = req.body || {};
  if (!From || !rawBody) {
    console.warn('[SMS Inbound] Missing From or Body');
    return sendTwiml();
  }

  // Sanitize inbound SMS content to prevent stored XSS
  const Body = sanitizeText(rawBody);

  // In-memory dedup: reject if we already saw this MessageSid
  if (MessageSid && recentMessageSids.has(MessageSid)) {
    console.log('[SMS Inbound] Duplicate MessageSid (in-memory), skipping:', MessageSid);
    return sendTwiml();
  }
  if (MessageSid) markSidProcessed(MessageSid);

  // ── Respond immediately — process in background ──
  sendTwiml();

  const normalizedPhone = normalizeE164(From);
  const serviceClient = getServiceClient();

  (async () => {
    try {
      // Build phone variants for flexible matching
      const phoneDigits = normalizedPhone.replace(/\D/g, '');
      const phoneVariants = [normalizedPhone];
      if (phoneDigits.startsWith('1') && phoneDigits.length === 11) {
        phoneVariants.push(phoneDigits.slice(1));
      }
      phoneVariants.push(phoneDigits);

      // Find existing conversation
      const { data: existingConvo } = await serviceClient
        .from('conversations')
        .select('id, org_id, client_id, client_name')
        .in('phone_number', phoneVariants)
        .limit(1)
        .maybeSingle();

      let conversation = existingConvo;
      let orgId = existingConvo?.org_id;

      // No conversation — match client or lead by phone
      if (!conversation) {
        const phoneFilter = phoneVariants.map((p) => `phone.eq.${p}`).join(',');
        const { data: client } = await serviceClient
          .from('clients')
          .select('id, org_id, first_name, last_name, phone')
          .or(phoneFilter)
          .is('deleted_at', null)
          .limit(1)
          .maybeSingle();

        let lead: any = null;
        if (!client) {
          const { data: leadMatch } = await serviceClient
            .from('leads')
            .select('id, org_id, first_name, last_name, phone')
            .or(phoneFilter)
            .is('deleted_at', null)
            .limit(1)
            .maybeSingle();
          lead = leadMatch;
        }

        const matchedEntity = client || lead;
        orgId = matchedEntity?.org_id || null;

        if (!orgId) {
          const { data: firstOrg } = await serviceClient
            .from('orgs')
            .select('id')
            .limit(1)
            .maybeSingle();
          orgId = firstOrg?.id || null;
        }

        const clientName = matchedEntity
          ? `${matchedEntity.first_name || ''} ${matchedEntity.last_name || ''}`.trim()
          : null;

        const { data: created } = await serviceClient
          .from('conversations')
          .insert({
            org_id: orgId,
            client_id: client?.id || null,
            phone_number: normalizedPhone,
            client_name: clientName,
          })
          .select('id, org_id, client_id, client_name')
          .single();

        conversation = created;
      }

      if (!conversation) {
        console.error('[SMS Inbound] Could not create conversation for', normalizedPhone);
        return;
      }

      const effectiveOrgId = orgId || conversation.org_id;

      // Save inbound message — use upsert on provider_message_id to guarantee idempotency
      // If MessageSid already exists, do nothing (Twilio retry)
      if (MessageSid) {
        const { data: inserted, error: msgError } = await serviceClient
          .from('messages')
          .upsert({
            conversation_id: conversation.id,
            org_id: effectiveOrgId,
            client_id: conversation.client_id,
            phone_number: normalizedPhone,
            direction: 'inbound',
            message_text: Body,
            status: 'received',
            provider_message_id: MessageSid,
          }, { onConflict: 'provider_message_id', ignoreDuplicates: true })
          .select('id')
          .maybeSingle();

        if (msgError) {
          console.error('[SMS Inbound] Failed to save message:', msgError.message);
          return;
        }

        // If upsert returned null, the row already existed — skip everything
        if (!inserted) {
          console.log('[SMS Inbound] Duplicate MessageSid (upsert), skipping:', MessageSid);
          return;
        }
      } else {
        // No MessageSid (rare) — plain insert
        const { error: msgError } = await serviceClient
          .from('messages')
          .insert({
            conversation_id: conversation.id,
            org_id: effectiveOrgId,
            client_id: conversation.client_id,
            phone_number: normalizedPhone,
            direction: 'inbound',
            message_text: Body,
            status: 'received',
            provider_message_id: null,
          });

        if (msgError) {
          console.error('[SMS Inbound] Failed to save message:', msgError.message);
          return;
        }
      }

      // ── From here, we know exactly 1 message was inserted ──

      // Update conversation: last_message_text + atomic unread increment
      const truncatedBody = Body.length > 200 ? Body.substring(0, 200) + '...' : Body;
      const { error: rpcError } = await serviceClient.rpc('increment_unread_count', { p_conversation_id: conversation.id });
      if (rpcError) {
        await serviceClient
          .from('conversations')
          .update({
            last_message_text: truncatedBody,
            last_message_at: new Date().toISOString(),
            unread_count: 1,
          })
          .eq('id', conversation.id);
      } else {
        await serviceClient
          .from('conversations')
          .update({ last_message_text: truncatedBody })
          .eq('id', conversation.id);
      }

      // Create notification (1 per message, guaranteed by the upsert gate above)
      if (effectiveOrgId) {
        const senderName = (conversation as any).client_name || normalizedPhone;
        await serviceClient
          .from('notifications')
          .insert({
            org_id: effectiveOrgId,
            type: 'sms_inbound',
            ref_id: conversation.id,
            title: `New SMS from ${senderName}`,
            body: Body.length > 100 ? Body.substring(0, 100) + '...' : Body,
            metadata: {
              conversation_id: conversation.id,
              phone_number: normalizedPhone,
              message_sid: MessageSid,
            },
          });
      }

      console.log('[SMS Inbound] Processed OK:', { from: normalizedPhone, conversation_id: conversation.id });
    } catch (error: any) {
      console.error('[SMS Inbound] Background processing error:', error?.message || error);
    }
  })();
});

// POST /api/messages/status — Twilio status callback (delivery updates)
router.post('/messages/status', async (req, res) => {
  try {
    // MANDATORY signature verification on status callbacks
    if (!twilioAuthToken) {
      return res.status(503).json({ error: 'Twilio not configured' });
    }
    const sig = req.headers['x-twilio-signature'] as string;
    if (!sig) {
      logSecurityEvent({
        event_type: 'twilio_status_missing_signature',
        severity: 'medium',
        source: 'webhook',
        ip_address: extractIP(req),
        details: { path: '/api/messages/status' },
      });
      return res.status(403).json({ error: 'Missing signature' });
    }
    const baseUrl = process.env.TWILIO_WEBHOOK_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || resolvePublicBaseUrl(req);
    const isValid = Twilio.validateRequest(twilioAuthToken, sig, `${baseUrl.replace(/\/$/, '')}/api/messages/status`, req.body || {});
    if (!isValid) {
      logSecurityEvent({
        event_type: 'twilio_status_invalid_signature',
        severity: 'high',
        source: 'webhook',
        ip_address: extractIP(req),
        details: { path: '/api/messages/status' },
      });
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const { MessageSid, MessageStatus } = req.body || {};
    if (!MessageSid || !MessageStatus) {
      return res.status(400).json({ error: 'Missing MessageSid or MessageStatus' });
    }

    const serviceClient = getServiceClient();

    // Map Twilio status to our status
    const statusMap: Record<string, string> = {
      queued: 'queued',
      sent: 'sent',
      delivered: 'delivered',
      undelivered: 'failed',
      failed: 'failed',
    };

    const mappedStatus = statusMap[MessageStatus] || MessageStatus;

    await serviceClient
      .from('messages')
      .update({ status: mappedStatus })
      .eq('provider_message_id', MessageSid);

    return res.json({ received: true });
  } catch (error: any) {
    console.error('Status callback error:', error);
    return res.status(500).json({ error: 'Failed to process status update' });
  }
});

export default router;
