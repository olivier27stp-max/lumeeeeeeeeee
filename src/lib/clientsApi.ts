import { supabase } from './supabase';

export interface ClientRecord {
  id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  street_number: string | null;
  street_name: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  place_id: string | null;
  status: string;
  notes: string | null;
  portal_token: string | null;
  org_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ClientsQuery {
  q?: string;
  status?: string;
  sort?: 'recent' | 'oldest' | 'name_asc' | 'name_desc';
  page?: number;
  pageSize?: number;
}

export interface ClientsResult {
  items: ClientRecord[];
  total: number;
}

export interface SoftDeleteClientResult {
  client: number;
  jobs: number;
  leads: number;
  pipeline_deals?: number;
  other_rows?: number;
}

export interface HardDeleteClientResult {
  client: number;
  jobs: number;
  leads: number;
  pipeline_deals: number;
  invoices: number;
  invoice_items: number;
  payments: number;
  schedule_events: number;
  job_line_items: number;
}

function buildSearchFilter(search: string): string {
  const safe = search.replace(/,/g, ' ').trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
  return [
    `first_name.ilike.%${safe}%`,
    `last_name.ilike.%${safe}%`,
    `company.ilike.%${safe}%`,
    `email.ilike.%${safe}%`,
    `phone.ilike.%${safe}%`,
    `address.ilike.%${safe}%`,
  ].join(',');
}

export async function listClients(query: ClientsQuery = {}): Promise<ClientsResult> {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const orgId = await getCurrentOrgIdOrThrow();
  let request = supabase
    .from('clients')
    .select('*', { count: 'exact' })
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .range(from, to);

  if (query.q?.trim()) request = request.or(buildSearchFilter(query.q));
  if (query.status && query.status !== 'All') request = request.eq('status', query.status);

  if (query.sort === 'oldest') request = request.order('created_at', { ascending: true });
  else if (query.sort === 'name_asc') request = request.order('last_name', { ascending: true }).order('first_name', { ascending: true });
  else if (query.sort === 'name_desc') request = request.order('last_name', { ascending: false }).order('first_name', { ascending: false });
  else request = request.order('created_at', { ascending: false });

  const { data, error, count } = await request;
  if (error) throw error;

  return {
    items: (data || []) as ClientRecord[],
    total: count || 0,
  };
}

export interface ClientPayload {
  first_name: string;
  last_name: string;
  company?: string;
  email?: string;
  phone?: string;
  address?: string;
  street_number?: string;
  street_name?: string;
  city?: string;
  province?: string;
  postal_code?: string;
  country?: string;
  latitude?: number | null;
  longitude?: number | null;
  place_id?: string;
  status?: string;
}

// Use the centralized version from orgApi instead of duplicating
import { getCurrentOrgIdOrThrow } from './orgApi';

export async function findClientsByEmail(email: string): Promise<ClientRecord[]> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return [];
  // Defense-in-depth: always scope to current org (RLS also enforces)
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .ilike('email', normalized)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as ClientRecord[];
}

export async function createClientWithDuplicateHandling(
  payload: ClientPayload,
  mode: 'add' | 'replace'
): Promise<ClientRecord> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('create_client_with_duplicate_handling', {
    p_org_id: orgId,
    p_mode: mode,
    p_payload: {
      first_name: payload.first_name?.trim() || '',
      last_name: payload.last_name?.trim() || '',
      company: payload.company?.trim() || null,
      email: payload.email?.trim() || null,
      phone: payload.phone?.trim() || null,
      address: payload.address?.trim() || null,
      street_number: payload.street_number?.trim() || null,
      street_name: payload.street_name?.trim() || null,
      city: payload.city?.trim() || null,
      province: payload.province?.trim() || null,
      postal_code: payload.postal_code?.trim() || null,
      country: payload.country?.trim() || null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      place_id: payload.place_id?.trim() || null,
      status: payload.status || 'active',
    },
    p_merge_duplicates: true,
  });
  if (error) throw error;
  return data as unknown as ClientRecord;
}

export async function createClient(payload: ClientPayload): Promise<ClientRecord> {
  return createClientWithDuplicateHandling(payload, 'add');
}

