import { supabase } from './supabase';

const API_BASE = '/api';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session?.access_token || ''}`,
  };
}

export type ReminderChannel = 'email' | 'sms' | 'both';

export interface ScheduleEntry {
  days_after_due: number;
  channel: ReminderChannel;
  template_id?: string | null;
}

export interface ReminderSettings {
  org_id: string;
  enabled: boolean;
  schedule: ScheduleEntry[];
  custom_email_subject: string | null;
  custom_email_body: string | null;
  custom_sms_body: string | null;
  updated_at: string;
}

export interface ReminderLogEntry {
  id: string;
  invoice_id: string;
  days_after_due: number;
  channel: ReminderChannel;
  sent_to: string;
  sent_at: string;
  status: 'sent' | 'failed';
  error_message: string | null;
}

export async function fetchReminderSettings(): Promise<ReminderSettings> {
  const res = await fetch(`${API_BASE}/reminders/settings`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load reminder settings.');
  const data = await res.json();
  return data.settings;
}

export async function updateReminderSettings(patch: Partial<Omit<ReminderSettings, 'org_id' | 'updated_at'>>): Promise<ReminderSettings> {
  const res = await fetch(`${API_BASE}/reminders/settings`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to save reminder settings.');
  const data = await res.json();
  return data.settings;
}

export async function fetchReminderLog(limit = 50): Promise<ReminderLogEntry[]> {
  const res = await fetch(`${API_BASE}/reminders/log?limit=${limit}`, { headers: await authHeaders() });
  if (!res.ok) return [];
  const data = await res.json();
  return data.entries || [];
}
