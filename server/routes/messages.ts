import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { getServiceClient } from '../lib/supabase';
import { twilioClient, twilioPhoneNumber, twilioAuthToken, Twilio } from '../lib/config';
import { normalizeE164, findOrCreateConversation, resolvePublicBaseUrl } from '../lib/helpers';
import { validate, messageSendSchema } from '../lib/validation';

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

// POST /api/messages/inbound — Twilio webhook for incoming SMS
router.post('/messages/inbound', async (req, res) => {
  // Always respond with TwiML to prevent Twilio's default auto-response
  const sendTwiml = (statusCode = 200) => {
    res.status(statusCode).set('Content-Type', 'text/xml');
    return res.send('<Response></Response>');
  };

  try {
    console.log('[SMS Inbound] Received webhook:', {
      from: req.body?.From,
      body: req.body?.Body?.substring(0, 50),
      sid: req.body?.MessageSid,
    });

    // Validate Twilio webhook signature — MANDATORY
    if (!twilioAuthToken) {
      console.error('[SMS Inbound] Twilio auth token not configured — rejecting');
      return sendTwiml(503);
    }

    const twilioSignature = req.headers['x-twilio-signature'] as string;
    if (!twilioSignature) {
      console.warn('[SMS Inbound] Missing x-twilio-signature header');
      return sendTwiml(403);
    }

    // Use TWILIO_WEBHOOK_BASE_URL if set (must match Twilio dashboard config exactly),
    // otherwise fall back to PUBLIC_BASE_URL / FRONTEND_URL.
    const baseUrl = process.env.TWILIO_WEBHOOK_BASE_URL
      || process.env.PUBLIC_BASE_URL
      || process.env.FRONTEND_URL
      || resolvePublicBaseUrl(req);
    const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/messages/inbound`;

    const isValid = Twilio.validateRequest(
      twilioAuthToken,
      twilioSignature,
      webhookUrl,
      req.body || {},
    );
    if (!isValid) {
      console.warn('[SMS Inbound] Signature validation failed. Expected URL:', webhookUrl);
      // In development, allow bypass if explicitly configured
      if (process.env.TWILIO_SKIP_SIGNATURE_VALIDATION !== 'true') {
        return sendTwiml(403);
      }
      console.warn('[SMS Inbound] Signature bypass enabled (dev only)');
    }

    const { From, Body, MessageSid } = req.body || {};
    if (!From || !Body) {
      console.warn('[SMS Inbound] Missing From or Body in payload');
      return sendTwiml(400);
    }

    const normalizedPhone = normalizeE164(From);
    const serviceClient = getServiceClient();

    // Deduplication: if MessageSid already exists, skip (Twilio retries on timeout)
    if (MessageSid) {
      const { data: existing } = await serviceClient
        .from('messages')
        .select('id')
        .eq('provider_message_id', MessageSid)
        .limit(1)
        .maybeSingle();
      if (existing) {
        console.log('[SMS Inbound] Duplicate MessageSid, skipping:', MessageSid);
        return sendTwiml();
      }
    }

    // Build phone variants for flexible matching
    const phoneDigits = normalizedPhone.replace(/\D/g, '');
    const phoneVariants = [normalizedPhone];
    if (phoneDigits.startsWith('1') && phoneDigits.length === 11) {
      phoneVariants.push(phoneDigits.slice(1)); // 10 digits without country code
    }
    phoneVariants.push(phoneDigits); // raw digits

    // Find existing conversation by any phone variant
    const { data: existingConvo } = await serviceClient
      .from('conversations')
      .select('id, org_id, client_id')
      .in('phone_number', phoneVariants)
      .limit(1)
      .maybeSingle();

    let conversation = existingConvo;
    let orgId = existingConvo?.org_id;

    // If no existing conversation, try to match by client phone
    if (!conversation) {
      const phoneFilter = phoneVariants.map((p) => `phone.eq.${p}`).join(',');
      const { data: client } = await serviceClient
        .from('clients')
        .select('id, org_id, first_name, last_name, phone')
        .or(phoneFilter)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();

      // Also check leads table if no client match
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

      // Fallback: get first org if still no org
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
        .select('*')
        .single();

      conversation = created;
    }

    if (!conversation) {
      console.error('[SMS Inbound] Could not create conversation for', normalizedPhone);
      return sendTwiml(500);
    }

    const effectiveOrgId = orgId || conversation.org_id;

    // Save inbound message
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
        provider_message_id: MessageSid || null,
      });

    if (msgError) {
      console.error('[SMS Inbound] Failed to save message:', msgError.message);
    }

    // Update conversation metadata: last_message + atomic unread increment
    // Use RPC for atomic increment, fallback to manual update
    const truncatedBody = Body.length > 200 ? Body.substring(0, 200) + '...' : Body;
    try {
      await serviceClient.rpc('increment_unread_count', { p_conversation_id: conversation.id });
      // RPC handles unread_count + last_message_at; update last_message_text separately
      await serviceClient
        .from('conversations')
        .update({ last_message_text: truncatedBody })
        .eq('id', conversation.id);
    } catch {
      // RPC not available — manual fallback
      await serviceClient
        .from('conversations')
        .update({
          last_message_text: truncatedBody,
          last_message_at: new Date().toISOString(),
          unread_count: (conversation as any).unread_count
            ? (conversation as any).unread_count + 1
            : 1,
        })
        .eq('id', conversation.id);
    }

    // Create notification for the org
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
        })
        .then(({ error }) => {
          if (error) console.warn('[SMS Inbound] Failed to create notification:', error.message);
        });
    }

    console.log('[SMS Inbound] Processed successfully:', {
      from: normalizedPhone,
      conversation_id: conversation.id,
      org_id: effectiveOrgId,
    });

    return sendTwiml();
  } catch (error: any) {
    console.error('[SMS Inbound] Unhandled error:', error?.message || error);
    return sendTwiml();
  }
});

// POST /api/messages/status — Twilio status callback (delivery updates)
router.post('/messages/status', async (req, res) => {
  try {
    // Validate Twilio signature on status callbacks too
    if (twilioAuthToken) {
      const sig = req.headers['x-twilio-signature'] as string;
      if (sig) {
        const baseUrl = process.env.FRONTEND_URL || process.env.PUBLIC_BASE_URL || resolvePublicBaseUrl(req);
        const isValid = Twilio.validateRequest(twilioAuthToken, sig, `${baseUrl.replace(/\/$/, '')}/api/messages/status`, req.body || {});
        if (!isValid) return res.status(403).json({ error: 'Invalid signature' });
      }
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
