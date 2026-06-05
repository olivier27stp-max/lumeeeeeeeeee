import { supabase } from '../supabase';
import { ClientRecord } from '@/types/db';

export async function listClients(search?: string, limit = 50): Promise<ClientRecord[]> {
  let q = supabase
    .from('clients')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (search && search.trim().length > 0) {
    const term = search.trim();
    q = q.or(
      `first_name.ilike.%${term}%,last_name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%`,
    );
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientRecord[];
}

export async function getClient(id: string): Promise<ClientRecord | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ClientRecord | null) ?? null;
}
