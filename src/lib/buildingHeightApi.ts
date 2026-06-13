/**
 * buildingHeightApi — read the SURFACE elevation at a clicked point.
 *
 * Google's clickable APIs only give bare-earth terrain (DTM); buildings live in
 * the DSM, exposed by the Solar API's roof model. So per point:
 *   - if the click falls inside a building footprint → use the nearest roof
 *     segment's planeHeightAtCenterMeters (real roof height, meters above sea level)
 *   - otherwise → use the ground/terrain elevation (Maps JS ElevationService)
 *
 * Measuring a building height = surface elevation at the roof point − at the ground
 * point. Solar is CORS-enabled for the app origin (direct browser fetch).
 */

export interface SurfacePoint {
  /** Surface elevation, meters above sea level (roof if on a building, else ground). */
  elevationMeters: number;
  /** True when the elevation came from a building roof (Solar DSM). */
  onBuilding: boolean;
}

async function groundElevation(lat: number, lng: number): Promise<number | null> {
  try {
    const svc = new google.maps.ElevationService();
    const res = await svc.getElevationForLocations({ locations: [{ lat, lng }] });
    const e = res.results?.[0]?.elevation;
    return typeof e === 'number' ? e : null;
  } catch {
    return null;
  }
}

export async function getSurfaceElevation(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<SurfacePoint | null> {
  // Solar first: if the click is inside a building footprint, use the roof.
  try {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${apiKey}`;
    const r = await fetch(url);
    if (r.ok) {
      const d: any = await r.json();
      const bb = d?.boundingBox;
      const inside = bb
        && lat >= bb.sw.latitude && lat <= bb.ne.latitude
        && lng >= bb.sw.longitude && lng <= bb.ne.longitude;
      const segs: any[] = d?.solarPotential?.roofSegmentStats || [];
      if (inside && segs.length) {
        let best: any = null;
        let bestD = Infinity;
        for (const s of segs) {
          const c = s?.center;
          if (!c || typeof s.planeHeightAtCenterMeters !== 'number') continue;
          const dd = (c.latitude - lat) ** 2 + (c.longitude - lng) ** 2;
          if (dd < bestD) { bestD = dd; best = s; }
        }
        if (best) return { elevationMeters: best.planeHeightAtCenterMeters, onBuilding: true };
      }
    }
  } catch {
    /* fall through to terrain */
  }

  // Otherwise: ground/terrain elevation.
  const g = await groundElevation(lat, lng);
  if (g == null) return null;
  return { elevationMeters: g, onBuilding: false };
}
