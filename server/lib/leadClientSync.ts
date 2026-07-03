/**
 * Lead ↔ Client Synchronization Service
 *
 * Central logic for keeping leads and clients in sync.
 * Every lead MUST have a linked client (client_id).
 * clients = authoritative identity source
 * leads = sales/pipeline extension of a client
 */

import { SupabaseClient } from '@supabase/supabase-js';

function normalizePhoneDigits(phone?: string | null): string {
  return (phone || '').replace(/[^0-9]+/g, '');
}

/**
 * Find an active client in the org whose phone matches after normalization.
 * Mirrors the DB unique index uq_clients_org_phone_notnull on
 * (org_id, regexp_replace(phone, '[^0-9]+', '', 'g')) — an insert that would
 * collide with it must resolve to this client instead.
 */
async function findActiveClientByPhone(
  client: SupabaseClient,
  orgId: string,
  phone?: string | null
): Promise<string | null> {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return null;
  const { data } = await client
    .from('clients')
    .select('id, phone')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .not('phone', 'is', null)
    .limit(5000);
  const match = (data || []).find((c: any) => normalizePhoneDigits(c.phone) === digits);
  return match ? String(match.id) : null;
}

/**
 * Ensure a client record exists for a lead.
 * - If a client with the same email already exists in the org, returns that client_id.
 * - Else if a client with the same (normalized) phone exists, returns that client_id
 *   — the DB enforces per-org phone uniqueness, so inserting would fail anyway.
 * - Otherwise, creates a new client with status='lead'.
 */
export async function ensureClientForLead(
  client: SupabaseClient,
  params: {
    orgId: string;
    createdBy: string;
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    company?: string | null;
  }
): Promise<string> {
  // A lead is a client with status='lead'. Reuse an existing client with the
  // same email in the org, otherwise create one.
  const email = (params.email || '').trim();
  if (email) {
    const { data: existing } = await client
      .from('clients')
      .select('id')
      .eq('org_id', params.orgId)
      .ilike('email', email)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (existing?.id) return String(existing.id);
  }

  const byPhone = await findActiveClientByPhone(client, params.orgId, params.phone);
  if (byPhone) return byPhone;

  const { data, error } = await client
    .from('clients')
    .insert({
      org_id: params.orgId,
      created_by: params.createdBy,
      first_name: (params.firstName || '').trim(),
      last_name: (params.lastName || '').trim(),
      email: email || null,
      phone: params.phone?.trim() || null,
      address: params.address?.trim() || null,
      company: params.company?.trim() || null,
      status: 'lead',
      lead_status: 'new_prospect',
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = unique violation — a concurrent request (double-submit) created
    // the client between our lookups and the insert. Resolve to that row.
    if ((error as any).code === '23505') {
      if (email) {
        const { data: byEmail } = await client
          .from('clients')
          .select('id')
          .eq('org_id', params.orgId)
          .ilike('email', email)
          .is('deleted_at', null)
          .limit(1)
          .maybeSingle();
        if (byEmail?.id) return String(byEmail.id);
      }
      const retryPhone = await findActiveClientByPhone(client, params.orgId, params.phone);
      if (retryPhone) return retryPhone;
    }
    throw error;
  }
  if (!data) throw new Error('Failed to create client for lead');
  return String(data.id);
}

/**
 * Sync key identity fields from a lead to its linked client.
 * Called after lead update.
 */
export async function syncLeadToClient(
  client: SupabaseClient,
  params: {
    clientId: string;
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    company?: string | null;
  }
): Promise<void> {
  const updatePayload: Record<string, any> = {
    first_name: params.firstName,
    last_name: params.lastName,
    updated_at: new Date().toISOString(),
  };
  // Only overwrite non-null values (don't erase client data with empty lead fields)
  if (params.email) updatePayload.email = params.email;
  if (params.phone) updatePayload.phone = params.phone;
  if (params.address) updatePayload.address = params.address;
  if (params.company) updatePayload.company = params.company;

  const { error } = await client
    .from('clients')
    .update(updatePayload)
    .eq('id', params.clientId);

  if (error) {
    // eslint-disable-next-line no-console
    console.error('syncLeadToClient failed', { clientId: params.clientId, code: error.code, message: error.message });
  }
}

/**
 * Resolve the client_id for a lead. Used when creating a job from a lead.
 * If the lead somehow has no client_id (legacy data), attempt to create one.
 */
export async function resolveClientIdForLead(
  client: SupabaseClient,
  leadId: string
): Promise<string> {
  // A lead is a client now — the lead id IS the client id.
  const { data, error } = await client
    .from('clients')
    .select('id')
    .eq('id', leadId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Lead not found');
  return String(data.id);
}

/**
 * When converting a lead's status to "won", update the linked client status to "active".
 */
export async function promoteClientFromLead(
  client: SupabaseClient,
  clientId: string
): Promise<void> {
  const { error } = await client
    .from('clients')
    .update({ status: 'active', lead_status: 'closed_won', updated_at: new Date().toISOString() })
    .eq('id', clientId)
    .eq('status', 'lead');

  if (error) {
    // eslint-disable-next-line no-console
    console.error('promoteClientFromLead failed', { clientId, code: error.code });
  }
}
