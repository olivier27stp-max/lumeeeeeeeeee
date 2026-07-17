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

// ── Shared period computation for summary + export ──────────
// Builds one row per active team member with a linked user: punched hours,
// hourly rate (from Membres), gross, commissions and adjustments in the window.
async function buildPeriodRows(sc: any, orgId: string, ref?: string) {
  const settings = await loadSettings(sc, orgId);
  const period = computePayPeriod(settings, ref);
  const { fromIso, toIso } = periodToIsoRange(period);

  const { data: members, error: mErr } = await sc
    .from('team_members')
    .select('user_id, first_name, last_name, role, status, hourly_rate_cents, labour_cost_hourly')
    .eq('org_id', orgId)
    .not('user_id', 'is', null);
  if (mErr) throw new Error(mErr.message);
  const active = (members || []).filter((m: any) => m.status !== 'inactive');
  const userIds = active.map((m: any) => m.user_id);

  const { data: entries } = userIds.length
    ? await sc
        .from('time_entries')
        .select('employee_id, punch_in_at, punch_out_at, breaks, status')
        .eq('org_id', orgId)
        .eq('status', 'completed')
        .in('employee_id', userIds)
        .gte('punch_in_at', fromIso)
        .lte('punch_in_at', toIso)
    : { data: [] as any[] };

  const { data: commissions } = userIds.length
    ? await sc
        .from('fs_commission_entries')
        .select('user_id, amount, status')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .in('user_id', userIds)
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
    : { data: [] as any[] };

  // Adjustments/payments tables ship behind a migration — degrade gracefully.
  let adjustments: any[] = [];
  let payments: any[] = [];
  let migrationMissing = false;
  {
    const adjRes = await sc
      .from('payroll_adjustments')
      .select('id, user_id, amount_cents, note, created_at')
      .eq('org_id', orgId)
      .eq('period_start', period.start)
      .eq('period_end', period.end)
      .is('deleted_at', null);
    if (adjRes.error) migrationMissing = true;
    else adjustments = adjRes.data || [];

    const payRes = await sc
      .from('payroll_payments')
      .select('user_id, total_cents, paid_at, note')
      .eq('org_id', orgId)
      .eq('period_start', period.start)
      .eq('period_end', period.end);
    if (payRes.error) migrationMissing = true;
    else payments = payRes.data || [];
  }

  const rows = active.map((m: any) => {
    const myEntries = (entries || []).filter((e: any) => e.employee_id === m.user_id);
    const hours = sumEntryHours(myEntries);
    const rateCents = Number(m.hourly_rate_cents)
      || Math.round(Number(m.labour_cost_hourly || 0) * 100)
      || 0;
    const grossCents = Math.round(hours * rateCents);
    const myComms = (commissions || []).filter((c: any) => c.user_id === m.user_id && c.status !== 'reversed');
    const commissionCents = Math.round(myComms.reduce((s: number, c: any) => s + Number(c.amount || 0), 0) * 100);
    const myAdjustments = adjustments.filter((a) => a.user_id === m.user_id);
    const adjustmentsCents = myAdjustments.reduce((s, a) => s + Number(a.amount_cents || 0), 0);
    const payment = payments.find((p) => p.user_id === m.user_id) || null;
    return {
      user_id: m.user_id,
      name: `${m.first_name || ''} ${m.last_name || ''}`.trim() || '—',
      role: m.role || null,
      hours: Math.round(hours * 100) / 100,
      rate_cents: rateCents,
      gross_cents: grossCents,
      commission_cents: commissionCents,
      punch_count: myEntries.length,
      adjustments: myAdjustments,
      adjustments_cents: adjustmentsCents,
      total_cents: grossCents + commissionCents + adjustmentsCents,
      payment,
    };
  });

  return { settings, period, rows, migrationMissing };
}

// GET /api/payroll/period-summary?ref=YYYY-MM-DD — owner/admin only.
router.get('/payroll/period-summary', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    if (!isAdmin) return res.status(403).json({ error: 'Admin role required.' });

    const ref = (req.query.ref as string | undefined) || undefined;
    const { settings, period, rows, migrationMissing } = await buildPeriodRows(sc, auth.orgId, ref);
    res.json({
      period,
      settings: {
        pay_period_type: settings.pay_period_type,
        anchor_date: settings.anchor_date,
        pay_day_offset: settings.pay_day_offset,
        timezone: settings.timezone,
      },
      rows,
      migration_missing: migrationMissing,
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to load payroll summary.', '[payroll]');
  }
});

