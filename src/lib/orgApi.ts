import { supabase } from './supabase';

export async function getCurrentOrgId(): Promise<string | null> {
  const { data, error } = await supabase.rpc('current_org_id');
  if (error) throw error;
  return (data as string | null) || null;
}

export async function getCurrentOrgIdOrThrow(): Promise<string> {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error('No organization context found. Please refresh.');
  return orgId;
}
