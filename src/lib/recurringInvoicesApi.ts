import { supabase } from './supabase';

export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringInvoiceItem {
  description: string;
  qty: number;
  unit_price_cents: number;
}

export interface RecurringInvoiceSchedule {
  id: string;
  org_id: string;
  client_id: string;
  subject: string;
  items: RecurringInvoiceItem[];
  frequency: RecurringFrequency;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  due_days_offset: number;
  auto_send: boolean;
  is_active: boolean;
  last_invoice_id: string | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  clients?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    email: string | null;
  } | null;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Requested-With': 'fetch',
  };
}

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function listRecurringSchedules(opts: { clientId?: string } = {}): Promise<RecurringInvoiceSchedule[]> {
  const headers = await authHeaders();
  const qs = opts.clientId ? `?client_id=${encodeURIComponent(opts.clientId)}` : '';
  const res = await fetch(`${API_BASE}/api/recurring-invoices${qs}`, { headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Failed to load schedules (${res.status})`);
  return (json.schedules || []) as RecurringInvoiceSchedule[];
}

export async function createRecurringSchedule(payload: {
  client_id: string;
  subject: string;
  items: RecurringInvoiceItem[];
  frequency: RecurringFrequency;
  start_date: string;
  end_date?: string | null;
  due_days_offset: number;
  auto_send: boolean;
}): Promise<RecurringInvoiceSchedule> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/recurring-invoices`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Failed to create schedule (${res.status})`);
  return json.schedule as RecurringInvoiceSchedule;
}

export async function updateRecurringSchedule(
  id: string,
  patch: Partial<{
    subject: string;
    items: RecurringInvoiceItem[];
    frequency: RecurringFrequency;
    start_date: string;
    end_date: string | null;
    next_run_date: string;
    due_days_offset: number;
    auto_send: boolean;
    is_active: boolean;
  }>,
): Promise<RecurringInvoiceSchedule> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/recurring-invoices/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Failed to update schedule (${res.status})`);
  return json.schedule as RecurringInvoiceSchedule;
}

export async function deleteRecurringSchedule(id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/recurring-invoices/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || `Failed to delete schedule (${res.status})`);
  }
}

export async function runRecurringScheduleNow(id: string): Promise<{ invoice_id: string; invoice_number: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/recurring-invoices/${id}/run-now`, {
    method: 'POST',
    headers,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Failed to run schedule (${res.status})`);
  return { invoice_id: json.invoice_id, invoice_number: json.invoice_number };
}
