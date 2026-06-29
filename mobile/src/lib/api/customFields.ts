// Custom fields (EAV). Definitions live in custom_columns (per entity), values in
// custom_column_values. Definitions are managed on desktop; mobile reads them and
// reads/writes values. Any org member can read/write values (RLS).

import { supabase } from '../supabase';

export type ColType =
  | 'text'
  | 'number'
  | 'status'
  | 'dropdown'
  | 'date'
  | 'checkbox'
  | 'email'
  | 'phone'
  | 'url'
  | 'currency'
  | 'rating'
  | 'label';

export interface CustomColumn {
  id: string;
  entity: 'clients' | 'jobs' | 'invoices';
  name: string;
  col_type: ColType;
  config: { options?: string[]; [k: string]: any };
  required: boolean;
  position: number;
}

export type CustomValue = string | number | boolean | null;

const NUMERIC: ColType[] = ['number', 'currency', 'rating'];

export async function listCustomColumns(
  orgId: string,
  entity: CustomColumn['entity'],
): Promise<CustomColumn[]> {
  const { data, error } = await supabase
    .from('custom_columns')
    .select('id, entity, name, col_type, config, required, position')
    .eq('org_id', orgId)
    .eq('entity', entity)
    .eq('visible', true)
    .is('deleted_at', null)
    .order('position', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((c: any) => ({ ...c, config: c.config ?? {} })) as CustomColumn[];
}

/** Returns a map of column_id → value for one record. */
export async function getCustomValues(
  orgId: string,
  recordId: string,
): Promise<Record<string, CustomValue>> {
  const { data, error } = await supabase
    .from('custom_column_values')
    .select('column_id, value_text, value_number, value_boolean, value_date')
    .eq('org_id', orgId)
    .eq('record_id', recordId);
  if (error) throw new Error(error.message);
  const map: Record<string, CustomValue> = {};
  for (const r of (data ?? []) as any[]) {
    map[r.column_id] =
      r.value_text ?? r.value_number ?? r.value_boolean ?? r.value_date ?? null;
  }
  return map;
}

function columnPayload(colType: ColType, value: CustomValue): Record<string, unknown> {
  const base = {
    value_text: null as string | null,
    value_number: null as number | null,
    value_boolean: null as boolean | null,
    value_date: null as string | null,
  };
  if (value == null || value === '') return base;
  if (colType === 'checkbox') return { ...base, value_boolean: Boolean(value) };
  if (NUMERIC.includes(colType)) return { ...base, value_number: Number(value) };
  if (colType === 'date') return { ...base, value_date: String(value) };
  return { ...base, value_text: String(value) };
}

/** Insert or update the value for a (column, record) pair. */
export async function saveCustomValue(input: {
  orgId: string;
  columnId: string;
  recordId: string;
  colType: ColType;
  value: CustomValue;
}): Promise<void> {
  const payload = columnPayload(input.colType, input.value);
  const { data: existing } = await supabase
    .from('custom_column_values')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('column_id', input.columnId)
    .eq('record_id', input.recordId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase.from('custom_column_values').update(payload).eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('custom_column_values').insert({
      org_id: input.orgId,
      column_id: input.columnId,
      record_id: input.recordId,
      ...payload,
    });
    if (error) throw new Error(error.message);
  }
}
