/**
 * Geographic helpers — haversine distance and related utilities.
 *
 * Sanity check (mental unit test):
 *   haversineKm({lat:45.5017,lng:-73.5673}, {lat:43.6532,lng:-79.3832})
 *     ≈ 504 km (Montréal → Toronto straight-line).
 *   haversineKm({lat:0,lng:0}, {lat:0,lng:0}) === 0.
 *   haversineKm({lat:0,lng:0}, {lat:0,lng:1}) ≈ 111.19 km (1° at equator).
 */

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two coordinates in kilometres.
 * Uses the haversine formula — accurate enough for urban routing (sub-km
 * precision over typical service-business day routes).
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Estimate drive time in minutes from a straight-line distance.
 * Assumes 50 km/h average urban speed — purposely conservative to account
 * for non-direct roads, lights, and the haversine being a lower bound.
 */
export function estimateDriveMinutes(km: number, avgKmh = 50): number {
  if (!Number.isFinite(km) || km <= 0) return 0;
  return Math.round((km / avgKmh) * 60);
}
