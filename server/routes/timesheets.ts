import { Router } from 'express';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { validate } from '../lib/validation';

const router = Router();

// ─── Schemas ────────────────────────────────────────────────────────────────

const punchInSchema = z.object({
  job_id: z.string().uuid().optional().nullable(),
  team_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).passthrough();

const breakSchema = z.object({
  entry_id: z.string().uuid(),
}).passthrough();

const punchOutSchema = z.object({
  entry_id: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).passthrough();

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowParts() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  const time = d.toTimeString().slice(0, 8);
  return { date, time, iso: d.toISOString() };
}

// Find the currently open time entry for this user (no punch_out)
async function findActiveEntry(client: any, orgId: string, userId: string) {
  const { data, error } = await client
    .from('time_entries')
    .select('*')
    .eq('org_id', orgId)
    .eq('employee_id', userId)
    .is('punch_out', null)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /api/timesheets/active — return the current user's active entry (if any)
router.get('/timesheets/active', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const entry = await findActiveEntry(auth.client, auth.orgId, auth.user.id);
    return res.json({ entry });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to fetch active timesheet.', '[timesheets]');
  }
});

// POST /api/timesheets/punch-in
router.post('/timesheets/punch-in', validate(punchInSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const existing = await findActiveEntry(auth.client, auth.orgId, auth.user.id);
    if (existing) {
      return res.status(409).json({ error: 'Already punched in', entry: existing });
    }

    const { job_id, team_id, notes } = req.body as z.infer<typeof punchInSchema>;
    const { date, time, iso } = nowParts();

    const admin = getServiceClient();
    const { data: profile } = await admin
      .from('memberships')
      .select('user_id, role')
      .eq('user_id', auth.user.id)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    const employeeName =
      (auth.user.user_metadata as any)?.full_name ||
      (auth.user.user_metadata as any)?.name ||
      auth.user.email ||
      'Employee';

    const { data, error } = await admin
      .from('time_entries')
      .insert({
        org_id: auth.orgId,
        employee_id: auth.user.id,
        employee_name: employeeName,
        date,
        punch_in: time,
        punch_in_at: iso,
        breaks: [],
        notes: notes ?? null,
        job_id: job_id ?? null,
        team_id: team_id ?? null,
        status: 'active',
      })
      .select('*')
      .single();

    if (error) {
      return sendSafeError(res, error, 'Failed to punch in.', '[timesheets]');
    }
    void profile; // unused; kept for future role-gated branches

    // Auto-create a tracking session linked to this time entry.
    // GPS points start flowing once the client calls /tracking/points after
    // the user grants geolocation permission. The session row alone enables
    // the "punched but no GPS" badge on the dispatch map.
    await admin
      .from('tracking_sessions')
      .update({ status: 'expired', ended_at: iso })
      .eq('user_id', auth.user.id)
      .eq('status', 'active');
    await admin
      .from('tracking_sessions')
      .insert({
        org_id: auth.orgId,
        user_id: auth.user.id,
        team_id: team_id ?? null,
        time_entry_id: data.id,
        source: 'web',
        status: 'active',
        started_at: iso,
      });

    return res.json({ ok: true, entry: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to punch in.', '[timesheets]');
  }
});

// POST /api/timesheets/punch-out
router.post('/timesheets/punch-out', validate(punchOutSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const body = req.body as z.infer<typeof punchOutSchema>;
    let entry = body.entry_id
      ? (await auth.client.from('time_entries').select('*').eq('id', body.entry_id).eq('org_id', auth.orgId).maybeSingle()).data
      : await findActiveEntry(auth.client, auth.orgId, auth.user.id);

    if (!entry) return res.status(404).json({ error: 'No active timesheet to punch out.' });
    if (entry.employee_id !== auth.user.id) {
      return res.status(403).json({ error: 'You can only punch out your own timesheet.' });
    }

    // If a break is currently open, close it
    const breaks: Array<{ start: string; end?: string }> = Array.isArray(entry.breaks) ? entry.breaks : [];
    const { time, iso } = nowParts();
    if (breaks.length && !breaks[breaks.length - 1].end) {
      breaks[breaks.length - 1].end = time;
    }

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('time_entries')
      .update({
        punch_out: time,
        punch_out_at: iso,
        breaks,
        status: 'completed',
        notes: body.notes ?? entry.notes,
        updated_at: iso,
      })
      .eq('id', entry.id)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();

    if (error) return sendSafeError(res, error, 'Failed to punch out.', '[timesheets]');

    // Stop any active tracking session linked to this entry
    await admin
      .from('tracking_sessions')
      .update({ status: 'stopped', ended_at: iso })
      .eq('time_entry_id', entry.id)
      .eq('status', 'active');

    return res.json({ ok: true, entry: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to punch out.', '[timesheets]');
  }
});

// POST /api/timesheets/break/start
router.post('/timesheets/break/start', validate(breakSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { entry_id } = req.body as z.infer<typeof breakSchema>;

    const { data: entry, error: getErr } = await auth.client
      .from('time_entries').select('*').eq('id', entry_id).eq('org_id', auth.orgId).maybeSingle();
    if (getErr || !entry) return res.status(404).json({ error: 'Entry not found.' });
    if (entry.employee_id !== auth.user.id) return res.status(403).json({ error: 'Forbidden.' });
    if (entry.punch_out) return res.status(400).json({ error: 'Entry already closed.' });

    const breaks: Array<{ start: string; end?: string }> = Array.isArray(entry.breaks) ? entry.breaks : [];
    if (breaks.length && !breaks[breaks.length - 1].end) {
      return res.status(409).json({ error: 'A break is already in progress.' });
    }
    const { time, iso } = nowParts();
    breaks.push({ start: time });

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('time_entries').update({ breaks, status: 'on_break', updated_at: iso })
      .eq('id', entry_id).eq('org_id', auth.orgId).select('*').single();
    if (error) return sendSafeError(res, error, 'Failed to start break.', '[timesheets]');
    return res.json({ ok: true, entry: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to start break.', '[timesheets]');
  }
});

// POST /api/timesheets/break/end
router.post('/timesheets/break/end', validate(breakSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { entry_id } = req.body as z.infer<typeof breakSchema>;

    const { data: entry, error: getErr } = await auth.client
      .from('time_entries').select('*').eq('id', entry_id).eq('org_id', auth.orgId).maybeSingle();
    if (getErr || !entry) return res.status(404).json({ error: 'Entry not found.' });
    if (entry.employee_id !== auth.user.id) return res.status(403).json({ error: 'Forbidden.' });

    const breaks: Array<{ start: string; end?: string }> = Array.isArray(entry.breaks) ? entry.breaks : [];
    if (!breaks.length || breaks[breaks.length - 1].end) {
      return res.status(409).json({ error: 'No open break.' });
    }
    const { time, iso } = nowParts();
    breaks[breaks.length - 1].end = time;

    const admin = getServiceClient();
    const { data, error } = await admin
      .from('time_entries').update({ breaks, status: 'active', updated_at: iso })
      .eq('id', entry_id).eq('org_id', auth.orgId).select('*').single();
    if (error) return sendSafeError(res, error, 'Failed to end break.', '[timesheets]');
    return res.json({ ok: true, entry: data });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to end break.', '[timesheets]');
  }
});

export default router;