// POST /api/payroll/adjustments — owner/admin. Positive = bonus, negative = deduction.
router.post('/payroll/adjustments', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    if (!isAdmin) return res.status(403).json({ error: 'Admin role required.' });

    const { user_id, period_start, period_end, amount_cents, note } = req.body || {};
    const amount = Math.trunc(Number(amount_cents));
    if (!user_id || !period_start || !period_end) return res.status(400).json({ error: 'user_id, period_start and period_end are required.' });
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000_00) {
      return res.status(400).json({ error: 'amount_cents must be a non-zero amount under $100,000.' });
    }

    const { data, error } = await sc
      .from('payroll_adjustments')
      .insert({
        org_id: auth.orgId,
        user_id,
        period_start,
        period_end,
        amount_cents: amount,
        note: String(note || '').trim() || null,
        created_by: auth.user.id,
      })
      .select('id, user_id, amount_cents, note, created_at')
      .single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to add adjustment.', '[payroll]');
  }
});

// DELETE /api/payroll/adjustments/:id — owner/admin, soft delete.
router.delete('/payroll/adjustments/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    if (!isAdmin) return res.status(403).json({ error: 'Admin role required.' });

    const { error } = await sc
      .from('payroll_adjustments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to remove adjustment.', '[payroll]');
  }
});

// POST /api/payroll/mark-paid — snapshot the member's period totals.
router.post('/payroll/mark-paid', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    if (!isAdmin) return res.status(403).json({ error: 'Admin role required.' });

    const { user_id, ref, note } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id is required.' });

    // Recompute server-side so the snapshot can't be forged by the client.
    const { period, rows } = await buildPeriodRows(sc, auth.orgId, ref);
    const row = rows.find((r) => r.user_id === user_id);
    if (!row) return res.status(404).json({ error: 'Member not found in this period.' });

    const { data, error } = await sc
      .from('payroll_payments')
      .upsert({
        org_id: auth.orgId,
        user_id,
        period_start: period.start,
        period_end: period.end,
        hours: row.hours,
        gross_cents: row.gross_cents,
        commission_cents: row.commission_cents,
        adjustments_cents: row.adjustments_cents,
        total_cents: row.total_cents,
        note: String(note || '').trim() || null,
        paid_at: new Date().toISOString(),
        paid_by: auth.user.id,
      }, { onConflict: 'org_id,user_id,period_start,period_end' })
      .select('user_id, total_cents, paid_at, note')
      .single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to mark as paid.', '[payroll]');
  }
});

// POST /api/payroll/unmark-paid — remove the payment record for the period.
router.post('/payroll/unmark-paid', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    if (!isAdmin) return res.status(403).json({ error: 'Admin role required.' });

    const { user_id, ref } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id is required.' });
    const settings = await loadSettings(sc, auth.orgId);
    const period = computePayPeriod(settings, ref);

    const { error } = await sc
      .from('payroll_payments')
      .delete()
      .eq('org_id', auth.orgId)
      .eq('user_id', user_id)
      .eq('period_start', period.start)
      .eq('period_end', period.end);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to unmark payment.', '[payroll]');
  }
});

// GET /api/payroll/export?ref=YYYY-MM-DD — QuickBooks-friendly CSV of the period.
router.get('/payroll/export', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    if (!isAdmin) return res.status(403).json({ error: 'Admin role required.' });

    const ref = (req.query.ref as string | undefined) || undefined;
    const { period, rows } = await buildPeriodRows(sc, auth.orgId, ref);

    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const money = (cents: number) => (cents / 100).toFixed(2);
    const header = [
      'Employee', 'Role', 'Period Start', 'Period End', 'Pay Date',
      'Hours', 'Hourly Rate', 'Gross Wages', 'Commissions', 'Adjustments', 'Total', 'Paid',
    ].join(',');
    const lines = rows.map((r) => [
      esc(r.name), esc(r.role || ''), period.start, period.end, period.payDate,
      r.hours.toFixed(2), money(r.rate_cents), money(r.gross_cents),
      money(r.commission_cents), money(r.adjustments_cents), money(r.total_cents),
      r.payment ? 'Yes' : 'No',
    ].join(','));

    // BOM so Excel/QuickBooks read UTF-8 accents correctly.
    const csv = '﻿' + [header, ...lines].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="paie_${period.start}_${period.end}.csv"`);
    res.send(csv);
  } catch (err: any) {
    return sendSafeError(res, err, 'Failed to export payroll.', '[payroll]');
  }
});

export default router;
