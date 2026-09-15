// Résolution des taxes d'un bureau pour un client donné + ventilation d'un
// total de taxes. Partagé entre GET /taxes/resolve et les pages publiques
// (devis, facture) qui doivent afficher « TPS 5 % / TVQ 9,975 % » sans session.
// Miroir serveur de computeTaxLines / splitTaxTotal (src/lib/taxApi.ts) :
// le stage prod du Dockerfile ne copie pas src/lib à la demande.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface TaxLike {
  name: string;
  rate: number;
  is_compound?: boolean | null;
  type?: string | null;
  is_active?: boolean | null;
  id?: string | null;
  tax_config_id?: string | null;
  registration_number?: string | null;
}

export interface TaxLine {
  name: string;
  rate: number;
  amount_cents: number;
  is_compound: boolean;
  tax_config_id: string | null;
  registration_number: string | null;
}

const PROVINCE_MAP: Record<string, string> = {
  'QUEBEC': 'QC', 'QUÉBEC': 'QC', 'ONTARIO': 'ON', 'BRITISH COLUMBIA': 'BC',
  'ALBERTA': 'AB', 'SASKATCHEWAN': 'SK', 'MANITOBA': 'MB',
  'NEW BRUNSWICK': 'NB', 'NOVA SCOTIA': 'NS', 'PEI': 'PE',
  'PRINCE EDWARD ISLAND': 'PE', 'NEWFOUNDLAND': 'NL',
  'NEWFOUNDLAND AND LABRADOR': 'NL',
  // US state names
  'CALIFORNIA': 'US-CA', 'TEXAS': 'US-TX', 'FLORIDA': 'US-FL',
  'NEW YORK': 'US-NY', 'ILLINOIS': 'US-IL', 'WASHINGTON': 'US-WA',
  'GEORGIA': 'US-GA', 'ARIZONA': 'US-AZ',
};

export interface ResolvedTaxes {
  taxes: any[];
  group: any | null;
  region: string;
  exempt?: boolean;
}

/**
 * Taxes applicables à un client (ou lead — même table) d'un bureau :
 * exempt → aucune ; région du client → groupe de la région ; sinon groupe par
 * défaut ; sinon toutes les taxes actives du bureau.
 */
export async function resolveTaxesForOrg(admin: SupabaseClient, orgId: string, rowId?: string | null): Promise<ResolvedTaxes> {
  let region = '';

  // tax_exempt ships behind a migration — retry without it so resolve keeps
  // working before the column exists.
  let clientRow: { province?: string | null; address?: string | null; tax_exempt?: boolean } | null = null;
  if (rowId) {
    const full = await admin.from('clients').select('province, address, tax_exempt').eq('id', rowId).eq('org_id', orgId).maybeSingle();
    if (full.error) {
      const fallback = await admin.from('clients').select('province, address').eq('id', rowId).eq('org_id', orgId).maybeSingle();
      clientRow = fallback.data;
    } else {
      clientRow = full.data;
    }
  }

  // Tax-exempt client (governments, First Nations, non-profits…): no taxes
  // on their documents, whatever the region.
  if (clientRow?.tax_exempt) {
    return { taxes: [], group: null, region: 'EXEMPT', exempt: true };
  }

  if (clientRow?.province) {
    region = clientRow.province.toUpperCase().trim();
    region = PROVINCE_MAP[region] || region;
  }
  if (!region && clientRow?.address) {
    const addr = clientRow.address.toUpperCase();
    for (const [name, code] of Object.entries(PROVINCE_MAP)) {
      if (addr.includes(name)) { region = code; break; }
    }
  }

  let group: any = null;
  if (region) {
    const { data } = await admin.from('tax_groups').select('*')
      .eq('org_id', orgId).eq('region', region).eq('is_active', true).maybeSingle();
    group = data;
  }
  if (!group) {
    const { data } = await admin.from('tax_groups').select('*')
      .eq('org_id', orgId).eq('is_default', true).eq('is_active', true).maybeSingle();
    group = data;
  }
  if (!group) {
    // Aucun groupe (lien groupe↔taxes jamais créé ou dérivé) : les taxes
    // actives de l'org restent la vérité — ne pas prétendre « non configuré ».
    const { data: orphanConfigs } = await admin.from('tax_configs').select('*')
      .eq('org_id', orgId).eq('is_active', true).order('sort_order');
    return { taxes: orphanConfigs || [], group: null, region };
  }

  const { data: items } = await admin.from('tax_group_items')
    .select('*, tax_configs(*)')
    .eq('tax_group_id', group.id)
    .order('sort_order');

  const taxes = (items || [])
    .map((i: any) => i.tax_configs)
    .filter((t: any) => t && t.is_active);

  return { taxes, group, region };
}

