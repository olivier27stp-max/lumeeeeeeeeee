import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import { emitAppointmentCreated, emitAppointmentCancelled } from './automationEventsApi';

export const DEFAULT_TIMEZONE = 'America/Toronto';
const CACHE_TTL_MS = 30_000;

export interface TeamRecord {
  id: string;
  org_id: string;
  name: string;
  color_hex: string;
  created_at: string;
}

export interface ScheduleJobRef {
  id: string;
  title: string;
  status: string;
  client_id: string | null;
  client_name: string | null;
  property_address: string | null;
  lead_id: string | null;
  team_id: string | null;
  latitude: number | null;
  longitude: number | null;
  geocode_status: string | null;
  total_cents?: number | null;
  job_number?: string | null;
}

export interface ScheduleEventRecord {
  id: string;
  job_id: string;
  team_id: string | null;
  start_at: string;
  end_at: string;
  timezone: string;
  status?: string | null;
  notes?: string | null;
  deleted_at: string | null;
  overlaps?: number;
  job?: ScheduleJobRef | null;
}

export interface UnscheduledJobRecord {
  id: string;
  title: string;
  status: string;
  team_id: string | null;
  client_name: string | null;
  property_address: string | null;
  lead_id: string | null;
  total_cents?: number | null;
}

const eventsCache = new Map<string, { cachedAt: number; rows: ScheduleEventRecord[] }>();

function buildCacheKey(startAt: string, endAt: string, teamIds: string[]) {
  return `${startAt}::${endAt}::${teamIds.sort().join(',')}`;
}

function toIsoOrThrow(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid date value');
  return date.toISOString();
}

function mapScheduleRow(row: any): ScheduleEventRecord {
  return {
    id: row.id,
    job_id: row.job_id,
    team_id: row.team_id ?? row.job?.team_id ?? null,
    start_at: row.start_at,
    end_at: row.end_at,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    status: row.status ?? null,
    notes: row.notes ?? null,
    deleted_at: row.deleted_at ?? null,
    job: row.job
      ? {
          id: row.job.id,
          title: row.job.title,
          status: row.job.status,
          client_id: row.job.client_id ?? null,
          client_name: row.job.client_name ?? null,
          property_address: row.job.property_address ?? null,
          lead_id: row.job.lead_id ?? null,
          team_id: row.job.team_id ?? null,
          latitude: row.job.latitude == null ? null : Number(row.job.latitude),
          longitude: row.job.longitude == null ? null : Number(row.job.longitude),
          geocode_status: row.job.geocode_status ?? null,
          total_cents: row.job.total_cents == null ? null : Number(row.job.total_cents),
        }
      : null,
  };
}

export function invalidateScheduleCache() {
  eventsCache.clear();
}

// listTeams and updateTeamColor have been moved to teamsApi.ts — use those instead.

