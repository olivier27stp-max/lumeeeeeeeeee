/**
 * Revenue series for the Home (CRM Workspace) revenue overview card.
 *
 * Two measures, bucketed over a chosen period:
 *  - collected : paid invoices, by `paid_at`
 *  - scheduled : work booked on the calendar — visits (schedule_events) in
 *                the window, by `start_at`. Each visit is worth its share of
 *                its job's total (job total ÷ number of visits, the same rule
 *                as per-visit billing). Cancelled visits are ignored.
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
  const [collectedRes, visitsRes] = await Promise.all([
    // Collected — paid invoices by paid_at
    supabase
      .from('invoices')
      .select('total_cents, paid_at')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .eq('status', 'paid')
      .gte('paid_at', startIso)
      .lte('paid_at', endIso),
    // Scheduled — visits booked in the window
    supabase
      .from('schedule_events')
      .select('id, job_id, start_at, status')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .not('job_id', 'is', null)
      .gte('start_at', startIso)
      .lte('start_at', endIso),
  ]);

  if (collectedRes.error) throw collectedRes.error;
  if (visitsRes.error) throw visitsRes.error;

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

  const isCancelled = (s: unknown) =>
    ['cancelled', 'canceled'].includes(String(s || '').toLowerCase());
  const visits = (visitsRes.data || []).filter(
    (v) => v.job_id && v.start_at && !isCancelled(v.status),
  );

  if (visits.length > 0) {
    const jobIds = Array.from(new Set(visits.map((v) => v.job_id as string)));
    const [jobsRes, allVisitsRes] = await Promise.all([
      supabase
        .from('jobs_active')
        .select('id, total_cents, total_amount')
        .eq('org_id', orgId)
        .in('id', jobIds),
      // All visits of those jobs (not just the window) — needed to split the
      // job total across its visits, per-visit-billing style.
      supabase
        .from('schedule_events')
        .select('id, job_id, status')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .in('job_id', jobIds),
    ]);
    if (jobsRes.error) throw jobsRes.error;
    if (allVisitsRes.error) throw allVisitsRes.error;

    // total_cents est la source de vérité; total_amount = colonne héritée
    const jobTotal = new Map<string, number>();
    for (const j of jobsRes.data || []) {
      const dollars =
        typeof j.total_cents === 'number'
          ? j.total_cents / 100
          : Number(j.total_amount || 0);
      jobTotal.set(j.id as string, dollars);
    }

    const visitCount = new Map<string, number>();
    for (const v of allVisitsRes.data || []) {
      if (isCancelled(v.status)) continue;
      const jobId = v.job_id as string;
      visitCount.set(jobId, (visitCount.get(jobId) || 0) + 1);
    }

    for (const v of visits) {
      const jobId = v.job_id as string;
      const amount = (jobTotal.get(jobId) || 0) / Math.max(visitCount.get(jobId) || 1, 1);
      if (amount <= 0) continue;
      scheduledTotal += amount;
      const idx = w.bucketOf(new Date(v.start_at as string));
      if (idx >= 0) w.buckets[idx].scheduled += amount;
    }
  }

  return { points: w.buckets, collectedTotal, scheduledTotal };
}
