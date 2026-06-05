// Time tracking — talks directly to the `time_entries` table (mobile cannot
// reach the web's /api/timesheets routes). The DB's partial unique index
// idx_time_entries_one_active on (employee_id) WHERE status='active' enforces
// "one active session per employee", so a duplicate punch-in throws.

import { supabase } from '../supabase';

export interface TimeEntryRow {
  id: string;
  org_id: string;
  employee_id: string;
  employee_name: string | null;
  date: string;
  punch_in: string;
  punch_out: string | null;
  punch_in_at: string | null;
  punch_out_at: string | null;
  breaks: Array<{ start: string; end?: string }>;
  notes: string | null;
  job_id: string | null;
  team_id: string | null;
  status: 'active' | 'paused' | 'completed' | string;
}

function localDate(d = new Date()): string {
  // YYYY-MM-DD in device-local time (payroll day boundary).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function localTime(d = new Date()): string {
  // HH:MM:SS in device-local time (the `punch_in`/`punch_out` time columns).
  return d.toTimeString().slice(0, 8);
}

/** The user's current open session (active or on break), if any. */
export async function getActiveTimesheet(employeeId: string): Promise<TimeEntryRow | null> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .in('status', ['active', 'paused'])
    .order('punch_in_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TimeEntryRow | null) ?? null;
}

export async function listTodaysEntries(employeeId: string): Promise<TimeEntryRow[]> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('date', localDate())
    .order('punch_in_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as TimeEntryRow[];
}

export async function punchIn(params: {
  orgId: string;
  employeeId: string;
  employeeName?: string | null;
  jobId?: string | null;
  teamId?: string | null;
}): Promise<TimeEntryRow> {
  const now = new Date();
  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      org_id: params.orgId,
      employee_id: params.employeeId,
      employee_name: params.employeeName ?? null,
      date: localDate(now),
      punch_in: localTime(now),
      punch_in_at: now.toISOString(),
      status: 'active',
      breaks: [],
      job_id: params.jobId ?? null,
      team_id: params.teamId ?? null,
    })
    .select('*')
    .single();
  if (error) {
    // Unique index → already punched in elsewhere.
    if (error.code === '23505') throw new Error('You are already punched in.');
    throw new Error(error.message);
  }
  return data as TimeEntryRow;
}

export async function punchOut(entryId: string): Promise<TimeEntryRow> {
  const now = new Date();
  // Close any still-open break so payroll totals stay correct.
  const { data: row } = await supabase
    .from('time_entries')
    .select('breaks')
    .eq('id', entryId)
    .single();
  const breaks: TimeEntryRow['breaks'] = Array.isArray(row?.breaks) ? row.breaks : [];
  const closedBreaks = breaks.map((b) => (b.end ? b : { ...b, end: now.toISOString() }));

  const { data, error } = await supabase
    .from('time_entries')
    .update({
      punch_out: localTime(now),
      punch_out_at: now.toISOString(),
      status: 'completed',
      breaks: closedBreaks,
    })
    .eq('id', entryId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as TimeEntryRow;
}

export async function startBreak(entryId: string): Promise<TimeEntryRow> {
  const { data: row } = await supabase
    .from('time_entries')
    .select('breaks')
    .eq('id', entryId)
    .single();
  const breaks: TimeEntryRow['breaks'] = Array.isArray(row?.breaks) ? row.breaks : [];
  breaks.push({ start: new Date().toISOString() });

  const { data, error } = await supabase
    .from('time_entries')
    .update({ breaks, status: 'paused' })
    .eq('id', entryId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as TimeEntryRow;
}

export async function endBreak(entryId: string): Promise<TimeEntryRow> {
  const { data: row } = await supabase
    .from('time_entries')
    .select('breaks')
    .eq('id', entryId)
    .single();
  const breaks: TimeEntryRow['breaks'] = Array.isArray(row?.breaks) ? row.breaks : [];
  for (let i = breaks.length - 1; i >= 0; i--) {
    if (!breaks[i].end) {
      breaks[i] = { ...breaks[i], end: new Date().toISOString() };
      break;
    }
  }
  const { data, error } = await supabase
    .from('time_entries')
    .update({ breaks, status: 'active' })
    .eq('id', entryId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as TimeEntryRow;
}

/** Total worked ms for an entry up to `now`, excluding breaks. */
export function workedMs(entry: TimeEntryRow, now = Date.now()): number {
  if (!entry.punch_in_at) return 0;
  const start = new Date(entry.punch_in_at).getTime();
  const end = entry.punch_out_at ? new Date(entry.punch_out_at).getTime() : now;
  let breakMs = 0;
  for (const b of entry.breaks ?? []) {
    const bStart = new Date(b.start).getTime();
    const bEnd = b.end ? new Date(b.end).getTime() : now;
    breakMs += Math.max(0, bEnd - bStart);
  }
  return Math.max(0, end - start - breakMs);
}
