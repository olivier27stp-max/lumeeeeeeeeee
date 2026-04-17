/* ═══════════════════════════════════════════════════════════════
   Agent Training Routes — Outcome tracking, corrections, calibration
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import {
  recordOutcome,
  recordCorrection,
  recordFeedback,
  getAllCalibration,
  getUserPrefs,
} from '../lib/agent/training-engine';

const router = Router();

// POST /api/agent/outcome — Record decision outcome
router.post('/agent/outcome', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { decisionLogId, sessionId, messageId, domain, actionType, confidence, outcome, outcomeNote } = req.body;
    if (!domain || !outcome) return res.status(400).json({ error: 'domain and outcome required' });

    const id = await recordOutcome(admin, {
      orgId: auth.orgId,
      userId: auth.user.id,
      decisionLogId, sessionId, messageId,
      domain, actionType,
      confidence: confidence || 70,
      outcome,
      outcomeNote,
    });

    return res.status(201).json({ id });
  } catch (err: any) {
    return sendSafeError(res, err, 'Training operation failed.', '[agent-training]');
  }
});

// POST /api/agent/correction — User explains what was wrong
router.post('/agent/correction', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { sessionId, messageId, originalResponse, domain, correctionType, correctionText, correctAnswer } = req.body;
    if (!originalResponse || !correctionType || !correctionText) {
      return res.status(400).json({ error: 'originalResponse, correctionType, correctionText required' });
    }

    const id = await recordCorrection(admin, {
      orgId: auth.orgId,
      userId: auth.user.id,
      sessionId, messageId,
      originalResponse, domain,
      correctionType, correctionText, correctAnswer,
    });

    return res.status(201).json({ id });
  } catch (err: any) {
    return sendSafeError(res, err, 'Training operation failed.', '[agent-training]');
  }
});

// POST /api/agent/feedback — Enhanced thumbs up/down with training
router.post('/agent/feedback-train', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const { messageId, isPositive, domain } = req.body;
    if (!messageId || isPositive === undefined) {
      return res.status(400).json({ error: 'messageId and isPositive required' });
    }

    await recordFeedback(admin, auth.orgId, auth.user.id, messageId, isPositive, domain);

    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Training operation failed.', '[agent-training]');
  }
});

// GET /api/agent/calibration — Get calibration data for the org
router.get('/agent/calibration', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const data = await getAllCalibration(admin, auth.orgId);
    return res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Training operation failed.', '[agent-training]');
  }
});

// GET /api/agent/user-prefs — Get user's learned preferences
router.get('/agent/user-prefs', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const prefs = await getUserPrefs(admin, auth.orgId, auth.user.id);
    return res.json(prefs || { preferred_detail_level: 'medium', preferred_tone: 'professional', approval_rate: 0 });
  } catch (err: any) {
    return sendSafeError(res, err, 'Training operation failed.', '[agent-training]');
  }
});

export default router;
