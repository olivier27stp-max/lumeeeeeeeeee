/**
 * Revenue series for the Home (CRM Workspace) revenue overview card.
 *
 * Two measures, bucketed over a chosen period:
 *  - collected : paid invoices, by `paid_at`
 *  - scheduled : outstanding expected revenue (sent / partial invoices with a
 *                positive balance), by `due_date`. Invoices already overdue
 *                (or without a due date) are still money we expect to collect,
 *                so they are clamped into the current-time bucket instead of
 *                being dropped.
 *
 * Period drives both the date window and the bucket granularity:
 *  - today : 24 hourly buckets
 *  - week  : 7 daily buckets (today and the 6 days before)
 *  - month : one bucket per day of the current calendar month
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export type RevenuePeriod = 'today' | 'week' | 'month';

export interface RevenuePoint {
  /** Short label shown on the x-axis (e.g. "8h", "Mon", "12"). */
  label: string;
  /** Collected revenue in dollars. */
  collected: number;
  /** Scheduled (outstanding) revenue in dollars. */
  scheduled: number;
}

export interface RevenueSeries {
  points: RevenuePoint[];
  collectedTotal: number;
  scheduledTotal: number;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface Window {
  start: Date;
  end: Date;
  /** Returns the bucket index for a given date, or -1 if out of range. */
  bucketOf: (d: Date) => number;
  /** Pre-built, zeroed buckets with their labels. */
  buckets: RevenuePoint[];
}

function buildWindow(period: RevenuePeriod, now: Date): Window {
  if (period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const buckets: RevenuePoint[] = Array.from({ length: 24 }, (_, h) => ({
      label: `${h}h`,
      collected: 0,
      scheduled: 0,
    }));
    return {
      start,
      end,
      buckets,
      bucketOf: (d) =>
        ymd(d) === ymd(start) ? d.getHours() : -1,
    };
  }

  if (period === 'week') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const days: Date[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
    const dayKeys = days.map(ymd);
    const labels = days.map((d) =>
      d.toLocaleDateString(undefined, { weekday: 'short' }),
    );
    const buckets: RevenuePoint[] = labels.map((label) => ({ label, collected: 0, scheduled: 0 }));
    return {
      start,
      end,
      buckets,
      bucketOf: (d) => dayKeys.indexOf(ymd(d)),
    };
  }

  // month
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const daysInMonth = end.getDate();
  const buckets: RevenuePoint[] = Array.from({ length: daysInMonth }, (_, i) => ({
    label: String(i + 1),
    collected: 0,
    scheduled: 0,
  }));
  return {
    start,
    end,
    buckets,
    bucketOf: (d) =>
      d.getFullYear() === start.getFullYear() && d.getMonth() === start.getMonth()
        ? d.getDate() - 1
        : -1,
  };
}

export async function getRevenueSeries(period: RevenuePeriod): Promise<RevenueSeries> {
  const orgId = await getCurrentOrgIdOrThrow();
  const now = new Date();
  const w = buildWindow(period, now);
  const startIso = w.start.toISOString();
  const endIso = w.end.toISOString();
  const endYmd = ymd(w.end);
  const nowIdx = w.bucketOf(now);

  const [collectedRes, scheduledRes] = await Promise.all([
    // Collected — paid invoices by paid_at
    supabase
      .from('invoices')
      .select('total_cents, paid_at')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .eq('status', 'paid')
      .gte('paid_at', startIso)
      .lte('paid_at', endIso),
    // Scheduled — outstanding (sent / partial) invoices due by the end of the
    // window. Overdue and undated invoices are kept (clamped to "now" below).
    supabase
      .from('invoices')
      .select('balance_cents, due_date')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .in('status', ['sent', 'partial'])
      .gt('balance_cents', 0)
      .or(`due_date.is.null,due_date.lte.${endYmd}`),
  ]);

  if (collectedRes.error) throw collectedRes.error;
  if (scheduledRes.error) throw scheduledRes.error;

  let collectedTotal = 0;
  let scheduledTotal = 0;

  for (const row of collectedRes.data || []) {
    if (!row.paid_at) continue;
    const idx = w.bucketOf(new Date(row.paid_at as string));
    if (idx < 0) continue;
    const amount = Number(row.total_cents || 0) / 100;
    w.buckets[idx].collected += amount;
    collectedTotal += amount;
  }

  for (const row of scheduledRes.data || []) {
    // due_date is a YYYY-MM-DD date — parse at local midnight
    const due = row.due_date ? new Date(`${row.due_date as string}T00:00:00`) : null;
    let idx = due ? w.bucketOf(due) : -1;
    if (idx < 0) {
      if (due && due.getTime() > w.end.getTime()) continue;
      // Overdue before the window (or no due date): still expected revenue,
      // attach it to the current bucket.
      idx = nowIdx;
    }
    if (idx < 0) continue;
    const amount = Number(row.balance_cents || 0) / 100;
    w.buckets[idx].scheduled += amount;
    scheduledTotal += amount;
  }

  return { points: w.buckets, collectedTotal, scheduledTotal };
}
