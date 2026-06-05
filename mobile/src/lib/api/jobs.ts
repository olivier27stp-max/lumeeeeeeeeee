import { supabase } from '../supabase';
import { Job } from '@/types/db';
import { endOfToday, startOfToday } from '../format';

export async function listTodaysJobs(): Promise<Job[]> {
  const start = startOfToday().toISOString();
  const end = endOfToday().toISOString();

  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .is('deleted_at', null)
    .or(`scheduled_at.gte.${start},start_at.gte.${start}`)
    .or(`scheduled_at.lte.${end},start_at.lte.${end}`)
    .order('scheduled_at', { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as Job[];
}

export async function listUpcomingJobs(limit = 50): Promise<Job[]> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .is('deleted_at', null)
    .gte('scheduled_at', now)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as Job[];
}

export async function getJob(id: string): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as Job | null) ?? null;
}

export async function markJobInProgress(id: string): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update({
      status: 'in_progress',
      start_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as Job;
}

export async function markJobCompleted(id: string, notes?: string): Promise<Job> {
  const completedAt = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: 'completed',
    completed_at: completedAt,
    end_at: completedAt,
  };
  if (notes && notes.trim().length > 0) update.notes = notes.trim();

  const { data, error } = await supabase
    .from('jobs')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(error.message);
  return data as Job;
}