export async function listScheduleEventsRange(params: {
  startAt: string;
  endAt: string;
  teamIds?: string[];
  bypassCache?: boolean;
}): Promise<ScheduleEventRecord[]> {
  const startAt = toIsoOrThrow(params.startAt);
  const endAt = toIsoOrThrow(params.endAt);
  const teamIds = params.teamIds || [];
  const key = buildCacheKey(startAt, endAt, teamIds);
  const now = Date.now();
  if (!params.bypassCache) {
    const hit = eventsCache.get(key);
    if (hit && now - hit.cachedAt < CACHE_TTL_MS) return hit.rows;
  }

  // Fetch events and jobs separately to avoid PostgREST JOIN "id ambiguous" with RLS
  const orgId = await getCurrentOrgIdOrThrow();
  let query = supabase
    .from('schedule_events')
    .select('id,job_id,team_id,start_at,end_at,timezone,status,notes,deleted_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .lt('start_at', endAt)
    .gt('end_at', startAt)
    .order('start_at', { ascending: true });

  // When specific teams are selected, include events that match by schedule_events.team_id
  // OR by the linked job's team_id (for events created before team was propagated).
  // Also include events with NULL team_id (unassigned) so they don't disappear.
  if (teamIds.length > 0) {
    const teamFilter = teamIds.map((id) => `"${id}"`).join(',');
    query = query.or(`team_id.in.(${teamFilter}),team_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const eventRows = data || [];
  if (eventRows.length === 0) {
    eventsCache.set(key, { cachedAt: now, rows: [] });
    return [];
  }

  // Fetch linked jobs separately (avoids PostgREST JOIN + RLS "id ambiguous")
  const jobIds = [...new Set(eventRows.map((r: any) => r.job_id).filter(Boolean))];
  const jobMap: Record<string, any> = {};
  if (jobIds.length > 0) {
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id,title,status,client_id,client_name,property_address,lead_id,team_id,latitude,longitude,geocode_status,total_cents,deleted_at')
      .in('id', jobIds);
    for (const j of jobs || []) {
      jobMap[j.id] = j;
    }
  }

  // Merge job data into event rows
  const merged = eventRows.map((row: any) => ({ ...row, job: jobMap[row.job_id] || null }));

  // Filter out events whose parent job has been soft-deleted
  let activeRows = merged.filter((row: any) => {
    if (row.job && row.job.deleted_at) return false;
    return true;
  });
  // Secondary team filter: for events with NULL team_id, check if the job's team_id matches
  if (teamIds.length > 0) {
    activeRows = activeRows.filter((row: any) => {
      if (row.team_id && teamIds.includes(row.team_id)) return true;
      if (!row.team_id && row.job?.team_id && teamIds.includes(row.job.team_id)) return true;
      if (!row.team_id && !row.job?.team_id) return true; // truly unassigned: show everywhere
      return false;
    });
  }
  const rows = activeRows.map(mapScheduleRow);
  eventsCache.set(key, { cachedAt: now, rows });
  return rows;
}

export async function listUnscheduledJobs(teamIds?: string[]): Promise<UnscheduledJobRecord[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  let query = supabase
    .from('jobs')
    .select('id,title,status,team_id,client_name,property_address,lead_id,scheduled_at,total_cents')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .is('scheduled_at', null)
    .in('status', ['draft', 'Draft'])
    .order('created_at', { ascending: false });

  // Always include unassigned jobs (team_id IS NULL) alongside jobs matching selected teams
  if (teamIds && teamIds.length > 0) {
    const teamFilter = teamIds.map((id) => `"${id}"`).join(',');
    query = query.or(`team_id.in.(${teamFilter}),team_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    team_id: row.team_id ?? null,
    client_name: row.client_name ?? null,
    property_address: row.property_address ?? null,
    lead_id: row.lead_id ?? null,
    total_cents: row.total_cents == null ? null : Number(row.total_cents),
  }));
}

export async function scheduleUnscheduledJob(payload: {
  jobId: string;
  teamId?: string | null;
  startAt: string;
  endAt: string;
  timezone?: string | null;
}): Promise<ScheduleEventRecord> {
  const { data, error } = await supabase.rpc('rpc_schedule_job', {
    p_job_id: payload.jobId,
    p_start_at: toIsoOrThrow(payload.startAt),
    p_end_at: toIsoOrThrow(payload.endAt),
    p_team_id: payload.teamId ?? null,
    p_timezone: payload.timezone ?? DEFAULT_TIMEZONE,
  });
  if (error) throw error;
  invalidateScheduleCache();
  const eventRow = (data as any)?.event || data;
  const mapped = mapScheduleRow(eventRow);

  // Fire automation hook (non-blocking)
  emitAppointmentCreated({
    eventId: mapped.id,
    jobId: payload.jobId,
    startTime: payload.startAt,
  });

  return mapped;
}

