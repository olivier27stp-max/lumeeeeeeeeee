/**
 * Reminder settings CRUD + recent log.
 *
 *   GET   /api/reminders/settings        — auth required; creates default row if missing
 *   PATCH /api/reminders/settings        — admin/owner only
 *   GET   /api/reminders/log?limit=50    — auth required; recent reminders for the caller's org
 */

import { Router } from 'express';
import { sendSafeError } from '../lib/error-handler';
import { requireAuthedClient, isOrgAdminOrOwner, getServiceClient } from '../lib/supabase';

const router = Router();

interface ScheduleEntry {
  days_after_due: number;
  channel: 'email' | 'sms' | 'both';
  template_id?: string | null;
}

const DEFAULT_SCHEDULE: ScheduleEntry[] = [
  { days_after_due: 1, channel: 'email' },
  { days_after_due: 7, channel: 'email' },
  { days_after_due: 14, channel: 'both' },
  { days_after_due: 30, channel: 'both' },
];

function sanitizeSchedule(input: unknown): ScheduleEntry[] | null {
  if (!Array.isArray(input)) return null;
  const out: ScheduleEntry[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return null;
    const days = Number((raw as any).days_after_due);
    const channel = String((raw as any).channel || '').toLowerCase();
    if (!Number.isFinite(days) || days < 0 || days > 365) return null;
    if (!['email', 'sms', 'both'].includes(channel)) return null;
    const entry: ScheduleEntry = { days_after_due: Math.floor(days), channel: channel as any };
    const tpl = (raw as any).template_id;
    if (typeof tpl === 'string' && tpl.length <= 64) entry.template_id = tpl;
    out.push(entry);
  }
  // Cap to a reasonable size to avoid runaway jsonb
  if (out.length > 20) return null;
  return out;
}

async function ensureSettingsRow(orgId: string) {
  const svc = getServiceClient();
  const { data, error } = await svc
    .from('reminder_settings')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: inserted, error: insErr } = await svc
    .from('reminder_settings')
    .insert({ org_id: orgId, enabled: true, schedule: DEFAULT_SCHEDULE })
    .select('*')
    .single();
  if (insErr) throw insErr;
  return inserted;
}

router.get('/reminders/settings', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const row = await ensureSettingsRow(auth.orgId);
    return res.json({ settings: row });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load reminder settings.', '[reminders/settings]');
  }
});

router.patch('/reminders/settings', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
    if (!admin) return res.status(403).json({ error: 'Admin or owner role required.' });

    const body = req.body || {};
    const patch: Record<string, unknown> = {};

    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;

    if (body.schedule !== undefined) {
      const sched = sanitizeSchedule(body.schedule);
      if (!sched) return res.status(400).json({ error: 'Invalid schedule format.' });
      patch.schedule = sched;
    }

    if (body.custom_email_subject !== undefined) {
      const s = body.custom_email_subject;
      if (s !== null && (typeof s !== 'string' || s.length > 500)) {
        return res.status(400).json({ error: 'Invalid custom_email_subject.' });
      }
      patch.custom_email_subject = s;
    }
    if (body.custom_email_body !== undefined) {
      const s = body.custom_email_body;
      if (s !== null && (typeof s !== 'string' || s.length > 5000)) {
        return res.status(400).json({ error: 'Invalid custom_email_body.' });
      }
      patch.custom_email_body = s;
    }
    if (body.custom_sms_body !== undefined) {
      const s = body.custom_sms_body;
      if (s !== null && (typeof s !== 'string' || s.length > 320)) {
        return res.status(400).json({ error: 'Invalid custom_sms_body.' });
      }
      patch.custom_sms_body = s;
    }

    patch.updated_at = new Date().toISOString();

    // Ensure row exists
    await ensureSettingsRow(auth.orgId);

    const svc = getServiceClient();
    const { data, error } = await svc
      .from('reminder_settings')
      .update(patch)
      .eq('org_id', auth.orgId)
      .select('*')
      .single();
    if (error) return sendSafeError(res, error, 'Failed to save reminder settings.', '[reminders/settings]');
    return res.json({ settings: data });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to save reminder settings.', '[reminders/settings]');
  }
});

router.get('/reminders/log', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const { data, error } = await auth.client
      .from('reminder_log')
      .select('id, invoice_id, days_after_due, channel, sent_to, sent_at, status, error_message')
      .order('sent_at', { ascending: false })
      .limit(limit);
    if (error) return sendSafeError(res, error, 'Failed to load reminder log.', '[reminders/log]');
    return res.json({ entries: data || [] });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load reminder log.', '[reminders/log]');
  }
});

export default router;
