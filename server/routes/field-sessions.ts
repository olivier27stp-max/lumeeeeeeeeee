import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import {
  startSession,
  endSession,
  pauseSession,
  resumeSession,
  recordGpsPoint,
  getGpsTrail,
  getActiveSession,
  getActiveSessions,
  getSessionHistory,
} from '../lib/field-sales/session-engine';

const router = Router();

// POST /api/field-sessions/start
router.post('/field-sessions/start', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { territoryId, latitude, longitude } = req.body;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'latitude and longitude are required.' });
  }

  try {
    const sc = getServiceClient();
    const session = await startSession(sc, auth.orgId, {
      userId: auth.user.id,
      territoryId,
      latitude,
      longitude,
    });
    res.json(session);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/field-sessions/:id/end
router.post('/field-sessions/:id/end', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { latitude, longitude } = req.body;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({ error: 'latitude and longitude are required.' });
  }

  try {
    const sc = getServiceClient();
    const session = await endSession(sc, auth.orgId, req.params.id, latitude, longitude);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/field-sessions/:id/pause
router.post('/field-sessions/:id/pause', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const session = await pauseSession(sc, auth.orgId, req.params.id);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/field-sessions/:id/resume
router.post('/field-sessions/:id/resume', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const session = await resumeSession(sc, auth.orgId, req.params.id);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/field-sessions/:id/gps
router.post('/field-sessions/:id/gps', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { lat, lng, accuracy } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng are required.' });
  }

  try {
    const sc = getServiceClient();
    const point = await recordGpsPoint(sc, req.params.id, auth.user.id, lat, lng, accuracy ?? null);
    res.json(point);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/field-sessions/:id/trail
router.get('/field-sessions/:id/trail', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const trail = await getGpsTrail(sc, req.params.id);
    res.json(trail);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/field-sessions/active
router.get('/field-sessions/active', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const session = await getActiveSession(sc, auth.orgId, auth.user.id);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/field-sessions/active/all — all org active sessions (managers)
router.get('/field-sessions/active/all', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const sessions = await getActiveSessions(sc, auth.orgId);
    res.json(sessions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/field-sessions/history?userId=...&from=...&to=...
router.get('/field-sessions/history', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const userId = (req.query.userId as string) || auth.user.id;
  const from = req.query.from as string;
  const to = req.query.to as string;

  if (!from || !to) {
    return res.status(400).json({ error: 'from and to query parameters are required.' });
  }

  try {
    const sc = getServiceClient();
    const sessions = await getSessionHistory(sc, auth.orgId, userId, { from, to });
    res.json(sessions);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
