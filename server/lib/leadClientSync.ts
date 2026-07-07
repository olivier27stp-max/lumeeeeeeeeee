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
 * Only used as a 23505 fallback while a legacy unique index still exists in
 * an environment (see below) — dead path once 20260720000000 is applied.
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
 * Create the client record for an inbound lead.
 *
 * Product decision (2026-07-07): every inbound submission creates its own
 * client — two different people sharing a phone or email stay two distinct
 * records. No proactive email/phone matching (migration 20260720000000
 * removed the DB uniqueness that used to force the merge). Duplicate
 * management is manual, via the Clients-page duplicate dialog.
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
  const email = (params.email || '').trim();

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
    // 23505 = unique violation — only possible while a legacy unique index on
    // email/phone still exists in this environment (migration 20260720000000
    // not applied yet). Degrade to the old merge behavior instead of failing
    // the submission.
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