export async function updateClient(id: string, payload: Partial<ClientPayload>): Promise<ClientRecord> {
  const updatePayload: Record<string, any> = {};
  if (payload.first_name !== undefined) updatePayload.first_name = payload.first_name.trim();
  if (payload.last_name !== undefined) updatePayload.last_name = payload.last_name.trim();
  if (payload.company !== undefined) updatePayload.company = payload.company?.trim() || null;
  if (payload.email !== undefined) updatePayload.email = payload.email?.trim() || null;
  if (payload.phone !== undefined) updatePayload.phone = payload.phone?.trim() || null;
  if (payload.address !== undefined) updatePayload.address = payload.address?.trim() || null;
  if (payload.street_number !== undefined) updatePayload.street_number = payload.street_number?.trim() || null;
  if (payload.street_name !== undefined) updatePayload.street_name = payload.street_name?.trim() || null;
  if (payload.city !== undefined) updatePayload.city = payload.city?.trim() || null;
  if (payload.province !== undefined) updatePayload.province = payload.province?.trim() || null;
  if (payload.postal_code !== undefined) updatePayload.postal_code = payload.postal_code?.trim() || null;
  if (payload.country !== undefined) updatePayload.country = payload.country?.trim() || null;
  if (payload.latitude !== undefined) updatePayload.latitude = payload.latitude;
  if (payload.longitude !== undefined) updatePayload.longitude = payload.longitude;
  if (payload.place_id !== undefined) updatePayload.place_id = payload.place_id?.trim() || null;
  if (payload.status !== undefined) updatePayload.status = payload.status;

  // Support optimistic locking if version provided in payload
  const expectedVersion = (payload as any).version;
  let query = supabase.from('clients').update(updatePayload).eq('id', id);
  if (expectedVersion != null) query = query.eq('version', expectedVersion);
  const { data, error } = await query.select('*').single();
  if (error?.code === 'PGRST116' && expectedVersion != null) {
    throw new Error('This client was modified by another user. Please refresh and try again.');
  }
  if (error) throw error;
  return data as ClientRecord;
}

export async function softDeleteClient(id: string): Promise<SoftDeleteClientResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('You need to be authenticated for this action.');

  const response = await fetch('/api/clients/soft-delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: id }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Failed to delete client (${response.status}).`);

  return {
    client: Number(payload.client || 0),
    jobs: Number(payload.jobs || 0),
    leads: Number(payload.leads || 0),
    pipeline_deals: Number(payload.pipeline_deals || 0),
    other_rows: Number(payload.other_rows || 0),
  };
}

export async function hardDeleteClient(id: string): Promise<HardDeleteClientResult> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('delete_client_cascade', {
    p_org_id: orgId,
    p_client_id: id,
    p_deleted_by: null,
  });
  if (error) throw error;
  return {
    client: Number((data as any)?.client || 0),
    jobs: Number((data as any)?.jobs || 0),
    leads: Number((data as any)?.leads || 0),
    pipeline_deals: Number((data as any)?.pipeline_deals || 0),
    invoices: Number((data as any)?.invoices || 0),
    invoice_items: Number((data as any)?.invoice_items || 0),
    payments: Number((data as any)?.payments || 0),
    schedule_events: Number((data as any)?.schedule_events || 0),
    job_line_items: Number((data as any)?.job_line_items || 0),
  };
}

export async function listClientJobs(clientId: string) {
  const { data, error } = await supabase
    .from('jobs_active')
    .select('*')
    .eq('client_id', clientId)
    .order('scheduled_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

export async function getClientById(clientId: string): Promise<ClientRecord | null> {
  const { data, error } = await supabase.from('clients').select('*').is('deleted_at', null).eq('id', clientId).maybeSingle();
  if (error) throw error;
  return (data as ClientRecord | null) || null;
}

/** Find other clients sharing the same Google place_id (for duplicate address warning). */
export async function findClientsByPlaceId(placeId: string, excludeClientId?: string): Promise<ClientRecord[]> {
  if (!placeId) return [];
  let query = supabase
    .from('clients')
    .select('*')
    .is('deleted_at', null)
    .eq('place_id', placeId)
    .order('created_at', { ascending: true });
  if (excludeClientId) query = query.neq('id', excludeClientId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ClientRecord[];
}
