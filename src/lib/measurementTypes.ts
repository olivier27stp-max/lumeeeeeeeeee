/**
 * measurementTypes.ts — Strict types for the quote measurement system.
 * Single source of truth for all measurement-related interfaces.
 */

// ── Geometry ──

export interface LatLng {
  lat: number;
  lng: number;
}

export type MeasurementType = 'line' | 'path' | 'polygon';

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
}

// ── Shape (in-memory representation of a measurement) ──

export interface Shape {
  id: string;
  label: string;
  color: string;
  result: MeasurementResult;
  notes: string;
  visible: boolean;
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
