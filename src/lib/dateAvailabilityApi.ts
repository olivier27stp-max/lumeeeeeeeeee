import { supabase } from './supabase';

export interface DateSlotRecord {
  id: string;
  org_id: string;
  team_id: string;
  slot_date: string;   // 'YYYY-MM-DD'
  start_time: string;  // 'HH:MM:SS'
  end_time: string;
  status: 'available' | 'blocked';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DateSlotInput {
  team_id: string;
  slot_date: string;
  start_time: string;  // 'HH:MM'
  end_time: string;
  status?: 'available' | 'blocked';
  notes?: string;
}

/** List date-based slots for a team, optionally filtered by date range. */
export async function listDateSlots(
  teamId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<DateSlotRecord[]> {
  let query = supabase
    .from('team_date_slots')
    .select('*')
    .eq('team_id', teamId)
    .order('slot_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (dateFrom) query = query.gte('slot_date', dateFrom);
  if (dateTo) query = query.lte('slot_date', dateTo);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as DateSlotRecord[];
}

/** Create a new date slot. Replaces existing duplicate if present. */
export async function createDateSlot(input: DateSlotInput): Promise<DateSlotRecord> {
  // Resolve org_id
  const { data: orgId, error: orgError } = await supabase.rpc('current_org_id');
  if (orgError) throw orgError;
  if (!orgId) throw new Error('No organization context found.');

  // Remove existing duplicate to avoid unique constraint violation
  await supabase
    .from('team_date_slots')
    .delete()
    .eq('team_id', input.team_id)
    .eq('slot_date', input.slot_date)
    .eq('start_time', input.start_time)
    .eq('end_time', input.end_time);

  const { data, error } = await supabase
    .from('team_date_slots')
    .insert({
      org_id: orgId,
      team_id: input.team_id,
      slot_date: input.slot_date,
      start_time: input.start_time,
      end_time: input.end_time,
      status: input.status || 'available',
      notes: input.notes?.trim() || null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as DateSlotRecord;
}

/** Update an existing date slot. */
export async function updateDateSlot(
  id: string,
  input: Partial<Omit<DateSlotInput, 'team_id'>>,
): Promise<DateSlotRecord> {
  const payload: Record<string, unknown> = {};
  if (input.slot_date !== undefined) payload.slot_date = input.slot_date;
  if (input.start_time !== undefined) payload.start_time = input.start_time;
  if (input.end_time !== undefined) payload.end_time = input.end_time;
  if (input.status !== undefined) payload.status = input.status;
  if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;

  const { data, error } = await supabase
    .from('team_date_slots')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as DateSlotRecord;
}

/** Delete a date slot permanently. */
export async function deleteDateSlot(id: string): Promise<void> {
  const { error } = await supabase
    .from('team_date_slots')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

/** Bulk-create slots for multiple dates at once (e.g. Mon-Fri of a week). Skips duplicates. */
export async function bulkCreateDateSlots(
  teamId: string,
  dates: string[],
  startTime: string,
  endTime: string,
  status: 'available' | 'blocked' = 'available',
): Promise<DateSlotRecord[]> {
  const { data: orgId, error: orgError } = await supabase.rpc('current_org_id');
  if (orgError) throw orgError;
  if (!orgId) throw new Error('No organization context found.');

  // Delete existing slots for these dates first to avoid duplicates
  for (const d of dates) {
    await supabase
      .from('team_date_slots')
      .delete()
      .eq('team_id', teamId)
      .eq('slot_date', d)
      .eq('start_time', startTime)
      .eq('end_time', endTime);
  }

  const rows = dates.map((d) => ({
    org_id: orgId,
    team_id: teamId,
    slot_date: d,
    start_time: startTime,
    end_time: endTime,
    status,
  }));

  const { data, error } = await supabase
    .from('team_date_slots')
    .insert(rows)
    .select('*');

  if (error) throw error;
  return (data || []) as DateSlotRecord[];
}