/** Ventile une base selon des taxes ; une taxe composée s'applique sur base + taxes précédentes. */
export function computeTaxLines(baseCents: number, taxes: TaxLike[]): TaxLine[] {
  if (baseCents <= 0 || taxes.length === 0) return [];
  let runningBase = baseCents;
  return taxes.filter((t) => t.is_active !== false).map((t) => {
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

/** Ventilation d'un total déjà enregistré — [] si les taxes ne l'expliquent pas. */
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
 * Lignes de taxes d'un document public : applied_taxes (montants recalculés
 * sur la base courante quand ils expliquent le total), sinon repli sur les
 * taxes résolues pour le client. Jamais une ventilation inventée.
 */
export async function documentTaxLines(
  admin: SupabaseClient,
  documentType: 'quote' | 'invoice',
  doc: { id: string; org_id: string; client_id?: string | null; lead_id?: string | null; subtotal_cents: number | null; discount_cents?: number | null; tax_cents: number | null },
): Promise<Array<{ name: string; rate: number; amount_cents: number; registration_number: string | null }>> {
  const base = (Number(doc.subtotal_cents) || 0) - (Number(doc.discount_cents) || 0);
  const taxCents = Number(doc.tax_cents) || 0;
  const strip = (l: TaxLine) => ({ name: l.name, rate: l.rate, amount_cents: l.amount_cents, registration_number: l.registration_number });

  const { data: stored } = await admin
    .from('applied_taxes')
    .select('name, rate, amount_cents, is_compound, sort_order, tax_config_id')
    .eq('document_type', documentType)
    .eq('document_id', doc.id)
    .order('sort_order');
  if (stored && stored.length > 0) {
    const ids = stored.map((t: any) => t.tax_config_id).filter(Boolean);
    const regNum = new Map<string, string>();
    if (ids.length > 0) {
      const { data: configs } = await admin.from('tax_configs').select('id, registration_number').in('id', ids);
      for (const c of configs || []) if (c.registration_number) regNum.set(c.id, c.registration_number);
    }
    const lines: TaxLine[] = stored.map((t: any) => ({
      name: t.name, rate: Number(t.rate), amount_cents: Number(t.amount_cents) || 0, is_compound: !!t.is_compound,
      tax_config_id: t.tax_config_id || null, registration_number: (t.tax_config_id && regNum.get(t.tax_config_id)) || null,
    }));
    const recomputed = computeTaxLines(base, lines);
    const sum = recomputed.reduce((s, l) => s + l.amount_cents, 0);
    return (Math.abs(sum - taxCents) <= recomputed.length ? recomputed : lines).map(strip);
  }

  if (taxCents <= 0) return [];
  try {
    const resolved = await resolveTaxesForOrg(admin, doc.org_id, doc.client_id || doc.lead_id || null);
    return splitTaxTotal(taxCents, base, resolved.taxes).map(strip);
  } catch (err: any) {
    console.error('[taxResolve] fallback failed:', err?.message || err);
    return [];
  }
}
