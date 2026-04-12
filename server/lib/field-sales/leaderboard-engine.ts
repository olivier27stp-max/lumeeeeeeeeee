/**
 * Leaderboard & Performance Engine
 *
 * Reads from fs_rep_stat_snapshots for historical data and computes
 * real-time stats from field_house_events for the current day.
 * Adapted from Clostra's leaderboard service for Lume's org_id model.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { startOfDay, startOfWeek, startOfMonth, endOfDay, endOfWeek, endOfMonth, format } from 'date-fns';

type PeriodType = 'daily' | 'weekly' | 'monthly';

function periodRange(period: PeriodType, date: Date = new Date()) {
  switch (period) {
    case 'daily':
      return {
        start: format(startOfDay(date), 'yyyy-MM-dd'),
        end: format(endOfDay(date), 'yyyy-MM-dd'),
      };
    case 'weekly':
      return {
        start: format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
        end: format(endOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      };
    case 'monthly':
      return {
        start: format(startOfMonth(date), 'yyyy-MM-dd'),
        end: format(endOfMonth(date), 'yyyy-MM-dd'),
      };
  }
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export async function getLeaderboard(
  supabase: SupabaseClient,
  orgId: string,
  period: PeriodType,
  date?: Date,
  teamId?: string
) {
  const range = periodRange(period, date);

  let query = supabase
    .from('fs_rep_stat_snapshots')
    .select('*')
    .eq('org_id', orgId)
    .eq('period', period)
    .gte('period_start', range.start)
    .lte('period_start', range.end)
    .order('revenue', { ascending: false });

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Enrich with member info
  const userIds = (data ?? []).map((r) => r.user_id);
  if (userIds.length === 0) return [];

  const { data: members } = await supabase
    .from('memberships')
    .select('user_id, full_name, avatar_url, role, team_name')
    .eq('org_id', orgId)
    .in('user_id', userIds);

  const memberMap = new Map(
    (members ?? []).map((m) => [m.user_id, m])
  );

  let entries = (data ?? []).map((row, index) => {
    const member = memberMap.get(row.user_id);
    return {
      rank: index + 1,
      user_id: row.user_id,
      full_name: member?.full_name || 'Unknown',
      avatar_url: member?.avatar_url || null,
      team_name: member?.team_name || null,
      closes: row.closes,
      revenue: row.revenue,
      doors_knocked: row.doors_knocked,
      conversion_rate: row.conversion_rate,
      trend: 0,
    };
  });

  // Filter by team if specified
  if (teamId) {
    const { data: teamMembers } = await supabase
      .from('memberships')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('team_id', teamId);
    const teamUserIds = new Set((teamMembers ?? []).map((m) => m.user_id));
    entries = entries.filter((e) => teamUserIds.has(e.user_id));
    entries.forEach((e, i) => { e.rank = i + 1; });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Rep Performance Detail
// ---------------------------------------------------------------------------

export async function getRepPerformance(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  dateRange: { from: string; to: string }
) {
  const { data, error } = await supabase
    .from('fs_rep_stat_snapshots')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('period_start', dateRange.from)
    .lte('period_end', dateRange.to);

  if (error) throw new Error(error.message);

  const agg = {
    doors_knocked: 0,
    conversations: 0,
    demos_set: 0,
    demos_held: 0,
    quotes_sent: 0,
    closes: 0,
    revenue: 0,
    conversion_rate: 0,
    average_ticket: 0,
    follow_ups_completed: 0,
  };

  for (const row of data ?? []) {
    agg.doors_knocked += row.doors_knocked;
    agg.conversations += row.conversations;
    agg.demos_set += row.demos_set;
    agg.demos_held += row.demos_held;
    agg.quotes_sent += row.quotes_sent;
    agg.closes += row.closes;
    agg.revenue += Number(row.revenue);
    agg.follow_ups_completed += row.follow_ups_completed;
  }

  agg.conversion_rate =
    agg.conversations > 0
      ? Math.round((agg.closes / agg.conversations) * 100 * 10) / 10
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
  orgId: string,
  userId: string,
  date: Date = new Date()
) {
  const dayStart = startOfDay(date).toISOString();
  const dayEnd = endOfDay(date).toISOString();

  const { data: events, error } = await supabase
    .from('field_house_events')
    .select('*')
    .eq('org_id', orgId)
    .eq('created_by', userId)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  if (error) throw new Error(error.message);

  const stats = {
    doors_knocked: 0,
    conversations: 0,
    demos_set: 0,
    demos_held: 0,
    quotes_sent: 0,
    closes: 0,
    revenue: 0,
    conversion_rate: 0,
    average_ticket: 0,
    follow_ups_completed: 0,
  };

  for (const event of events ?? []) {
    const type = event.event_type || event.status;
    switch (type) {
      case 'knock':
      case 'door_knock':
        stats.doors_knocked++;
        break;
      case 'conversation':
      case 'contact':
        stats.conversations++;
        break;
      case 'demo_set':
      case 'callback':
        stats.demos_set++;
        break;
      case 'demo_held':
        stats.demos_held++;
        break;
      case 'quote_sent':
        stats.quotes_sent++;
        break;
      case 'follow_up':
        stats.follow_ups_completed++;
        break;
      case 'lead':
      case 'sale':
      case 'closed_won': {
        stats.closes++;
        const rev = event.metadata?.revenue ?? event.metadata?.value ?? 0;
        if (typeof rev === 'number') stats.revenue += rev;
        break;
      }
    }
  }

  stats.conversion_rate =
    stats.conversations > 0
      ? Math.round((stats.closes / stats.conversations) * 100 * 10) / 10
      : 0;
  stats.average_ticket =
    stats.closes > 0 ? Math.round(stats.revenue / stats.closes) : 0;

  return stats;
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

  for (const member of members ?? []) {
    const stats = await calculateRepStats(supabase, orgId, member.user_id, today);

    await supabase.from('fs_rep_stat_snapshots').upsert(
      {
        org_id: orgId,
        user_id: member.user_id,
        period: 'daily',
        period_start: dayStart,
        period_end: dayEnd,
        ...stats,
      },
      { onConflict: 'user_id,period,period_start' }
    );
  }
}
