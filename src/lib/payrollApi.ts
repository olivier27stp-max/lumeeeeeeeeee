import { supabase } from './supabase';

export type PayPeriodType = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export interface PayrollSettings {
  org_id: string;
  pay_period_type: PayPeriodType;
  anchor_date: string;      // YYYY-MM-DD
  pay_day_offset: number;
  timezone: string;
}

export interface PayPeriod {
  start: string;
  end: string;
  payDate: string;
}

export interface CurrentPeriodResult {
  period: PayPeriod;
  settings: Omit<PayrollSettings, 'org_id'>;
  userId: string;
  hours: number;
  commission: {
    total: number;
    pending: number;
    approved: number;
    paid: number;
    reversed: number;
    count: number;
    entries: any[];
  };
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

export function getPayrollSettings(): Promise<PayrollSettings> {
  return authedFetch('/api/payroll/settings');
}

export function updatePayrollSettings(data: Partial<PayrollSettings>): Promise<PayrollSettings> {
  return authedFetch('/api/payroll/settings', { method: 'PUT', body: JSON.stringify(data) });
}

export function getCurrentPayPeriod(userId?: string): Promise<CurrentPeriodResult> {
  const q = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  return authedFetch(`/api/payroll/current-period${q}`);
}

// ── Period summary (admin) ──────────────────────────────────

export interface PayrollAdjustment {
  id: string;
  user_id: string;
  amount_cents: number;
  note: string | null;
  created_at: string;
}

export interface PayrollRow {
  user_id: string;
  name: string;
  role: string | null;
  hours: number;
  rate_cents: number;
  gross_cents: number;
  commission_cents: number;
  punch_count: number;
  adjustments: PayrollAdjustment[];
  adjustments_cents: number;
  total_cents: number;
  payment: { user_id: string; total_cents: number; paid_at: string; note: string | null } | null;
}

export interface PeriodSummary {
  period: PayPeriod;
  settings: Omit<PayrollSettings, 'org_id'>;
  rows: PayrollRow[];
  migration_missing: boolean;
}

export function getPeriodSummary(ref?: string): Promise<PeriodSummary> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  return authedFetch(`/api/payroll/period-summary${q}`);
}

export function addPayrollAdjustment(input: {
  user_id: string;
  period_start: string;
  period_end: string;
  amount_cents: number;
  note?: string;
}): Promise<PayrollAdjustment> {
  return authedFetch('/api/payroll/adjustments', { method: 'POST', body: JSON.stringify(input) });
}

export function deletePayrollAdjustment(id: string): Promise<{ success: boolean }> {
  return authedFetch(`/api/payroll/adjustments/${id}`, { method: 'DELETE' });
}

export function markPeriodPaid(userId: string, ref?: string, note?: string) {
  return authedFetch('/api/payroll/mark-paid', { method: 'POST', body: JSON.stringify({ user_id: userId, ref, note }) });
}

export function unmarkPeriodPaid(userId: string, ref?: string) {
  return authedFetch('/api/payroll/unmark-paid', { method: 'POST', body: JSON.stringify({ user_id: userId, ref }) });
}

export interface PayHistoryEntry {
  period_start: string;
  period_end: string;
  hours: number;
  gross_cents: number;
  commission_cents: number;
  adjustments_cents: number;
  total_cents: number;
  note: string | null;
  paid_at: string;
}

export function getPayHistory(userId: string): Promise<{ payments: PayHistoryEntry[]; migration_missing: boolean }> {
  return authedFetch(`/api/payroll/history?user_id=${encodeURIComponent(userId)}`);
}

/** Download the QuickBooks-friendly CSV for the period containing `ref`. */
export async function downloadPayrollCsv(ref?: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const res = await fetch(`/api/payroll/export${q}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as any)?.error || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'paie.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
