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
 * Solar is CORS-enabled for the app origin (direct browser fetch).
 */

/** Ground/terrain elevation in meters above sea level, or null. */
export async function groundElevation(lat: number, lng: number): Promise<number | null> {
  try {
    const svc = new google.maps.ElevationService();
    const res = await svc.getElevationForLocations({ locations: [{ lat, lng }] });
    const e = res.results?.[0]?.elevation;
    return typeof e === 'number' ? e : null;
  } catch {
    return null;
  }
}

/**
 * Roof elevation (meters above sea level) at a clicked roof point — the nearest
 * Solar roof segment to the click. Returns null when Google has no roof data there.
 */
export async function roofElevation(lat: number, lng: number, apiKey: string): Promise<number | null> {
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
