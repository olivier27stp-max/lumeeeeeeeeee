import { supabase } from '../supabase';
import { Job } from '@/types/db';
import { endOfToday, startOfToday } from '../format';
import {
  PermissionsMap,
  Scope,
  stripFinancialFields,
  TeamRole,
} from '../permissions';

/**
 * Role/scope context passed from the membership layer so the data layer can:
 *  - restrict jobs to the user's team when their scope is not company-wide
 *    (technicians = 'assigned' → only their team's jobs), and
 *  - mask financial fields (total_cents, …) for users without pricing access.
 * This is the real pricing boundary on mobile (RLS does not mask columns).
 */
export type JobAccess = {
  teamId: string | null;
  scope: Scope;
  permissions: PermissionsMap | null;
  role: TeamRole | null;
};

function maskJob(job: Job, access?: JobAccess): Job {
  if (!access) return job;
  return stripFinancialFields(job, 'jobs', access.permissions, access.role ?? undefined) as Job;
}

/** Filter a jobs query to the user's team unless they have company-wide scope. */
function applyScope<T>(query: T, access?: JobAccess): T {
  if (!access || access.scope === 'company') return query;
  // Non-company scope (technician 'assigned', 'team', 'self'): restrict to team.
  if (access.teamId) {
    return (query as any).eq('team_id', access.teamId);
  }
  // No team assigned + restricted scope → return nothing (avoid leaking org jobs).
  return (query as any).eq('team_id', '00000000-0000-0000-0000-000000000000');
}

export async function listTodaysJobs(access?: JobAccess): Promise<Job[]> {
  const start = startOfToday().toISOString();
  const end = endOfToday().toISOString();

  let query = supabase
    .from('jobs')
    .select('*')
    .is('deleted_at', null)
    .or(`scheduled_at.gte.${start},start_at.gte.${start}`)
    .or(`scheduled_at.lte.${end},start_at.lte.${end}`)
    .order('scheduled_at', { ascending: true, nullsFirst: false });

  query = applyScope(query, access);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => maskJob(j as Job, access));
}

export async function listUpcomingJobs(access?: JobAccess, limit = 50): Promise<Job[]> {
  const now = new Date().toISOString();
  let query = supabase
    .from('jobs')
    .select('*')
    .is('deleted_at', null)
    .gte('scheduled_at', now)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .limit(limit);

  query = applyScope(query, access);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => maskJob(j as Job, access));
}

export async function listJobsInRange(
  startISO: string,
  endISO: string,
  access?: JobAccess,
): Promise<Job[]> {
  let query = supabase
    .from('jobs')
    .select('*')
    .is('deleted_at', null)
    .gte('scheduled_at', startISO)
    .lte('scheduled_at', endISO)
    .order('scheduled_at', { ascending: true, nullsFirst: false });

  query = applyScope(query, access);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => maskJob(j as Job, access));
}

export async function getJob(id: string, access?: JobAccess): Promise<Job | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return maskJob(data as Job, access);
}

export interface JobInput {
  title: string;
  description?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  property_address?: string | null;
  scheduled_at?: string | null;
  team_id?: string | null;
}

export async function createJob(orgId: string, input: JobInput): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({ org_id: orgId, status: 'scheduled', ...input })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Job;
}

export async function updateJob(id: string, input: Partial<JobInput>): Promise<Job> {
  const { data, error } = await supabase
    .from('jobs')
    .update(input)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Job;
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
