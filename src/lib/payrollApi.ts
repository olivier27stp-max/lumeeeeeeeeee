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
