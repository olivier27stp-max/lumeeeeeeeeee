import { supabase } from './supabase';

const API = '/api';

async function headers() {
  let session = (await supabase.auth.getSession()).data.session;
  // Retry once if session not ready yet
  if (!session?.access_token) {
    await new Promise(r => setTimeout(r, 500));
    session = (await supabase.auth.getSession()).data.session;
  }
  if (!session?.access_token) throw new Error('Not authenticated');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

export interface TaxConfig {
  id: string;
  org_id: string;
  name: string;
  rate: number;
  type: 'percentage' | 'fixed';
  region: string;
  country: string;
  is_compound: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface TaxGroup {
  id: string;
  org_id: string;
  name: string;
  region: string;
  country: string;
  is_default: boolean;
  is_active: boolean;
}

export interface TaxPreset {
  key: string;
  name: string;
  region: string;
  country: string;
  taxes: Array<{ name: string; rate: number; is_compound: boolean; sort_order: number }>;
}

export interface TaxGroupItem {
  id: string;
  tax_group_id: string;
  tax_config_id: string;
  sort_order: number;
  tax_configs: TaxConfig;
}

export interface ResolvedTaxes {
  taxes: TaxConfig[];
  group: TaxGroup | null;
  region: string;
}

async function jsonOrEmpty(res: Response) {
  try { return await res.json(); } catch { return {}; }
}

export async function listTaxes(): Promise<{
  configs: TaxConfig[];
  groups: TaxGroup[];
  group_items: TaxGroupItem[];
  presets: TaxPreset[];
}> {
  const h = await headers();
  const res = await fetch(`${API}/taxes`, { headers: h });
  const body = await jsonOrEmpty(res);
  if (!res.ok) throw new Error(body?.error || 'Failed');
  return body;
}

export async function resolveTaxes(clientId?: string | null, leadId?: string | null): Promise<ResolvedTaxes> {
  const h = await headers();
  const params = new URLSearchParams();
  if (clientId) params.set('client_id', clientId);
  if (leadId) params.set('lead_id', leadId);
  const qs = params.toString();
  const url = qs ? `${API}/taxes/resolve?${qs}` : `${API}/taxes/resolve`;
  const res = await fetch(url, { headers: h });
  const body = await jsonOrEmpty(res);
  if (!res.ok) throw new Error(body?.error || 'Failed');
  return body;
}

export async function setupTaxPreset(presetKey: string, makeDefault = true): Promise<{ group: TaxGroup; config_count: number }> {
  const h = await headers();
  const res = await fetch(`${API}/taxes/setup`, {
    method: 'POST', headers: h,
    body: JSON.stringify({ preset_key: presetKey, make_default: makeDefault }),
  });
  const body = await jsonOrEmpty(res);
  if (!res.ok) throw new Error(body?.error || 'Failed to setup taxes');
  return body;
}

export async function createTaxConfig(data: { name: string; rate: number; type?: string; region?: string; country?: string; is_compound?: boolean }): Promise<TaxConfig> {
  const h = await headers();
  const res = await fetch(`${API}/taxes/config`, { method: 'POST', headers: h, body: JSON.stringify(data) });
  const body = await jsonOrEmpty(res);
  if (!res.ok) throw new Error(body?.error || 'Failed');
  return body.config;
}

export async function updateTaxConfig(id: string, data: { name?: string; rate?: number; is_active?: boolean }): Promise<TaxConfig> {
  const h = await headers();
  const res = await fetch(`${API}/taxes/config/${id}`, { method: 'PUT', headers: h, body: JSON.stringify(data) });
  const body = await jsonOrEmpty(res);
  if (!res.ok) throw new Error(body?.error || 'Failed');
  return body.config;
}

export async function deleteTaxGroup(id: string): Promise<void> {
  const h = await headers();
  const res = await fetch(`${API}/taxes/group/${id}`, { method: 'DELETE', headers: h });
  const body = await jsonOrEmpty(res);
  if (!res.ok) throw new Error(body?.error || 'Failed');
}

export async function setDefaultTaxGroup(id: string): Promise<TaxGroup> {
  const h = await headers();
  const res = await fetch(`${API}/taxes/group/${id}/default`, { method: 'PATCH', headers: h });
  const body = await jsonOrEmpty(res);
  if (!res.ok) throw new Error(body?.error || 'Failed');
  return body.group;
}

/** Calculate tax amounts given subtotal and resolved taxes */
export function calculateTaxes(subtotalCents: number, discountCents: number, taxes: TaxConfig[]): Array<{ name: string; rate: number; amount_cents: number }> {
  const base = subtotalCents - discountCents;
  if (base <= 0 || taxes.length === 0) return [];

  let runningBase = base;
  return taxes.filter(t => t.is_active).map(t => {
    const amount = t.type === 'percentage'
      ? Math.round((t.is_compound ? runningBase : base) * t.rate / 100)
      : Math.round(t.rate * 100);
    if (t.is_compound) runningBase += amount;
    return { name: t.name, rate: t.rate, amount_cents: amount };
  });
}
