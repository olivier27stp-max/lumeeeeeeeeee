/**
 * Generic outbound webhook dispatcher.
 *
 * dispatchWebhook(orgId, eventName, payload):
 *   - Looks up active endpoints subscribed to `eventName` (or '*')
 *   - Inserts a `webhook_deliveries` row per endpoint
 *   - Fires each delivery in the background (fire-and-forget)
 *
 * attemptDelivery(deliveryId):
 *   - POSTs to endpoint.url with HMAC-SHA256 signature
 *   - On 2xx: marks `sent`, updates endpoint stats
 *   - Otherwise: increments attempt_count, schedules retry with
 *     exponential backoff (2^n minutes), or marks `abandoned` after 5 attempts.
 */

import crypto from 'crypto';
import { getServiceClient } from './supabase';

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

export type WebhookEventName = string;

interface EndpointRow {
  id: string;
  org_id: string;
  url: string;
  secret: string;
  events: string[];
  is_active: boolean;
}

interface DeliveryRow {
  id: string;
  endpoint_id: string;
  org_id: string;
  event_name: string;
  payload: any;
  attempt_count: number;
  status: string;
}

function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  const signedPayload = `${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function isHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Insert deliveries for all active endpoints subscribed to this event
 * and immediately attempt them in the background.
 */
export async function dispatchWebhook(
  orgId: string,
  eventName: WebhookEventName,
  payload: object,
): Promise<void> {
  if (!orgId || !eventName) return;
  try {
    const admin = getServiceClient();

    const { data: endpoints, error } = await admin
      .from('webhook_endpoints')
      .select('id, org_id, url, secret, events, is_active')
      .eq('org_id', orgId)
      .eq('is_active', true);

    if (error) {
      console.error('[webhookDispatcher] list endpoints failed:', error.message);
      return;
    }
    if (!endpoints || endpoints.length === 0) return;

    const matched = (endpoints as EndpointRow[]).filter((ep) => {
      if (!Array.isArray(ep.events) || ep.events.length === 0) return false;
      return ep.events.includes(eventName) || ep.events.includes('*');
    });
    if (matched.length === 0) return;

    const wrapped = {
      event: eventName,
      created_at: new Date().toISOString(),
      org_id: orgId,
      data: payload,
    };

    const rows = matched.map((ep) => ({
      endpoint_id: ep.id,
      org_id: orgId,
      event_name: eventName,
      payload: wrapped,
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
    }));

    const { data: inserted, error: insErr } = await admin
      .from('webhook_deliveries')
      .insert(rows)
      .select('id');

    if (insErr) {
      console.error('[webhookDispatcher] insert deliveries failed:', insErr.message);
      return;
    }

    // Fire-and-forget — let attempts run async, don't block caller.
    for (const row of inserted || []) {
      attemptDelivery(row.id).catch((err: any) =>
        console.error('[webhookDispatcher] attempt error:', err?.message),
      );
    }
  } catch (err: any) {
    console.error('[webhookDispatcher] dispatch failed:', err?.message);
  }
}

/**
 * Attempt a single delivery. Loads the row + endpoint, signs, POSTs, updates state.
 * Safe to call repeatedly (idempotent transitions). Used by the retry cron.
 */
export async function attemptDelivery(deliveryId: string): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
}> {
  const admin = getServiceClient();

  const { data: delivery, error: delErr } = await admin
    .from('webhook_deliveries')
    .select('id, endpoint_id, org_id, event_name, payload, attempt_count, status')
    .eq('id', deliveryId)
    .maybeSingle();

  if (delErr || !delivery) {
    return { ok: false, error: 'delivery not found' };
  }
  if (delivery.status !== 'pending') {
    return { ok: false, error: `status=${delivery.status}` };
  }

  const { data: endpoint, error: epErr } = await admin
    .from('webhook_endpoints')
    .select('id, org_id, url, secret, is_active')
    .eq('id', (delivery as DeliveryRow).endpoint_id)
    .maybeSingle();

  // Toute transition vers 'abandoned' doit etre lue : si elle echoue la
  // livraison reste 'pending' avec next_attempt_at echu, donc le cron la
  // reprend indefiniment sans jamais pouvoir aboutir.
  const abandon = async (reason: string) => {
    const { error } = await admin
      .from('webhook_deliveries')
      .update({ status: 'abandoned', error_message: reason })
      .eq('id', deliveryId);
    if (error) {
      console.error(`[webhookDispatcher] failed to abandon delivery ${deliveryId} (${reason}):`, error.message);
    }
  };

  if (epErr || !endpoint) {
    await abandon('endpoint missing');
    return { ok: false, error: 'endpoint missing' };
  }
  if (!endpoint.is_active) {
    await abandon('endpoint inactive');
    return { ok: false, error: 'endpoint inactive' };
  }
  if (!isHttpUrl(endpoint.url)) {
    await abandon('invalid URL');
    return { ok: false, error: 'invalid URL' };
  }

  const rawBody = JSON.stringify((delivery as DeliveryRow).payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = computeSignature(endpoint.secret, timestamp, rawBody);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let httpStatus: number | null = null;
  let responseBody = '';
  let networkErr: string | null = null;

  try {
    const resp = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Lume-CRM-Webhooks/1.0',
        'X-Lume-Event': (delivery as DeliveryRow).event_name,
        'X-Lume-Delivery': deliveryId,
        'X-Lume-Signature': signature,
      },
      body: rawBody,
      signal: controller.signal,
    });
    httpStatus = resp.status;
    try {
      const txt = await resp.text();
      responseBody = txt.slice(0, 2000);
    } catch (err) {
      console.error('[webhookDispatcher] response read failed:', err);
    }
  } catch (err: any) {
    networkErr = err?.name === 'AbortError' ? 'timeout' : err?.message || 'network error';
  } finally {
    clearTimeout(timer);
  }

  const success = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
  const newAttemptCount = (delivery as DeliveryRow).attempt_count + 1;

  if (success) {
    const { error: sentErr } = await admin
      .from('webhook_deliveries')
      .update({
        status: 'sent',
        attempt_count: newAttemptCount,
        http_status: httpStatus,
        response_body: responseBody,
        error_message: null,
        next_attempt_at: null,
        sent_at: new Date().toISOString(),
      })
      .eq('id', deliveryId);
    if (sentErr) {
      // La requete HTTP est PARTIE mais la livraison reste 'pending' : le cron
      // la rejouera et l'abonne recevra l'evenement en double.
      console.error(`[webhookDispatcher] CRITICAL: delivery ${deliveryId} sent but not marked — it will be re-delivered:`, sentErr.message);
    }
    const { error: statErr } = await admin
      .from('webhook_endpoints')
      .update({
        last_delivery_at: new Date().toISOString(),
        last_delivery_status: 'sent',
      })
      .eq('id', endpoint.id);
    if (statErr) {
      console.error(`[webhookDispatcher] endpoint ${endpoint.id} stats update failed:`, statErr.message);
    }
    return { ok: true, status: httpStatus! };
  }

  // Failure path — retry or abandon.
  const giveUp = newAttemptCount >= MAX_ATTEMPTS;
  const nextStatus = giveUp ? 'abandoned' : 'pending';
  const backoffMin = Math.pow(2, newAttemptCount); // 2,4,8,16,32 min
  const nextAttemptAt = giveUp
    ? null
    : new Date(Date.now() + backoffMin * 60_000).toISOString();

  const errMsg = networkErr || `HTTP ${httpStatus}`;
  const { error: retryErr } = await admin
    .from('webhook_deliveries')
    .update({
      status: nextStatus,
      attempt_count: newAttemptCount,
      http_status: httpStatus,
      response_body: responseBody,
      error_message: errMsg,
      next_attempt_at: nextAttemptAt,
    })
    .eq('id', deliveryId);
  if (retryErr) {
    // attempt_count/next_attempt_at non ecrits = plus de backoff ni de plafond
    // a MAX_ATTEMPTS : le cron martelerait l'endpoint mort a chaque passage.
    console.error(`[webhookDispatcher] CRITICAL: delivery ${deliveryId} retry state not written (backoff lost):`, retryErr.message);
  }

  const { error: statErr } = await admin
    .from('webhook_endpoints')
    .update({
      last_delivery_at: new Date().toISOString(),
      last_delivery_status: nextStatus === 'abandoned' ? 'abandoned' : 'failed',
    })
    .eq('id', endpoint.id);
  if (statErr) {
    console.error(`[webhookDispatcher] endpoint ${endpoint.id} stats update failed:`, statErr.message);
  }

  return { ok: false, status: httpStatus ?? undefined, error: errMsg };
}

/**
 * Process all due-pending deliveries. Used by the cron endpoint.
 * Concurrency-limited to avoid overwhelming the server.
 */
export async function processPendingDeliveries(opts: {
  batchSize?: number;
  concurrency?: number;
} = {}): Promise<{ processed: number; succeeded: number; failed: number; abandoned: number }> {
  const batchSize = opts.batchSize ?? 200;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 25));

  const admin = getServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await admin
    .from('webhook_deliveries')
    .select('id')
    .eq('status', 'pending')
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .limit(batchSize);

  if (error) throw error;
  const ids = (due || []).map((d: any) => d.id as string);

  let succeeded = 0;
  let failed = 0;
  let abandoned = 0;

  // Simple concurrency pool.
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const i = cursor++;
      const id = ids[i];
      try {
        const r = await attemptDelivery(id);
        if (r.ok) succeeded++;
        else failed++;
      } catch (err: any) {
        console.error('[webhookDispatcher] worker error:', err?.message);
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Count abandoned after the fact (approximate — based on what just transitioned)
  // We don't need this exact; the summary is informational.
  if (ids.length > 0) {
    const { count } = await admin
      .from('webhook_deliveries')
      .select('id', { count: 'exact', head: true })
      .in('id', ids)
      .eq('status', 'abandoned');
    abandoned = count ?? 0;
  }

  return { processed: ids.length, succeeded, failed, abandoned };
}

/** Catalog of known event names — used by frontend multi-select. */
export const KNOWN_EVENTS: string[] = [
  'client.created',
  'client.updated',
  'lead.created',
  'quote.created',
  'quote.sent',
  'quote.accepted',
  'quote.declined',
  'invoice.created',
  'invoice.sent',
  'invoice.paid',
  'payment.received',
  'job.created',
  'job.scheduled',
  'job.completed',
  'booking.received',
  'webhook.test',
];
