import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export type MapDateRange = 'today' | 'tomorrow' | 'this_week' | 'all';

/**
 * Resolve the client id to open from a job pin. The map denormalizes
 * client_name onto the job, but the id can live in several places:
 *   1. pin.clientId (client_id ?? lead_id from the map query)
 *   2. a fresh read of the job row (in case the embed lacked the columns)
 *   3. a single client whose display name matches pin.clientName (last resort)
 * Returns null when the job has no resolvable client record.
 */
export async function resolveClientIdForPin(pin: {
  clientId: string | null;
  jobId: string;
  clientName: string | null;
}): Promise<string | null> {
  if (pin.clientId) return pin.clientId;

  const { data: job } = await supabase
    .from('jobs')
    .select('client_id, lead_id')
    .eq('id', pin.jobId)
    .maybeSingle();
  if (job?.client_id) return job.client_id as string;
  if (job?.lead_id) return job.lead_id as string;

  const name = (pin.clientName || '').replace(/[(),*%]/g, ' ').trim();
  if (name) {
    const orgId = await getCurrentOrgIdOrThrow();
    const lastToken = name.split(/\s+/).pop() || name;
    const { data: matches } = await supabase
      .from('clients')
      .select('id, first_name, last_name, company')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .or(`company.ilike.%${name}%,last_name.ilike.%${lastToken}%`)
      .limit(20);
    if (matches && matches.length) {
      const target = (pin.clientName || '').trim();
      const exact = matches.find((c: any) => {
        const full = `${c.first_name || ''} ${c.last_name || ''}`.trim();
        return full === target || (c.company || '').trim() === target;
      });
      if (exact) return exact.id as string;
      if (matches.length === 1) return matches[0].id as string;
    }
  }
  return null;
}

export interface MapJobPin {
  id: string;
  jobId: string;
  clientId: string | null;
  jobNumber: string;
  title: string;
  clientName: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  scheduledAt: string | null;
  endAt: string | null;
  status: string;
  teamColor: string | null;
  teamName: string | null;
  totalCents: number;
}

function getDateBounds(range: MapDateRange): { start: string | null; end: string | null } {
  const now = new Date();

  if (range === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (range === 'tomorrow') {
    const start = new Date(now);
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (range === 'this_week') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  return { start: null, end: null };
}

export interface MapJobResult {
  pins: MapJobPin[];
  totalEvents: number;
  missingLocationCount: number;
}

function hasValidCoords(e: any): boolean {
  const lat = e.job?.latitude;
  const lng = e.job?.longitude;
  if (lat == null || lng == null) return false;
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) return false;
  // Reject (0, 0) — default/unset placeholder, not a real job location
  if (numLat === 0 && numLng === 0) return false;
  return true;
}

export async function fetchMapJobs(range: MapDateRange): Promise<MapJobResult> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { start, end } = getDateBounds(range);

  let query = supabase
    .from('schedule_events')
    .select(
      `
      id, start_at, end_at, status, team_id,
      team:teams!schedule_events_team_id_fkey(name, color_hex),
      job:jobs!schedule_events_job_id_fkey(id, client_id, lead_id, job_number, title, client_name, property_address, status, total_cents, latitude, longitude)
      `
    )
    .eq('org_id', orgId)
    .is('deleted_at', null);

  if (start) query = query.gte('start_at', start);
  if (end) query = query.lte('start_at', end);

  query = query.order('start_at', { ascending: true });

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []) as any[];
  const withCoords = rows.filter(hasValidCoords);

  const pins: MapJobPin[] = withCoords.map((event) => ({
    id: event.id,
    jobId: event.job?.id || event.id,
    clientId: event.job?.client_id || event.job?.lead_id || null,
    jobNumber: event.job?.job_number || '',
    title: event.job?.title || 'Untitled',
    clientName: event.job?.client_name || null,
    address: event.job?.property_address || null,
    latitude: Number(event.job.latitude),
    longitude: Number(event.job.longitude),
    scheduledAt: event.start_at,
    endAt: event.end_at,
    status: event.job?.status || event.status || 'Scheduled',
    teamColor: event.team?.color_hex || null,
    teamName: event.team?.name || null,
    totalCents: event.job?.total_cents || 0,
  }));

  return {
    pins,
    totalEvents: rows.length,
    missingLocationCount: rows.length - withCoords.length,
  };
}

/**
 * Same shape as fetchMapJobs but for an explicit [start, end) window — used by
 * the calendar "Map" button so the pins match the period currently shown
 * (day / week / month). `end` is treated as exclusive (matches buildRange()).
 */
export async function fetchMapJobsInRange(startISO: string, endISO: string): Promise<MapJobResult> {
  const orgId = await getCurrentOrgIdOrThrow();

  const { data, error } = await supabase
    .from('schedule_events')
    .select(
      `
      id, start_at, end_at, status, team_id,
      team:teams!schedule_events_team_id_fkey(name, color_hex),
      job:jobs!schedule_events_job_id_fkey(id, client_id, lead_id, job_number, title, client_name, property_address, status, total_cents, latitude, longitude)
      `
    )
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('start_at', startISO)
    .lt('start_at', endISO)
    .order('start_at', { ascending: true });

  if (error) throw error;

  const rows = (data || []) as any[];
  const withCoords = rows.filter(hasValidCoords);

  const pins: MapJobPin[] = withCoords.map((event) => ({
    id: event.id,
    jobId: event.job?.id || event.id,
    clientId: event.job?.client_id || event.job?.lead_id || null,
    jobNumber: event.job?.job_number || '',
    title: event.job?.title || 'Untitled',
    clientName: event.job?.client_name || null,
    address: event.job?.property_address || null,
    latitude: Number(event.job.latitude),
    longitude: Number(event.job.longitude),
    scheduledAt: event.start_at,
    endAt: event.end_at,
    status: event.job?.status || event.status || 'Scheduled',
    teamColor: event.team?.color_hex || null,
    teamName: event.team?.name || null,
    totalCents: event.job?.total_cents || 0,
  }));

  return {
    pins,
    totalEvents: rows.length,
    missingLocationCount: rows.length - withCoords.length,
  };
}
