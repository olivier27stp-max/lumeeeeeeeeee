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
import { getServiceClient } from '../lib/supabase';

const router = Router();

function checkCronAuth(req: Request, res: Response): boolean {
  const provided = req.headers['x-cron-secret'];
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    res.status(503).json({ error: 'CRON_SECRET not configured on server' });
    return false;
  }
  if (typeof provided !== 'string' || provided !== expected) {
    res.status(401).json({ error: 'Invalid cron secret' });
    return false;
  }
  return true;
}

router.post('/cron/retention', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  const svc = getServiceClient();
  const { data, error } = await svc.rpc('run_retention_job');
  if (error) return res.status(500).json({ error: error.message });
  console.log('[cron] retention_job:', JSON.stringify(data));
  return res.status(200).json({ ok: true, result: data });
});

router.post('/cron/purge-audit', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  const svc = getServiceClient();
  const { data, error } = await svc.rpc('purge_old_audit_events', { p_retention_days: 1095 });
  if (error) return res.status(500).json({ error: error.message });
  console.log('[cron] purge_old_audit_events:', data);
  return res.status(200).json({ ok: true, purged: data });
});

export default router;
