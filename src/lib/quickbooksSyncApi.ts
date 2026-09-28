// Synchro QuickBooks : état, réglages, historique (server/routes/quickbooks.ts).
// L'en-tête x-org-id du bureau actif est ajouté par apiOrgHeader.
import { supabase } from './supabase';

const API_BASE = import.meta.env.VITE_API_URL || '';

export type QboMethodKey = 'card' | 'cash' | 'check' | 'e-transfer' | 'paypal' | 'bank';

export interface QboSyncSettings {
  org_id: string;
  enabled: boolean;
  sync_from: string | null;
  item_id: string | null;
  item_name: string | null;
  deposit_account_id: string | null;
  deposit_account_name: string | null;
  deposit_account_online_id: string | null;
  deposit_account_online_name: string | null;
  tax_code_taxable_id: string | null;
  tax_code_exempt_id: string | null;
  payment_methods: Partial<Record<QboMethodKey, { id: string; name: string }>>;
}

export interface QboSyncRow {
  id: string;
  entity_type: 'client' | 'invoice' | 'payment';
  entity_id: string;
  status: 'pending' | 'processing' | 'done' | 'error' | 'skipped';
  last_error: string | null;
  attempts: number;
  updated_at: string;
  label: string | null;
}

export interface QboSyncStatus {
  settings: QboSyncSettings;
  counts: { pending: number; errors: number; done24h: number };
  recent: QboSyncRow[];
}

export interface QboOption {
  id: string;
  name: string;
}

export interface QboSyncOptions {
  items: QboOption[];
  depositAccounts: (QboOption & { type: string })[];
  paymentMethods: QboOption[];
  taxCodes: (QboOption & { rate: number })[];
}

/** La migration n'est pas encore appliquée sur la base. */
export class QboSyncUnavailable extends Error {}

/** Réservé au propriétaire / admin du bureau. */
export class QboSyncForbidden extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const res = await fetch(`${API_BASE}/api/quickbooks/sync${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 503 && data?.error === 'migration_pending') throw new QboSyncUnavailable(data.message);
  if (res.status === 403) throw new QboSyncForbidden(data?.error || 'Forbidden');
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getQboSyncStatus = () => call<QboSyncStatus>('/status');
export const getQboSyncOptions = () => call<QboSyncOptions>('/options');
export const saveQboSyncSettings = (patch: Partial<QboSyncSettings>) =>
  call<{ settings: QboSyncSettings }>('/settings', { method: 'PUT', body: JSON.stringify(patch) });
export const sendQboHistory = (from: string) =>
  call<{ queued: number }>('/history', { method: 'POST', body: JSON.stringify({ from }) });
export const retryQboSync = (id?: string) =>
  call<{ retried: number }>('/retry', { method: 'POST', body: JSON.stringify(id ? { id } : {}) });
export const runQboSyncNow = () => call<{ processed: number }>('/run', { method: 'POST' });
