import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import { emitAppointmentCreated, emitAppointmentCancelled, emitAppointmentRescheduled } from './automationEventsApi';

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
  tag_ids?: string[] | null;
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

// ── Visites « N'importe quand » ─────────────────────────────────────────────
// Convention de stockage (aucune colonne dédiée) : une visite sans heures
// précises couvre sa journée entière, 00:00 → 23:59 heure locale. Le tri,
// recompute_job_schedule et les vues dispatch fonctionnent sans changement;
// seul l'affichage remplace la plage horaire par « N'importe quand ».
export const ANYTIME_START_TIME = '00:00';
export const ANYTIME_END_TIME = '23:59';

export function isAnytimeVisit(startAt?: string | null, endAt?: string | null): boolean {
  if (!startAt || !endAt) return false;
  const s = new Date(startAt);
  const e = new Date(endAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return false;
  return s.getHours() === 0 && s.getMinutes() === 0 && e.getHours() === 23 && e.getMinutes() === 59;
}

export function anytimeLabel(fr: boolean): string {
  return fr ? "Pas d'heure précise" : 'No set time';
}

/** Visite « fermée » : complétée/annulée, ou dont le job est fermé — les
 * cartes du calendrier l'affichent barrée. */
export function isClosedVisit(ev: Pick<ScheduleEventRecord, 'status' | 'job'>): boolean {
  const vs = (ev.status || '').toLowerCase();
  const js = (ev.job?.status || '').toLowerCase();
  return ['completed', 'cancelled', 'canceled'].includes(vs)
    || ['completed', 'cancelled', 'canceled', 'archived'].includes(js);
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
    // team_id NULL = visite explicitement non assignée. Aucun fallback sur
    // jobs.team_id : chaque visite porte sa propre équipe (rpc_add_visit /
    // rpc_schedule_job l'estampillent à la création), sinon la désassignation
    // par visite rebondirait visuellement sur l'équipe du job.
    team_id: row.team_id ?? null,
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
          job_number: row.job.job_number == null ? null : String(row.job.job_number),
          tag_ids: Array.isArray(row.job.tag_ids) ? row.job.tag_ids : null,
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

  // Dédup par id: le `.or(team_id.in..,team_id.is.null)` ci-dessus peut faire
  // matcher une même ligne par deux branches → doublons. Non dédupliqués, ils
  // rendent deux cartes avec la même key React (texte superposé/dédoublé).
  const seenIds = new Set<string>();
  const eventRows = (data || []).filter((r: any) => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true)));
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
      .select('id,title,status,client_id,client_name,property_address,lead_id,team_id,latitude,longitude,geocode_status,total_cents,job_number,tag_ids,deleted_at')
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
  // Secondary team filter: unassigned visits (NULL team_id) show everywhere.
  if (teamIds.length > 0) {
    activeRows = activeRows.filter((row: any) => !row.team_id || teamIds.includes(row.team_id));
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
  /** Désassigner la visite : le RPC coalesce p_team_id (null = « garder »),
   * donc la désassignation passe par un update direct après le déplacement. */
  clearTeam?: boolean;
  timezone?: string | null;
}): Promise<{ event: ScheduleEventRecord; overlaps: number }> {
  const { data, error } = await supabase.rpc('rpc_reschedule_event', {
    p_event_id: payload.eventId,
    p_start_at: toIsoOrThrow(payload.startAt),
    p_end_at: toIsoOrThrow(payload.endAt),
    p_team_id: payload.clearTeam ? null : (payload.teamId ?? null),
    p_timezone: payload.timezone ?? DEFAULT_TIMEZONE,
  });
  if (error) throw error;

  const eventRow = (data as any)?.event || {};
  if (payload.clearTeam && eventRow.team_id != null) {
    const { error: clearErr } = await supabase
      .from('schedule_events')
      .update({ team_id: null, updated_at: new Date().toISOString() })
      .eq('id', payload.eventId);
    if (clearErr) throw clearErr;
    eventRow.team_id = null;
  }
  invalidateScheduleCache();

  // rpc_reschedule_event recomputes jobs.scheduled_at from the visit set
  // server-side (next upcoming visit), so no client-side sync is needed —
  // important now that a job can have several visits.

  // Replanifie les rappels sur la NOUVELLE date (non bloquant).
  //
  // Les rappels sont planifiés à partir de la date du rendez-vous
  // (`execute_at = start_time − délai`). Sans cette émission, déplacer une
  // visite laisse les tâches déjà en attente calées sur l'ANCIENNE date :
  // le serveur annule les tâches périmées puis les replanifie, mais il faut
  // encore le prévenir. Bug déjà constaté en prod — un rappel « 2 h avant »
  // parti 22 h APRÈS la visite.
  const mapped = mapScheduleRow(eventRow);
  emitAppointmentRescheduled({
    eventId: payload.eventId,
    jobId: mapped.job_id ?? undefined,
    startTime: payload.startAt,
  });

  return {
    event: mapped,
    overlaps: Number((data as any)?.overlaps || 0),
  };
}

/** All active visits (schedule_events) of a job, earliest first. */
export async function listJobVisits(jobId: string): Promise<ScheduleEventRecord[]> {
  const { data, error } = await supabase
    .from('schedule_events')
    .select('id,job_id,team_id,start_at,end_at,timezone,status,notes,deleted_at')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('start_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapScheduleRow);
}

/**
 * Add an ADDITIONAL visit to a job. Unlike scheduleUnscheduledJob (which upserts
 * the job's first visit), this always inserts a new schedule_event so a single
 * job can hold multiple visits. The server recomputes jobs.scheduled_at to the
 * next upcoming visit.
 */
export async function addVisit(payload: {
  jobId: string;
  startAt: string;
  endAt: string;
  teamId?: string | null;
  timezone?: string | null;
  notes?: string | null;
}): Promise<{ event: ScheduleEventRecord; overlaps: number }> {
  const { data, error } = await supabase.rpc('rpc_add_visit', {
    p_job_id: payload.jobId,
    p_start_at: toIsoOrThrow(payload.startAt),
    p_end_at: toIsoOrThrow(payload.endAt),
    p_team_id: payload.teamId ?? null,
    p_timezone: payload.timezone ?? DEFAULT_TIMEZONE,
    p_notes: payload.notes ?? null,
  });
  if (error) throw error;
  invalidateScheduleCache();

  const event = mapScheduleRow((data as any)?.event);

  // Fire automation hook (non-blocking)
  emitAppointmentCreated({
    eventId: event.id,
    jobId: payload.jobId,
    startTime: payload.startAt,
  });

  return {
    event,
    overlaps: Number((data as any)?.overlaps || 0),
  };
}

/** Fetch all scheduled events without a team (schedule_events.team_id IS NULL). */
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
      .select('id,title,status,client_id,client_name,property_address,lead_id,team_id,latitude,longitude,geocode_status,total_cents,job_number,tag_ids,deleted_at')
      .in('id', jobIds);
    for (const j of jobs || []) {
      jobMap[j.id] = j;
    }
  }

  return eventRows
    .map((row: any) => ({ ...row, job: jobMap[row.job_id] || null }))
    .filter((row: any) => !(row.job && row.job.deleted_at))
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
