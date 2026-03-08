import { supabase } from './supabase';

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
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  return { start: null, end: null };
}

async function getCurrentOrgId(): Promise<string> {
  const { data, error } = await supabase.rpc('current_org_id');
  if (error) throw new Error('Failed to resolve organization context.');
  const orgId = (data as string | null) || null;
  if (!orgId) throw new Error('No organization context found.');
  return orgId;
}

export async function fetchMapJobs(range: MapDateRange): Promise<MapJobPin[]> {
  const orgId = await getCurrentOrgId();
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

  return ((data || []) as any[])
    .filter((e) => {
      const lat = e.job?.latitude;
      const lng = e.job?.longitude;
      return lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
    })
    .map((event) => ({
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
}