export async function rescheduleEvent(payload: {
  eventId: string;
  startAt: string;
  endAt: string;
  teamId?: string | null;
  timezone?: string | null;
}): Promise<{ event: ScheduleEventRecord; overlaps: number }> {
  const { data, error } = await supabase.rpc('rpc_reschedule_event', {
    p_event_id: payload.eventId,
    p_start_at: toIsoOrThrow(payload.startAt),
    p_end_at: toIsoOrThrow(payload.endAt),
    p_team_id: payload.teamId ?? null,
    p_timezone: payload.timezone ?? DEFAULT_TIMEZONE,
  });
  if (error) throw error;
  invalidateScheduleCache();

  // Sync job.scheduled_at / end_at to match the rescheduled event
  const event = mapScheduleRow((data as any)?.event);
  if (event.job_id) {
    supabase
      .from('jobs')
      .update({
        scheduled_at: toIsoOrThrow(payload.startAt),
        end_at: toIsoOrThrow(payload.endAt),
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.job_id)
      .then(({ error: jobErr }) => {
        if (jobErr) console.warn('Failed to sync job dates after reschedule:', jobErr.message);
      });
  }

  return {
    event,
    overlaps: Number((data as any)?.overlaps || 0),
  };
}

/** Fetch all scheduled events where the job has no team assigned (team_id IS NULL on both event and job). */
export async function listUnassignedScheduledEvents(params: {
  startAt: string;
  endAt: string;
}): Promise<ScheduleEventRecord[]> {
  const startAt = toIsoOrThrow(params.startAt);
  const endAt = toIsoOrThrow(params.endAt);

  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('schedule_events')
    .select('id,job_id,team_id,start_at,end_at,timezone,status,notes,deleted_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .is('team_id', null)
    .lt('start_at', endAt)
    .gt('end_at', startAt)
    .order('start_at', { ascending: true });

  if (error) throw error;

  const eventRows = data || [];
  if (eventRows.length === 0) return [];

  // Fetch linked jobs separately (avoids PostgREST JOIN + RLS "id ambiguous")
  const jobIds = [...new Set(eventRows.map((r: any) => r.job_id).filter(Boolean))];
  const jobMap: Record<string, any> = {};
  if (jobIds.length > 0) {
    const { data: jobs } = await supabase
      .from('jobs')
      .select('id,title,status,client_id,client_name,property_address,lead_id,team_id,latitude,longitude,geocode_status,total_cents,deleted_at')
      .in('id', jobIds);
    for (const j of jobs || []) {
      jobMap[j.id] = j;
    }
  }

  return eventRows
    .map((row: any) => ({ ...row, job: jobMap[row.job_id] || null }))
    .filter((row: any) => {
      if (row.job && row.job.deleted_at) return false;
      if (row.job?.team_id) return false;
      return true;
    })
    .map(mapScheduleRow);
}

/** Fetch all unscheduled jobs that have no team assigned. */
export async function listUnassignedUnscheduledJobs(): Promise<UnscheduledJobRecord[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id,title,status,team_id,client_name,property_address,lead_id,scheduled_at,total_cents')
    .is('deleted_at', null)
    .is('scheduled_at', null)
    .is('team_id', null)
    .in('status', ['draft', 'Draft'])
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    team_id: null,
    client_name: row.client_name ?? null,
    property_address: row.property_address ?? null,
    lead_id: row.lead_id ?? null,
    total_cents: row.total_cents == null ? null : Number(row.total_cents),
  }));
}

/** Assign a job to a team via the server route (bypasses RLS). */
export async function assignJobToTeam(jobId: string, teamId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Not authenticated.');

  const res = await fetch('/api/jobs/assign-team', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, teamId }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || 'Failed to assign job to team.');

  invalidateScheduleCache();
}

export async function unscheduleJob(payload: { jobId: string; eventId?: string | null }): Promise<void> {
  const { error } = await supabase.rpc('rpc_unschedule_job', {
    p_job_id: payload.jobId,
    p_event_id: payload.eventId ?? null,
  });
  if (error) throw error;
  invalidateScheduleCache();

  // Fire automation hook (non-blocking)
  if (payload.eventId) {
    emitAppointmentCancelled({
      eventId: payload.eventId,
      jobId: payload.jobId,
    });
  }
}
