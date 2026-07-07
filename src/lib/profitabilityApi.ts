/**
 * Job profitability — real P&L per job.
 * Labour is derived from time_entries (hours worked on the job × the
 * employee's hourly_rate_cents on team_members); expenses come from
 * jobs.expenses_cents. Profit = revenue − labour − expenses.
 *
 * Requires migration 20260715000000_job_profitability. Until it is applied
 * the cost columns don't exist and this returns empty totals gracefully.
 */
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export interface JobPnLRow {
  job_id: string;
  job_number: string;
  client_name: string;
  revenue_cents: number;
  labour_cents: number;
  expenses_cents: number;
  profit_cents: number;
  margin_pct: number;
}

export interface JobPnL {
  rows: JobPnLRow[];
  total_revenue_cents: number;
  total_labour_cents: number;
  total_expenses_cents: number;
  total_profit_cents: number;
  margin_pct: number;
}

const EMPTY: JobPnL = {
  rows: [],
  total_revenue_cents: 0,
  total_labour_cents: 0,
  total_expenses_cents: 0,
  total_profit_cents: 0,
  margin_pct: 0,
};

function timeToSeconds(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(t).trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] || 0);
}

/** Worked seconds for one time entry: (punch_out − punch_in) minus breaks. */
function entrySeconds(punch_in: string, punch_out: string | null, breaks: unknown): number {
  const inS = timeToSeconds(punch_in);
  const outS = timeToSeconds(punch_out);
  if (inS == null || outS == null) return 0;
  let dur = outS - inS;
  if (dur < 0) dur += 24 * 3600; // spanned midnight
  if (Array.isArray(breaks)) {
    for (const b of breaks as Array<{ start?: string; end?: string }>) {
      const bs = timeToSeconds(b?.start);
      const be = timeToSeconds(b?.end);
      if (bs != null && be != null && be > bs) dur -= be - bs;
    }
  }
  return Math.max(0, dur);
}

export async function fetchJobPnL(params: { from: string; to: string }): Promise<JobPnL> {
  try {
    const orgId = await getCurrentOrgIdOrThrow();

    const { data: jobs, error } = await supabase
      .from('jobs')
      .select('id, job_number, client_id, total_cents, expenses_cents, status')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .in('status', ['completed', 'invoiced'])
      .gte('created_at', params.from)
      .lte('created_at', `${params.to}T23:59:59.999Z`)
      .limit(5000);
    if (error) throw error;

    const jl = (jobs || []) as any[];
    if (jl.length === 0) return EMPTY;

    const jobIds = jl.map((j) => j.id);
    const clientIds = Array.from(new Set(jl.map((j) => j.client_id).filter(Boolean)));

    const [entriesRes, membersRes, clientsRes] = await Promise.all([
      supabase.from('time_entries').select('job_id, employee_id, punch_in, punch_out, breaks').eq('org_id', orgId).in('job_id', jobIds).limit(20000),
      supabase.from('team_members').select('user_id, hourly_rate_cents').eq('org_id', orgId),
      clientIds.length
        ? supabase.from('clients').select('id, first_name, last_name, company').in('id', clientIds)
        : Promise.resolve({ data: [] as any[] } as any),
    ]);

    const rateByUser = new Map<string, number>(
      ((membersRes.data || []) as any[]).map((m) => [m.user_id, Number(m.hourly_rate_cents) || 0]),
    );
    const nameById = new Map<string, string>(
      ((clientsRes.data || []) as any[]).map((c) => [
        c.id,
        (c.company || `${c.first_name || ''} ${c.last_name || ''}`.trim()) || '—',
      ]),
    );

    const labourByJob = new Map<string, number>();
    for (const e of (entriesRes.data || []) as any[]) {
      const secs = entrySeconds(e.punch_in, e.punch_out, e.breaks);
      const rate = rateByUser.get(e.employee_id) || 0;
      const cents = (secs / 3600) * rate;
      labourByJob.set(e.job_id, (labourByJob.get(e.job_id) || 0) + cents);
    }

    const rows: JobPnLRow[] = jl
      .map((j) => {
        const revenue = Number(j.total_cents) || 0;
        const labour = Math.round(labourByJob.get(j.id) || 0);
        const expenses = Number(j.expenses_cents) || 0;
        const profit = revenue - labour - expenses;
        return {
          job_id: j.id,
          job_number: j.job_number || String(j.id).slice(0, 8),
          client_name: nameById.get(j.client_id) || '—',
          revenue_cents: revenue,
          labour_cents: labour,
          expenses_cents: expenses,
          profit_cents: profit,
          margin_pct: revenue > 0 ? Math.round((profit / revenue) * 100) : 0,
        };
      })
      .sort((a, b) => b.revenue_cents - a.revenue_cents);

    const tRev = rows.reduce((s, r) => s + r.revenue_cents, 0);
    const tLab = rows.reduce((s, r) => s + r.labour_cents, 0);
    const tExp = rows.reduce((s, r) => s + r.expenses_cents, 0);
    const tPro = tRev - tLab - tExp;
    return {
      rows,
      total_revenue_cents: tRev,
      total_labour_cents: tLab,
      total_expenses_cents: tExp,
      total_profit_cents: tPro,
      margin_pct: tRev > 0 ? Math.round((tPro / tRev) * 100) : 0,
    };
  } catch {
    return EMPTY;
  }
}

/** Set the materials/subcontracting expense on a job (in cents). Org-scoped. */
export async function updateJobExpenses(jobId: string, expensesCents: number): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase
    .from('jobs')
    .update({ expenses_cents: Math.max(0, Math.round(expensesCents)) })
    .eq('id', jobId)
    .eq('org_id', orgId);
  if (error) throw error;
}
