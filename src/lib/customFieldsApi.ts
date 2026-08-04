import { supabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────
export type EntityType = 'clients' | 'jobs' | 'invoices';

export type ColumnType =
  | 'text' | 'number' | 'status' | 'dropdown' | 'date' | 'checkbox'
  | 'email' | 'phone' | 'url' | 'currency' | 'rating' | 'label';

export interface DropdownOption {
  value: string;
  color?: string;
}

export interface StatusOption {
  value: string;
  color: string; // tailwind color name or hex
}

export interface ColumnConfig {
  options?: DropdownOption[];         // dropdown / status
  statuses?: StatusOption[];          // status column
  currency_code?: string;             // currency column
  max_rating?: number;                // rating column (default 5)
  default_value?: string | number | boolean;
}

export interface CustomColumn {
  id: string;
  org_id: string;
  entity: EntityType;
  name: string;
  col_type: ColumnType;
  config: ColumnConfig;
  position: number;
  visible: boolean;
  required: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface CustomColumnValue {
  id: string;
  org_id: string;
  column_id: string;
  record_id: string;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  value_date: string | null;
  value_json: any | null;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────
async function getOrgId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data } = await supabase
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!data) throw new Error('No organization found');
  return data.org_id;
}

// ─── Columns CRUD ───────────────────────────────────────────────

export async function listColumns(entity: EntityType): Promise<CustomColumn[]> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('custom_columns')
    .select('*')
    .eq('org_id', orgId)
    .eq('entity', entity)
    .is('deleted_at', null)
    .order('position', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createColumn(
  entity: EntityType,
  name: string,
  col_type: ColumnType,
  config: ColumnConfig = {}
): Promise<CustomColumn> {
  const orgId = await getOrgId();

  // Get next position
  const { data: existing } = await supabase
    .from('custom_columns')
    .select('position')
    .eq('org_id', orgId)
    .eq('entity', entity)
    .is('deleted_at', null)
    .order('position', { ascending: false })
    .limit(1);

  const nextPos = existing && existing.length > 0 ? existing[0].position + 1 : 0;

  // Add default statuses for status columns
  if (col_type === 'status' && !config.statuses) {
    config.statuses = [
      { value: 'Not started', color: '#94a3b8' },
      { value: 'In progress', color: '#3b82f6' },
      { value: 'Done', color: '#22c55e' },
      { value: 'Stuck', color: '#ef4444' },
    ];
  }

  // Add default options for dropdown / label
  if ((col_type === 'dropdown' || col_type === 'label') && !config.options) {
    config.options = [];
  }

  const { data, error } = await supabase
    .from('custom_columns')
    .insert({
      org_id: orgId,
      entity,
      name,
      col_type,
      config,
      position: nextPos,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateColumn(
  columnId: string,
  updates: Partial<Pick<CustomColumn, 'name' | 'config' | 'visible' | 'required' | 'position'>>
): Promise<CustomColumn> {
  const { data, error } = await supabase
    .from('custom_columns')
    .update(updates)
    .eq('id', columnId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteColumn(columnId: string): Promise<void> {
  // Soft delete
  const { error } = await supabase
    .from('custom_columns')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', columnId);
  if (error) throw error;
}

export async function reorderColumns(entity: EntityType, orderedIds: string[]): Promise<void> {
  // Update positions in batch
  const updates = orderedIds.map((id, idx) =>
    supabase.from('custom_columns').update({ position: idx }).eq('id', id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

// ─── Values CRUD ────────────────────────────────────────────────

export async function getValuesForRecord(recordId: string): Promise<Record<string, any>> {
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('custom_column_values')
    .select('column_id, value_text, value_number, value_boolean, value_date, value_json')
    .eq('org_id', orgId)
    .eq('record_id', recordId);
  if (error) throw error;

  const result: Record<string, any> = {};
  for (const row of data || []) {
    // Return the first non-null value
    const val = row.value_text ?? row.value_number ?? row.value_boolean ?? row.value_date ?? row.value_json;
    result[row.column_id] = val;
  }
  return result;
}

export async function getValuesForRecords(recordIds: string[]): Promise<Record<string, Record<string, any>>> {
  if (recordIds.length === 0) return {};
  const orgId = await getOrgId();
  const { data, error } = await supabase
    .from('custom_column_values')
    .select('record_id, column_id, value_text, value_number, value_boolean, value_date, value_json')
    .eq('org_id', orgId)
    .in('record_id', recordIds);
  if (error) throw error;

  const result: Record<string, Record<string, any>> = {};
  for (const row of data || []) {
    if (!result[row.record_id]) result[row.record_id] = {};
    const val = row.value_text ?? row.value_number ?? row.value_boolean ?? row.value_date ?? row.value_json;
    result[row.record_id][row.column_id] = val;
  }
  return result;
}

export async function setValue(
  columnId: string,
  recordId: string,
  value: any,
  colType: ColumnType
): Promise<void> {
  const orgId = await getOrgId();

  // Determine which typed column to use
  const row: any = {
    org_id: orgId,
    column_id: columnId,
    record_id: recordId,
    value_text: null,
    value_number: null,
    value_boolean: null,
    value_date: null,
    value_json: null,
  };

  switch (colType) {
    case 'text':
    case 'email':
    case 'phone':
    case 'url':
      row.value_text = value != null ? String(value) : null;
      break;
    case 'number':
    case 'currency':
    case 'rating':
      row.value_number = value != null ? Number(value) : null;
      break;
    case 'checkbox':
      row.value_boolean = value != null ? Boolean(value) : null;
      break;
    case 'date':
      row.value_date = value || null;
      break;
    case 'status':
    case 'dropdown':
    case 'label':
      row.value_text = value != null ? String(value) : null;
      break;
    default:
      row.value_json = value;
  }

  const { error } = await supabase
    .from('custom_column_values')
    .upsert(row, { onConflict: 'column_id,record_id' });
  if (error) throw error;
}

export async function deleteValuesForRecord(recordId: string): Promise<void> {
  const orgId = await getOrgId();
  const { error } = await supabase
    .from('custom_column_values')
    .delete()
    .eq('org_id', orgId)
    .eq('record_id', recordId);
  if (error) throw error;
}
