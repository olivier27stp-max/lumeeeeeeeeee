// Calendar data — 1:1 port of the web src/lib/scheduleApi.ts (main).
// Same schedule_events model (multiple visits per job), same two-step read
// (events then jobs — avoids the PostgREST JOIN + RLS "id ambiguous"), same
// RPCs (rpc_reschedule_event / rpc_schedule_job) and the same authed server
// route for team assignment. Callers pass orgId explicitly (usePermissions)
// instead of the web's getCurrentOrgIdOrThrow.

import { supabase } from '../supabase';

import { serverPost } from './server';

export const DEFAULT_TIMEZONE = 'America/Toronto';

export const FALLBACK_TEAM_COLOR = '#6B7280';

export function isHexColor(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

/** '#RRGGBB' → 'rgba(r,g,b,a)' — same helper the web uses for event cards. */
export function toRgba(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(107,114,128,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export interface ScheduleJobRef {
  id: string;
  title: string;
  status: string;
  client_id: string | null;
  client_name: string | null;
  property_address: string | null;
  team_id: string | null;
  latitude: number | null;
  longitude: number | null;
  total_cents: number | null;
}

export interface ScheduleEventRecord {
  id: string;
  job_id: string;
  team_id: string | null;
  start_at: string;
  end_at: string;
  status: string | null;
  notes: string | null;
  job: ScheduleJobRef | null;
}

export interface UnscheduledJobRecord {
  id: string;
  title: string;
  status: string;
  team_id: string | null;
  client_name: string | null;
  property_address: string | null;
  total_cents: number | null;
}

function mapScheduleRow(row: any): ScheduleEventRecord {
  return {
    id: row.id,
    job_id: row.job_id,
    team_id: row.team_id ?? row.job?.team_id ?? null,
    start_at: row.start_at,
    end_at: row.end_at,
    status: row.status ?? null,
    notes: row.notes ?? null,
    job: row.job
      ? {
          id: row.job.id,
          title: row.job.title,
          status: row.job.status,
          client_id: row.job.client_id ?? null,
          client_name: row.job.client_name ?? null,
          property_address: row.job.property_address ?? null,
          team_id: row.job.team_id ?? null,
          latitude: row.job.latitude == null ? null : Number(row.job.latitude),
          longitude: row.job.longitude == null ? null : Number(row.job.longitude),
          total_cents: row.job.total_cents == null ? null : Number(row.job.total_cents),
        }
      : null,
  };
}

const JOB_COLS =
  'id,title,status,client_id,client_name,property_address,team_id,latitude,longitude,total_cents,deleted_at';

async function attachJobs(eventRows: any[]): Promise<any[]> {
  const jobIds = [...new Set(eventRows.map((r: any) => r.job_id).filter(Boolean))];
  const jobMap: Record<string, any> = {};
  if (jobIds.length > 0) {
    const { data: jobs } = await supabase.from('jobs').select(JOB_COLS).in('id', jobIds);
    for (const j of jobs || []) jobMap[j.id] = j;
  }
  return eventRows.map((row: any) => ({ ...row, job: jobMap[row.job_id] || null }));
}

export async function listScheduleEventsRange(params: {
  orgId: string;
  startAt: string;
  endAt: string;
  teamIds?: string[];
}): Promise<ScheduleEventRecord[]> {
  const teamIds = params.teamIds || [];
  let query = supabase
    .from('schedule_events')
    .select('id,job_id,team_id,start_at,end_at,status,notes')
    .eq('org_id', params.orgId)
    .is('deleted_at', null)
    .lt('start_at', params.endAt)
    .gt('end_at', params.startAt)
    .order('start_at', { ascending: true });

  // When specific teams are selected, include events matching by
  // schedule_events.team_id OR the linked job's team_id, plus NULL team_id
  // (unassigned) so those never disappear. Same contract as the web.
  if (teamIds.length > 0) {
    const teamFilter = teamIds.map((id) => `"${id}"`).join(',');
    query = query.or(`team_id.in.(${teamFilter}),team_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Dédup par id: le `.or(...)` peut matcher une même ligne deux fois.
  const seen = new Set<string>();
  const eventRows = (data || []).filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  if (eventRows.length === 0) return [];

  const merged = await attachJobs(eventRows);

  let activeRows = merged.filter((row: any) => !(row.job && row.job.deleted_at));
  if (teamIds.length > 0) {
    activeRows = activeRows.filter((row: any) => {
      if (row.team_id && teamIds.includes(row.team_id)) return true;
      if (!row.team_id && row.job?.team_id && teamIds.includes(row.job.team_id)) return true;
      if (!row.team_id && !row.job?.team_id) return true; // truly unassigned: show everywhere
      return false;
    });
  }
  return activeRows.map(mapScheduleRow);
}

/** Scheduled events where neither the event nor the job has a team. */
export async function listUnassignedScheduledEvents(params: {
  orgId: string;
  startAt: string;
  endAt: string;
}): Promise<ScheduleEventRecord[]> {
  const { data, error } = await supabase
    .from('schedule_events')
    .select('id,job_id,team_id,start_at,end_at,status,notes')
    .eq('org_id', params.orgId)
    .is('deleted_at', null)
    .is('team_id', null)
    .lt('start_at', params.endAt)
    .gt('end_at', params.startAt)
    .order('start_at', { ascending: true });
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const merged = await attachJobs(data);
  return merged
    .filter((row: any) => !(row.job && row.job.deleted_at) && !row.job?.team_id)
    .map(mapScheduleRow);
}

export async function listUnscheduledJobs(orgId: string, teamIds?: string[]): Promise<UnscheduledJobRecord[]> {
  let query = supabase
    .from('jobs')
    .select('id,title,status,team_id,client_name,property_address,total_cents')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .is('scheduled_at', null)
    .in('status', ['draft', 'Draft'])
    .order('created_at', { ascending: false });

  if (teamIds && teamIds.length > 0) {
    const teamFilter = teamIds.map((id) => `"${id}"`).join(',');
    query = query.or(`team_id.in.(${teamFilter}),team_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    team_id: row.team_id ?? null,
    client_name: row.client_name ?? null,
    property_address: row.property_address ?? null,
    total_cents: row.total_cents == null ? null : Number(row.total_cents),
  }));
}

export async function listUnassignedUnscheduledJobs(orgId: string): Promise<UnscheduledJobRecord[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('id,title,status,team_id,client_name,property_address,total_cents')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .is('scheduled_at', null)
    .is('team_id', null)
    .in('status', ['draft', 'Draft'])
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row: any) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    team_id: null,
    client_name: row.client_name ?? null,
    property_address: row.property_address ?? null,
    total_cents: row.total_cents == null ? null : Number(row.total_cents),
  }));
}

