import express from 'express';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { validate } from '../lib/validation';

const router = express.Router();

// ── Schemas ──────────────────────────────────────────────────────────────────

const startSessionSchema = z.object({
  teamId: z.string().uuid().optional().nullable(),
  timeEntryId: z.string().uuid().optional().nullable(),
  source: z.enum(['web', 'mobile', 'external']).optional().default('web'),
});

const stopSessionSchema = z.object({
  sessionId: z.string().uuid(),
  reason: z.enum(['stopped', 'lost_permission', 'error', 'expired']).optional().default('stopped'),
});

const recordPointSchema = z.object({
  sessionId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy_m: z.number().optional().nullable(),
  heading: z.number().optional().nullable(),
  speed_mps: z.number().optional().nullable(),
  altitude_m: z.number().optional().nullable(),
  is_moving: z.boolean().optional(),
  job_id: z.string().uuid().optional().nullable(),
});

const batchPointsSchema = z.object({
  sessionId: z.string().uuid(),
  points: z.array(z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy_m: z.number().optional().nullable(),
    heading: z.number().optional().nullable(),
    speed_mps: z.number().optional().nullable(),
    altitude_m: z.number().optional().nullable(),
    is_moving: z.boolean().optional(),
    recorded_at: z.string(),
  })).min(1).max(100),
});

// ── Start tracking session ───────────────────────────────────────────────────

router.post('/tracking/start', validate(startSessionSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { teamId, timeEntryId, source } = req.body;

    // Expire any stale active sessions
    await admin
      .from('tracking_sessions')
      .update({ status: 'expired', ended_at: new Date().toISOString() })
      .eq('user_id', auth.user.id)
      .eq('status', 'active');

    const { data: session, error } = await admin
      .from('tracking_sessions')
      .insert({
        org_id: auth.orgId,
        user_id: auth.user.id,
        team_id: teamId || null,
        time_entry_id: timeEntryId || null,
        source: source || 'web',
        status: 'active',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;

    // Log event
    await admin.from('tracking_events').insert({
      org_id: auth.orgId,
      session_id: session.id,
      user_id: auth.user.id,
      event_type: 'session_start',
      event_at: new Date().toISOString(),
      details: { source: source || 'web' },
    });

    return res.json({ session });
  } catch (error: any) {
    console.error('tracking_start_failed', error?.message);
    return res.status(500).json({ error: error?.message || 'Failed to start tracking session.' });
  }
});

// ── Stop tracking session ────────────────────────────────────────────────────

router.post('/tracking/stop', validate(stopSessionSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { sessionId, reason } = req.body;
    const now = new Date().toISOString();

    await admin
      .from('tracking_sessions')
      .update({ status: reason || 'stopped', ended_at: now })
      .eq('id', sessionId)
      .eq('user_id', auth.user.id);

    await admin.from('tracking_events').insert({
      org_id: auth.orgId,
      session_id: sessionId,
      user_id: auth.user.id,
      event_type: reason === 'stopped' ? 'session_stop' : 'session_expired',
      event_at: now,
      details: { reason },
    });

    // Mark offline
    await admin
      .from('tracking_live_locations')
      .update({ tracking_status: 'offline', session_id: null })
      .eq('user_id', auth.user.id);

    return res.json({ ok: true });
  } catch (error: any) {
    console.error('tracking_stop_failed', error?.message);
    return res.status(500).json({ error: error?.message || 'Failed to stop tracking session.' });
  }
});

// ── Record single position ───────────────────────────────────────────────────

