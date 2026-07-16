import { supabase } from './supabase';

export interface RepRealStats {
  /** Sum of jobs.total_amount where salesperson = rep and not soft-deleted */
  totalRevenue: number;
  /** Count of jobs assigned to rep as salesperson */
  jobsAsSalesperson: number;
  /** Count of jobs completed (status='completed') for rep */
  jobsCompleted: number;
  /** Count of jobs scheduled/pending for rep */
  jobsPending: number;
  /** Count of quotes signed/accepted created by rep */
  contractsSigned: number;
  /** Total hours worked across all time_entries */
  hoursWorked: number;
  /** Count of distinct days worked (any time_entry) */
  daysWorked: number;
}

function diffHours(punchIn: string | null, punchOut: string | null, breaks: any): number {
  if (!punchIn || !punchOut) return 0;
  const start = new Date(punchIn).getTime();
  const end = new Date(punchOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  let breakMs = 0;
  if (Array.isArray(breaks)) {
    for (const b of breaks) {
      if (b?.start && b?.end) {
        const bs = new Date(b.start).getTime();
        const be = new Date(b.end).getTime();
        if (Number.isFinite(bs) && Number.isFinite(be) && be > bs) breakMs += (be - bs);
      }
    }
  }
  return Math.max(0, (end - start - breakMs) / 3_600_000);
}

// ---------------------------------------------------------------------------
// Period stats — the Rep Hub KPI grid, filtered by a date or a date range
// ---------------------------------------------------------------------------

export interface RepPeriodStats {
  /** Sum of jobs.total_amount (salesperson = rep, created in period) */
  revenue: number;
  /** Count of jobs assigned to rep as salesperson, created in period */
  jobs: number;
  /** Revenue from service-plan jobs only (job_type = 'recurring') */
  serviceRevenue: number;
  /** Count of service-plan jobs (job_type = 'recurring') */
  serviceJobs: number;
  /** APP — appointment pins ('quote_sent') placed by rep on the sales map */
  app: number;
  /** VG — sale pins ('sale') placed by rep on the sales map */
  vg: number;
  /** Quotes approved/converted ÷ quotes created by rep, in % — null if no quotes */
  contractClosingRate: number | null;
  /** Cancelled jobs ÷ total jobs, in % — null if no jobs */
  cancelRate: number | null;
  /** Distinct days with a completed time entry in period */
  daysWorked: number;
}

/** from/to are local calendar dates (YYYY-MM-DD), both inclusive. */
export async function getRepPeriodStats(
  userId: string,
  orgId: string,
  from: string,
  to: string
): Promise<RepPeriodStats> {
  // Local-day boundaries → UTC for timestamptz comparisons
  const fromISO = new Date(`${from}T00:00:00`).toISOString();
  const toISO = new Date(`${to}T23:59:59.999`).toISOString();

  const [jobsRes, quotesRes, pinsRes, timeRes] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, status, total_amount, job_type')
      .eq('org_id', orgId)
      .eq('salesperson_id', userId)
      .is('deleted_at', null)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),
    supabase
      .from('quotes')
      .select('id, status')
      .eq('org_id', orgId)
      .eq('created_by', userId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),
    supabase
      .from('field_pins')
      .select('id, status')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .gte('created_at', fromISO)
      .lte('created_at', toISO),
    supabase
      .from('time_entries')
      .select('date')
      .eq('org_id', orgId)
      .eq('employee_id', userId)
      .gte('date', from)
      .lte('date', to),
  ]);

  const jobs = jobsRes.data || [];
  const quotes = quotesRes.data || [];
  const pins = pinsRes.data || [];
  const times = timeRes.data || [];

  const serviceJobsList = jobs.filter((j: any) => j.job_type === 'recurring');
  const cancelled = jobs.filter((j: any) => j.status === 'cancelled').length;
  const quotesWon = quotes.filter((q: any) => q.status === 'approved' || q.status === 'converted').length;

  return {
    revenue: jobs.reduce((sum, j: any) => sum + Number(j.total_amount || 0), 0),
    jobs: jobs.length,
    serviceRevenue: serviceJobsList.reduce((sum, j: any) => sum + Number(j.total_amount || 0), 0),
    serviceJobs: serviceJobsList.length,
    app: pins.filter((p: any) => p.status === 'quote_sent').length,
    vg: pins.filter((p: any) => p.status === 'sale').length,
    contractClosingRate: quotes.length > 0 ? Math.round((quotesWon / quotes.length) * 100) : null,
    cancelRate: jobs.length > 0 ? Math.round((cancelled / jobs.length) * 100) : null,
    daysWorked: new Set(times.map((t: any) => t.date)).size,
  };
}

