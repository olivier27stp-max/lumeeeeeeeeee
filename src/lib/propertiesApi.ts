import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

/**
 * A property is a service location belonging to a client. A client can have
 * many properties; each has a name + a (structured) address. Jobs, quotes and
 * invoices are assigned to a property. See migration
 * `20260707000000_properties_feature.sql`.
 */
export interface PropertyRecord {
  id: string;
  org_id: string;
  client_id: string;
  name: string;
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
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PropertyPayload {
  client_id: string;
  name: string;
  address?: string | null;
  street_number?: string | null;
  street_name?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  place_id?: string | null;
  is_primary?: boolean;
}

/** List a client's properties (primary first, then oldest first). */
export async function listPropertiesByClient(clientId: string): Promise<PropertyRecord[]> {
  if (!clientId) return [];
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as PropertyRecord[];
}

export async function getPropertyById(id: string): Promise<PropertyRecord | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as PropertyRecord | null) || null;
}

function cleanPayload(payload: Partial<PropertyPayload>): Record<string, any> {
  const out: Record<string, any> = {};
  if (payload.name !== undefined) out.name = payload.name.trim();
  if (payload.address !== undefined) out.address = payload.address?.trim() || null;
  if (payload.street_number !== undefined) out.street_number = payload.street_number?.trim() || null;
  if (payload.street_name !== undefined) out.street_name = payload.street_name?.trim() || null;
  if (payload.city !== undefined) out.city = payload.city?.trim() || null;
  if (payload.province !== undefined) out.province = payload.province?.trim() || null;
  if (payload.postal_code !== undefined) out.postal_code = payload.postal_code?.trim() || null;
  if (payload.country !== undefined) out.country = payload.country?.trim() || null;
  if (payload.latitude !== undefined) out.latitude = payload.latitude ?? null;
  if (payload.longitude !== undefined) out.longitude = payload.longitude ?? null;
  if (payload.place_id !== undefined) out.place_id = payload.place_id?.trim() || null;
  if (payload.is_primary !== undefined) out.is_primary = payload.is_primary;
  return out;
}

/**
 * Create a property for a client. The first property created for a client is
 * automatically marked primary (so job/quote/invoice auto-fill can resolve a
 * default location). org_id/created_by are stamped by the crm_enforce_scope
 * trigger; we still pass org_id for the RLS check.
 */
export async function createProperty(payload: PropertyPayload): Promise<PropertyRecord> {
  if (!payload.client_id) throw new Error('client_id is required to create a property.');
  if (!payload.name?.trim()) throw new Error('Le nom de la propriété est requis.');
  const orgId = await getCurrentOrgIdOrThrow();

  let isPrimary = payload.is_primary ?? false;
  if (payload.is_primary === undefined) {
    const existing = await listPropertiesByClient(payload.client_id);
    if (existing.length === 0) isPrimary = true;
  }

  const insertPayload = {
    ...cleanPayload(payload),
    name: payload.name.trim(),
    org_id: orgId,
    client_id: payload.client_id,
    is_primary: isPrimary,
  };

  const { data, error } = await supabase
    .from('properties')
    .insert(insertPayload)
    .select('*')
    .single();
  if (error) throw error;
  return data as PropertyRecord;
}

export async function updateProperty(id: string, payload: Partial<PropertyPayload>): Promise<PropertyRecord> {
  const orgId = await getCurrentOrgIdOrThrow();
  const updatePayload = cleanPayload(payload);
  const { data, error } = await supabase
    .from('properties')
    .update(updatePayload)
    .eq('id', id)
    .eq('org_id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  return data as PropertyRecord;
}

/** Soft-delete (CLAUDE.md: never hard delete). */
export async function softDeleteProperty(id: string): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase
    .from('properties')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId);
  if (error) throw error;
}
