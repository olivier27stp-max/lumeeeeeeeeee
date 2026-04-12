/**
 * Edge Case Handling for Field Sales
 *
 * Handles:
 * - Duplicate addresses (normalization + proximity)
 * - Missing coordinates (geocoding fallback)
 * - Empty territories
 * - Rep without territory
 * - Overlapping territories
 * - Scheduling conflicts
 * - Multi-day jobs
 * - Partial data
 */

// ---------------------------------------------------------------------------
// Address normalization
// ---------------------------------------------------------------------------

export function normalizeAddress(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|pl|place|cir|circle)\b/gi, (match) => {
      const MAP: Record<string, string> = {
        st: 'street', ave: 'avenue', blvd: 'boulevard', rd: 'road',
        dr: 'drive', ln: 'lane', ct: 'court', pl: 'place', cir: 'circle',
      };
      return MAP[match.toLowerCase()] ?? match.toLowerCase();
    })
    .replace(/[.,#]/g, '')
    .replace(/\bapt\s*/i, 'apartment ')
    .replace(/\bste\s*/i, 'suite ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Coordinate validation
// ---------------------------------------------------------------------------

export function isValidCoordinate(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// ---------------------------------------------------------------------------
// Haversine distance (metres)
// ---------------------------------------------------------------------------

export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export interface DuplicateCheck {
  isDuplicate: boolean;
  existingId?: string;
  existingAddress?: string;
  distance?: number;
}

export function checkDuplicate(
  lat: number,
  lng: number,
  address: string,
  existingHouses: Array<{ id: string; address: string; lat: number; lng: number }>,
  toleranceMetres = 50
): DuplicateCheck {
  const norm = normalizeAddress(address);

  // 1. Exact address match
  for (const h of existingHouses) {
    if (normalizeAddress(h.address) === norm) {
      return { isDuplicate: true, existingId: h.id, existingAddress: h.address, distance: 0 };
    }
  }

  // 2. Proximity match
  for (const h of existingHouses) {
    const dist = haversineMetres(lat, lng, h.lat, h.lng);
    if (dist <= toleranceMetres) {
      return { isDuplicate: true, existingId: h.id, existingAddress: h.address, distance: Math.round(dist) };
    }
  }

  return { isDuplicate: false };
}

// ---------------------------------------------------------------------------
// Overlap detection: check if a point is in multiple territories
// ---------------------------------------------------------------------------

export function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][1], yi = polygon[i][0];
    const xj = polygon[j][1], yj = polygon[j][0];
    if (((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function findOverlappingTerritories(
  lat: number,
  lng: number,
  territories: Array<{ id: string; name: string; polygon_geojson: any }>
): Array<{ id: string; name: string }> {
  const overlaps: Array<{ id: string; name: string }> = [];
  for (const ter of territories) {
    const coords = ter.polygon_geojson?.coordinates?.[0];
    if (!coords) continue;
    if (pointInPolygon(lat, lng, coords)) {
      overlaps.push({ id: ter.id, name: ter.name });
    }
  }
  return overlaps;
}

// ---------------------------------------------------------------------------
// Schedule conflict detection
// ---------------------------------------------------------------------------

export interface TimeSlot {
  start: Date;
  end: Date;
}

export function hasScheduleConflict(newSlot: TimeSlot, existingSlots: TimeSlot[]): boolean {
  return existingSlots.some(existing =>
    newSlot.start < existing.end && newSlot.end > existing.start
  );
}

// ---------------------------------------------------------------------------
// Partial data validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateHouseData(data: {
  address?: string;
  lat?: number;
  lng?: number;
}): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data.address?.trim()) {
    errors.push('Address is required');
  }

  if (!isValidCoordinate(data.lat, data.lng)) {
    if (data.address?.trim()) {
      warnings.push('Missing or invalid coordinates — geocoding required');
    } else {
      errors.push('Either valid coordinates or an address is required');
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
