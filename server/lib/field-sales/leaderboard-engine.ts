/**
 * Leaderboard & Performance Engine
 *
 * Source of truth: jobs. A created job with a salesperson assigned (at
 * creation or later via edit) IS a closed deal — attributed to
 * jobs.salesperson_id, falling back to the creator. Only real org members
 * (sales reps, admins, owners) are ranked. Leads/quotes still feed the
 * upstream funnel metrics.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { startOfDay, startOfWeek, startOfMonth, endOfDay, endOfWeek, endOfMonth, format } from 'date-fns';

type PeriodType = 'daily' | 'weekly' | 'monthly';

export interface DateWindow {
  start: string; // ISO
  end: string;   // ISO
}

export function periodRange(period: PeriodType, date: Date = new Date()): DateWindow {
  switch (period) {
    case 'daily':
      return { start: startOfDay(date).toISOString(), end: endOfDay(date).toISOString() };
    case 'weekly':
      return { start: startOfWeek(date, { weekStartsOn: 1 }).toISOString(), end: endOfWeek(date, { weekStartsOn: 1 }).toISOString() };
    case 'monthly':
      return { start: startOfMonth(date).toISOString(), end: endOfMonth(date).toISOString() };
  }
}

// Roles that appear on the leaderboard — anyone else (or a non-member id
// left over from test data) is dropped from the ranking.
const RANKED_ROLES = new Set(['sales_rep', 'admin', 'owner']);

function repIdOf(deal: any): string | null {
  return deal.rep_id || deal.created_by || null;
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

// A job counts for the assigned salesperson; jobs created without an
// explicit assignment count for their creator.
function repOfJob(job: any): string | null {
  return job.salesperson_id || job.created_by || null;
}

function jobRevenue(job: any): number {
  return (Number(job.total_cents) || 0) / 100;
}

export async function getLeaderboard(
  supabase: SupabaseClient,
  orgId: string | string[],
  window: DateWindow,
  teamId?: string,
  experience?: 'rookie' | 'experienced'
) {
  // Un "office" = un org. Le leaderboard mélange tous les offices d'une
  // même compagnie : on accepte donc un ou plusieurs org_id.
  const orgIds = Array.isArray(orgId) ? orgId : [orgId];
  const range = window;

  // Current window: real jobs — une job créée = un deal closé.
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, salesperson_id, created_by, total_cents, created_at')
    .in('org_id', orgIds)
    .is('deleted_at', null)
    .gte('created_at', range.start)
    .lte('created_at', range.end);
  if (error) throw new Error(error.message);

  // Aggregate per rep
  const byRep = new Map<string, { closes: number; revenue: number }>();
  for (const j of jobs ?? []) {
    const rid = repOfJob(j);
    if (!rid) continue;
    const cur = byRep.get(rid) || { closes: 0, revenue: 0 };
    cur.closes += 1;
    cur.revenue += jobRevenue(j);
    byRep.set(rid, cur);
  }

  if (byRep.size === 0) return [];

  // Previous window of equal length for the trend
  const startMs = new Date(range.start).getTime();
  const endMs = new Date(range.end).getTime();
  const durationMs = Math.max(endMs - startMs, 1);
  const prevRange = {
    start: new Date(startMs - 1 - durationMs).toISOString(),
    end: new Date(startMs - 1).toISOString(),
  };

  const userIds = Array.from(byRep.keys());

  const [membersRes, prevJobsRes, leadsRes] = await Promise.all([
    supabase
      .from('memberships')
      .select('user_id, full_name, avatar_url, role, team_id, experience_level, teams:team_id(name)')
      .in('org_id', orgIds)
      .in('user_id', userIds),
    supabase
      .from('jobs')
      .select('salesperson_id, created_by, total_cents')
      .in('org_id', orgIds)
      .is('deleted_at', null)
      .gte('created_at', prevRange.start)
      .lte('created_at', prevRange.end),
    // doors_knocked / conversion baseline: count leads created in the period per rep
    supabase
      .from('clients')
      .select('assigned_to, user_id, created_by')
      .eq('status', 'lead')
      .in('org_id', orgIds)
      .is('deleted_at', null)
      .gte('created_at', range.start)
      .lte('created_at', range.end),
  ]);

  const memberMap = new Map((membersRes.data ?? []).map((m: any) => [m.user_id, m]));

  const prevRevenueMap = new Map<string, number>();
  for (const j of prevJobsRes.data ?? []) {
    const rid = repOfJob(j);
    if (!rid) continue;
    prevRevenueMap.set(rid, (prevRevenueMap.get(rid) || 0) + jobRevenue(j));
  }

  const leadsByRep = new Map<string, number>();
  for (const l of leadsRes.data ?? []) {
    const rid = (l as any).assigned_to || (l as any).user_id || (l as any).created_by;
    if (!rid) continue;
    leadsByRep.set(rid, (leadsByRep.get(rid) || 0) + 1);
  }

  // Only real members with a ranked role — drops test reps and stale ids.
  let entries = userIds
    .filter((uid) => {
      const m: any = memberMap.get(uid);
      return m && RANKED_ROLES.has(m.role);
    })
    .map((uid) => {
    const m: any = memberMap.get(uid) || {};
    const stats = byRep.get(uid)!;
    const prevRevenue = prevRevenueMap.get(uid) || 0;
    const trend = prevRevenue > 0
      ? Math.round(((stats.revenue - prevRevenue) / prevRevenue) * 100)
      : stats.revenue > 0 ? 100 : 0;
    const leads = leadsByRep.get(uid) || 0;
    const conversion_rate = leads > 0 ? Math.round((stats.closes / leads) * 100 * 10) / 10 : 0;
    return {
      rank: 0,
      user_id: uid,
      full_name: m.full_name || 'Unknown',
      avatar_url: m.avatar_url || null,
      team_name: m.teams?.name || null,
      team_id: m.team_id || null,
      experience_level: m.experience_level || null,
      closes: stats.closes,
      revenue: stats.revenue,
      doors_knocked: leads,
      conversion_rate,
      trend,
    };
  });

  entries.sort((a, b) => b.revenue - a.revenue);

  if (teamId) {
    entries = entries.filter((e) => e.team_id === teamId);
  }
  if (experience) {
    entries = entries.filter((e) => e.experience_level === experience);
  }
  // Rank is assigned AFTER filtering, so each category has its own 1-2-3.
  entries.forEach((e, i) => { e.rank = i + 1; });

  return entries;
}

// ---------------------------------------------------------------------------
// Rep Performance Detail
// ---------------------------------------------------------------------------

export async function getRepPerformance(
  supabase: SupabaseClient,
  orgId: string | string[],
  userId: string,
  dateRange: { from: string; to: string }
) {
  // Accepte un ou plusieurs offices (compagnie) pour que le détail d'un rep
  // fonctionne même s'il appartient à un autre office du leaderboard combiné.
  const orgIds = Array.isArray(orgId) ? orgId : [orgId];
  const fromIso = new Date(dateRange.from).toISOString();
  const toIso = endOfDay(new Date(dateRange.to)).toISOString();

  const [leadsRes, quotesRes, dealsRes, jobsRes] = await Promise.all([
    supabase
      .from('clients')
      .select('id, status:lead_status, created_at, assigned_to, user_id, created_by')
      .eq('status', 'lead')
      .in('org_id', orgIds)
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    supabase
      .from('quotes')
      .select('id, status, salesperson_id, created_by, sent_via_email_at, sent_via_sms_at, created_at, total_cents')
      .in('org_id', orgIds)
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    supabase
      .from('pipeline_deals')
      .select('id, stage, rep_id, created_by, value, value_cents, won_at, created_at')
      .in('org_id', orgIds)
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    supabase
      .from('jobs')
      .select('id, status, salesperson_id, created_by, created_at, total_cents')
      .in('org_id', orgIds)
      .is('deleted_at', null)
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
  ]);

  const matchLead = (l: any) => (l.assigned_to || l.user_id || l.created_by) === userId;
  const matchQuote = (q: any) => (q.salesperson_id || q.created_by) === userId;
  const matchDeal = (d: any) => repIdOf(d) === userId;
  const matchJob = (j: any) => (j.salesperson_id || j.created_by) === userId;

  const myLeads = (leadsRes.data ?? []).filter(matchLead);
  const myQuotes = (quotesRes.data ?? []).filter(matchQuote);
  const myDeals = (dealsRes.data ?? []).filter(matchDeal);
  const myJobs = (jobsRes.data ?? []).filter(matchJob);

  const agg = {
    doors_knocked: myLeads.length,
    conversations: myLeads.filter((l: any) => l.status && l.status !== 'new').length,
    demos_set: myDeals.length,
    demos_held: myDeals.filter((d: any) => d.stage !== 'new_prospect').length,
    quotes_sent: myQuotes.filter((q: any) => q.sent_via_email_at || q.sent_via_sms_at || ['awaiting_response', 'changes_requested', 'approved', 'declined', 'converted'].includes(q.status)).length,
    // Une job créée dans la fenêtre = un deal closé, attribué au salesperson
    closes: myJobs.length,
    revenue: myJobs.reduce((s: number, j: any) => s + jobRevenue(j), 0),
    conversion_rate: 0,
    average_ticket: 0,
    follow_ups_completed: myJobs.filter((j: any) => j.status === 'completed').length,
  };

  agg.conversion_rate =
    agg.doors_knocked > 0
      ? Math.round((agg.closes / agg.doors_knocked) * 100 * 10) / 10
      : 0;
  agg.average_ticket =
    agg.closes > 0 ? Math.round(agg.revenue / agg.closes) : 0;

  return agg;
}

// ---------------------------------------------------------------------------
// Real-time stats from field_house_events (current day)
// ---------------------------------------------------------------------------

export async function calculateRepStats(
  supabase: SupabaseClient,
  orgId: string | string[],
  userId: string,
  date: Date = new Date()
) {
  const dayStart = startOfDay(date).toISOString().slice(0, 10);
  const dayEnd = endOfDay(date).toISOString().slice(0, 10);
  return getRepPerformance(supabase, orgId, userId, { from: dayStart, to: dayEnd });
}

// ---------------------------------------------------------------------------
// Snapshot cron job (called by scheduler)
// ---------------------------------------------------------------------------

export async function snapshotDailyStats(
  supabase: SupabaseClient,
  orgId: string
) {
  const { data: members, error: mError } = await supabase
    .from('memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .in('role', ['sales_rep', 'admin', 'owner']);

  if (mError) throw new Error(mError.message);

  const today = new Date();
  const dayStart = format(startOfDay(today), 'yyyy-MM-dd');
  const dayEnd = format(endOfDay(today), 'yyyy-MM-dd');

  // Compute all reps' stats in parallel, then batch upsert
  const results = await Promise.all(
    (members ?? []).map(async (member) => {
      const stats = await calculateRepStats(supabase, orgId, member.user_id, today);
      return {
        org_id: orgId,
        user_id: member.user_id,
        period: 'daily' as const,
        period_start: dayStart,
        period_end: dayEnd,
        ...stats,
      };
    })
  );

  if (results.length > 0) {
    await supabase.from('fs_rep_stat_snapshots').upsert(results, {
      onConflict: 'user_id,period,period_start',
    });
  }
}
