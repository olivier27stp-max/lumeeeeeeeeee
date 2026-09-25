import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

// ─── Types ──────────────────────────────────────────────────────
export type GpsProvider = 'traccar' | 'life360';

export interface GpsProviderConfig {
  id: string;
  org_id: string;
  provider: GpsProvider;
  active: boolean;
  config: TraccarConfig | Life360Config;
  last_sync: string | null;
  sync_status: 'ok' | 'error' | 'syncing' | 'never' | null;
  error_msg: string | null;
  created_at: string;
}

export interface TraccarConfig {
  server_url: string;
  api_token?: string;
  username?: string;
  password?: string;
}

export interface Life360Config {
  access_token: string;
  refresh_token?: string;
  circle_id?: string;
}

export interface TechnicianLocation {
  id: string;
  user_id: string;
  provider: GpsProvider;
  external_id: string | null;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  speed_kmh: number | null;
  heading: number | null;
  battery_pct: number | null;
  address: string | null;
  recorded_at: string;
  received_at: string;
  // Joined fields
  user_name?: string;
  user_avatar?: string;
}

export interface DeviceMapping {
  id: string;
  provider_id: string;
  user_id: string;
  external_id: string;
  external_name: string | null;
  active: boolean;
}

export interface ExternalDevice {
  id: string;
  name: string;
  last_update?: string;
  latitude?: number;
  longitude?: number;
  battery?: number;
}

export interface Geofence {
  id: string;
  org_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  job_id: string | null;
  active: boolean;
}