router.post('/tracking/point', validate(recordPointSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { sessionId, latitude, longitude, accuracy_m, heading, speed_mps, altitude_m, is_moving, job_id } = req.body;
    const now = new Date().toISOString();
    const moving = is_moving ?? (speed_mps != null ? speed_mps > 0.5 : true);

    // Verify session belongs to user and is active
    const { data: session } = await admin
      .from('tracking_sessions')
      .select('id, org_id, team_id')
      .eq('id', sessionId)
      .eq('user_id', auth.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!session) return res.status(404).json({ error: 'No active session found.' });

    // Insert point
    await admin.from('tracking_points').insert({
      org_id: auth.orgId,
      session_id: sessionId,
      user_id: auth.user.id,
      team_id: session.team_id,
      latitude, longitude,
      accuracy_m: accuracy_m ?? null,
      heading: heading ?? null,
      speed_mps: speed_mps ?? null,
      altitude_m: altitude_m ?? null,
      is_moving: moving,
      job_id: job_id ?? null,
      recorded_at: now,
    });

    // Update session
    await admin
      .from('tracking_sessions')
      .update({ last_point_at: now })
      .eq('id', sessionId);

    // Upsert live location
    await admin.from('tracking_live_locations').upsert({
      user_id: auth.user.id,
      org_id: auth.orgId,
      session_id: sessionId,
      team_id: session.team_id,
      latitude, longitude,
      accuracy_m: accuracy_m ?? null,
      heading: heading ?? null,
      speed_mps: speed_mps ?? null,
      is_moving: moving,
      job_id: job_id ?? null,
      recorded_at: now,
      tracking_status: moving ? 'active' : 'idle',
    }, { onConflict: 'user_id' });

    return res.json({ ok: true });
  } catch (error: any) {
    console.error('tracking_point_failed', error?.message);
    return res.status(500).json({ error: error?.message || 'Failed to record position.' });
  }
});

// ── Batch record positions (for offline buffer flush) ────────────────────────

router.post('/tracking/points-batch', validate(batchPointsSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { sessionId, points } = req.body;

    const { data: session } = await admin
      .from('tracking_sessions')
      .select('id, org_id, team_id')
      .eq('id', sessionId)
      .eq('user_id', auth.user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (!session) return res.status(404).json({ error: 'No active session found.' });

    const rows = points.map((p: any) => ({
      org_id: auth.orgId,
      session_id: sessionId,
      user_id: auth.user.id,
      team_id: session.team_id,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy_m: p.accuracy_m ?? null,
      heading: p.heading ?? null,
      speed_mps: p.speed_mps ?? null,
      altitude_m: p.altitude_m ?? null,
      is_moving: p.is_moving ?? true,
      recorded_at: p.recorded_at,
    }));

    const { error } = await admin.from('tracking_points').insert(rows);
    if (error) throw error;

    // Update session with latest point
    const latest = points[points.length - 1];
    await admin
      .from('tracking_sessions')
      .update({ last_point_at: latest.recorded_at })
      .eq('id', sessionId);

    // Update live location with latest
    await admin.from('tracking_live_locations').upsert({
      user_id: auth.user.id,
      org_id: auth.orgId,
      session_id: sessionId,
      team_id: session.team_id,
      latitude: latest.latitude,
      longitude: latest.longitude,
      accuracy_m: latest.accuracy_m ?? null,
      heading: latest.heading ?? null,
      speed_mps: latest.speed_mps ?? null,
      is_moving: latest.is_moving ?? true,
      recorded_at: latest.recorded_at,
      tracking_status: 'active',
    }, { onConflict: 'user_id' });

    return res.json({ ok: true, count: rows.length });
  } catch (error: any) {
    console.error('tracking_batch_failed', error?.message);
    return res.status(500).json({ error: error?.message || 'Failed to record batch.' });
  }
});

// ── Log tracking event ───────────────────────────────────────────────────────

router.post('/tracking/event', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { sessionId, eventType, latitude, longitude, details } = req.body;

    await admin.from('tracking_events').insert({
      org_id: auth.orgId,
      session_id: sessionId || null,
      user_id: auth.user.id,
      event_type: eventType,
      event_at: new Date().toISOString(),
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      details: details ?? null,
    });

    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to log event.' });
  }
});

export default router;
