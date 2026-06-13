/**
 * buildingHeightApi — real building heights from Google's DSM data.
 *
 * The Elevation API and the 3D map click both return bare-earth TERRAIN, so
 * they can't measure a building. The Google Solar API, however, exposes Google's
 * AI/DSM roof model: each roof segment carries `planeHeightAtCenterMeters` (meters
 * above sea level, buildings INCLUDED). Building height ≈ highest roof plane − ground.
 *
 * Ground is read from the Maps JS ElevationService (same MSL datum, no CORS issue).
 * The Solar REST endpoint is CORS-enabled for the app origin, so it's called directly.
 */

export interface BuildingHeightResult {
  found: true;
  heightMeters: number;
  roofMaxMeters: number;
  groundMeters: number;
  matchedCenter: { lat: number; lng: number };
}
export interface BuildingHeightMiss {
  found: false;
  /** 'no_coverage' | 'no_roof' | 'no_ground' | 'error' | 'network' */
  reason: string;
}

export async function fetchBuildingHeight(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<BuildingHeightResult | BuildingHeightMiss> {
  // 1) Solar API — roof segment heights (DSM, above sea level)
  let data: any;
  try {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&key=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) return { found: false, reason: r.status === 404 ? 'no_coverage' : 'error' };
    data = await r.json();
  } catch {
    return { found: false, reason: 'network' };
  }

  const segs: any[] = data?.solarPotential?.roofSegmentStats || [];
  const heights = segs
    .map((s) => s?.planeHeightAtCenterMeters)
    .filter((n) => typeof n === 'number') as number[];
  if (!heights.length) return { found: false, reason: 'no_roof' };
  const roofMaxMeters = Math.max(...heights);

  const center = data?.center || {};
  const cLat = typeof center.latitude === 'number' ? center.latitude : lat;
  const cLng = typeof center.longitude === 'number' ? center.longitude : lng;

  // 2) Ground elevation at the building center (DTM) — via Maps JS ElevationService
  let groundMeters: number | null = null;
  try {
    const svc = new google.maps.ElevationService();
    const res = await svc.getElevationForLocations({ locations: [{ lat: cLat, lng: cLng }] });
    const e = res.results?.[0]?.elevation;
    if (typeof e === 'number') groundMeters = e;
  } catch {
    /* fall through */
  }
  if (groundMeters == null) return { found: false, reason: 'no_ground' };

  return {
    found: true,
    heightMeters: Math.max(0, roofMaxMeters - groundMeters),
    roofMaxMeters,
    groundMeters,
    matchedCenter: { lat: cLat, lng: cLng },
  };
}
