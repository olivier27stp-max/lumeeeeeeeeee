/**
 * Webhook endpoint CRUD + delivery log.
 *
 * GET    /api/webhooks                 — list endpoints (members)
 * POST   /api/webhooks                 — create endpoint (admin only)
 * PATCH  /api/webhooks/:id             — update endpoint (admin only)
 * DELETE /api/webhooks/:id             — soft-deactivate (admin only)
 * POST   /api/webhooks/:id/test        — fire a `webhook.test` event (admin only)
 * GET    /api/webhooks/:id/deliveries  — last N deliveries (members)
 * GET    /api/webhooks/events          — catalog of known event names
 */

import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { dispatchWebhook, KNOWN_EVENTS } from '../lib/webhookDispatcher';

const router = Router();

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

function isValidUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url().max(2000),
  events: z.array(z.string().min(1).max(80)).min(1).max(64),
  is_active: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.string().url().max(2000).optional(),
  events: z.array(z.string().min(1).max(80)).min(1).max(64).optional(),
  is_active: z.boolean().optional(),
});

router.get('/webhooks/events', (_req, res) => {
  return res.json({ events: KNOWN_EVENTS });
});

router.get('/webhooks', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { data, error } = await auth.client
      .from('webhook_endpoints')
      .select('id, name, url, events, is_active, created_at, updated_at, last_delivery_at, last_delivery_status')
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ endpoints: data || [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to list webhooks.', '[webhooks/list]');
  }
});

router.post('/webhooks', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    if (!(await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId))) {
      return res.status(403).json({ error: 'Admin role required.' });
    }
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload.', details: parsed.error.flatten() });
    }
    if (!isValidUrl(parsed.data.url)) {
      return res.status(400).json({ error: 'URL must be http(s).' });
    }

    const secret = generateSecret();
    const admin = getServiceClient();
    const { data, error } = await admin
      .from('webhook_endpoints')
      .insert({
        org_id: auth.orgId,
        name: parsed.data.name,
        url: parsed.data.url,
        events: parsed.data.events,
        secret,
        is_active: parsed.data.is_active ?? true,
      })
      .select('id, name, url, events, is_active, created_at, updated_at')
      .single();
    if (error) throw error;

    // Return secret ONCE — caller must store/display it now.
    return res.json({ endpoint: data, secret });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to create webhook.', '[webhooks/create]');
  }
});

router.patch('/webhooks/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    if (!(await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId))) {
      return res.status(403).json({ error: 'Admin role required.' });
    }
    const id = String(req.params.id || '');
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload.', details: parsed.error.flatten() });
    }
    if (parsed.data.url && !isValidUrl(parsed.data.url)) {
      return res.status(400).json({ error: 'URL must be http(s).' });
    }
    const admin = getServiceClient();
    const { data, error } = await admin
      .from('webhook_endpoints')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', auth.orgId)
      .select('id, name, url, events, is_active, created_at, updated_at, last_delivery_at, last_delivery_status')
      .single();
    if (error) throw error;
    return res.json({ endpoint: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to update webhook.', '[webhooks/update]');
  }
});

router.delete('/webhooks/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    if (!(await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId))) {
      return res.status(403).json({ error: 'Admin role required.' });
    }
    const id = String(req.params.id || '');
    const admin = getServiceClient();
    const { error } = await admin
      .from('webhook_endpoints')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('org_id', auth.orgId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to delete webhook.', '[webhooks/delete]');
  }
});

router.post('/webhooks/:id/test', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    if (!(await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId))) {
      return res.status(403).json({ error: 'Admin role required.' });
    }
    const id = String(req.params.id || '');
    const admin = getServiceClient();
    const { data: ep } = await admin
      .from('webhook_endpoints')
      .select('id, org_id, is_active, events')
      .eq('id', id)
      .eq('org_id', auth.orgId)
      .maybeSingle();
    if (!ep) return res.status(404).json({ error: 'Webhook not found.' });

    // Force-dispatch to this single endpoint, regardless of subscription.
    const events = Array.isArray(ep.events) ? ep.events.slice() : [];
    let needsTempSub = false;
    if (!events.includes('webhook.test') && !events.includes('*')) {
      // Temporarily add the event so dispatcher picks it up
      needsTempSub = true;
      await admin
        .from('webhook_endpoints')
        .update({ events: [...events, 'webhook.test'] })
        .eq('id', id);
    }
    try {
      await dispatchWebhook(auth.orgId, 'webhook.test', {
        message: 'Test from Lume CRM',
        endpoint_id: id,
        triggered_by: auth.user.id,
      });
    } finally {
      if (needsTempSub) {
        await admin.from('webhook_endpoints').update({ events }).eq('id', id);
      }
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to test webhook.', '[webhooks/test]');
  }
});

router.get('/webhooks/:id/deliveries', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const id = String(req.params.id || '');
    const limit = Math.max(1, Math.min(Number(req.query.limit ?? 100), 500));
    const { data, error } = await auth.client
      .from('webhook_deliveries')
      .select('id, event_name, status, attempt_count, http_status, error_message, created_at, sent_at, next_attempt_at')
      .eq('endpoint_id', id)
      .eq('org_id', auth.orgId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return res.json({ deliveries: data || [] });
  } catch (err: any) {
    return sendSafeError(res, err, 'Unable to list deliveries.', '[webhooks/deliveries]');
  }
});

export default router;