/**
 * Move/resize a visit. rpc_reschedule_event recomputes jobs.scheduled_at from
 * the visit set server-side (next upcoming visit) — no client-side sync needed.
 * Returns the server-computed overlap count for the warning toast.
 */
export async function rescheduleEvent(payload: {
  eventId: string;
  startAt: string;
  endAt: string;
  teamId?: string | null;
}): Promise<{ event: ScheduleEventRecord; overlaps: number }> {
  const { data, error } = await supabase.rpc('rpc_reschedule_event', {
    p_event_id: payload.eventId,
    p_start_at: payload.startAt,
    p_end_at: payload.endAt,
    p_team_id: payload.teamId ?? null,
    p_timezone: DEFAULT_TIMEZONE,
  });
  if (error) throw new Error(error.message);
  return {
    event: mapScheduleRow((data as any)?.event),
    overlaps: Number((data as any)?.overlaps || 0),
  };
}

/** Schedule a draft job's first visit (upsert semantics server-side). */
export async function scheduleUnscheduledJob(payload: {
  jobId: string;
  teamId?: string | null;
  startAt: string;
  endAt: string;
}): Promise<ScheduleEventRecord> {
  const { data, error } = await supabase.rpc('rpc_schedule_job', {
    p_job_id: payload.jobId,
    p_start_at: payload.startAt,
    p_end_at: payload.endAt,
    p_team_id: payload.teamId ?? null,
    p_timezone: DEFAULT_TIMEZONE,
  });
  if (error) throw new Error(error.message);
  return mapScheduleRow((data as any)?.event || data);
}

/** Assign a job to a team via the same authed server route as the web (bypasses RLS). */
export async function assignJobToTeam(jobId: string, teamId: string): Promise<void> {
  await serverPost('/jobs/assign-team', { jobId, teamId });
}
