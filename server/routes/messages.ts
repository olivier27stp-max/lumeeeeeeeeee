import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { getServiceClient } from '../lib/supabase';
import { twilioClient, twilioAuthToken, Twilio } from '../lib/config';
import { getOrgSmsFromNumber, SmsNumberNotProvisionedError } from '../lib/twilioProvisioning';
import { normalizeE164, findOrCreateConversation, resolvePublicBaseUrl } from '../lib/helpers';
import { validate, messageSendSchema } from '../lib/validation';
import { logSecurityEvent, sanitizeText, checkAnomalies, extractIP } from '../lib/security';
import { withDeadLetter } from '../lib/dead-letter';

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

    // CASL compliance — block SMS to recipients who texted STOP
    const { data: optOut } = await serviceClient
      .from('sms_opt_outs')
      .select('id')
      .eq('org_id', orgId)
      .eq('phone', normalizedPhone)
      .maybeSingle();
    if (optOut) {
      return res.status(409).json({
        error: 'This recipient has opted out of SMS from your organization.',
        code: 'sms_opted_out',
      });
    }

    // Resolve THIS org's dedicated sending number (Jobber-style: no shared fallback)
    let fromNumber: string;
    try {
      fromNumber = await getOrgSmsFromNumber(orgId);
    } catch (e) {
      if (e instanceof SmsNumberNotProvisionedError) {
        return res.status(409).json({
          error: 'Your organization does not have an SMS number yet. Provision one in Settings → Messaging.',
          code: 'sms_not_provisioned',
        });
      }
      throw e;
    }

    // Find or create conversation
    const conversation = await findOrCreateConversation(serviceClient, orgId, normalizedPhone, client_id, client_name);

    // Send via Twilio from this org's own number
    const twilioMessage = await twilioClient.messages.create({
      body: message_text,
      from: fromNumber,
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
    return sendSafeError(res, error, 'Failed to send SMS.', '[messages/send]');
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

  // Validate signature — must use the EXACT URL Twilio called (the one we registered at provisioning time).
  // PUBLIC_URL is what twilioProvisioning.ts uses when buying the number, so prioritize it.
  const baseUrl = process.env.TWILIO_WEBHOOK_BASE_URL
    || process.env.PUBLIC_URL
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

  // ── CASL STOP/START opt-out handling ──
  // Must run before saving message so outbound sends are blocked immediately.
  const bodyTrim = (Body || '').trim();
  const stopRegex = /^(stop|arret|arrêt|unsubscribe|cancel|end|quit|désabonner|desabonner)$/i;
  const startRegex = /^(start|unstop|reprendre|resume|yes|oui)$/i;
  if (stopRegex.test(bodyTrim)) {
    (async () => {
      try {
        // Find any org this phone has texted with — best-effort: all orgs with a conversation
        const { data: convos } = await serviceClient
          .from('conversations')
          .select('org_id')
          .eq('phone_number', normalizedPhone);
        const orgIds = Array.from(new Set((convos || []).map((c: any) => c.org_id).filter(Boolean)));
        for (const oid of orgIds) {
          await serviceClient
            .from('sms_opt_outs')
            .upsert({ org_id: oid, phone: normalizedPhone, reason: 'client_stop' }, { onConflict: 'org_id,phone' });
        }
        console.log(`[SMS Inbound] Opted-out ${normalizedPhone} from ${orgIds.length} org(s)`);
      } catch (e: any) {
        console.error('[SMS Inbound] Opt-out handling failed:', e?.message);
      }
    })();
    return;
  }
  if (startRegex.test(bodyTrim)) {
    (async () => {
      try {
        await serviceClient.from('sms_opt_outs').delete().eq('phone', normalizedPhone);
        console.log(`[SMS Inbound] Opt-out removed for ${normalizedPhone}`);
      } catch (e: any) {
        console.error('[SMS Inbound] Opt-in handling failed:', e?.message);
      }
    })();
    // Fall through — saving the "START" as a regular message is fine
  }

  withDeadLetter('sms_inbound', { From, Body: bodyTrim, MessageSid }, async () => {
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

        // No client/lead match → route to the org that owns the receiving Twilio number.
        // Falling back to "first org in the table" is wrong: it dumps every unknown sender
        // into Default Organization regardless of which tenant the SMS was actually sent to.
        if (!orgId) {
          const To = req.body?.To;
          if (To) {
            const normalizedTo = normalizeE164(To);
            const { data: channel } = await serviceClient
              .from('communication_channels')
              .select('org_id')
              .eq('phone_number', normalizedTo)
              .eq('channel_type', 'sms')
              .eq('status', 'active')
              .maybeSingle();
            orgId = channel?.org_id || null;
          }
          if (!orgId) {
            console.warn(`[SMS Inbound] No org found for destination ${To}; dropping message.`);
            return;
          }
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

      // Update conversation preview text only.
      // NOTE: unread_count, last_message_at and updated_at are already handled atomically
      // by the trg_message_insert trigger on the messages table (see 20260309120000_messaging.sql).
      // Do NOT increment unread_count here — doing so double-counts and the badge shows 2 for a
      // single inbound message. We only override last_message_text with a truncated preview.
      const truncatedBody = Body.length > 200 ? Body.substring(0, 200) + '...' : Body;
      await serviceClient
        .from('conversations')
        .update({ last_message_text: truncatedBody })
        .eq('id', conversation.id);

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

      console.log('[SMS Inbound] Processed OK:', { from: normalizedPhone?.slice(-4) ? `***${normalizedPhone.slice(-4)}` : 'unknown', conversation_id: conversation.id });
    } catch (error: any) {
      console.error('[SMS Inbound] Background processing error:', error?.message || error);
      throw error; // bubble to withDeadLetter so it's persisted
    }
  }); // withDeadLetter fires and returns immediately
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

// GET /api/messages/twilio-diagnostic — verify webhook config for the org's number
router.get('/messages/twilio-diagnostic', async (req, res) => {
  try {
    const authed = await requireAuthedClient(req, res);
    if (!authed) return;
    const { orgId } = authed;

    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

    const publicUrl = (process.env.PUBLIC_URL || process.env.TWILIO_WEBHOOK_BASE_URL || '').trim().replace(/\/$/, '');
    checks.push({
      name: 'PUBLIC_URL set',
      ok: !!publicUrl && /^https?:\/\//.test(publicUrl) && !publicUrl.includes('localhost'),
      detail: publicUrl || '(empty) — set PUBLIC_URL in .env.local',
    });
    checks.push({
      name: 'TWILIO_AUTH_TOKEN set',
      ok: !!twilioAuthToken,
      detail: twilioAuthToken ? 'present' : 'missing — webhook signature validation will reject all inbound',
    });
    checks.push({
      name: 'Twilio client initialized',
      ok: !!twilioClient,
      detail: twilioClient ? 'ok' : 'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing/invalid',
    });

    const serviceClient = getServiceClient();
    const { data: channel } = await serviceClient
      .from('communication_channels')
      .select('id, phone_number, status, metadata')
      .eq('org_id', orgId)
      .eq('channel_type', 'sms')
      .eq('is_default', true)
      .maybeSingle();

    checks.push({
      name: 'Active SMS channel in DB',
      ok: !!channel && channel.status === 'active',
      detail: channel ? `${channel.phone_number} (${channel.status})` : 'no SMS channel — provision one first',
    });

    let expectedSmsUrl = publicUrl ? `${publicUrl}/api/messages/inbound` : '';
    let expectedStatusUrl = publicUrl ? `${publicUrl}/api/messages/status` : '';

    if (channel && twilioClient && publicUrl) {
      try {
        const matches = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: channel.phone_number, limit: 1 });
        const twNumber = matches[0];
        if (!twNumber) {
          checks.push({ name: 'Number exists on Twilio account', ok: false, detail: 'not found — wrong Twilio account or number was released' });
        } else {
          checks.push({ name: 'Number exists on Twilio account', ok: true, detail: twNumber.sid });
          checks.push({
            name: 'Twilio smsUrl matches PUBLIC_URL',
            ok: twNumber.smsUrl === expectedSmsUrl,
            detail: `expected=${expectedSmsUrl} actual=${twNumber.smsUrl || '(empty)'}`,
          });
          checks.push({
            name: 'Twilio statusCallback matches PUBLIC_URL',
            ok: twNumber.statusCallback === expectedStatusUrl,
            detail: `expected=${expectedStatusUrl} actual=${twNumber.statusCallback || '(empty)'}`,
          });
        }
      } catch (e: any) {
        checks.push({ name: 'Twilio API reachable', ok: false, detail: e?.message || 'unknown error' });
      }
    }

    const allOk = checks.every((c) => c.ok);
    return res.json({
      ok: allOk,
      summary: allOk ? 'Two-way SMS is fully configured.' : 'Configuration issues detected — see checks.',
      expected: { smsUrl: expectedSmsUrl, statusCallback: expectedStatusUrl },
      checks,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to run Twilio diagnostic.', '[messages/twilio-diagnostic]');
  }
});

export default router;
