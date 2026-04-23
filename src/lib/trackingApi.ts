import { supabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export type TrackingSessionStatus = 'active' | 'stopped' | 'lost_permission' | 'error' | 'expired';
export type TrackingSource = 'web' | 'mobile' | 'external';
export type TrackingEventType =
  | 'session_start' | 'session_stop' | 'session_expired'
  | 'permission_granted' | 'permission_denied' | 'permission_revoked'
  | 'gps_error' | 'gps_recovered'
  | 'idle_start' | 'idle_end'
  | 'job_arrival' | 'job_departure'
  | 'tab_hidden' | 'tab_visible'
  | 'network_lost' | 'network_recovered'
  | 'heartbeat';

export type LiveTrackingStatus = 'active' | 'idle' | 'offline' | 'stale';

export interface TrackingSession {
  id: string;
  org_id: string;
  user_id: string;
  team_id: string | null;
  time_entry_id: string | null;
  source: TrackingSource;
  status: TrackingSessionStatus;
  started_at: string;
  ended_at: string | null;
  last_point_at: string | null;
  point_count: number;
  total_distance_m: number;
  metadata: Record<string, any> | null;
}

export interface TrackingPoint {
  id: string;
  session_id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mps: number | null;
  altitude_m: number | null;
  is_moving: boolean;
  job_id: string | null;
  recorded_at: string;
}

export interface LiveLocation {
  user_id: string;
  org_id: string;
  session_id: string | null;
  team_id: string | null;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mps: number | null;
  is_moving: boolean;
  job_id: string | null;
  recorded_at: string;
  tracking_status: LiveTrackingStatus;
  // Joined
  user_name?: string;
  team_name?: string;
  team_color?: string;
}

export interface TrackingEvent {
  id: string;
  session_id: string | null;
  user_id: string;
  event_type: TrackingEventType;
  event_at: string;
  latitude: number | null;
  longitude: number | null;
  details: Record<string, any> | null;
}

// ─── Configuration ──────────────────────────────────────────────────────────

export const TRACKING_CONFIG = {
  /** Minimum accuracy in meters to accept a point (reject worse) */
  maxAccuracyM: 100,
  /** Minimum distance in meters to record a new point (noise filter) */
  minDistanceM: 10,
  /** Minimum time between points in ms (throttle) */
  minIntervalMs: 5_000,
  /** Heartbeat interval in ms (keep-alive when not moving) */
  heartbeatIntervalMs: 60_000,
  /** Idle threshold: no movement for this many ms = idle */
  idleThresholdMs: 300_000, // 5 minutes
  /** Stale threshold: no update for this many ms = stale on admin map */
  staleThresholdMs: 180_000, // 3 minutes
  /** Geofence radius for job arrival/departure detection (meters) */
  jobGeofenceRadiusM: 150,
  /** Speed threshold below which employee is considered stationary (m/s) */
  movingSpeedThreshold: 0.5,
};

// ─── Haversine distance ─────────────────────────────────────────────────────

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Session management ─────────────────────────────────────────────────────

export async function getActiveSession(userId: string): Promise<TrackingSession | null> {
  const { data, error } = await supabase
    .from('tracking_sessions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as TrackingSession | null;
}

export async function startTrackingSession(params: {
  orgId: string;
  userId: string;
  teamId?: string | null;
  timeEntryId?: string | null;
  source?: TrackingSource;
}): Promise<TrackingSession> {
  // Close any stale active sessions for this user first
  await supabase
    .from('tracking_sessions')
    .update({ status: 'expired', ended_at: new Date().toISOString() })
    .eq('user_id', params.userId)
    .eq('status', 'active');

  const { data, error } = await supabase
    .from('tracking_sessions')
    .insert({
      org_id: params.orgId,
      user_id: params.userId,
      team_id: params.teamId ?? null,
      time_entry_id: params.timeEntryId ?? null,
      source: params.source || 'web',
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;

  await logTrackingEvent({
    orgId: params.orgId,
    sessionId: data.id,
    userId: params.userId,
    eventType: 'session_start',
    details: { source: params.source || 'web' },
  });

  return data as TrackingSession;
}

export async function stopTrackingSession(params: {
  sessionId: string;
  userId: string;
  orgId: string;
  reason?: TrackingSessionStatus;
}): Promise<void> {
  const now = new Date().toISOString();
  const status = params.reason || 'stopped';

  await supabase
    .from('tracking_sessions')
    .update({ status, ended_at: now })
    .eq('id', params.sessionId)
    .eq('user_id', params.userId);

  await logTrackingEvent({
    orgId: params.orgId,
    sessionId: params.sessionId,
    userId: params.userId,
    eventType: status === 'stopped' ? 'session_stop' : 'session_expired',
    details: { reason: status },
  });

  // Mark live location as offline
  await supabase
    .from('tracking_live_locations')
    .update({ tracking_status: 'offline', session_id: null })
    .eq('user_id', params.userId);
}

// ─── Position recording ─────────────────────────────────────────────────────

export async function recordPosition(params: {
  orgId: string;
  sessionId: string;
  userId: string;
  teamId?: string | null;
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
  heading?: number | null;
  speed_mps?: number | null;
  altitude_m?: number | null;
  is_moving?: boolean;
  job_id?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const isMoving = params.is_moving ?? (params.speed_mps != null ? params.speed_mps > TRACKING_CONFIG.movingSpeedThreshold : true);

  // Insert tracking point
  await supabase.from('tracking_points').insert({
    org_id: params.orgId,
    session_id: params.sessionId,
    user_id: params.userId,
    team_id: params.teamId ?? null,
    latitude: params.latitude,
    longitude: params.longitude,
    accuracy_m: params.accuracy_m ?? null,
    heading: params.heading ?? null,
    speed_mps: params.speed_mps ?? null,
    altitude_m: params.altitude_m ?? null,
    is_moving: isMoving,
    job_id: params.job_id ?? null,
    recorded_at: now,
  });

  // Update session stats
  await supabase
    .from('tracking_sessions')
    .update({ last_point_at: now, point_count: undefined }) // point_count incremented via RPC or trigger
    .eq('id', params.sessionId);

  // Upsert live location
  await upsertLiveLocation({
    userId: params.userId,
    orgId: params.orgId,
    sessionId: params.sessionId,
    teamId: params.teamId ?? null,
    latitude: params.latitude,
    longitude: params.longitude,
    accuracy_m: params.accuracy_m ?? null,
    heading: params.heading ?? null,
    speed_mps: params.speed_mps ?? null,
    is_moving: isMoving,
    job_id: params.job_id ?? null,
  });
}

export async function upsertLiveLocation(params: {
  userId: string;
  orgId: string;
  sessionId: string;
  teamId: string | null;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  heading: number | null;
  speed_mps: number | null;
  is_moving: boolean;
  job_id: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from('tracking_live_locations').upsert(
    {
      user_id: params.userId,
      org_id: params.orgId,
      session_id: params.sessionId,
      team_id: params.teamId,
      latitude: params.latitude,
      longitude: params.longitude,
      accuracy_m: params.accuracy_m,
      heading: params.heading,
      speed_mps: params.speed_mps,
      is_moving: params.is_moving,
      job_id: params.job_id,
      recorded_at: now,
      tracking_status: params.is_moving ? 'active' : 'idle',
    },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
}

// ─── Event logging ──────────────────────────────────────────────────────────

export async function logTrackingEvent(params: {
  orgId: string;
  sessionId?: string | null;
  userId: string;
  eventType: TrackingEventType;
  latitude?: number | null;
  longitude?: number | null;
  details?: Record<string, any> | null;
}): Promise<void> {
  await supabase.from('tracking_events').insert({
    org_id: params.orgId,
    session_id: params.sessionId ?? null,
    user_id: params.userId,
    event_type: params.eventType,
    event_at: new Date().toISOString(),
    latitude: params.latitude ?? null,
    longitude: params.longitude ?? null,
    details: params.details ?? null,
  });
}

// ─── Admin queries ──────────────────────────────────────────────────────────

export async function getActiveLiveLocations(): Promise<LiveLocation[]> {
  const { data, error } = await supabase
    .from('tracking_live_locations')
    .select('*')
    .in('tracking_status', ['active', 'idle']);
  if (error) throw error;

  const rows = (data || []) as any[];
  if (rows.length === 0) return [];

  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
  const teamIds = Array.from(new Set(rows.map((r) => r.team_id).filter(Boolean)));

  const [profilesRes, teamsRes] = await Promise.all([
    userIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [], error: null } as any),
    teamIds.length
      ? supabase.from('teams').select('id, name, color_hex').in('id', teamIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const profileMap = new Map<string, { full_name: string | null }>(
    ((profilesRes.data as any[]) || []).map((p) => [p.id, p]),
  );
  const teamMap = new Map<string, { name: string | null; color_hex: string | null }>(
    ((teamsRes.data as any[]) || []).map((t) => [t.id, t]),
  );

  return rows.map((row) => ({
    ...row,
    user_name: profileMap.get(row.user_id)?.full_name || null,
    team_name: row.team_id ? teamMap.get(row.team_id)?.name || null : null,
    team_color: row.team_id ? teamMap.get(row.team_id)?.color_hex || null : null,
  }));
}

export async function getEmployeeRouteForDay(userId: string, date: string): Promise<TrackingPoint[]> {
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  const { data, error } = await supabase
    .from('tracking_points')
    .select('*')
    .eq('user_id', userId)
    .gte('recorded_at', dayStart)
    .lte('recorded_at', dayEnd)
    .order('recorded_at', { ascending: true });
  if (error) throw error;
  return (data || []) as TrackingPoint[];
}

export async function getSessionEvents(sessionId: string): Promise<TrackingEvent[]> {
  const { data, error } = await supabase
    .from('tracking_events')
    .select('*')
    .eq('session_id', sessionId)
    .order('event_at', { ascending: true });
  if (error) throw error;
  return (data || []) as TrackingEvent[];
}

// ─── Analytics helpers ──────────────────────────────────────────────────────

export interface IdlePeriod {
  startedAt: string;
  endedAt: string;
  durationMs: number;
  latitude: number;
  longitude: number;
}

export function detectIdlePeriods(points: TrackingPoint[], thresholdMs?: number): IdlePeriod[] {
  const threshold = thresholdMs || TRACKING_CONFIG.idleThresholdMs;
  const idles: IdlePeriod[] = [];
  if (points.length < 2) return idles;

  let idleStart: TrackingPoint | null = null;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dist = haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
    const dt = new Date(curr.recorded_at).getTime() - new Date(prev.recorded_at).getTime();

    if (dist < TRACKING_CONFIG.minDistanceM && dt > 0) {
      if (!idleStart) idleStart = prev;
    } else {
      if (idleStart) {
        const duration = new Date(prev.recorded_at).getTime() - new Date(idleStart.recorded_at).getTime();
        if (duration >= threshold) {
          idles.push({
            startedAt: idleStart.recorded_at,
            endedAt: prev.recorded_at,
            durationMs: duration,
            latitude: idleStart.latitude,
            longitude: idleStart.longitude,
          });
        }
        idleStart = null;
      }
    }
  }

  // Check final idle period
  if (idleStart) {
    const last = points[points.length - 1];
    const duration = new Date(last.recorded_at).getTime() - new Date(idleStart.recorded_at).getTime();
    if (duration >= threshold) {
      idles.push({
        startedAt: idleStart.recorded_at,
        endedAt: last.recorded_at,
        durationMs: duration,
        latitude: idleStart.latitude,
        longitude: idleStart.longitude,
      });
    }
  }

  return idles;
}

export interface JobVisit {
  jobId: string;
  arrivedAt: string;
  departedAt: string | null;
  durationMs: number;
}

export function detectJobArrivals(
  points: TrackingPoint[],
  jobs: Array<{ id: string; latitude: number; longitude: number }>,
  radiusM?: number
): JobVisit[] {
  const radius = radiusM || TRACKING_CONFIG.jobGeofenceRadiusM;
  const visits: JobVisit[] = [];

  for (const job of jobs) {
    let insideStart: string | null = null;

    for (const point of points) {
      const dist = haversineDistance(point.latitude, point.longitude, job.latitude, job.longitude);
      const inside = dist <= radius;

      if (inside && !insideStart) {
        insideStart = point.recorded_at;
      } else if (!inside && insideStart) {
        const duration = new Date(point.recorded_at).getTime() - new Date(insideStart).getTime();
        visits.push({ jobId: job.id, arrivedAt: insideStart, departedAt: point.recorded_at, durationMs: duration });
        insideStart = null;
      }
    }

    // Still inside at end of route
    if (insideStart && points.length > 0) {
      const last = points[points.length - 1];
      const duration = new Date(last.recorded_at).getTime() - new Date(insideStart).getTime();
      visits.push({ jobId: job.id, arrivedAt: insideStart, departedAt: null, durationMs: duration });
    }
  }

  return visits.sort((a, b) => new Date(a.arrivedAt).getTime() - new Date(b.arrivedAt).getTime());
}
