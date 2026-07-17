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
  lead: '#A855F7', quote_sent: '#a855f7', sale: '#22c55e',
  callback: '#06b6d4', do_not_knock: '#dc2626', revisit: '#06b6d4',
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
 * Progressive simplifications of an address for geocode retries: full form,
 * then without unit/suite parts, then street + locality tail, then locality
 * only. Ordered from most to least precise; capped to avoid hammering the
 * geocoders.
 */
function addressVariants(address: string): string[] {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const variants: string[] = [parts.join(', ')];
  const noUnit = parts.filter((p) => !/^(apt|app|unit|suite|ste|bureau|local|#)\b/i.test(p));
  if (noUnit.length && noUnit.length !== parts.length) variants.push(noUnit.join(', '));
  if (parts.length >= 4) variants.push([parts[0], ...parts.slice(-3)].join(', '));
  if (parts.length >= 3) variants.push(parts.slice(-3).join(', '));
  return [...new Set(variants)].slice(0, 4);
}

/** geocodeAddress with the fallback chain above. */
export async function geocodeWithFallback(
  address: string,
): Promise<{ latitude: number; longitude: number; variant: string } | null> {
  for (const variant of addressVariants(address)) {
    const geo = await geocodeAddress(variant);
    if (geo) return { latitude: geo.latitude, longitude: geo.longitude, variant };
  }
  return null;
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
      .select('id, client_id, lat, current_status')
      .eq('org_id', input.orgId)
      .eq('address_normalized', addressNorm)
      .is('deleted_at', null)
      .maybeSingle();

    let houseId: string | null = byAddress?.id ?? null;
    let existingClientId: string | null = byAddress?.client_id ?? null;
    // Priorité Vendu : une maison déjà 'sale' (job assignée) n'est jamais
    // rétrogradée en 'lead' par une request entrante.
    let existingStatus: string | null = (byAddress as any)?.current_status ?? null;
    // House created without coords (e.g. by the trg_clients_ensure_field_pin
    // DB trigger, which cannot geocode): fill them in during the merge below.
    const needsCoords = !!byAddress && byAddress.lat == null;
    let lat: number | null = null;
    let lng: number | null = null;
    let geocodePending = false;

    // 2. No address match → geocode, then merge with any house within 50 m.
    //    A geocode failure does NOT abort: the house + pin are still created
    //    with null coords and repairMissingPinCoords() fills them in later.
    if (!houseId) {
      const geo = await geocodeWithFallback(address);
      if (geo) {
        lat = geo.latitude;
        lng = geo.longitude;

        const { data: nearby } = await admin
          .from('field_house_profiles')
          .select('id, lat, lng, client_id, lead_id, metadata, current_status')
          .eq('org_id', input.orgId)
          .is('deleted_at', null);
        // Merge into a nearby house only when identities are compatible: 50 m
        // can span two neighbours, and absorbing a new client's request into
        // another client's house leaves the new client with no visible pin.
        const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
        const inPhone = digits(input.customerPhone);
        const inEmail = String(input.customerEmail ?? '').trim().toLowerCase();
        const duplicate = (nearby ?? []).find((h: any) => {
          if (h.lat == null || h.lng == null || haversineMetres(lat!, lng!, h.lat, h.lng) > 50) return false;
          if (h.client_id === input.clientId || h.lead_id === input.clientId) return true;
          if (!h.client_id && !h.lead_id) return true;
          const hPhone = digits(h.metadata?.customer_phone);
          const hEmail = String(h.metadata?.customer_email ?? '').trim().toLowerCase();
          return (!!inPhone && inPhone === hPhone) || (!!inEmail && inEmail === hEmail);
        });
        if (duplicate) {
          houseId = duplicate.id;
          existingClientId = duplicate.client_id ?? null;
          existingStatus = (duplicate as any).current_status ?? null;
        }
      } else {
        geocodePending = true;
        console.warn('[field-pin] geocode failed, creating pin without coords (repair cron will retry)', {
          orgId: input.orgId,
          address,
        });
      }
    }

    const created = !houseId;
    // 'sale' garde toujours le dessus sur 'lead'
    const pinStatus = existingStatus === 'sale' ? 'sale' : 'lead';

    if (houseId) {
      // Merge: mark the existing house as a fresh lead (unless already sold)
      const patch: Record<string, unknown> = {
        current_status: pinStatus,
        client_id: existingClientId || input.clientId,
        last_activity_at: now,
        updated_at: now,
      };
      if (needsCoords) {
        const geo = await geocodeWithFallback(address);
        if (geo) {
          patch.lat = geo.latitude;
          patch.lng = geo.longitude;
        }
      }
      await admin.from('field_house_profiles').update(patch).eq('id', houseId);
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
            ...(geocodePending ? { geocode_status: 'pending' } : {}),
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
      const { error: pinErr } = await admin
        .from('field_pins')
        .update({ status: pinStatus, pin_color: STATUS_COLORS[pinStatus], has_note: !!input.noteText, updated_at: now })
        .eq('id', existingPin.id);
      if (pinErr) console.error('[field-pin] pin update failed:', pinErr.message);
    } else {
      const { error: pinErr } = await admin.from('field_pins').insert({
        org_id: input.orgId,
        house_id: houseId,
        user_id: input.actorId,
        status: pinStatus,
        pin_color: STATUS_COLORS[pinStatus],
        has_note: !!input.noteText,
      });
      if (pinErr) console.error('[field-pin] pin insert failed:', pinErr.message);
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

/**
 * Repair cron: geocode houses saved without coordinates (geocoder was down or
 * the address needed simplifying). Falls back to the linked client's current
 * address when the house address still fails. Also guarantees a field_pins
 * row exists for each repaired house. Returns the number of houses repaired.
 */
export async function repairMissingPinCoords(admin: SupabaseClient): Promise<number> {
  const { data: houses, error } = await admin
    .from('field_house_profiles')
    .select('id, org_id, address, client_id, assigned_user_id, metadata')
    .is('deleted_at', null)
    .is('lat', null)
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) {
    console.error('[field-pin-repair] fetch failed:', error.message);
    return 0;
  }

  let repaired = 0;
  for (const house of houses ?? []) {
    try {
      let geo = house.address ? await geocodeWithFallback(house.address) : null;

      if (!geo && house.client_id) {
        const { data: client } = await admin
          .from('clients')
          .select('address')
          .eq('id', house.client_id)
          .maybeSingle();
        const clientAddress = normalizeAddress(client?.address);
        if (clientAddress && clientAddress.toLowerCase() !== String(house.address || '').toLowerCase()) {
          geo = await geocodeWithFallback(clientAddress);
        }
      }

      if (!geo) continue;

      const now = new Date().toISOString();
      const metadata = { ...(house.metadata || {}), geocode_status: 'resolved', geocode_variant: geo.variant };
      const { error: updErr } = await admin
        .from('field_house_profiles')
        .update({ lat: geo.latitude, lng: geo.longitude, metadata, updated_at: now })
        .eq('id', house.id);
      if (updErr) {
        console.error('[field-pin-repair] house update failed:', updErr.message);
        continue;
      }

      const { data: pin } = await admin
        .from('field_pins')
        .select('id')
        .eq('house_id', house.id)
        .maybeSingle();
      if (!pin?.id && house.assigned_user_id) {
        await admin.from('field_pins').insert({
          org_id: house.org_id,
          house_id: house.id,
          user_id: house.assigned_user_id,
          status: 'lead',
          pin_color: STATUS_COLORS.lead,
        });
      }

      repaired++;
    } catch (err: any) {
      console.error('[field-pin-repair] house repair failed:', house.id, err?.message);
    }
  }

  if (repaired > 0) console.log(`[field-pin-repair] repaired ${repaired} pin(s)`);
  return repaired;
}
