// Door-to-door (D2D) field sales — direct Supabase against the field_* tables
// (the web goes through a backend, but the tables are RLS-scoped by org so an
// authenticated org member can read/write directly). We replicate the minimal
// write logic: log an event, move the house status, and keep the pin in sync.

import { supabase } from '../supabase';

export type HouseStatus =
  | 'unknown'
  | 'not_interested'
  | 'no_answer'
  | 'lead'
  | 'quote_sent'
  | 'sale'
  | 'callback'
  | 'do_not_knock'
  | 'revisit';

export type HouseEventType =
  | 'knock'
  | 'no_answer'
  | 'lead'
  | 'quote_sent'
  | 'sale'
  | 'note'
  | 'revisit'
  | 'callback'
  | 'do_not_knock'
  | 'status_change';

export interface FieldHouse {
  id: string;
  org_id: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  current_status: HouseStatus | string;
  house_score: 'cold' | 'warm' | 'hot' | string | null;
  visit_count: number | null;
  last_activity_at: string | null;
  metadata: Record<string, any> | null;
}

export interface FieldHouseEvent {
  id: string;
  house_id: string;
  user_id: string | null;
  event_type: string;
  note_text: string | null;
  created_at: string;
}

/** Pin colors by status (mirrors the web D2D legend). */
export const STATUS_COLOR: Record<string, string> = {
  unknown: '#FFFFFF',
  no_answer: '#CBD5E1',
  not_interested: '#EF4444',
  lead: '#3B82F6',
  quote_sent: '#94A3B8',
  sale: '#22C55E',
  callback: '#F59E0B',
  do_not_knock: '#7F1D1D',
  revisit: '#A855F7',
};

export const STATUS_LABEL: Record<string, string> = {
  unknown: 'Unknown',
  no_answer: 'No answer',
  not_interested: 'Not interested',
  lead: 'Lead',
  quote_sent: 'Quote sent',
  sale: 'Sale',
  callback: 'Callback',
  do_not_knock: 'Do not knock',
  revisit: 'Revisit',
};

/** Event type → resulting house status (null = leave status unchanged). */
const EVENT_TO_STATUS: Record<string, HouseStatus | null> = {
  knock: null,
  note: null,
  status_change: null,
  no_answer: 'no_answer',
  lead: 'lead',
  quote_sent: 'quote_sent',
  sale: 'sale',
  revisit: 'revisit',
  callback: 'callback',
  do_not_knock: 'do_not_knock',
};

/** Whether the org has the D2D / field-sales module turned on. */
export async function isFieldSalesEnabled(orgId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('field_settings')
    .select('feature_enabled')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) return false;
  return data?.feature_enabled === true;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Houses within the current map viewport (bbox query on the geo index). */
export async function listHousesInBounds(b: Bounds, limit = 500): Promise<FieldHouse[]> {
  const { data, error } = await supabase
    .from('field_house_profiles')
    .select('id, org_id, address, lat, lng, current_status, house_score, visit_count, last_activity_at, metadata')
    .is('deleted_at', null)
    .gte('lat', b.minLat)
    .lte('lat', b.maxLat)
    .gte('lng', b.minLng)
    .lte('lng', b.maxLng)
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as FieldHouse[];
}

export async function getHouse(id: string): Promise<FieldHouse | null> {
  const { data, error } = await supabase
    .from('field_house_profiles')
    .select('id, org_id, address, lat, lng, current_status, house_score, visit_count, last_activity_at, metadata')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as FieldHouse | null) ?? null;
}

export async function listHouseEvents(houseId: string): Promise<FieldHouseEvent[]> {
  const { data, error } = await supabase
    .from('field_house_events')
    .select('id, house_id, user_id, event_type, note_text, created_at')
    .eq('house_id', houseId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FieldHouseEvent[];
}

/** Log an interaction: insert the event, advance the house status, sync the pin. */
export async function logHouseEvent(params: {
  orgId: string;
  houseId: string;
  userId: string;
  eventType: HouseEventType;
  /** Force a resulting house status (e.g. 'not_interested', which is a status
   *  but not a valid event_type — log it as 'status_change' with this set). */
  statusOverride?: HouseStatus | null;
  noteText?: string | null;
  customer?: { name?: string; phone?: string; email?: string } | null;
}): Promise<void> {
  const { orgId, houseId, userId, eventType, statusOverride, noteText, customer } = params;

  const { error: evErr } = await supabase.from('field_house_events').insert({
    org_id: orgId,
    house_id: houseId,
    user_id: userId,
    event_type: eventType,
    note_text: noteText ?? null,
    metadata: customer ?? {},
  });
  if (evErr) throw new Error(evErr.message);

  const nextStatus = statusOverride ?? EVENT_TO_STATUS[eventType];
  const houseUpdate: Record<string, any> = {
    last_activity_at: new Date().toISOString(),
  };
  if (nextStatus) houseUpdate.current_status = nextStatus;
  if (customer && Object.keys(customer).length > 0) {
    houseUpdate.metadata = customer;
  }

  const { error: hErr } = await supabase
    .from('field_house_profiles')
    .update(houseUpdate)
    .eq('id', houseId);
  if (hErr) throw new Error(hErr.message);

  if (nextStatus) {
    // Keep the lightweight pin in sync (unique on org_id, house_id).
    await supabase
      .from('field_pins')
      .upsert(
        {
          org_id: orgId,
          house_id: houseId,
          user_id: userId,
          status: nextStatus,
          pin_color: STATUS_COLOR[nextStatus] ?? '#3B82F6',
          has_note: !!noteText,
        },
        { onConflict: 'org_id,house_id' },
      );
  }
}

/** Drop a new house pin at a tapped location. */
export async function createHouseAt(params: {
  orgId: string;
  userId: string;
  lat: number;
  lng: number;
  address?: string | null;
  status?: HouseStatus;
}): Promise<FieldHouse> {
  const { orgId, userId, lat, lng, address, status = 'unknown' } = params;
  // address is NOT NULL in the DB — fall back to the coordinates.
  const safeAddress = address?.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const { data, error } = await supabase
    .from('field_house_profiles')
    .insert({
      org_id: orgId,
      lat,
      lng,
      address: safeAddress,
      current_status: status,
      assigned_user_id: userId,
      visit_count: 0,
    })
    .select('id, org_id, address, lat, lng, current_status, house_score, visit_count, last_activity_at, metadata')
    .single();
  if (error) throw new Error(error.message);

  await supabase.from('field_pins').upsert(
    {
      org_id: orgId,
      house_id: data.id,
      user_id: userId,
      status,
      pin_color: STATUS_COLOR[status] ?? '#FFFFFF',
      has_note: false,
    },
    { onConflict: 'org_id,house_id' },
  );

  return data as FieldHouse;
}