export interface ProofOfPresence {
  id: string;
  user_id: string;
  geofence_id: string;
  job_id: string | null;
  event_type: 'enter' | 'exit';
  latitude: number;
  longitude: number;
  distance_m: number;
  recorded_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────
// Bureau actif (sélecteur), jamais « la première membership » : un compte à deux bureaux
// écrivait ses géorepérages et positions GPS dans le mauvais bureau.
async function getOrgId(): Promise<string> {
  return getCurrentOrgIdOrThrow();
}

/** Haversine distance between two coordinates in meters */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371e3;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── GPS Provider CRUD ──────────────────────────────────────────

export async function getGpsProviders(): Promise<GpsProviderConfig[]> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('gps_providers')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getActiveProvider(): Promise<GpsProviderConfig | null> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('gps_providers')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveGpsProvider(
  provider: GpsProvider,
  config: TraccarConfig | Life360Config
): Promise<GpsProviderConfig> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('gps_providers')
    .upsert({
      org_id: orgId,
      provider,
      active: true,
      config,
      sync_status: 'never',
    }, { onConflict: 'org_id,provider' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function disconnectGpsProvider(providerId: string): Promise<void> {
  const { error } = await supabase
    .from('gps_providers')
    .update({ active: false, config: {} })
    .eq('id', providerId);
  if (error) throw error;
}

export async function updateSyncStatus(
  providerId: string,
  status: 'ok' | 'error' | 'syncing',
  errorMsg?: string
): Promise<void> {
  const { error } = await supabase
    .from('gps_providers')
    .update({
      sync_status: status,
      last_sync: status === 'ok' ? new Date().toISOString() : undefined,
      error_msg: errorMsg || null,
    })
    .eq('id', providerId);
  if (error) throw error;
}

// ─── Traccar API ────────────────────────────────────────────────

export async function traccarFetchDevices(config: TraccarConfig): Promise<ExternalDevice[]> {
  const url = `${config.server_url.replace(/\/$/, '')}/api/devices`;
  const headers: Record<string, string> = { 'Accept': 'application/json' };

  if (config.api_token) {
    headers['Authorization'] = `Bearer ${config.api_token}`;
  } else if (config.username && config.password) {
    headers['Authorization'] = `Basic ${btoa(`${config.username}:${config.password}`)}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Traccar API error: ${res.status} ${res.statusText}`);

  const devices = await res.json();
  return devices.map((d: any) => ({
    id: String(d.id),
    name: d.name || `Device ${d.id}`,
    last_update: d.lastUpdate,
    latitude: d.latitude,
    longitude: d.longitude,
    battery: d.attributes?.batteryLevel,
  }));
}

export async function traccarFetchPositions(config: TraccarConfig): Promise<any[]> {
  const url = `${config.server_url.replace(/\/$/, '')}/api/positions`;
  const headers: Record<string, string> = { 'Accept': 'application/json' };

  if (config.api_token) {
    headers['Authorization'] = `Bearer ${config.api_token}`;
  } else if (config.username && config.password) {
    headers['Authorization'] = `Basic ${btoa(`${config.username}:${config.password}`)}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Traccar API error: ${res.status}`);
  return res.json();
}

export async function traccarTestConnection(config: TraccarConfig): Promise<boolean> {
  try {
    await traccarFetchDevices(config);
    return true;
  } catch {
    return false;
  }
}

// ─── Life360 API ────────────────────────────────────────────────

const LIFE360_BASE = 'https://api-cloudfront.life360.com/v3';

export async function life360FetchMembers(config: Life360Config): Promise<ExternalDevice[]> {
  if (!config.circle_id) throw new Error('Circle ID required');

  const res = await fetch(`${LIFE360_BASE}/circles/${config.circle_id}/members`, {
    headers: {
      'Authorization': `Bearer ${config.access_token}`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Life360 API error: ${res.status}`);

  const data = await res.json();
  const members = data.members || [];
  return members.map((m: any) => ({
    id: m.id,
    name: `${m.firstName} ${m.lastName}`.trim(),
    last_update: m.location?.timestamp ? new Date(Number(m.location.timestamp) * 1000).toISOString() : undefined,
    latitude: m.location?.latitude ? Number(m.location.latitude) : undefined,
    longitude: m.location?.longitude ? Number(m.location.longitude) : undefined,
    battery: m.location?.battery ? Number(m.location.battery) : undefined,
  }));
}

export async function life360FetchCircles(config: Life360Config): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${LIFE360_BASE}/circles`, {
    headers: {
      'Authorization': `Bearer ${config.access_token}`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Life360 API error: ${res.status}`);

  const data = await res.json();
  return (data.circles || []).map((c: any) => ({ id: c.id, name: c.name }));
}

export async function life360TestConnection(config: Life360Config): Promise<boolean> {
  try {
    await life360FetchCircles(config);
    return true;
  } catch {
    return false;
  }
}

// ─── Technician Locations ───────────────────────────────────────

export async function getLatestLocations(): Promise<TechnicianLocation[]> {
  const orgId = await getOrgId();
  // Get the latest location per user
  const { data, error } = await supabase
    .from('technician_locations')
    .select('*')
    .eq('org_id', orgId)
    .order('recorded_at', { ascending: false });
  if (error) throw error;

  // Dedupe: keep only latest per user
  const seen = new Set<string>();
  const latest: TechnicianLocation[] = [];
  for (const row of data || []) {
    if (!seen.has(row.user_id)) {
      seen.add(row.user_id);
      latest.push(row);
    }
  }
  return latest;
}

export async function getLocationHistory(
  userId: string,
  from: string,
  to: string
): Promise<TechnicianLocation[]> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('technician_locations')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .gte('recorded_at', from)
    .lte('recorded_at', to)
    .order('recorded_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function insertLocation(
  location: Omit<TechnicianLocation, 'id' | 'received_at'>
): Promise<void> {
  const orgId = await getOrgId();
  const { error } = await supabase
    .from('technician_locations')
    .insert({ ...location, org_id: orgId });
  if (error) throw error;
}

// ─── Sync: fetch from provider and store ────────────────────────

export async function syncProviderLocations(provider: GpsProviderConfig): Promise<number> {
  const orgId = await getOrgId();
  await updateSyncStatus(provider.id, 'syncing');

  try {
    // Get device mappings
    const { data: mappings } = await supabase
      .from('technician_device_mappings')
      .select('*')
      .eq('provider_id', provider.id)
      .eq('active', true);

    if (!mappings?.length) {
      await updateSyncStatus(provider.id, 'ok');
      return 0;
    }

    const mappingByExternal = new Map(mappings.map((m) => [m.external_id, m]));
    let positions: any[] = [];

    if (provider.provider === 'traccar') {
      positions = await traccarFetchPositions(provider.config as TraccarConfig);
    } else if (provider.provider === 'life360') {
      const members = await life360FetchMembers(provider.config as Life360Config);
      positions = members
        .filter((m) => m.latitude != null && m.longitude != null)
        .map((m) => ({
          deviceId: m.id,
          latitude: m.latitude,
          longitude: m.longitude,
          speed: 0,
          course: 0,
          attributes: { batteryLevel: m.battery },
          deviceTime: m.last_update || new Date().toISOString(),
        }));
    }

    // Map positions to technician_locations
    const rows = positions
      .filter((p) => mappingByExternal.has(String(p.deviceId)))
      .map((p) => {
        const mapping = mappingByExternal.get(String(p.deviceId))!;
        return {
          org_id: orgId,
          user_id: mapping.user_id,
          provider: provider.provider,
          external_id: String(p.deviceId),
          latitude: p.latitude,
          longitude: p.longitude,
          speed_kmh: p.speed ? p.speed * 1.852 : null, // knots to km/h
          heading: p.course || null,
          battery_pct: p.attributes?.batteryLevel ?? null,
          recorded_at: p.deviceTime || new Date().toISOString(),
        };
      });

    if (rows.length > 0) {
      const { error } = await supabase
        .from('technician_locations')
        .insert(rows);
      if (error) throw error;
    }

    await updateSyncStatus(provider.id, 'ok');
    return rows.length;
  } catch (e: any) {
    await updateSyncStatus(provider.id, 'error', e.message);
    throw e;
  }
}

// ─── Device Mappings ────────────────────────────────────────────

export async function getDeviceMappings(providerId: string): Promise<DeviceMapping[]> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('technician_device_mappings')
    .select('*')
    .eq('org_id', orgId)
    .eq('provider_id', providerId);
  if (error) throw error;
  return data || [];
}

export async function saveDeviceMapping(
  providerId: string,
  externalId: string,
  externalName: string,
  userId: string
): Promise<void> {
  const orgId = await getOrgId();
  const { error } = await supabase
    .from('technician_device_mappings')
    .upsert({
      org_id: orgId,
      provider_id: providerId,
      external_id: externalId,
      external_name: externalName,
      user_id: userId,
      active: true,
    }, { onConflict: 'org_id,provider_id,external_id' });
  if (error) throw error;
}

export async function removeDeviceMapping(mappingId: string): Promise<void> {
  const { error } = await supabase
    .from('technician_device_mappings')
    .delete()
    .eq('id', mappingId);
  if (error) throw error;
}

// ─── Geofences ──────────────────────────────────────────────────

export async function getGeofences(): Promise<Geofence[]> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('geofences')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createGeofence(
  geofence: Pick<Geofence, 'name' | 'latitude' | 'longitude' | 'radius_m' | 'job_id'>
): Promise<Geofence> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('geofences')
    .insert({ ...geofence, org_id: orgId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteGeofence(id: string): Promise<void> {
  const { error } = await supabase
    .from('geofences')
    .update({ active: false })
    .eq('id', id);
  if (error) throw error;
}

// ─── Proof of Presence ──────────────────────────────────────────

export async function checkProofOfPresence(
  userId: string,
  latitude: number,
  longitude: number
): Promise<ProofOfPresence[]> {
  const orgId = await getOrgId();
  const geofences = await getGeofences();

  const events: ProofOfPresence[] = [];
  for (const gf of geofences) {
    const distance = haversineDistance(latitude, longitude, gf.latitude, gf.longitude);
    if (distance <= gf.radius_m) {
      const event = {
        org_id: orgId,
        user_id: userId,
        geofence_id: gf.id,
        job_id: gf.job_id,
        event_type: 'enter' as const,
        latitude,
        longitude,
        distance_m: Math.round(distance),
      };
      const { data, error } = await supabase
        .from('proof_of_presence')
        .insert(event)
        .select()
        .single();
      if (!error && data) events.push(data);
    }
  }
  return events;
}

export async function getPresenceHistory(
  geofenceId: string,
  from?: string,
  to?: string
): Promise<ProofOfPresence[]> {
  const orgId = await getOrgId();
  let query = supabase
    .from('proof_of_presence')
    .select('*')
    .eq('org_id', orgId)
    .eq('geofence_id', geofenceId)
    .order('recorded_at', { ascending: false });
  if (from) query = query.gte('recorded_at', from);
  if (to) query = query.lte('recorded_at', to);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
