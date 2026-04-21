/* ═══════════════════════════════════════════════════════════════
   Agent Training Routes — Outcome tracking, corrections, calibration
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { z } from 'zod';
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

const outcomeSchema = z.object({
  decisionLogId: z.string().uuid().optional().nullable(),
  sessionId: z.string().trim().max(200).optional().nullable(),
  messageId: z.string().uuid().optional().nullable(),
  domain: z.string().trim().min(1).max(100),
  actionType: z.string().trim().max(100).optional().nullable(),
  confidence: z.number().int().min(0).max(100).optional(),
  outcome: z.enum(['success', 'partial', 'failure', 'rejected', 'ignored']),
  outcomeNote: z.string().trim().max(2000).optional().nullable(),
});
const correctionSchema = z.object({
  sessionId: z.string().trim().max(200).optional().nullable(),
  messageId: z.string().uuid().optional().nullable(),
  originalResponse: z.string().trim().min(1).max(20_000),
  domain: z.string().trim().max(100).optional().nullable(),
  correctionType: z.enum(['wrong_answer', 'wrong_tone', 'missing_context', 'hallucination', 'outdated']),
  correctionText: z.string().trim().min(1).max(4000),
  correctAnswer: z.string().trim().max(20_000).optional().nullable(),
});
const feedbackTrainSchema = z.object({
  messageId: z.string().uuid(),
  isPositive: z.boolean(),
  domain: z.string().trim().max(100).optional().nullable(),
});

// POST /api/agent/outcome — Record decision outcome
router.post('/agent/outcome', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();

    const parsed = outcomeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }
    const { decisionLogId, sessionId, messageId, domain, actionType, confidence, outcome, outcomeNote } = parsed.data;

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

    const parsed = correctionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }
    const { sessionId, messageId, originalResponse, domain, correctionType, correctionText, correctAnswer } = parsed.data;

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

    const parsed = feedbackTrainSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join('; ') });
    }
    const { messageId, isPositive, domain } = parsed.data;

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
