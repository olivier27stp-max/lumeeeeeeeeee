/**
 * measurementTypes.ts — Strict types for the quote measurement system.
 * Single source of truth for all measurement-related interfaces.
 */

// ── Geometry ──

export interface LatLng {
  lat: number;
  lng: number;
  /** Ground elevation above sea level, in meters (Google Elevation API / GeoJSON altitude). Undefined until fetched. */
  elevation?: number;
}

export type MeasurementType = 'line' | 'path' | 'polygon';

/** Elevation summary for a measurement, all values in meters above sea level. */
export interface ElevationStats {
  /** Lowest point elevation (m). */
  min: number;
  /** Highest point elevation (m). */
  max: number;
  /** Vertical drop max − min, i.e. the total rise/fall across the shape (m). */
  gain: number;
  /** Elevation of the first point (m). */
  start: number;
  /** Elevation of the last point (m). */
  end: number;
}

export type Tool = 'select' | 'line' | 'path' | 'polygon';

export type UnitSystem = 'imperial' | 'metric';

export interface UnitConfig {
  system: UnitSystem;
  length: 'ft' | 'm';
  area: 'sq ft' | 'm²';
  lengthLabel: string;
  areaLabel: string;
}

// ── Measurement results ──

export interface MeasurementResult {
  type: MeasurementType;
  /** Primary value: distance in feet (line/path) or area in sq ft (polygon) */
  value: number;
  /** Area in sq ft (polygon only) */
  areaValue: number | null;
  /** Perimeter in feet (polygon only) */
  perimeterValue: number | null;
  /** GeoJSON representation */
  geojson: GeoJSON.Geometry;
  /** Points used */
  points: LatLng[];
  /** Elevation summary (m), or null when no point has elevation data yet. */
  elevation: ElevationStats | null;
}

// ── Shape (in-memory representation of a measurement) ──

export interface Shape {
  id: string;
  label: string;
  color: string;
  result: MeasurementResult;
  notes: string;
  visible: boolean;
  /**
   * Extra non-geometry data persisted to the DB `metadata` column.
   * A building-height measurement (captured in the 3D modal) carries
   * `{ kind: 'height', heightMeters, baseAltitude, topAltitude }` here while
   * being stored as a normal 2-point 'line' — so no DB schema change is needed.
   */
  metadata?: Record<string, unknown> | null;
}

// ── Camera state ──

export interface CameraState {
  center: LatLng;
  zoom: number;
  tilt: number;
  heading: number;
}

// ── Database record ──

export interface QuoteMeasurementRecord {
  id: string;
  org_id: string;
  quote_id: string;
  measurement_type: MeasurementType;
  label: string;
  unit: string;
  value: number;
  area_value: number | null;
  perimeter_value: number | null;
  geojson: any;
  screenshot_url: string | null;
  notes: string | null;
  color: string;
  sort_order: number;
  camera_state: CameraState | null;
  metadata: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateMeasurementInput {
  quote_id: string;
  measurement_type: MeasurementType;
  label: string;
  unit?: string;
  value: number;
  area_value?: number | null;
  perimeter_value?: number | null;
  geojson: any;
  screenshot_url?: string | null;
  notes?: string | null;
  color?: string;
  sort_order?: number;
  camera_state?: CameraState | null;
  metadata?: Record<string, unknown> | null;
}

// ── Store state ──

export interface MeasureState {
  tool: Tool;
  shapes: Shape[];
  selectedId: string | null;
  drawingPoints: LatLng[];
  cursorPos: LatLng | null;
  unitSystem: UnitSystem;
  saving: boolean;
  tilt3d: boolean;
  panelOpen: boolean;
  hoveredShapeId: string | null;
  draggingVertex: { shapeId: string; vertexIdx: number } | null;
}

// ── Constants ──

export const SNAP_PX = 12;

export const MEASUREMENT_COLORS = [
  '#FF4444', '#4488FF', '#44BB44', '#FF8800', '#AA44FF',
  '#FF44AA', '#44DDDD', '#FFBB00', '#8844FF', '#44FF88',
] as const;

export const UNIT_CONFIGS: Record<UnitSystem, UnitConfig> = {
  imperial: { system: 'imperial', length: 'ft', area: 'sq ft', lengthLabel: 'ft', areaLabel: 'sq ft' },
  metric: { system: 'metric', length: 'm', area: 'm²', lengthLabel: 'm', areaLabel: 'm²' },
} as const;
