import { supabase } from './supabase';

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
  status: 'active' | 'on_break' | 'completed' | string;
}

async function authedFetch(path: string, init: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);
  return json;
}

export async function getActiveTimesheet(): Promise<TimeEntryRow | null> {
  const json = await authedFetch('/api/timesheets/active');
  return (json.entry as TimeEntryRow) || null;
}

export async function punchIn(params: { job_id?: string | null; team_id?: string | null; notes?: string | null } = {}): Promise<TimeEntryRow> {
  const json = await authedFetch('/api/timesheets/punch-in', { method: 'POST', body: JSON.stringify(params) });
  return json.entry as TimeEntryRow;
}

export async function punchOut(params: { entry_id?: string; notes?: string | null } = {}): Promise<TimeEntryRow> {
  const json = await authedFetch('/api/timesheets/punch-out', { method: 'POST', body: JSON.stringify(params) });
  return json.entry as TimeEntryRow;
}

export async function startBreak(entry_id: string): Promise<TimeEntryRow> {
  const json = await authedFetch('/api/timesheets/break/start', { method: 'POST', body: JSON.stringify({ entry_id }) });
  return json.entry as TimeEntryRow;
}

export async function endBreak(entry_id: string): Promise<TimeEntryRow> {
  const json = await authedFetch('/api/timesheets/break/end', { method: 'POST', body: JSON.stringify({ entry_id }) });
  return json.entry as TimeEntryRow;
}
