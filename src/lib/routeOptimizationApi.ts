import { supabase } from './supabase';

export interface OptimizedStop {
  job_id: string;
  order: number;
  distance_km_from_prev: number;
  eta_minutes_from_prev: number;
  estimated_arrival_time: string;
  title: string | null;
  address: string | null;
  lat: number;
  lng: number;
  duration_minutes: number;
}

export interface OptimizeResponse {
  ok: true;
  algorithm: 'nearest-neighbor';
  provider: 'haversine' | 'google';
  ordered_jobs: OptimizedStop[];
  total_distance_km: number;
  total_drive_minutes: number;
  return_leg: { distance_km: number; drive_minutes: number } | null;
  skipped: { job_id: string; reason: string }[];
  notes?: string;
}

export interface OptimizeRequest {
  job_ids: string[];
  start_location?: { lat?: number; lng?: number; address?: string };
  end_location?: { lat?: number; lng?: number; address?: string };
  depart_at?: string; // ISO
}

export async function optimizeRoute(req: OptimizeRequest): Promise<OptimizeResponse> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Not authenticated.');

  const res = await fetch('/api/route-optimization/optimize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || 'Route optimization failed.');
  return payload as OptimizeResponse;
}

/**
 * Reschedule a list of jobs to a sequential time window starting at
 * `dayStart`, preserving each job's existing duration and inserting drive
 * time between them. Uses individual UPDATE calls — fine for ≤30 jobs.
 */
export async function applyOptimizedSchedule(
  stops: OptimizedStop[],
  dayStart: Date,
): Promise<{ updated: number }> {
  let clock = new Date(dayStart).getTime();
  let updated = 0;

  for (const s of stops) {
    // Drive time before this stop.
    clock += s.eta_minutes_from_prev * 60 * 1000;
    const startIso = new Date(clock).toISOString();
    const endIso = new Date(clock + s.duration_minutes * 60 * 1000).toISOString();

    const { error: jobErr } = await supabase
      .from('jobs')
      .update({ scheduled_at: startIso, end_at: endIso })
      .eq('id', s.job_id);
    if (jobErr) throw jobErr;

    // Best-effort: update any open schedule_event rows for this job.
    await supabase
      .from('schedule_events')
      .update({ start_at: startIso, end_at: endIso })
      .eq('job_id', s.job_id)
      .is('deleted_at', null);

    clock += s.duration_minutes * 60 * 1000;
    updated++;
  }
  return { updated };
}
