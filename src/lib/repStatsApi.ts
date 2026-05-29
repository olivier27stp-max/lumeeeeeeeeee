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
