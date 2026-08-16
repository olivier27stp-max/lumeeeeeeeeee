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

// Irreversibly release Twilio numbers whose grace period has elapsed.
// Safe to run daily: it skips anything still within its grace window and
// re-checks the plan before deleting, so a re-subscribed org keeps its number.
router.post('/cron/release-sms-numbers', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  try {
    const { releaseExpiredSmsNumbers } = await import('../lib/twilioRelease');
    const summary = await releaseExpiredSmsNumbers();
    console.log('[cron] release-sms-numbers:', JSON.stringify(summary));
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    return sendSafeError(res, err, 'Cron job failed.', '[cron/release-sms-numbers]');
  }
});

export default router;
