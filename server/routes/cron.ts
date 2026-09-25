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
import { balayerRappelsDates } from '../lib/rappels-dates';
import crypto from 'crypto';
import { getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { runDueSchedules } from '../lib/recurringInvoicesEngine';
import { processPendingDeliveries } from '../lib/webhookDispatcher';
import { logger } from '../lib/logger';

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
  logger.info('[cron] retention_job:', { result: data });
  return res.status(200).json({ ok: true, result: data });
});

router.post('/cron/purge-audit', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  const svc = getServiceClient();
  const { data, error } = await svc.rpc('purge_old_audit_events', { p_retention_days: 1095 });
  if (error) return sendSafeError(res, error, 'Cron job failed.', '[cron]');
  logger.info('[cron] purge_old_audit_events:', { purged: data });
  return res.status(200).json({ ok: true, purged: data });
});

router.post('/cron/recurring-invoices', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  try {
    const svc = getServiceClient();
    const summary = await runDueSchedules(svc);
    logger.info('[cron] recurring-invoices:', {
      processed: summary.processed, errors: summary.errors,
    });
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    return sendSafeError(res, err, 'Cron job failed.', '[cron/recurring-invoices]');
  }
});

/*
 * Les rappels sur date — une fois par jour.
 *
 * Fin de contrat, échéance de garantie, entretien annuel : une date dans un
 * champ personnalisé, et le message part X jours avant. Le balayage voit
 * l'état RÉEL du jour, alors qu'une tâche planifiée six mois plus tôt
 * parlerait d'un monde qui n'existe plus.
 */
router.post('/cron/rappels-dates', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  try {
    const svc = getServiceClient();
    const resume = await balayerRappelsDates(svc);
    logger.info('[cron] rappels-dates:', { ...resume });
    return res.status(200).json({ ok: true, ...resume });
  } catch (err: any) {
    return sendSafeError(res, err, 'Cron job failed.', '[cron/rappels-dates]');
  }
});

router.post('/cron/webhook-retries', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  try {
    const summary = await processPendingDeliveries({ concurrency: 5 });
    logger.info('[cron] webhook-retries:', { ...summary });
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
    logger.info('[cron] release-sms-numbers:', { ...summary });
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    return sendSafeError(res, err, 'Cron job failed.', '[cron/release-sms-numbers]');
  }
});

/**
 * POST /api/cron/lumi-bienvenue { org_id }
 *
 * Envoie le mot de bienvenue de Lumi aux propriétaires et administrateurs
 * d'une org. Normalement déclenché par l'activation de l'abonnement ; cette
 * route sert aux orgs qui existaient AVANT que le canal texto n'existe, et à
 * rattraper un envoi manqué.
 *
 * Idempotente : quelqu'un qui a déjà reçu le message ne le reçoit pas deux
 * fois, et un numéro qui a refusé les textos n'est jamais recontacté.
 */
router.post('/cron/lumi-bienvenue', async (req, res) => {
  if (!checkCronAuth(req, res)) return;
  const orgId = String((req.body || {}).org_id || '').trim();
  if (!orgId) return res.status(400).json({ error: 'org_id is required.' });
  try {
    const [{ envoyerBienvenue }, { logger }] = await Promise.all([
      import('../lib/sms/bienvenue'),
      import('../lib/logger'),
    ]);
    const r = await envoyerBienvenue(getServiceClient(), orgId);
    logger.info('[cron] lumi-bienvenue', { orgId, envoyes: r.envoyes, ignores: r.ignores.length });
    return res.status(200).json({ ok: true, ...r });
  } catch (err: any) {
    return sendSafeError(res, err, 'Cron job failed.', '[cron/lumi-bienvenue]');
  }
});

export default router;
