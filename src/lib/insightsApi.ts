import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export type InsightsTab = 'revenue' | 'lead_conversion' | 'jobs' | 'invoices';

export interface InsightsOverview {
  new_leads_count: number;
  converted_quotes_count: number;
  new_oneoff_jobs_count: number;
  invoiced_value_cents: number;
  revenue_cents: number;
  requests_count: number | null;
}

export interface InsightsRevenuePoint {
  bucket_start: string;
  revenue_cents: number;
  invoiced_cents: number;
}

export interface InsightsLeadSourceBreakdown {
  source: string;
  leads_created: number;
  leads_closed: number;
  revenue_cents: number;
}

export interface InsightsLeadConversion {
  leads_created: number;
  leads_closed: number;
  conversion_rate: number;
  breakdown: InsightsLeadSourceBreakdown[] | null;
}

export interface InsightsInvoicesSummary {
  count_draft: number;
  count_sent: number;
  count_paid: number;
  count_past_due: number;
  total_outstanding_cents: number;
  avg_payment_time_days: number | null;
}

export interface InsightsJobsSummary {
  totalJobs: number;
  scheduledJobs: number;
  unscheduledJobs: number;
  byTeam: Array<{
    teamId: string | null;
    teamName: string;
    count: number;
  }>;
}

function toIsoRange(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  const endExclusive = new Date(toDate);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return {
    fromIso: fromDate.toISOString(),
    toIsoExclusive: endExclusive.toISOString(),
  };
}

export async function fetchInsightsOverview(params: { from: string; to: string }): Promise<InsightsOverview> {
  const { data, error } = await supabase.rpc('rpc_insights_overview', {
    p_org: null,
    p_from: params.from,
    p_to: params.to,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    new_leads_count: Number(row?.new_leads_count || 0),
    converted_quotes_count: Number(row?.converted_quotes_count || 0),
    new_oneoff_jobs_count: Number(row?.new_oneoff_jobs_count || 0),
    invoiced_value_cents: Number(row?.invoiced_value_cents || 0),
    revenue_cents: Number(row?.revenue_cents || 0),
    requests_count: row?.requests_count == null ? null : Number(row.requests_count),
  };
}

export async function fetchInsightsRevenueSeries(params: {
  from: string;
  to: string;
  granularity?: 'day' | 'week' | 'month';
}): Promise<InsightsRevenuePoint[]> {
  const { data, error } = await supabase.rpc('rpc_insights_revenue_series', {
    p_org: null,
    p_from: params.from,
    p_to: params.to,
    p_granularity: params.granularity || 'month',
  });
  if (error) throw error;

  return (data || []).map((row: any) => ({
    bucket_start: String(row.bucket_start),
    revenue_cents: Number(row.revenue_cents || 0),
    invoiced_cents: Number(row.invoiced_cents || 0),
  }));
}

export async function fetchInsightsLeadConversion(params: { from: string; to: string }): Promise<InsightsLeadConversion> {
  const { data, error } = await supabase.rpc('rpc_insights_lead_conversion', {
    p_org: null,
    p_from: params.from,
    p_to: params.to,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const rawBreakdown = row?.breakdown;
  const parsedBreakdown = Array.isArray(rawBreakdown)
    ? rawBreakdown.map((entry: any) => ({
        source: String(entry?.source || 'Unknown'),
        leads_created: Number(entry?.leads_created || 0),
        leads_closed: Number(entry?.leads_closed || 0),
        revenue_cents: Number(entry?.revenue_cents || 0),
      }))
    : null;

  return {
    leads_created: Number(row?.leads_created || 0),
    leads_closed: Number(row?.leads_closed || 0),
    conversion_rate: Number(row?.conversion_rate || 0),
    breakdown: parsedBreakdown,
  };
}

export async function fetchInsightsInvoicesSummary(params: { from: string; to: string }): Promise<InsightsInvoicesSummary> {
  const { data, error } = await supabase.rpc('rpc_insights_invoices_summary', {
    p_org: null,
    p_from: params.from,
    p_to: params.to,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    count_draft: Number(row?.count_draft || 0),
    count_sent: Number(row?.count_sent || 0),
    count_paid: Number(row?.count_paid || 0),
    count_past_due: Number(row?.count_past_due || 0),
    total_outstanding_cents: Number(row?.total_outstanding_cents || 0),
    avg_payment_time_days: row?.avg_payment_time_days == null ? null : Number(row.avg_payment_time_days),
  };
}

export async function fetchInsightsJobsSummary(params: { from: string; to: string }): Promise<InsightsJobsSummary> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { fromIso, toIsoExclusive } = toIsoRange(params.from, params.to);

  const [{ data: jobsRows, error: jobsError }, { data: teamsRows, error: teamsError }] = await Promise.all([
    supabase
      .from('jobs')
      .select('id,team_id,scheduled_at,status')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lt('created_at', toIsoExclusive),
    supabase.from('teams').select('id,name').eq('org_id', orgId).is('deleted_at', null),
  ]);

  if (jobsError) throw jobsError;
  if (teamsError) throw teamsError;

  const jobs = jobsRows || [];
  const teams = teamsRows || [];
  const teamLabelMap = new Map<string, string>(teams.map((team: any) => [team.id, team.name || 'Unnamed team']));

  const byTeamMap = new Map<string, { teamId: string | null; teamName: string; count: number }>();
  for (const job of jobs) {
    const teamId = (job as any).team_id || null;
    const key = teamId || 'unassigned';
    const teamName = teamId ? teamLabelMap.get(teamId) || 'Unknown team' : 'Unassigned';
    const current = byTeamMap.get(key) || { teamId, teamName, count: 0 };
    current.count += 1;
    byTeamMap.set(key, current);
  }

  const scheduledJobs = jobs.filter((job: any) => !!job.scheduled_at && String(job.status || '').toLowerCase() !== 'unscheduled').length;
  const unscheduledJobs = jobs.length - scheduledJobs;

  return {
    totalJobs: jobs.length,
    scheduledJobs,
    unscheduledJobs,
    byTeam: Array.from(byTeamMap.values()).sort((a, b) => b.count - a.count),
  };
}
