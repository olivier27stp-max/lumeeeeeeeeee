/**
 * Field-sales map pin sync for inbound CRM leads.
 * =================================================
 * When a lead arrives with an address (e.g. public request form), drop a
 * 'lead' pin on the D2D map: geocode → find-or-create field_house_profiles →
 * upsert field_pins. Ongoing status changes are handled by the DB trigger
 * trg_clients_sync_field_pin (see migration 20260703200000).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { geocodeAddress, normalizeAddress } from './helpers';

const STATUS_COLORS: Record<string, string> = {
  unknown: '#6b7280', no_answer: '#9ca3af', not_interested: '#ef4444',
  lead: '#3b82f6', quote_sent: '#a855f7', sale: '#22c55e',
  callback: '#f59e0b', do_not_knock: '#dc2626', revisit: '#06b6d4',
};

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface LeadPinInput {
  orgId: string;
  actorId: string;
  clientId: string;
  address: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  noteText?: string | null;
}

/**
 * Create (or merge into) a map pin for an inbound lead.
 * Returns the house id, or null when the address is missing/un-geocodable.
 * Never throws — map pin creation must not break the caller's flow.
 */
export async function upsertLeadPinForClient(
  admin: SupabaseClient,
  input: LeadPinInput,
): Promise<{ houseId: string; created: boolean } | null> {
  try {
    const address = normalizeAddress(input.address);
    if (!address) return null;

    const addressNorm = address.toLowerCase().trim();
    const now = new Date().toISOString();

    // 1. Existing house at the same normalized address
    const { data: byAddress } = await admin
      .from('field_house_profiles')
      .select('id, client_id')
      .eq('org_id', input.orgId)
      .eq('address_normalized', addressNorm)
      .is('deleted_at', null)
      .maybeSingle();

    let houseId: string | null = byAddress?.id ?? null;
    let existingClientId: string | null = byAddress?.client_id ?? null;
    let lat: number | null = null;
    let lng: number | null = null;

    // 2. No address match → geocode, then merge with any house within 50 m
    if (!houseId) {
      const geo = await geocodeAddress(address);
      if (!geo) {
        console.warn('[field-pin] geocode failed, no pin created', { orgId: input.orgId, address });
        return null;
      }
      lat = geo.latitude;
      lng = geo.longitude;

      const { data: nearby } = await admin
        .from('field_house_profiles')
        .select('id, lat, lng, client_id')
        .eq('org_id', input.orgId)
        .is('deleted_at', null);
      const duplicate = (nearby ?? []).find(
        (h: any) => h.lat != null && h.lng != null && haversineMetres(lat!, lng!, h.lat, h.lng) <= 50,
      );
      if (duplicate) {
        houseId = duplicate.id;
        existingClientId = duplicate.client_id ?? null;
      }
    }

    const created = !houseId;

    if (houseId) {
      // Merge: mark the existing house as a fresh lead
      await admin
        .from('field_house_profiles')
        .update({
          current_status: 'lead',
          client_id: existingClientId || input.clientId,
          last_activity_at: now,
          updated_at: now,
        })
        .eq('id', houseId);
    } else {
      const { data: house, error: hErr } = await admin
        .from('field_house_profiles')
        .insert({
          org_id: input.orgId,
          address,
          address_normalized: addressNorm,
          lat,
          lng,
          current_status: 'lead',
          client_id: input.clientId,
          assigned_user_id: input.actorId,
          visit_count: 0,
          last_activity_at: now,
          metadata: {
            source: 'request_form',
            customer_name: input.customerName || null,
            customer_phone: input.customerPhone || null,
            customer_email: input.customerEmail || null,
          },
        })
        .select('id')
        .single();
      if (hErr || !house) {
        console.error('[field-pin] house insert failed:', hErr?.message);
        return null;
      }
      houseId = house.id as string;
    }

    // 3. Upsert the pin (UNIQUE (org_id, house_id))
    const { data: existingPin } = await admin
      .from('field_pins')
      .select('id')
      .eq('house_id', houseId)
      .maybeSingle();

    if (existingPin?.id) {
      await admin
        .from('field_pins')
        .update({ status: 'lead', pin_color: STATUS_COLORS.lead, has_note: !!input.noteText, updated_at: now })
        .eq('id', existingPin.id);
    } else {
      await admin.from('field_pins').insert({
        org_id: input.orgId,
        house_id: houseId,
        user_id: input.actorId,
        status: 'lead',
        pin_color: STATUS_COLORS.lead,
        has_note: !!input.noteText,
      });
    }

    // 4. Timeline event + entity link (best-effort)
    await admin.from('field_house_events').insert({
      org_id: input.orgId,
      house_id: houseId,
      user_id: input.actorId,
      event_type: 'lead',
      note_text: input.noteText || `Inbound request${input.customerName ? ` — ${input.customerName}` : ''}`,
      metadata: { source: 'request_form', client_id: input.clientId },
    });

    await admin.from('field_pin_entity_links').upsert(
      {
        org_id: input.orgId,
        house_id: houseId,
        entity_type: 'client',
        entity_id: input.clientId,
        linked_at: now,
      },
      { onConflict: 'org_id,house_id,entity_type,entity_id' },
    );

    return { houseId: houseId!, created };
  } catch (err: any) {
    console.error('[field-pin] upsertLeadPinForClient failed:', err?.message);
    return null;
  }
}
