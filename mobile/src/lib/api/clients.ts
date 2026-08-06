import { supabase } from '../supabase';
import { ClientRecord } from '@/types/db';
import { createNotification } from './notifications';

export async function listClients(search?: string, limit = 50): Promise<ClientRecord[]> {
  let q = supabase
    .from('clients')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (search && search.trim().length > 0) {
    // In a PostgREST .or() filter the wildcard is `*`, not `%` — using `%` here
    // matches the literal characters and returns nothing (this broke search).
    const term = search.trim().replace(/[,()*]/g, ' ');
    q = q.or(
      `first_name.ilike.*${term}*,last_name.ilike.*${term}*,company.ilike.*${term}*,email.ilike.*${term}*`,
    );
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientRecord[];
}

/** Phone numbers for a set of clients, keyed by client id (for job action rows). */
export async function listClientPhones(ids: string[]): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data, error } = await supabase.from('clients').select('id, phone').in('id', unique);
  if (error) throw new Error(error.message);
  const map: Record<string, string | null> = {};
  for (const r of data ?? []) map[r.id as string] = (r.phone as string | null) ?? null;
  return map;
}

export interface ClientInput {
  first_name?: string;
  last_name?: string;
  company?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  country?: string;
  /** Needed by the map and route optimization — a client without them is invisible there. */
  latitude?: number | null;
  longitude?: number | null;
  notes?: string;
}

export async function createClient(orgId: string, input: ClientInput): Promise<ClientRecord> {
  const { data, error } = await supabase
    .from('clients')
    .insert({
      org_id: orgId,
      ...input,
      // first_name / last_name are NOT NULL in the DB.
      first_name: input.first_name ?? '',
      last_name: input.last_name ?? '',
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  const created = data as ClientRecord;
  const name = `${created.first_name ?? ''} ${created.last_name ?? ''}`.trim() || 'Client';
  createNotification({
    orgId,
    title: `Nouveau client : ${name}`,
    category: 'new_client',
    type: 'success',
    entityType: 'client',
    entityId: created.id,
  });
  return created;
}

export async function updateClient(id: string, input: ClientInput): Promise<ClientRecord> {
  const { data, error } = await supabase
    .from('clients')
    .update(input)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ClientRecord;
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
