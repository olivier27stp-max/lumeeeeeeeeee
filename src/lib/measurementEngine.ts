/**
 * measurementEngine.ts — Geometry calculations for the quote measurement workspace.
 * Haversine-based for real-world accuracy. Supports imperial and metric units.
 */

import type {
  LatLng, MeasurementType, MeasurementResult, UnitSystem, CameraState,
} from './measurementTypes';
import { MEASUREMENT_COLORS } from './measurementTypes';

// Re-export types for backward compatibility
export type { LatLng, MeasurementType, MeasurementResult };
export { MEASUREMENT_COLORS };

// ── Constants ──

const EARTH_RADIUS_FT = 20_902_231;
const FT_TO_M = 0.3048;
const SQ_FT_TO_SQ_M = 0.092903;

// ── Core distance calculation ──

/** Haversine distance between two points in feet. */
export function haversineDistanceFt(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_FT * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total path length in feet. */
export function pathLengthFt(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceFt(points[i - 1], points[i]);
  }
  return total;
}

// ── Area calculation ──

/** Polygon area in sq ft (Shoelace on flat projection). */
export function polygonAreaSqFt(points: LatLng[]): number {
  if (points.length < 3) return 0;
  const refLat = points[0].lat;
  const cosRef = Math.cos((refLat * Math.PI) / 180);
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * cosRef;

  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = points[i].lng * mPerDegLng;
    const yi = points[i].lat * mPerDegLat;
    const xj = points[j].lng * mPerDegLng;
    const yj = points[j].lat * mPerDegLat;
    area += xi * yj - xj * yi;
  }
  return Math.abs(area / 2) * (1 / SQ_FT_TO_SQ_M);
}

/** Polygon perimeter in feet. */
export function polygonPerimeterFt(points: LatLng[]): number {
  if (points.length < 2) return 0;
  let total = pathLengthFt(points);
  total += haversineDistanceFt(points[points.length - 1], points[0]);
  return total;
}

// ── Measurement computation ──

export function computeMeasurement(type: MeasurementType, points: LatLng[]): MeasurementResult {
  const geojson = pointsToGeoJSON(type, points);

  if (type === 'line') {
    const value = points.length === 2 ? haversineDistanceFt(points[0], points[1]) : 0;
    return { type, value, areaValue: null, perimeterValue: null, geojson, points };
  }
  if (type === 'path') {
    return { type, value: pathLengthFt(points), areaValue: null, perimeterValue: null, geojson, points };
  }
  const area = polygonAreaSqFt(points);
  const perimeter = polygonPerimeterFt(points);
  return { type, value: area, areaValue: area, perimeterValue: perimeter, geojson, points };
}

// ── GeoJSON ──

function pointsToGeoJSON(type: MeasurementType, points: LatLng[]): GeoJSON.Geometry {
  const coords = points.map((p) => [p.lng, p.lat]);
  if (type === 'polygon') {
    return { type: 'Polygon', coordinates: [[...coords, coords[0]]] };
  }
  return { type: 'LineString', coordinates: coords };
}

// ── Unit conversion ──

export function ftToUnit(ft: number, system: UnitSystem): number {
  return system === 'metric' ? ft * FT_TO_M : ft;
}

export function sqFtToUnit(sqft: number, system: UnitSystem): number {
  return system === 'metric' ? sqft * SQ_FT_TO_SQ_M : sqft;
}

// ── Formatting ──

export function formatLength(ft: number, system: UnitSystem): string {
  if (system === 'metric') {
    const m = ft * FT_TO_M;
    if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
    return `${r2(m)} m`;
  }
  if (ft >= 5280) return `${(ft / 5280).toFixed(2)} mi`;
  return `${r2(ft)} ft`;
}

export function formatArea(sqft: number, system: UnitSystem): string {
  if (system === 'metric') {
    const sqm = sqft * SQ_FT_TO_SQ_M;
    if (sqm >= 10000) return `${(sqm / 10000).toFixed(2)} ha`;
    return `${r2(sqm)} m²`;
  }
  if (sqft >= 43560) return `${(sqft / 43560).toFixed(2)} acres`;
  return `${r2(sqft)} sq ft`;
}

export function formatMeasurementValue(type: MeasurementType, value: number, system: UnitSystem = 'imperial'): string {
  if (type === 'polygon') return formatArea(value, system);
  return formatLength(value, system);
}

/** Legacy compat wrappers */
export function formatFeet(ft: number): string { return formatLength(ft, 'imperial'); }
export function formatSqFeet(sqft: number): string { return formatArea(sqft, 'imperial'); }

export function feetToMeters(ft: number): number { return ft * FT_TO_M; }

// ── Geometry helpers ──

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

export function centroid(points: LatLng[]): LatLng {
  const n = points.length;
  if (n === 0) return { lat: 0, lng: 0 };
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / n, lng: sum.lng / n };
}

export function nextColor(index: number): string {
  return MEASUREMENT_COLORS[index % MEASUREMENT_COLORS.length];
}

// ── Camera helpers ──

export function getCameraState(map: google.maps.Map): CameraState {
  const center = map.getCenter();
  return {
    center: { lat: center?.lat() || 0, lng: center?.lng() || 0 },
    zoom: map.getZoom() || 19,
    tilt: map.getTilt() || 0,
    heading: map.getHeading() || 0,
  };
}

export function applyCameraState(map: google.maps.Map, state: CameraState) {
  map.setCenter(state.center);
  map.setZoom(state.zoom);
  map.setTilt(state.tilt);
  map.setHeading(state.heading);
}

// ── GeoJSON → LatLng[] ──

export function geoJsonToPoints(g: any): LatLng[] {
  if (!g?.coordinates) return [];
  if (g.type === 'Polygon') return (g.coordinates[0] || []).slice(0, -1).map(([ln, lt]: number[]) => ({ lat: lt, lng: ln }));
  return (g.coordinates || []).map(([ln, lt]: number[]) => ({ lat: lt, lng: ln }));
}

function r2(n: number) { return Math.round(n * 100) / 100; }
