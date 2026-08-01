/**
 * buildingHeightApi — elevations for the 2-point height tool.
 *
 * Google's clickable APIs only give bare-earth terrain (DTM); buildings live in
 * the DSM, exposed by the Solar API's roof model. The height tool is deterministic:
 *   - point 1 = BASE  → ground/terrain elevation (Maps JS ElevationService)
 *   - point 2 = TOP   → roof elevation (Solar: nearest roof segment's
 *                        planeHeightAtCenterMeters, meters above sea level)
 * Height = roof − ground. (We don't guess "is this click on a building" — the user
 * tells us by click order — because Solar bounding boxes overlap streets.)
 *
 * The lookups go through the server relay (/api/geocode/elevation) because the
 * browser key is referer-restricted and doesn't cover the Solar/Elevation APIs
 * on every domain — same fix as the address autocomplete. The direct browser
 * calls remain as fallbacks.
 */

import { supabase } from './supabase';

/** Server relay lookup — returns null on any failure so callers can fall back. */
async function serverElevation(surface: 'ground' | 'roof', lat: number, lng: number): Promise<number | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return null;
    const res = await fetch('/api/geocode/elevation', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, surface }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return typeof data?.elevation === 'number' ? data.elevation : null;
  } catch {
    return null;
  }
}

/** Distance caméra Street View → mur du bâtiment (m), via le contour Solar.
 *  Null si le serveur n'a pas de contour (le caller se replie sur le centre). */
export async function wallDistance(panoLat: number, panoLng: number, targetLat: number, targetLng: number): Promise<number | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return null;
    const res = await fetch('/api/geocode/elevation', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: panoLat, lng: panoLng, surface: 'wall-distance', target_lat: targetLat, target_lng: targetLng }),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return typeof data?.distance === 'number' ? data.distance : null;
  } catch {
    return null;
  }
}

/** Ground/terrain elevation in meters above sea level, or null.
 *  Browser ElevationService first (the REST endpoint rejects referer-restricted
 *  keys, so the relay is only a fallback here — the opposite of the roof). */
export async function groundElevation(lat: number, lng: number): Promise<number | null> {
  try {
    const svc = new google.maps.ElevationService();
    const res = await svc.getElevationForLocations({ locations: [{ lat, lng }] });
    const e = res.results?.[0]?.elevation;
    if (typeof e === 'number') return e;
  } catch { /* fall through to relay */ }
  return serverElevation('ground', lat, lng);
}

/**
 * Roof elevation (meters above sea level) at a clicked roof point — the nearest
 * Solar roof segment to the click. Returns null when Google has no roof data there.
 */
export async function roofElevation(lat: number, lng: number, apiKey: string): Promise<number | null> {
  const relayed = await serverElevation('roof', lat, lng);
  if (relayed != null) return relayed;
  try {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d: any = await r.json();
    const segs: any[] = d?.solarPotential?.roofSegmentStats || [];
    let best: number | null = null;
    let bestD = Infinity;
    for (const s of segs) {
      const c = s?.center;
      if (!c || typeof s.planeHeightAtCenterMeters !== 'number') continue;
      const dd = (c.latitude - lat) ** 2 + (c.longitude - lng) ** 2;
      if (dd < bestD) { bestD = dd; best = s.planeHeightAtCenterMeters; }
    }
    return best;
  } catch {
    return null;
  }
}
