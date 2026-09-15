import { supabase } from './supabase';

const API = '/api';

// getSession peut rester suspendu indéfiniment (deadlock connu de supabase-js
// via le Navigator LockManager — multi-onglets, retour de veille). Sans borne,
// l'appelant reste bloqué en « Chargement... » pour toujours : on abandonne
// après 10 s pour que son retry/bouton Réessayer reprenne la main.
function getSessionBounded() {
  return Promise.race([
    supabase.auth.getSession(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('getSession timeout')), 10_000)),
  ]);
}

async function headers() {
  let session = (await getSessionBounded()).data.session;
  // Retry once if session not ready yet
  if (!session?.access_token) {
    await new Promise(r => setTimeout(r, 500));
    session = (await getSessionBounded()).data.session;
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
  registration_number?: string | null;
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
  /** True when the client is flagged tax-exempt — taxes is then always empty. */
  exempt?: boolean;
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

export interface TaxesCollected {
  from: string;
  to: string;
  total_cents: number;
  configured: boolean;
  taxes: Array<{ name: string; rate: number; cents: number; registration_number: string | null }>;
}

/** Taxes collected (to remit) over a period, split by the org's tax config. */
export async function fetchTaxesCollected(from: string, to: string): Promise<TaxesCollected> {
  const h = await headers();
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`${API}/taxes/collected?${params.toString()}`, { headers: h });
  const body = await jsonOrEmpty(res);
  if (!res.ok) throw new Error(body?.error || 'Failed');
  return body as TaxesCollected;
}

export async function resolveTaxes(clientId?: string | null, leadId?: string | null): Promise<ResolvedTaxes> {
  const h = await headers();
  const params = new URLSearchParams();
  if (clientId) params.set('client_id', clientId);
  if (leadId) params.set('lead_id', leadId);
  const qs = params.toString();
  const url = qs ? `${API}/taxes/resolve?${qs}` : `${API}/taxes/resolve`;
  // Connexion qui stalle (redéploiement Railway) : sans timeout, la tentative
  // ne se termine jamais et le retry du job form n'avance plus.
  const res = await fetch(url, { headers: h, signal: AbortSignal.timeout(15_000) });
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

export async function deleteTaxConfig(id: string): Promise<void> {
  const h = await headers();
  const res = await fetch(`${API}/taxes/config/${id}`, { method: 'DELETE', headers: h });
  const body = await jsonOrEmpty(res);
  if (!res.ok) throw new Error(body?.error || 'Failed');
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

export type AppliedTaxDocument = 'quote' | 'invoice';

/** Une ligne de taxe telle qu'affichée sur un devis ou une facture. */
export interface TaxLine {
  name: string;
  rate: number;
  amount_cents: number;
  is_compound?: boolean;
  tax_config_id?: string | null;
  registration_number?: string | null;
}

/** Le minimum pour ventiler une base : nom, taux, composée. */
export interface TaxLike {
  name: string;
  rate: number;
  is_compound?: boolean | null;
  type?: 'percentage' | 'fixed' | string | null;
  is_active?: boolean | null;
  id?: string | null;
  tax_config_id?: string | null;
  registration_number?: string | null;
}

/**
 * Ventile une base (sous-total − rabais) selon une liste de taxes.
 * Une taxe composée s'applique sur base + TOUTES les taxes précédentes.
 */
export function computeTaxLines(baseCents: number, taxes: TaxLike[]): TaxLine[] {
  if (baseCents <= 0 || taxes.length === 0) return [];
  let runningBase = baseCents;
  return taxes.filter(t => t.is_active !== false).map(t => {
    const rate = Number(t.rate) || 0;
    const amount = (t.type || 'percentage') === 'percentage'
      ? Math.round((t.is_compound ? runningBase : baseCents) * rate / 100)
      : Math.round(rate * 100);
    runningBase += amount;
    return {
      name: t.name,
      rate,
      amount_cents: amount,
      is_compound: !!t.is_compound,
      tax_config_id: t.tax_config_id ?? t.id ?? null,
      registration_number: t.registration_number || null,
    };
  });
}

/** Calculate tax amounts given subtotal and resolved taxes */
export function calculateTaxes(subtotalCents: number, discountCents: number, taxes: TaxConfig[]): Array<{ name: string; rate: number; amount_cents: number; registration_number?: string | null }> {
  return computeTaxLines(subtotalCents - discountCents, taxes)
    .map(l => ({ name: l.name, rate: l.rate, amount_cents: l.amount_cents, registration_number: l.registration_number || null }));
}

/**
 * Retrouve la ventilation d'un total de taxes déjà enregistré (documents créés
 * avant la ventilation, ou par les RPC de facturation). Les lignes ne sont
 * renvoyées que si elles expliquent le total à l'arrondi près ; sinon [] —
 * jamais une ventilation inventée.
 */
export function splitTaxTotal(taxCents: number, baseCents: number, taxes: TaxLike[]): TaxLine[] {
  if (taxCents <= 0) return [];
  const lines = computeTaxLines(baseCents, taxes);
  if (lines.length === 0) return [];
  const sum = lines.reduce((s, l) => s + l.amount_cents, 0);
  const diff = taxCents - sum;
  if (Math.abs(diff) > lines.length) return [];
  if (diff !== 0) lines[lines.length - 1] = { ...lines[lines.length - 1], amount_cents: lines[lines.length - 1].amount_cents + diff };
  return lines;
}

/**
 * Lignes de taxes enregistrées pour un document (table applied_taxes), avec
 * le numéro d'enregistrement courant de chaque taxe. [] si rien d'enregistré.
 */
export async function getAppliedTaxes(documentType: AppliedTaxDocument, documentId: string): Promise<TaxLine[]> {
  const { data, error } = await supabase
    .from('applied_taxes')
    .select('name, rate, amount_cents, is_compound, sort_order, tax_config_id')
    .eq('document_type', documentType)
    .eq('document_id', documentId)
    .order('sort_order');
  if (error || !data || data.length === 0) return [];

  const configIds = data.map((t: any) => t.tax_config_id).filter(Boolean);
  const regNumMap = new Map<string, string>();
  if (configIds.length > 0) {
    const { data: configs } = await supabase
      .from('tax_configs')
      .select('id, registration_number')
      .in('id', configIds);
    for (const c of configs || []) {
      if (c.registration_number) regNumMap.set(c.id, c.registration_number);
    }
  }

  return data.map((t: any) => ({
    name: t.name,
    rate: Number(t.rate),
    amount_cents: Number(t.amount_cents) || 0,
    is_compound: !!t.is_compound,
    tax_config_id: t.tax_config_id || null,
    registration_number: (t.tax_config_id && regNumMap.get(t.tax_config_id)) || null,
  }));
}

/**
 * Remplace la ventilation enregistrée d'un document. supabase-js ne throw
 * pas : on lit `error` à chaque étape, sinon l'échec est invisible.
 */
export async function saveAppliedTaxes(documentType: AppliedTaxDocument, documentId: string, lines: TaxLine[]): Promise<void> {
  const { error: delErr } = await supabase
    .from('applied_taxes')
    .delete()
    .eq('document_type', documentType)
    .eq('document_id', documentId);
  if (delErr) throw delErr;
  if (lines.length === 0) return;
  const { error: insErr } = await supabase.from('applied_taxes').insert(
    lines.map((l, idx) => ({
      document_type: documentType,
      document_id: documentId,
      tax_config_id: l.tax_config_id || null,
      name: l.name,
      rate: l.rate,
      amount_cents: l.amount_cents,
      is_compound: !!l.is_compound,
      sort_order: idx,
    })),
  );
  if (insErr) throw insErr;
}

/**
 * Ventilation d'un document : lignes enregistrées (montants recalculés sur la
 * base courante, le document ayant pu être modifié depuis), sinon repli sur
 * les taxes résolues pour le client quand elles expliquent le total.
 */
export async function getDocumentTaxLines(
  documentType: AppliedTaxDocument,
  doc: { id: string; client_id?: string | null; lead_id?: string | null; subtotal_cents: number; discount_cents?: number | null; tax_cents: number },
): Promise<TaxLine[]> {
  const base = (Number(doc.subtotal_cents) || 0) - (Number(doc.discount_cents) || 0);
  const stored = await getAppliedTaxes(documentType, doc.id);
  if (stored.length > 0) {
    const recomputed = computeTaxLines(base, stored);
    const sum = recomputed.reduce((s, l) => s + l.amount_cents, 0);
    // Base inchangée (cas normal) ou recalcul cohérent avec le total : lignes
    // à jour. Sinon (montant de taxe saisi à la main) : lignes telles qu'enregistrées.
    return Math.abs(sum - (Number(doc.tax_cents) || 0)) <= recomputed.length ? recomputed : stored;
  }
  if ((Number(doc.tax_cents) || 0) <= 0) return [];
  try {
    const resolved = await resolveTaxes(doc.client_id || null, doc.lead_id || null);
    return splitTaxTotal(Number(doc.tax_cents) || 0, base, resolved?.taxes || []);
  } catch {
    return [];
  }
}

export async function updateTaxRegistrationNumber(id: string, registration_number: string): Promise<TaxConfig> {
  const h = await headers();
  const res = await fetch(`${API}/taxes/config/${id}`, { method: 'PUT', headers: h, body: JSON.stringify({ registration_number }) });
  const body = await jsonOrEmpty(res);
  if (!res.ok) throw new Error(body?.error || 'Failed');
  return body.config;
}
