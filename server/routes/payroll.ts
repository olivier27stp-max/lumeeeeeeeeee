import { Router } from 'express';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { getPayrollPreview } from '../lib/field-sales/commission-engine';
import {
  DEFAULT_PAYROLL_SETTINGS,
  computePayPeriod,
  periodToIsoRange,
  sumEntryHours,
  type PayPeriodType,
} from '../lib/payroll';

const router = Router();

const VALID_TYPES: PayPeriodType[] = ['weekly', 'biweekly', 'semimonthly', 'monthly'];

// Load the org's payroll settings, falling back to defaults if unset.
async function loadSettings(sc: any, orgId: string) {
  const { data } = await sc
    .from('payroll_settings')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (data) return data;
  return { org_id: orgId, ...DEFAULT_PAYROLL_SETTINGS };
}

// GET /api/payroll/settings — any org member can read the config.
router.get('/payroll/settings', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const settings = await loadSettings(sc, auth.orgId);
    res.json(settings);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load payroll settings.', '[payroll]');
  }
});

// PUT /api/payroll/settings — owner/admin only.
router.put('/payroll/settings', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    if (!isAdmin) return res.status(403).json({ error: 'Admin role required.' });

    const body = req.body || {};
    const payPeriodType = body.pay_period_type;
    if (payPeriodType && !VALID_TYPES.includes(payPeriodType)) {
      return res.status(400).json({ error: 'Invalid pay_period_type.' });
    }

    const offset = Number(body.pay_day_offset);
    const payload: Record<string, any> = {
      org_id: auth.orgId,
      pay_period_type: payPeriodType || DEFAULT_PAYROLL_SETTINGS.pay_period_type,
      anchor_date: body.anchor_date || DEFAULT_PAYROLL_SETTINGS.anchor_date,
      pay_day_offset: Number.isFinite(offset) ? Math.max(0, Math.min(31, offset)) : DEFAULT_PAYROLL_SETTINGS.pay_day_offset,
      timezone: body.timezone || DEFAULT_PAYROLL_SETTINGS.timezone,
      created_by: auth.user.id,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await sc
      .from('payroll_settings')
      .upsert(payload, { onConflict: 'org_id' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to save payroll settings.', '[payroll]');
  }
});

// GET /api/payroll/current-period?userId=...&ref=YYYY-MM-DD
// Returns the active pay period plus the hours + commission heading to the
// effective user's account. Reps are always scoped to themselves; admins may
// pass userId to inspect a specific rep.
router.get('/payroll/current-period', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    const requestedUserId = req.query.userId as string | undefined;
    const effectiveUserId = isAdmin && requestedUserId ? requestedUserId : auth.user.id;
    const ref = (req.query.ref as string | undefined) || undefined;

    const settings = await loadSettings(sc, auth.orgId);
    const period = computePayPeriod(settings, ref);
    const { fromIso, toIso } = periodToIsoRange(period);

    // Hours from completed timesheet entries in the window.
    const { data: entries, error: tErr } = await sc
      .from('time_entries')
      .select('punch_in_at, punch_out_at, breaks, status')
      .eq('org_id', auth.orgId)
      .eq('employee_id', effectiveUserId)
      .eq('status', 'completed')
      .gte('punch_in_at', fromIso)
      .lte('punch_in_at', toIso);
    if (tErr) throw new Error(tErr.message);
    const hours = sumEntryHours(entries || []);

    // Commission heading to this rep for the same window.
    const commission = await getPayrollPreview(sc, auth.orgId, effectiveUserId, period.start, period.end);

    res.json({
      period,
      settings: {
        pay_period_type: settings.pay_period_type,
        anchor_date: settings.anchor_date,
        pay_day_offset: settings.pay_day_offset,
        timezone: settings.timezone,
      },
      userId: effectiveUserId,
      hours,
      commission,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load current pay period.', '[payroll]');
  }
});

export default router;
