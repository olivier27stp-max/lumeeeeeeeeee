import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export type MapDateRange = 'today' | 'tomorrow' | 'this_week' | 'all';

export interface MapJobPin {
  id: string;
  jobId: string;
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
      job:jobs!schedule_events_job_id_fkey(id, job_number, title, client_name, property_address, status, total_cents, latitude, longitude)
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
