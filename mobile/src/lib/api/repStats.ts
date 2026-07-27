// Real DB-derived rep stats — 1:1 port of the web `src/lib/repStatsApi.ts`
// (jobs / quotes / time_entries under RLS) plus the extra reads the web
// RepProfile page does client-side (team_members details, pipeline_deals).

import { supabase } from '../supabase';

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

export const EMPTY_REAL_STATS: RepRealStats = {
  totalRevenue: 0,
  jobsAsSalesperson: 0,
  jobsCompleted: 0,
  jobsPending: 0,
  contractsSigned: 0,
  hoursWorked: 0,
  daysWorked: 0,
};

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
        if (Number.isFinite(bs) && Number.isFinite(be) && be > bs) breakMs += be - bs;
      }
    }
  }
  return Math.max(0, (end - start - breakMs) / 3_600_000);
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
  const jobsPending = jobs.filter(
    (j: any) => j.status === 'scheduled' || j.status === 'in_progress' || j.status === 'pending',
  ).length;
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

// ── Team-member details (the web profile's Details / Contact cards) ─────────

export interface TeamMemberDetails {
  id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  address: { city?: string; province?: string } | null;
  created_at: string | null;
}

export async function getTeamMemberDetails(userId: string, orgId: string): Promise<TeamMemberDetails | null> {
  const { data, error } = await supabase
    .from('team_members')
    .select('id, first_name, last_name, role, phone, email, avatar_url, address, created_at')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) return null;
  return (data as TeamMemberDetails | null) ?? null;
}

// ── Closes (pipeline_deals auto-linked via rep_id, like the web) ────────────

export interface RepDeal {
  id: string;
  title: string;
  value: number;
  stage: string;
  won_at: string | null;
  created_at: string;
}

export async function listRepDeals(userId: string, orgId: string): Promise<RepDeal[]> {
  const { data, error } = await supabase
    .from('pipeline_deals')
    .select('id, title, value, stage, won_at, created_at')
    .eq('org_id', orgId)
    .eq('rep_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as RepDeal[];
}

// ---------------------------------------------------------------------------
// Period stats — the Rep Hub KPI grid, filtered by a date or a date range
// (1:1 port of the web src/lib/repStatsApi.ts period section)
// ---------------------------------------------------------------------------

export interface RepPeriodStats {
  /** Sum of jobs.total_amount (salesperson = rep, created in period) */
  revenue: number;
  /** Count of jobs assigned to rep as salesperson, created in period */
  jobs: number;
  /** Serviced revenue — revenu des jobs du rep marquées completed (job fermée) */
  servicedRevenue: number;
  /** Nombre de jobs du rep marquées completed */
  servicedJobs: number;
  /** Valeur moyenne par contrat — revenue ÷ jobs, null si aucune job */
  avgContractValue: number | null;
  /** Quotes approved/converted ÷ quotes created by rep, in % — null if no quotes */
  contractClosingRate: number | null;
  /** Cancelled jobs ÷ total jobs, in % — null if no jobs */
  cancelRate: number | null;
  /** Distinct days with a completed time entry in period */
  daysWorked: number;
}

/** Local-day boundaries (YYYY-MM-DD, inclusive) → UTC ISO for timestamptz comparisons */
function periodBounds(from: string, to: string): { fromISO: string; toISO: string } {
  return {
    fromISO: new Date(`${from}T00:00:00`).toISOString(),
    toISO: new Date(`${to}T23:59:59.999`).toISOString(),
  };
}

/**
 * Jobs créditées au rep — même logique que le leaderboard : salesperson
 * explicite, sinon créateur (jobs d'avant le fix salesperson_id), plus les
 * jobs qui lui sont assignées via assigned_user_id.
 */
function repJobCreditFilter(userId: string): string {
  return `salesperson_id.eq.${userId},assigned_user_id.eq.${userId},and(salesperson_id.is.null,created_by.eq.${userId})`;
}

/** from/to are local calendar dates (YYYY-MM-DD), both inclusive. */
export async function getRepPeriodStats(
  userId: string,
  orgId: string,
  from: string,
  to: string
): Promise<RepPeriodStats> {
  const { fromISO, toISO } = periodBounds(from, to);

  const [jobsRes, quotesRes, timeRes] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, status, total_amount')
      .eq('org_id', orgId)
      .or(repJobCreditFilter(userId))
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
      .from('time_entries')
      .select('date')
      .eq('org_id', orgId)
      .eq('employee_id', userId)
      .gte('date', from)
      .lte('date', to),
  ]);

  const jobs = jobsRes.data || [];
  const quotes = quotesRes.data || [];
  const times = timeRes.data || [];

  const completedJobs = jobs.filter((j: any) => j.status === 'completed');
  const cancelled = jobs.filter((j: any) => j.status === 'cancelled').length;
  const quotesWon = quotes.filter((q: any) => q.status === 'approved' || q.status === 'converted').length;
  const revenue = jobs.reduce((sum, j: any) => sum + Number(j.total_amount || 0), 0);

  return {
    revenue,
    jobs: jobs.length,
    servicedRevenue: completedJobs.reduce((sum, j: any) => sum + Number(j.total_amount || 0), 0),
    servicedJobs: completedJobs.length,
    avgContractValue: jobs.length > 0 ? Math.round(revenue / jobs.length) : null,
    contractClosingRate: quotes.length > 0 ? Math.round((quotesWon / quotes.length) * 100) : null,
    cancelRate: jobs.length > 0 ? Math.round((cancelled / jobs.length) * 100) : null,
    daysWorked: new Set(times.map((t: any) => t.date)).size,
  };
}

// ---------------------------------------------------------------------------
// Pin counts — all pins the rep placed on the sales map, grouped by the seven
// map pin types (same DB status → pin type mapping as D2DMap's STATUS_MAP)
// ---------------------------------------------------------------------------

export type RepPinKind = 'closed_won' | 'lead' | 'follow_up' | 'appointment' | 'no_answer' | 'rejected' | 'other';

const DB_PIN_TO_KIND: Record<string, RepPinKind> = {
  sale: 'closed_won', sold: 'closed_won', closed_won: 'closed_won',
  lead: 'lead',
  follow_up: 'follow_up', callback: 'follow_up',
  no_answer: 'no_answer',
  not_interested: 'rejected', do_not_knock: 'rejected', rejected: 'rejected',
  quote_sent: 'appointment', appointment: 'appointment',
  unknown: 'other', new: 'other', knocked: 'other', note: 'other', revisit: 'other', other: 'other',
};

export interface RepPinCounts {
  total: number;
  byKind: Record<RepPinKind, number>;
}

/** Pins posés par le rep durant la période sélectionnée (from/to inclusifs). */
export async function getRepPinCounts(
  userId: string,
  orgId: string,
  from: string,
  to: string
): Promise<RepPinCounts> {
  const { fromISO, toISO } = periodBounds(from, to);
  const { data } = await supabase
    .from('field_pins')
    .select('id, status')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('created_at', fromISO)
    .lte('created_at', toISO);

  const byKind: Record<RepPinKind, number> = {
    closed_won: 0, lead: 0, follow_up: 0, appointment: 0, no_answer: 0, rejected: 0, other: 0,
  };
  for (const p of data || []) byKind[DB_PIN_TO_KIND[p.status as string] || 'other']++;

  return { total: (data || []).length, byKind };
}
