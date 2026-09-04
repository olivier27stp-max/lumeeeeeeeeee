import { supabase } from './supabase';
import { erreurLisible } from './erreursBase';

/** One phone number with its label (New Client form). */
export interface ClientPhone {
  number: string;
  label: 'work' | 'mobile' | 'home' | 'fax' | 'other';
}

export interface ClientRecord {
  id: string;
  /** Numéro séquentiel par org (trigger DB) — absent tant que la migration n'est pas appliquée. */
  client_number?: string | null;
  /** Exonéré de taxes (gouvernements, Premières Nations, OSBL…) — absent tant que la migration n'est pas appliquée. */
  tax_exempt?: boolean;
  first_name: string;
  last_name: string;
  company: string | null;
  email: string | null;
  email_label: string | null;
  phone: string | null;
  phones: ClientPhone[] | null;
  lead_source: string | null;
  tax_ids: string[] | null;
  address: string | null;
  billing_same_as_service: boolean;
  billing_address: string | null;
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
  display_as_company: boolean;
  notes: string | null;
  portal_token: string | null;
  last_client_activity_at: string | null;
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

/** Strip diacritics so searching "belanger" still matches "Bélanger". */
function stripAccents(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function buildSearchFilter(search: string): string {
  const cleaned = search.replace(/,/g, ' ').trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
  const variants = new Set<string>([cleaned, stripAccents(cleaned)]);
  const clauses: string[] = [];
  for (const v of variants) {
    if (!v) continue;
    clauses.push(
      `first_name.ilike.%${v}%`,
      `last_name.ilike.%${v}%`,
      `company.ilike.%${v}%`,
      `email.ilike.%${v}%`,
      `phone.ilike.%${v}%`,
      `address.ilike.%${v}%`,
    );
  }
  return clauses.join(',');
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
  email_label?: string;
  phone?: string;
  phones?: ClientPhone[];
  lead_source?: string | null;
  tax_ids?: string[] | null;
  address?: string;
  billing_same_as_service?: boolean;
  billing_address?: string | null;
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
  display_as_company?: boolean;
  /** Numéro voulu (validé côté serveur); vide/absent = attribution auto par le trigger. */
  client_number?: string;
}

// Use the centralized version from orgApi instead of duplicating
import { getCurrentOrgIdOrThrow } from './orgApi';

/**
 * The client's primary display name. When `display_as_company` is set and a
 * company is present, the company name is the main name; otherwise the personal
 * first/last name is used (falling back to company, then '' so callers can
 * apply their own placeholder). Set by org staff, not by the client.
 */
export function clientDisplayName(
  client: Partial<Pick<ClientRecord, 'first_name' | 'last_name' | 'company' | 'display_as_company'>> | null | undefined,
): string {
  if (!client) return '';
  const personal = `${client.first_name || ''} ${client.last_name || ''}`.trim();
  const company = (client.company || '').trim();
  if (client.display_as_company && company) return company;
  return personal || company;
}

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

/** Basic RFC 5322-lite email format check. Returns true for empty strings. */
function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  const trimmed = email.trim();
  if (!trimmed) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export async function createClientWithDuplicateHandling(
  payload: ClientPayload,
  mode: 'add' | 'replace'
): Promise<ClientRecord> {
  if (!isValidEmail(payload.email)) {
    throw new Error('Adresse courriel invalide.');
  }
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('create_client_with_duplicate_handling', {
    p_org_id: orgId,
    p_mode: mode,
    p_payload: {
      first_name: payload.first_name?.trim() || '',
      last_name: payload.last_name?.trim() || '',
      company: payload.company?.trim() || null,
      email: payload.email?.trim() || null,
      email_label: payload.email_label || 'main',
      phone: payload.phone?.trim() || null,
      phones: payload.phones ?? [],
      lead_source: payload.lead_source?.trim() || null,
      tax_ids: payload.tax_ids ?? null,
      address: payload.address?.trim() || null,
      billing_same_as_service: payload.billing_same_as_service ?? true,
      billing_address: payload.billing_address?.trim() || null,
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
      display_as_company: payload.display_as_company ?? false,
      client_number: payload.client_number?.trim() || null,
    },
    p_merge_duplicates: true,
  });
  if (error) throw erreurLisible(error);
  return data as unknown as ClientRecord;
}

export async function createClient(payload: ClientPayload): Promise<ClientRecord> {
  return createClientWithDuplicateHandling(payload, 'add');
}

export async function updateClient(id: string, payload: Partial<ClientPayload>): Promise<ClientRecord> {
  if (payload.email !== undefined && !isValidEmail(payload.email)) {
    throw new Error('Adresse courriel invalide.');
  }
  const updatePayload: Record<string, any> = {};
  if (payload.first_name !== undefined) updatePayload.first_name = payload.first_name.trim();
  if (payload.last_name !== undefined) updatePayload.last_name = payload.last_name.trim();
  if (payload.company !== undefined) updatePayload.company = payload.company?.trim() || null;
  if (payload.email !== undefined) updatePayload.email = payload.email?.trim() || null;
  if (payload.email_label !== undefined) updatePayload.email_label = payload.email_label || 'main';
  if (payload.phone !== undefined) updatePayload.phone = payload.phone?.trim() || null;
  if (payload.phones !== undefined) updatePayload.phones = payload.phones ?? [];
  if (payload.lead_source !== undefined) updatePayload.lead_source = payload.lead_source?.trim() || null;
  if (payload.tax_ids !== undefined) updatePayload.tax_ids = payload.tax_ids;
  if (payload.address !== undefined) updatePayload.address = payload.address?.trim() || null;
  if (payload.billing_same_as_service !== undefined) updatePayload.billing_same_as_service = payload.billing_same_as_service;
  if (payload.billing_address !== undefined) updatePayload.billing_address = payload.billing_address?.trim() || null;
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
  if (payload.display_as_company !== undefined) updatePayload.display_as_company = payload.display_as_company;

  // Support optimistic locking if version provided in payload
  const expectedVersion = (payload as any).version;
  const orgId = await getCurrentOrgIdOrThrow();
  let query = supabase.from('clients').update(updatePayload).eq('id', id).eq('org_id', orgId);
  if (expectedVersion != null) query = query.eq('version', expectedVersion);
  const { data, error } = await query.select('*').single();
  if (error?.code === 'PGRST116' && expectedVersion != null) {
    throw new Error('This client was modified by another user. Please refresh and try again.');
  }
  if (error) throw erreurLisible(error);
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

// REMOVED 2026-05-12: hardDeleteClient violated CLAUDE.md soft-delete rule
// (audit AUDIT_FEATURES_2026_05_12.md). Was imported by src/pages/Clients.tsx
// but never actually invoked. Use softDeleteClient instead.

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
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.from('clients').select('*').eq('org_id', orgId).is('deleted_at', null).eq('id', clientId).maybeSingle();
  if (error) throw error;
  return (data as ClientRecord | null) || null;
}

/** Find other clients sharing the same Google place_id (for duplicate address warning). */
export async function findClientsByPlaceId(placeId: string, excludeClientId?: string): Promise<ClientRecord[]> {
  if (!placeId) return [];
  const orgId = await getCurrentOrgIdOrThrow();
  let query = supabase
    .from('clients')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('place_id', placeId)
    .order('created_at', { ascending: true });
  if (excludeClientId) query = query.neq('id', excludeClientId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as ClientRecord[];
}
