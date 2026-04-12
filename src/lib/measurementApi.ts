/**
 * measurementApi.ts — CRUD for quote_measurements + quote_measurement_camera.
 */

import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import type {
  MeasurementType, CameraState, UnitSystem,
  QuoteMeasurementRecord, CreateMeasurementInput,
} from './measurementTypes';

// Re-export types for backward compat
export type { QuoteMeasurementRecord as QuoteMeasurement, CreateMeasurementInput };

// ── Camera state per quote ──

export interface QuoteMeasurementCamera {
  id: string;
  quote_id: string;
  address: string;
  camera: CameraState;
  unit_system: UnitSystem;
}

export async function getQuoteCamera(quoteId: string): Promise<QuoteMeasurementCamera | null> {
  const { data, error } = await supabase
    .from('quote_measurement_camera')
    .select('*')
    .eq('quote_id', quoteId)
    .maybeSingle();
  if (error) throw error;
  return data as QuoteMeasurementCamera | null;
}

export async function saveQuoteCamera(
  quoteId: string,
  camera: CameraState,
  address: string,
  unitSystem: UnitSystem,
): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase
    .from('quote_measurement_camera')
    .upsert({
      org_id: orgId,
      quote_id: quoteId,
      address,
      camera,
      unit_system: unitSystem,
    }, { onConflict: 'quote_id' });
  if (error) throw error;
}

// ── Measurements CRUD ──

export async function listMeasurements(quoteId: string): Promise<QuoteMeasurementRecord[]> {
  const { data, error } = await supabase
    .from('quote_measurements')
    .select('*')
    .eq('quote_id', quoteId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []) as QuoteMeasurementRecord[];
}

export async function createMeasurement(input: CreateMeasurementInput): Promise<QuoteMeasurementRecord> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('quote_measurements')
    .insert({
      org_id: orgId,
      quote_id: input.quote_id,
      measurement_type: input.measurement_type,
      label: input.label,
      unit: input.unit || 'ft',
      value: input.value,
      area_value: input.area_value ?? null,
      perimeter_value: input.perimeter_value ?? null,
      geojson: input.geojson,
      screenshot_url: input.screenshot_url ?? null,
      notes: input.notes ?? null,
      color: input.color || '#FF4444',
      sort_order: input.sort_order ?? 0,
      camera_state: input.camera_state ?? null,
      metadata: input.metadata ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as QuoteMeasurementRecord;
}

export async function updateMeasurement(
  id: string,
  updates: Partial<Omit<CreateMeasurementInput, 'quote_id'>>,
): Promise<QuoteMeasurementRecord> {
  const { data, error } = await supabase
    .from('quote_measurements')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as QuoteMeasurementRecord;
}

export async function deleteMeasurement(id: string): Promise<void> {
  const { error } = await supabase
    .from('quote_measurements')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export async function deleteAllMeasurements(quoteId: string): Promise<void> {
  const { error } = await supabase
    .from('quote_measurements')
    .delete()
    .eq('quote_id', quoteId);
  if (error) throw error;
}

// ── Screenshot ──

export async function uploadMeasurementScreenshot(
  quoteId: string,
  blob: Blob,
): Promise<string> {
  const orgId = await getCurrentOrgIdOrThrow();
  const filename = `measurements/${orgId}/${quoteId}/${Date.now()}.png`;
  const { error: uploadErr } = await supabase.storage
    .from('attachments')
    .upload(filename, blob, { contentType: 'image/png', upsert: true });
  if (uploadErr) throw uploadErr;
  const { data } = supabase.storage.from('attachments').getPublicUrl(filename);
  return data.publicUrl;
}
