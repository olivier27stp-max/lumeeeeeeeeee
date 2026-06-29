// Sales-rep dashboard data: door-knock stats, lead pipeline, and a leaderboard.
// Aggregations are done client-side (PostgREST has no group-by without an RPC),
// scoped by date so the row counts stay small. All reads are defensive.

import { supabase } from '../supabase';

export interface DoorStats {
  knocks: number;
  leads: number;
  sales: number;
  total: number;
}

/** Door-knock activity for a rep (or whole org if userId is null) since a date. */
export async function getDoorStats(orgId: string, userId: string | null, sinceISO: string): Promise<DoorStats> {
  let q = supabase
    .from('field_house_events')
    .select('event_type, user_id, created_at')
    .eq('org_id', orgId)
    .gte('created_at', sinceISO)
    .limit(5000);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) return { knocks: 0, leads: 0, sales: 0, total: 0 };

  let knocks = 0;
  let leads = 0;
  let sales = 0;
  for (const r of (data ?? []) as any[]) {
    if (r.event_type === 'knock') knocks += 1;
    else if (r.event_type === 'lead') leads += 1;
    else if (r.event_type === 'sale') sales += 1;
  }
  return { knocks, leads, sales, total: (data ?? []).length };
}

export interface PipelineBucket {
  status: string;
  count: number;
}

/** Lead counts by status (rep's own if userId set, else whole org). */
export async function getLeadPipeline(orgId: string, userId: string | null): Promise<PipelineBucket[]> {
  let q = supabase.from('leads').select('status, assigned_to').eq('org_id', orgId).limit(3000);
  if (userId) q = q.eq('assigned_to', userId);
  const { data, error } = await q;
  if (error) return [];

  const m = new Map<string, number>();
  for (const r of (data ?? []) as any[]) {
    const s = (r.status ?? 'new') as string;
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return [...m.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
}

export interface RepRank {
  user_id: string;
  name: string;
  sales: number;
  knocks: number;
  /** Revenue in cents — sum of total_cents of jobs the rep created in the window. */
  revenueCents: number;
  /** Uploaded profile photo (else null → UnifiedAvatar shows DiceBear). */
  avatarUrl: string | null;
}

/** Reps ranked by sales (then knocks) over a window. Pass untilISO to bound the
 * upper end (used to compute the previous period for trend arrows). Returns the
 * full ranked list (capped) so the caller can re-sort by metric. */
export async function getLeaderboard(
  orgId: string,
  sinceISO: string,
  untilISO?: string,
): Promise<RepRank[]> {
  // Sales/knocks from door events.
  let q = supabase
    .from('field_house_events')
    .select('user_id, event_type, created_at')
    .eq('org_id', orgId)
    .gte('created_at', sinceISO)
    .limit(8000);
  if (untilISO) q = q.lt('created_at', untilISO);
  const { data, error } = await q;

  const m = new Map<string, { sales: number; knocks: number; revenueCents: number }>();
  const bump = (id: string) => {
    let e = m.get(id);
    if (!e) {
      e = { sales: 0, knocks: 0, revenueCents: 0 };
      m.set(id, e);
    }
    return e;
  };
  if (!error) {
    for (const r of (data ?? []) as any[]) {
      if (!r.user_id) continue;
      const e = bump(r.user_id);
      if (r.event_type === 'sale') e.sales += 1;
      else if (r.event_type === 'knock') e.knocks += 1;
    }
  }

  // Revenue = total_cents of jobs the rep created in the window.
  let jq = supabase
    .from('jobs')
    .select('created_by, total_cents, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', sinceISO)
    .limit(8000);
  if (untilISO) jq = jq.lt('created_at', untilISO);
  const { data: jobRows } = await jq;
  for (const r of (jobRows ?? []) as any[]) {
    if (!r.created_by) continue;
    bump(r.created_by).revenueCents += r.total_cents ?? 0;
  }

  const ids = [...m.keys()];
  let names = new Map<string, string>();
  let avatars = new Map<string, string | null>();
  if (ids.length) {
    const { data: mem } = await supabase
      .from('memberships')
      .select('user_id, full_name')
      .eq('org_id', orgId)
      .in('user_id', ids);
    names = new Map((mem ?? []).map((x: any) => [x.user_id, x.full_name]));
    // Profile photos live in profiles.avatar_url → show them on the leaderboard too.
    const { data: profs } = await supabase.from('profiles').select('id, avatar_url').in('id', ids);
    avatars = new Map((profs ?? []).map((p: any) => [p.id, p.avatar_url ?? null]));
  }

  return ids
    .map((id) => ({ user_id: id, name: names.get(id) ?? 'Rep', avatarUrl: avatars.get(id) ?? null, ...m.get(id)! }))
    .sort((a, b) => b.revenueCents - a.revenueCents || b.sales - a.sales)
    .slice(0, 50);
}

export interface MonthlySales {
  label: string; // e.g. "Jan", "Fév"
  sales: number;
}

/** Sales per month for a rep over the last N months (oldest → newest), for the
 * profile bar chart. */
export async function getMonthlySales(
  orgId: string,
  userId: string,
  monthsBack = 6,
): Promise<MonthlySales[]> {
  const start = new Date();
  start.setMonth(start.getMonth() - (monthsBack - 1));
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('field_house_events')
    .select('created_at, event_type')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('event_type', 'sale')
    .gte('created_at', start.toISOString())
    .limit(5000);

  const labels = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  const buckets: MonthlySales[] = [];
  const keyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const index = new Map<string, number>();
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    index.set(keyOf(d), i);
    buckets.push({ label: labels[d.getMonth()], sales: 0 });
  }
  if (!error) {
    for (const r of (data ?? []) as any[]) {
      const d = new Date(r.created_at);
      const i = index.get(keyOf(d));
      if (i != null) buckets[i].sales += 1;
    }
  }
  return buckets;
}
