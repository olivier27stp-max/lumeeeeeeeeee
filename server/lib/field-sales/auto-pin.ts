/**
 * Auto-Pin Logic
 *
 * When a Quote, Job, Client, or Invoice is created with an address:
 * - Creates or merges a pin at that address
 * - Links all related entities (client, quote, job)
 * - Assigns territory based on coordinates
 * - Triggers score recalculation
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutoPinInput {
  org_id: string;
  user_id: string;
  address: string;
  lat: number;
  lng: number;
  entity_type: 'client' | 'lead' | 'quote' | 'job' | 'invoice';
  entity_id: string;
  client_id?: string;
  lead_id?: string;
  quote_id?: string;
  job_id?: string;
}

export interface AutoPinResult {
  house_id: string;
  pin_id: string;
  is_new: boolean;
  territory_id: string | null;
  linked_entities: string[];
}

// ---------------------------------------------------------------------------
// Haversine helper
// ---------------------------------------------------------------------------

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Point-in-polygon (ray casting)
// ---------------------------------------------------------------------------

function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0]; // lat, lng
    const xj = polygon[j][1], yj = polygon[j][0];
    if (((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Main: create or merge pin for an entity
// ---------------------------------------------------------------------------

export async function autoCreateOrMergePin(
  admin: SupabaseClient,
  input: AutoPinInput
): Promise<AutoPinResult> {
  const { org_id, user_id, address, lat, lng, entity_type, entity_id } = input;
  const now = new Date().toISOString();
  const addressNorm = address.toLowerCase().trim();

  // 1. Check for existing house within 50m
  const { data: nearby } = await admin
    .from('field_house_profiles')
    .select('id, lat, lng, client_id, lead_id, quote_id, job_id, territory_id')
    .eq('org_id', org_id)
    .is('deleted_at', null);

  let existingHouse = (nearby ?? []).find(
    (h: any) => haversineMetres(lat, lng, h.lat, h.lng) <= 50
  );

  let isNew = false;
  let houseId: string;
  let territoryId: string | null = null;

  if (existingHouse) {
    // Merge: update existing house with new entity links
    houseId = existingHouse.id;
    territoryId = existingHouse.territory_id;

    const updates: Record<string, any> = { updated_at: now };
    if (input.client_id && !existingHouse.client_id) updates.client_id = input.client_id;
    if (input.lead_id && !existingHouse.lead_id) updates.lead_id = input.lead_id;
    if (input.quote_id && !existingHouse.quote_id) updates.quote_id = input.quote_id;
    if (input.job_id && !existingHouse.job_id) updates.job_id = input.job_id;

    // Also set based on entity_type
    if (entity_type === 'client') updates.client_id = entity_id;
    if (entity_type === 'lead') updates.lead_id = entity_id;
    if (entity_type === 'quote') updates.quote_id = entity_id;
    if (entity_type === 'job') updates.job_id = entity_id;

    await admin.from('field_house_profiles').update(updates).eq('id', houseId);
  } else {
    // Create new house
    isNew = true;

    // Find territory for this location
    const { data: territories } = await admin
      .from('field_territories')
      .select('id, polygon_geojson')
      .eq('org_id', org_id)
      .is('deleted_at', null);

    for (const ter of territories ?? []) {
      const geo = (ter as any).polygon_geojson;
      const coords = geo?.coordinates?.[0];
      if (coords && pointInPolygon(lat, lng, coords)) {
        territoryId = ter.id;
        break;
      }
    }

    const houseData: Record<string, any> = {
      org_id,
      address,
      address_normalized: addressNorm,
      lat,
      lng,
      territory_id: territoryId,
      assigned_user_id: user_id,
      current_status: entity_type === 'job' ? 'sold' : entity_type === 'quote' ? 'quote_sent' : 'lead',
      visit_count: 0,
      last_activity_at: now,
      metadata: {},
    };

    if (input.client_id) houseData.client_id = input.client_id;
    if (input.lead_id) houseData.lead_id = input.lead_id;
    if (input.quote_id) houseData.quote_id = input.quote_id;
    if (input.job_id) houseData.job_id = input.job_id;
    if (entity_type === 'client') houseData.client_id = entity_id;
    if (entity_type === 'lead') houseData.lead_id = entity_id;
    if (entity_type === 'quote') houseData.quote_id = entity_id;
    if (entity_type === 'job') houseData.job_id = entity_id;

    const { data: house, error } = await admin
      .from('field_house_profiles')
      .insert(houseData)
      .select('id')
      .single();

    if (error || !house) throw new Error(`Failed to create house: ${error?.message}`);
    houseId = house.id;
  }

  // 2. Upsert pin
  const STATUS_COLORS: Record<string, string> = {
    sold: '#10B981', lead: '#3B82F6', quote_sent: '#A855F7',
    callback: '#F59E0B', new: '#9CA3AF', unknown: '#6B7280',
  };

  const pinStatus = entity_type === 'job' ? 'sold' : entity_type === 'quote' ? 'quote_sent' : 'lead';

  const { data: existingPin } = await admin
    .from('field_pins')
    .select('id')
    .eq('house_id', houseId)
    .maybeSingle();

  let pinId: string;
  if (existingPin) {
    await admin.from('field_pins').update({
      status: pinStatus,
      pin_color: STATUS_COLORS[pinStatus] ?? '#9CA3AF',
      updated_at: now,
    }).eq('id', existingPin.id);
    pinId = existingPin.id;
  } else {
    const { data: pin } = await admin.from('field_pins').insert({
      org_id,
      house_id: houseId,
      user_id,
      status: pinStatus,
      pin_color: STATUS_COLORS[pinStatus] ?? '#9CA3AF',
      has_note: false,
    }).select('id').single();
    pinId = pin?.id ?? '';
  }

  // 3. Create entity link
  await admin.from('field_pin_entity_links').upsert({
    org_id,
    house_id: houseId,
    entity_type,
    entity_id,
    linked_at: now,
  }, { onConflict: 'org_id,house_id,entity_type,entity_id' });

  // 4. Create event
  await admin.from('field_house_events').insert({
    org_id,
    house_id: houseId,
    user_id,
    event_type: entity_type === 'job' ? 'sale' : entity_type === 'quote' ? 'quote_sent' : 'lead',
    note_text: `Auto-linked from ${entity_type} creation`,
    metadata: { auto_linked: true, entity_type, entity_id },
    created_at: now,
  });

  const linked = [entity_type];
  if (input.client_id) linked.push('client');
  if (input.lead_id) linked.push('lead');
  if (input.quote_id) linked.push('quote');
  if (input.job_id) linked.push('job');

  return {
    house_id: houseId,
    pin_id: pinId,
    is_new: isNew,
    territory_id: territoryId,
    linked_entities: [...new Set(linked)],
  };
}
