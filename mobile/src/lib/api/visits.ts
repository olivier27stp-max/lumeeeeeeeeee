// Multiple visits per job. A job can have several schedule_events (e.g. a
// multi-day install or a return visit). Reuses the schedule_events table that
// createJob already writes to. Any org member can read/write (RLS).

import { supabase } from '../supabase';

export interface JobVisit {
  id: string;
  start_at: string;
  end_at: string | null;
  status: string | null;
}

export async function listJobVisits(jobId: string): Promise<JobVisit[]> {
  const { data, error } = await supabase
    .from('schedule_events')
    .select('id, start_at, end_at, start_time, end_time, status')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('start_time', { ascending: true });
  if (error) return [];
  return (data ?? []).map((r: any) => ({
    id: r.id,
    start_at: r.start_at ?? r.start_time,
    end_at: r.end_at ?? r.end_time ?? null,
    status: r.status ?? null,
  }));
}

export async function addJobVisit(input: {
  orgId: string;
  jobId: string;
  teamId?: string | null;
  startISO: string;
  endISO: string;
}): Promise<void> {
  const { error } = await supabase.from('schedule_events').insert({
    org_id: input.orgId,
    job_id: input.jobId,
    team_id: input.teamId ?? null,
    start_at: input.startISO,
    end_at: input.endISO,
    start_time: input.startISO,
    end_time: input.endISO,
    status: 'scheduled',
  });
  if (error) throw new Error(error.message);
}

export async function deleteJobVisit(id: string): Promise<void> {
  const { error } = await supabase
    .from('schedule_events')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
