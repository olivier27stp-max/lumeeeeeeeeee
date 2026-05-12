/**
 * Cron fallback endpoints — for when pg_cron is not available (Supabase Free plan).
 *
 * Auth: requires header `x-cron-secret: $CRON_SECRET` (env var).
 * Call daily via cron-job.org, GitHub Actions, Vercel Cron, or similar.
 *
 * Endpoints:
 *   - POST /api/cron/retention        → public.run_retention_job()
 *   - POST /api/cron/purge-audit      → public.purge_old_audit_events(1095)
 */

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { runDueSchedules } from '../lib/recurringInvoicesEngine';
import { processPendingDeliveries } from '../lib/webhookDispatcher';

const router = Router();

function checkCronAuth(req: Request, res: Response): boolean {
  const provided = req.headers['x-cron-secret'];
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(503).json({ error: 'CRON_SECRET not configured on server' });
    return false;
  }
  if (typeof provided !== 'string') {
    res.status(401).json({ error: 'Invalid cron secret' });
    return false;
  }
  // Length check before timingSafeEqual (which throws on mismatch). The
  // length itself is not secret — the secret's content is — and gating the
  // compare on length avoids the throw without leaking content timing.
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    res.status(401).json({ error: 'Invalid cron secret' });
    return false;
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    res.status(401).json({ error: 'Invalid cron secret' });
    return false;
  }
  return true;
}

router.post('/cron/retention', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  const svc = getServiceClient();
  const { data, error } = await svc.rpc('run_retention_job');
  if (error) return sendSafeError(res, error, 'Cron job failed.', '[cron]');
  console.log('[cron] retention_job:', JSON.stringify(data));
  return res.status(200).json({ ok: true, result: data });
});

router.post('/cron/purge-audit', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  const svc = getServiceClient();
  const { data, error } = await svc.rpc('purge_old_audit_events', { p_retention_days: 1095 });
  if (error) return sendSafeError(res, error, 'Cron job failed.', '[cron]');
  console.log('[cron] purge_old_audit_events:', data);
  return res.status(200).json({ ok: true, purged: data });
});

router.post('/cron/campaigns', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  try {
    const svc = getServiceClient();
    const nowIso = new Date().toISOString();
    const { data: due, error } = await svc
      .from('email_campaigns')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_at', nowIso)
      .limit(20);
    if (error) return sendSafeError(res, error, 'Cron job failed.', '[cron/campaigns]');

    const { processCampaign } = await import('./campaigns.js');
    const results: any[] = [];
    for (const c of due || []) {
      try {
        const r = await processCampaign(svc, c);
        results.push({ id: c.id, ok: true, ...r });
      } catch (err: any) {
        await svc.from('email_campaigns').update({ status: 'failed' }).eq('id', c.id);
        results.push({ id: c.id, ok: false, error: err?.message });
      }
    }
    console.log('[cron/campaigns]', JSON.stringify({ processed: results.length }));
    return res.status(200).json({ ok: true, processed: results.length, results });
  } catch (err: any) {
    return sendSafeError(res, err, 'Cron job failed.', '[cron/campaigns]');
  }
});

router.post('/cron/recurring-invoices', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  try {
    const svc = getServiceClient();
    const summary = await runDueSchedules(svc);
    console.log('[cron] recurring-invoices:', JSON.stringify({
      processed: summary.processed, errors: summary.errors,
    }));
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    return sendSafeError(res, err, 'Cron job failed.', '[cron/recurring-invoices]');
  }
});

router.post('/cron/webhook-retries', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  try {
    const summary = await processPendingDeliveries({ concurrency: 5 });
    console.log('[cron] webhook-retries:', JSON.stringify(summary));
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    return sendSafeError(res, err, 'Cron job failed.', '[cron/webhook-retries]');
  }
});

export default router;
