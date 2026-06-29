// Live technician locations for the admin/owner map (browser/EAS GPS tracking).
// Reads tracking_live_locations (one row per user) under org RLS.

import { supabase } from '../supabase';

export interface LiveLocation {
  user_id: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
  tracking_status: string;
  is_moving: boolean | null;
  user_name?: string | null;
}

export interface TrackPoint {
  latitude: number;
  longitude: number;
  recorded_at: string;
  is_moving: boolean | null;
  job_id: string | null;
}

/** GPS trail for one technician over a time range (history view). */
export async function getTrackingHistory(
  orgId: string,
  userId: string,
  startISO: string,
  endISO: string,
): Promise<TrackPoint[]> {
  const { data, error } = await supabase
    .from('tracking_points')
    .select('latitude, longitude, recorded_at, is_moving, job_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('recorded_at', startISO)
    .lte('recorded_at', endISO)
    .order('recorded_at', { ascending: true })
    .limit(3000);
  if (error) throw new Error(error.message);
  return (data ?? []) as TrackPoint[];
}

// ─── Writers ──────────────────────────────────────────────────────────────
// Until now the mobile app only READ these tables, so the live map + history
// were empty for mobile-only orgs. These writers populate them (RLS allows any
// org member to insert their own session/points/live row). source = 'mobile'.

export interface PointInput {
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
  heading?: number | null;
  speed_mps?: number | null;
  altitude_m?: number | null;
  is_moving?: boolean;
  job_id?: string | null;
}

/** Open a tracking session for the signed-in user (one per shift). */
export async function startTrackingSession(input: {
  orgId: string;
  userId: string;
  teamId?: string | null;
  timeEntryId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from('tracking_sessions')
    .insert({
      org_id: input.orgId,
      user_id: input.userId,
      team_id: input.teamId ?? null,
      time_entry_id: input.timeEntryId ?? null,
      source: 'mobile',
      status: 'active',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Record one GPS point and upsert the user's single live-location row. */
export async function recordTrackingPoint(
  ctx: { orgId: string; userId: string; sessionId: string; teamId?: string | null },
  p: PointInput,
): Promise<void> {
  const recorded_at = new Date().toISOString();
  const moving = p.is_moving ?? (p.speed_mps != null ? p.speed_mps > 0.5 : true);

  await supabase.from('tracking_points').insert({
    org_id: ctx.orgId,
    session_id: ctx.sessionId,
    user_id: ctx.userId,
    team_id: ctx.teamId ?? null,
    latitude: p.latitude,
    longitude: p.longitude,
    accuracy_m: p.accuracy_m ?? null,
    heading: p.heading ?? null,
    speed_mps: p.speed_mps ?? null,
    altitude_m: p.altitude_m ?? null,
    is_moving: moving,
    job_id: p.job_id ?? null,
    recorded_at,
  });

  // One row per user → upsert on user_id (primary key).
  await supabase.from('tracking_live_locations').upsert(
    {
      user_id: ctx.userId,
      org_id: ctx.orgId,
      session_id: ctx.sessionId,
      team_id: ctx.teamId ?? null,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy_m: p.accuracy_m ?? null,
      heading: p.heading ?? null,
      speed_mps: p.speed_mps ?? null,
      is_moving: moving,
      job_id: p.job_id ?? null,
      recorded_at,
      tracking_status: 'active',
    },
    { onConflict: 'user_id' },
  );
}

/** Close the session and mark the user offline on the live map. */
export async function endTrackingSession(input: {
  sessionId: string;
  userId: string;
}): Promise<void> {
  await supabase
    .from('tracking_sessions')
    .update({ status: 'stopped', ended_at: new Date().toISOString() })
    .eq('id', input.sessionId);
  await supabase
    .from('tracking_live_locations')
    .update({ tracking_status: 'offline' })
    .eq('user_id', input.userId);
}

/** Current live positions for the org, with member names attached. */
export async function getActiveLiveLocations(orgId: string): Promise<LiveLocation[]> {
  const { data, error } = await supabase
    .from('tracking_live_locations')
    .select('user_id, latitude, longitude, recorded_at, tracking_status, is_moving')
    .eq('org_id', orgId);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];

  const ids = rows.map((r) => r.user_id).filter(Boolean);
  if (ids.length) {
    const { data: mem } = await supabase
      .from('memberships')
      .select('user_id, full_name')
      .eq('org_id', orgId)
      .in('user_id', ids);
    const byId = new Map((mem ?? []).map((m: any) => [m.user_id, m.full_name]));
    rows.forEach((r) => {
      r.user_name = byId.get(r.user_id) ?? null;
    });
  }
  return rows as LiveLocation[];
}