// ---------------------------------------------------------------------------
// Pin counts — all pins the rep placed on the sales map, grouped by the six
// map pin types (same DB status → pin type mapping as D2DMap)
// ---------------------------------------------------------------------------

export type RepPinKind = 'closed_won' | 'follow_up' | 'appointment' | 'no_answer' | 'rejected' | 'other';

const DB_PIN_TO_KIND: Record<string, RepPinKind> = {
  sale: 'closed_won',
  lead: 'follow_up',
  callback: 'follow_up',
  quote_sent: 'appointment',
  no_answer: 'no_answer',
  not_interested: 'rejected',
  do_not_knock: 'rejected',
  unknown: 'other',
  revisit: 'other',
};

export interface RepPinCounts {
  total: number;
  byKind: Record<RepPinKind, number>;
}

export async function getRepPinCounts(userId: string, orgId: string): Promise<RepPinCounts> {
  const { data } = await supabase
    .from('field_pins')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('user_id', userId);

  const byKind: Record<RepPinKind, number> = {
    closed_won: 0, follow_up: 0, appointment: 0, no_answer: 0, rejected: 0, other: 0,
  };
  for (const p of data || []) byKind[DB_PIN_TO_KIND[p.status as string] || 'other']++;

  return { total: (data || []).length, byKind };
}

// ---------------------------------------------------------------------------
// Deals — jobs where the rep is the assigned salesperson (For Deals section)
// ---------------------------------------------------------------------------

export interface RepDealJob {
  id: string;
  job_number: string | null;
  title: string;
  status: string;
  total_amount: number;
  created_at: string;
}

export async function getRepDealJobs(userId: string, orgId: string, limit = 50): Promise<RepDealJob[]> {
  const { data } = await supabase
    .from('jobs')
    .select('id, job_number, title, status, total_amount, created_at')
    .eq('org_id', orgId)
    .eq('salesperson_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data || []) as RepDealJob[];
}

export async function getRepRealStats(userId: string, orgId: string): Promise<RepRealStats> {
  const [jobsRes, quotesRes, timeRes] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, status, total_amount, salesperson_id')
      .eq('org_id', orgId)
      .eq('salesperson_id', userId)
      .is('deleted_at', null),
    supabase
      .from('quotes')
      .select('id, status')
      .eq('org_id', orgId)
      .eq('created_by', userId)
      .in('status', ['accepted', 'signed', 'won']),
    supabase
      .from('time_entries')
      .select('punch_in_at, punch_out_at, breaks, date')
      .eq('org_id', orgId)
      .eq('employee_id', userId)
      .not('punch_out_at', 'is', null),
  ]);

  const jobs = jobsRes.data || [];
  const quotes = quotesRes.data || [];
  const times = timeRes.data || [];

  const totalRevenue = jobs.reduce((sum, j: any) => sum + Number(j.total_amount || 0), 0);
  const jobsCompleted = jobs.filter((j: any) => j.status === 'completed').length;
  const jobsPending = jobs.filter((j: any) => j.status === 'scheduled' || j.status === 'in_progress' || j.status === 'pending').length;
  const hoursWorked = times.reduce((sum, t: any) => sum + diffHours(t.punch_in_at, t.punch_out_at, t.breaks), 0);
  const daysWorked = new Set(times.map((t: any) => t.date)).size;

  return {
    totalRevenue,
    jobsAsSalesperson: jobs.length,
    jobsCompleted,
    jobsPending,
    contractsSigned: quotes.length,
    hoursWorked: Math.round(hoursWorked * 10) / 10,
    daysWorked,
  };
}
