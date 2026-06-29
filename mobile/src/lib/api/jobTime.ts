// Per-job time tracking (a tech can time the work on a specific job, separate
// from the shift clock). Stored in `job_time_logs` (run the SQL below once).
//
//   create table if not exists public.job_time_logs (
//     id uuid primary key default gen_random_uuid(),
//     org_id uuid not null,
//     job_id uuid not null,
//     user_id uuid not null,
//     started_at timestamptz not null default now(),
//     ended_at timestamptz,
//     seconds integer,
//     created_at timestamptz not null default now()
//   );
//   alter table public.job_time_logs enable row level security;
//   create policy job_time_logs_all on public.job_time_logs for all
//     using  (org_id in (select org_id from public.memberships where user_id = auth.uid()))
//     with check (org_id in (select org_id from public.memberships where user_id = auth.uid()));

import { supabase } from '../supabase';

export interface JobTimeState {
  totalSeconds: number; // sum of finished sessions (everyone)
  activeStartedAt: string | null; // this user's running timer, if any
}

/** Reads gracefully — returns zero if the table doesn't exist yet. */
export async function getJobTime(jobId: string, userId: string): Promise<JobTimeState> {
  const { data, error } = await supabase
    .from('job_time_logs')
    .select('user_id, started_at, ended_at, seconds')
    .eq('job_id', jobId);
  if (error) return { totalSeconds: 0, activeStartedAt: null };

  let totalSeconds = 0;
  let activeStartedAt: string | null = null;
  for (const r of (data ?? []) as any[]) {
    if (r.ended_at) {
      totalSeconds +=
        r.seconds ?? Math.max(0, Math.floor((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000));
    } else if (r.user_id === userId) {
      activeStartedAt = r.started_at;
    }
  }
  return { totalSeconds, activeStartedAt };
}

export async function startJobTimer(orgId: string, jobId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('job_time_logs')
    .insert({ org_id: orgId, job_id: jobId, user_id: userId, started_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function stopJobTimer(jobId: string, userId: string): Promise<void> {
  const { data } = await supabase
    .from('job_time_logs')
    .select('id, started_at')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.id) return;
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(data.started_at).getTime()) / 1000));
  const { error } = await supabase
    .from('job_time_logs')
    .update({ ended_at: new Date().toISOString(), seconds })
    .eq('id', data.id);
  if (error) throw new Error(error.message);
}
