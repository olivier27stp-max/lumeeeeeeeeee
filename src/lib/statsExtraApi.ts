/**
 * Extra Statistiques aggregates that had no RPC yet — computed client-side,
 * defensively (any failure returns an empty/zero shape so a card shows an empty
 * state, never a crash). Covers: payment-method mix, average-job-value series,
 * monthly-recurring-revenue (from recurring schedules), and loyalty metrics.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import { listPayments, paymentMethodLabel } from './paymentsApi';
import { listRecurringSchedules, type RecurringFrequency } from './recurringInvoicesApi';
import { fetchClientLifetimeValue, fetchCohortRetention } from './insightsApi';

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface Series { labels: string[]; vals: number[] }

/** Ordered YYYY-MM keys spanning [from, to]. */
function monthKeys(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length < 60) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
function monthLabel(key: string, fr: boolean): string {
  const m = Number(key.slice(5, 7)) - 1;
  return (fr ? MONTHS_FR : MONTHS_EN)[m] || key;
}

const FREQ_TO_MONTHLY: Record<RecurringFrequency, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

/** Revenue by payment method over the period (top 4). */
export async function fetchPaymentMix(params: { from: string; to: string }): Promise<Array<{ name: string; value: number }>> {
  try {
    const res = await listPayments({ status: 'all', method: 'all', date: 'custom', q: '', page: 1, pageSize: 1000, fromDate: params.from, toDate: params.to });
    const map = new Map<string, number>();
    for (const r of res.rows) {
      const label = paymentMethodLabel(r.payment_method) || (r.payment_method || 'Autre');
      map.set(label, (map.get(label) || 0) + (r.amount_cents || 0));
    }
    const sorted = Array.from(map.entries()).map(([name, value]) => ({ name, value })).filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
    if (sorted.length <= 4) return sorted;
    const top = sorted.slice(0, 3);
    const other = sorted.slice(3).reduce((s, x) => s + x.value, 0);
    if (other > 0) top.push({ name: 'Autre', value: other });
    return top;
  } catch {
    return [];
  }
}

/** Average completed-job value per month over the period (cents). */
export async function fetchAvgJobValueSeries(params: { from: string; to: string; fr: boolean }): Promise<Series> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data, error } = await supabase
      .from('jobs')
      .select('created_at, total_cents, status')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .in('status', ['completed', 'invoiced'])
      .gte('created_at', params.from)
      .lte('created_at', `${params.to}T23:59:59.999Z`)
      .limit(5000);
    if (error) throw error;
    const buckets = new Map<string, { sum: number; n: number }>();
    for (const j of (data || []) as Array<{ created_at: string; total_cents: number }>) {
      const key = String(j.created_at).slice(0, 7);
      const b = buckets.get(key) || { sum: 0, n: 0 };
      b.sum += j.total_cents || 0; b.n += 1;
      buckets.set(key, b);
    }
    const keys = monthKeys(params.from, params.to);
    return {
      labels: keys.map((k) => monthLabel(k, params.fr)),
      vals: keys.map((k) => { const b = buckets.get(k); return b && b.n ? Math.round(b.sum / b.n) : 0; }),
    };
  } catch {
    return { labels: [], vals: [] };
  }
}

/** Monthly recurring revenue series (cents) + current MRR, from recurring schedules. */
export async function fetchMrrSeries(params: { from: string; to: string; fr: boolean }): Promise<Series & { currentCents: number }> {
  try {
    const schedules = await listRecurringSchedules();
    const monthlyOf = (s: (typeof schedules)[number]) => {
      const amount = (s.items || []).reduce((x, it) => x + (it.qty || 0) * (it.unit_price_cents || 0), 0);
      return amount * (FREQ_TO_MONTHLY[s.frequency] || 1);
    };
    const keys = monthKeys(params.from, params.to);
    const vals = keys.map((k) => {
      const first = `${k}-01`;
      const last = `${k}-31`;
      return Math.round(schedules.reduce((sum, s) => {
        const start = (s.start_date || '').slice(0, 10);
        const end = (s.end_date || '').slice(0, 10);
        const activeThen = (!start || start <= last) && (!end || end >= first) && s.is_active !== false;
        return activeThen ? sum + monthlyOf(s) : sum;
      }, 0));
    });
    const currentCents = Math.round(schedules.filter((s) => s.is_active).reduce((sum, s) => sum + monthlyOf(s), 0));
    return { labels: keys.map((k) => monthLabel(k, params.fr)), vals, currentCents };
  } catch {
    return { labels: [], vals: [], currentCents: 0 };
  }
}

/** Loyalty metrics: recurring-revenue share, average lifetime value, retention. */
export async function fetchLoyalty(params: { from: string; to: string }): Promise<{ recurringPct: number; ltvAvgCents: number; retentionPct: number }> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();
    const { data: jobs } = await supabase
      .from('jobs')
      .select('total_cents, job_type, status')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .in('status', ['completed', 'invoiced'])
      .gte('created_at', params.from)
      .lte('created_at', `${params.to}T23:59:59.999Z`)
      .limit(5000);
    let rec = 0, tot = 0;
    for (const j of (jobs || []) as Array<{ total_cents: number; job_type: string | null }>) {
      const v = j.total_cents || 0; tot += v;
      if (String(j.job_type) === 'recurring') rec += v;
    }
    const recurringPct = tot > 0 ? Math.round((rec / tot) * 100) : 0;

    const clv = await fetchClientLifetimeValue(50);
    const ltvAvgCents = clv.length ? Math.round(clv.reduce((s, c) => s + c.total_revenue_cents, 0) / clv.length) : 0;

    const cohorts = await fetchCohortRetention();
    const rets = cohorts.map((c) => { const r = c.retention_pct || 0; return r > 0 && r <= 1 ? r * 100 : r; });
    const retentionPct = rets.length ? Math.round(rets.reduce((s, r) => s + r, 0) / rets.length) : 0;

    return { recurringPct, ltvAvgCents, retentionPct };
  } catch {
    return { recurringPct: 0, ltvAvgCents: 0, retentionPct: 0 };
  }
}
