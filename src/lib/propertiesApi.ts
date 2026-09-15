import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

/**
 * A property is an address belonging to a client.
 * - kind = 'service' (default): a service location. A client can have many;
 *   jobs, quotes and invoices are assigned to one. See migration
 *   `20260707000000_properties_feature.sql`.
 * - kind = 'billing': the client's billing address — at most ONE active per
 *   client, never primary. Mirrored by DB trigger into
 *   `clients.billing_address`; used on invoices when
 *   `clients.billing_same_as_service` is false. See migration
 *   `20260915000000_billing_properties.sql`.
 */
export type PropertyKind = 'service' | 'billing';

export interface PropertyRecord {
  id: string;
  org_id: string;
  client_id: string;
  kind: PropertyKind;
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
  kind?: PropertyKind;
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

/** List a client's SERVICE properties (primary first, then oldest first).
 *  The billing address is a separate entity: see getBillingProperty. */
export async function listPropertiesByClient(clientId: string): Promise<PropertyRecord[]> {
  if (!clientId) return [];
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('kind', 'service')
    .is('deleted_at', null)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as PropertyRecord[];
}

/** The client's active billing address (kind = 'billing'), or null. */
export async function getBillingProperty(clientId: string): Promise<PropertyRecord | null> {
  if (!clientId) return null;
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .eq('kind', 'billing')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as PropertyRecord | null) || null;
}

export type BillingAddressInput = Omit<PropertyPayload, 'client_id' | 'kind' | 'name' | 'is_primary'>;

/**
 * Create or update the client's billing address (one per client). Creating it
 * also flips `clients.billing_same_as_service` to false (DB trigger), so the
 * client is billed there from now on.
 */
export async function upsertBillingProperty(clientId: string, input: BillingAddressInput): Promise<PropertyRecord> {
  if (!clientId) throw new Error('client_id is required to save a billing address.');
  const existing = await getBillingProperty(clientId);
  if (existing) return updateProperty(existing.id, input);
  return createProperty({
    ...input,
    client_id: clientId,
    kind: 'billing',
    name: 'Adresse de facturation',
    is_primary: false,
  });
}

/** Remove the client's billing address (soft delete; the mirror column is cleared by trigger). */
export async function removeBillingProperty(clientId: string): Promise<void> {
  const existing = await getBillingProperty(clientId);
  if (existing) await softDeleteProperty(existing.id);
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
  if (payload.kind !== undefined) out.kind = payload.kind;
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

  const kind: PropertyKind = payload.kind ?? 'service';
  // A billing address is never the primary (service) property.
  let isPrimary = kind === 'billing' ? false : (payload.is_primary ?? false);
  if (kind === 'service' && payload.is_primary === undefined) {
    const existing = await listPropertiesByClient(payload.client_id);
    if (existing.length === 0) isPrimary = true;
  }

  const insertPayload = {
    ...cleanPayload(payload),
    name: payload.name.trim(),
    org_id: orgId,
    client_id: payload.client_id,
    kind,
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
