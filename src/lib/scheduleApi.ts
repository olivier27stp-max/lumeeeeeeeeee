import { supabase } from './supabase';

export const DEFAULT_TIMEZONE = 'America/Montreal';
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
    start_at: row.start_at || row.start_time,
    end_at: row.end_at || row.end_time,
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

export async function listTeams(): Promise<TeamRecord[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('id,org_id,name,color_hex,created_at')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as TeamRecord[];
}

export async function updateTeamColor(teamId: string, colorHex: string): Promise<TeamRecord> {
  const { data, error } = await supabase
    .from('teams')
    .update({ color_hex: colorHex, updated_at: new Date().toISOString() })
    .eq('id', teamId)
    .select('id,org_id,name,color_hex,created_at')
    .single();
  if (error) throw error;
  invalidateScheduleCache();
  return data as TeamRecord;
}

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

  let query = supabase
    .from('schedule_events')
    .select(
      `
      id,job_id,team_id,start_at,end_at,start_time,end_time,timezone,status,notes,deleted_at,
      job:jobs!schedule_events_job_id_fkey(
        id,title,status,client_id,client_name,property_address,lead_id,team_id,latitude,longitude,geocode_status,total_cents
      )
      `
    )
    .is('deleted_at', null)
    .lt('start_at', endAt)
    .gt('end_at', startAt)
    .order('start_at', { ascending: true });

  if (teamIds.length > 0) query = query.in('team_id', teamIds);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).map(mapScheduleRow);
  eventsCache.set(key, { cachedAt: now, rows });
  return rows;
}

export async function listUnscheduledJobs(teamIds?: string[]): Promise<UnscheduledJobRecord[]> {
  let query = supabase
    .from('jobs')
    .select('id,title,status,team_id,client_name,property_address,lead_id,scheduled_at,total_cents')
    .is('deleted_at', null)
    .is('scheduled_at', null)
    .in('status', ['draft'])
    .order('created_at', { ascending: false });

  if (teamIds && teamIds.length > 0) query = query.in('team_id', teamIds);

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
  return mapScheduleRow(eventRow);
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
  return {
    event: mapScheduleRow((data as any)?.event),
    overlaps: Number((data as any)?.overlaps || 0),
  };
}

export async function unscheduleJob(payload: { jobId: string; eventId?: string | null }): Promise<void> {
  const { error } = await supabase.rpc('rpc_unschedule_job', {
    p_job_id: payload.jobId,
    p_event_id: payload.eventId ?? null,
  });
  if (error) throw error;
  invalidateScheduleCache();
}
