import { supabase } from './supabase';
import type { FsCommissionEntry, FsCommissionRule, CommissionPayrollPreview, CommissionSettings } from '../types';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const BASE = '/api';

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') p.set(k, String(v));
  }
  const str = p.toString();
  return str ? `?${str}` : '';
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export function getCommissionEntries(options?: {
  userId?: string;
  status?: string;
  from?: string;
  to?: string;
}): Promise<FsCommissionEntry[]> {
  return apiFetch(`/commissions${qs({
    userId: options?.userId,
    status: options?.status,
    from: options?.from,
    to: options?.to,
  })}`);
}

export function generateCommissionsForInvoice(invoiceId: string): Promise<{ created: number; skipped: string | null }> {
  return apiFetch('/commissions/generate-for-invoice', {
    method: 'POST',
    body: JSON.stringify({ invoiceId }),
  });
}

export function approveCommission(entryId: string): Promise<FsCommissionEntry> {
  return apiFetch(`/commissions/${entryId}/approve`, { method: 'POST' });
}

export function markCommissionPaid(entryId: string): Promise<FsCommissionEntry> {
  return apiFetch(`/commissions/${entryId}/mark-paid`, { method: 'POST' });
}

export function reverseCommission(entryId: string, reason?: string): Promise<FsCommissionEntry> {
  return apiFetch(`/commissions/${entryId}/reverse`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function getCommissionRules(): Promise<FsCommissionRule[]> {
  return apiFetch('/commissions/rules');
}

export function createCommissionRule(data: Partial<FsCommissionRule>): Promise<FsCommissionRule> {
  return apiFetch('/commissions/rules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCommissionRule(id: string, data: Partial<FsCommissionRule>): Promise<FsCommissionRule> {
  return apiFetch(`/commissions/rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteCommissionRule(id: string): Promise<{ ok: true }> {
  return apiFetch(`/commissions/rules/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function getCommissionSettings(): Promise<CommissionSettings> {
  return apiFetch('/commissions/settings');
}

export function updateCommissionSettings(data: Partial<CommissionSettings>): Promise<CommissionSettings> {
  return apiFetch('/commissions/settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Payroll Preview
// ---------------------------------------------------------------------------

export function getPayrollPreview(
  from: string,
  to: string,
  userId?: string
): Promise<CommissionPayrollPreview> {
  return apiFetch(`/commissions/payroll-preview${qs({ from, to, userId })}`);
}
