// Tax resolution — mirrors GET /api/taxes/resolve (server/routes/taxes.ts).
//
// The mobile app talks to Supabase directly, so the server route is out of
// reach; this reproduces its logic. The three tables carry org-scoped RLS
// policies, so a member reads exactly their own org.
//
// Order of resolution, same as the web:
//   1. a tax-exempt client pays nothing, whatever the region
//   2. the client's province picks a tax group
//   3. failing that, the org's default group
//   4. failing that, every active percentage config (legacy behaviour, kept so
//      orgs that never set up groups keep the rate they had)

import { supabase } from '../supabase';

export interface ResolvedTax {
  id: string | null;
  name: string;
  rate: number;
  is_compound: boolean;
}

export interface ResolvedTaxes {
  taxes: ResolvedTax[];
  exempt: boolean;
  region: string;
  /** Combined percentage — what the single-rate inputs display. */
  totalRatePct: number;
}

export const EMPTY_TAXES: ResolvedTaxes = { taxes: [], exempt: false, region: '', totalRatePct: 0 };

const PROVINCE_MAP: Record<string, string> = {
  QUEBEC: 'QC', QUÉBEC: 'QC', ONTARIO: 'ON', 'BRITISH COLUMBIA': 'BC',
  ALBERTA: 'AB', SASKATCHEWAN: 'SK', MANITOBA: 'MB',
  'NEW BRUNSWICK': 'NB', 'NOVA SCOTIA': 'NS', PEI: 'PE',
  'PRINCE EDWARD ISLAND': 'PE', NEWFOUNDLAND: 'NL',
  'NEWFOUNDLAND AND LABRADOR': 'NL',
  CALIFORNIA: 'US-CA', TEXAS: 'US-TX', FLORIDA: 'US-FL',
  'NEW YORK': 'US-NY', ILLINOIS: 'US-IL', WASHINGTON: 'US-WA',
  GEORGIA: 'US-GA', ARIZONA: 'US-AZ',
};

function sumRates(taxes: ResolvedTax[]): number {
  return taxes.reduce((s, t) => s + (Number(t.rate) || 0), 0);
}

/** Every active percentage config of the org, ignoring groups. */
async function allActiveConfigs(orgId: string): Promise<ResolvedTax[]> {
  const { data, error } = await supabase
    .from('tax_configs')
    .select('id, name, rate, type, is_compound, is_active, sort_order')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('sort_order');
  if (error || !data) return [];
  return (data as any[])
    .filter((t) => t.type === 'percentage')
    .map((t) => ({ id: t.id, name: t.name, rate: Number(t.rate) || 0, is_compound: !!t.is_compound }));
}

export async function resolveTaxes(orgId: string, clientId?: string | null): Promise<ResolvedTaxes> {
  if (!orgId) return EMPTY_TAXES;

  let region = '';
  if (clientId) {
    const { data: client } = await supabase
      .from('clients')
      .select('province, address, tax_exempt')
      .eq('id', clientId)
      .eq('org_id', orgId)
      .maybeSingle();

    // Governments, First Nations, non-profits… no tax on their documents.
    if (client?.tax_exempt) return { taxes: [], exempt: true, region: 'EXEMPT', totalRatePct: 0 };

    if (client?.province) {
      const raw = String(client.province).toUpperCase().trim();
      region = PROVINCE_MAP[raw] ?? raw;
    }
    if (!region && client?.address) {
      const addr = String(client.address).toUpperCase();
      for (const [name, code] of Object.entries(PROVINCE_MAP)) {
        if (addr.includes(name)) { region = code; break; }
      }
    }
  }

  // Group matching the region, else the org default.
  let group: { id: string } | null = null;
  if (region) {
    const { data } = await supabase
      .from('tax_groups')
      .select('id')
      .eq('org_id', orgId)
      .eq('region', region)
      .eq('is_active', true)
      .maybeSingle();
    group = (data as any) ?? null;
  }
  if (!group) {
    const { data } = await supabase
      .from('tax_groups')
      .select('id')
      .eq('org_id', orgId)
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle();
    group = (data as any) ?? null;
  }

  if (!group) {
    const taxes = await allActiveConfigs(orgId);
    return { taxes, exempt: false, region, totalRatePct: sumRates(taxes) };
  }

  const { data: items } = await supabase
    .from('tax_group_items')
    .select('sort_order, tax_configs(id, name, rate, type, is_compound, is_active)')
    .eq('tax_group_id', group.id)
    .order('sort_order');

  const taxes: ResolvedTax[] = ((items ?? []) as any[])
    .map((i) => (Array.isArray(i.tax_configs) ? i.tax_configs[0] : i.tax_configs))
    .filter((t) => t && t.is_active && t.type === 'percentage')
    .map((t) => ({ id: t.id, name: t.name, rate: Number(t.rate) || 0, is_compound: !!t.is_compound }));

  // A group that resolves to nothing usable is worse than no group at all.
  if (taxes.length === 0) {
    const fallback = await allActiveConfigs(orgId);
    return { taxes: fallback, exempt: false, region, totalRatePct: sumRates(fallback) };
  }

  return { taxes, exempt: false, region, totalRatePct: sumRates(taxes) };
}

export interface TaxLine {
  name: string; rate: number; amount_cents: number; tax_config_id: string | null; is_compound: boolean;
}

/** Split a tax total across the resolved taxes.
 *
 *  `taxCents` is what the document actually records. The parts MUST add up to
 *  it — a breakdown that doesn't reconcile with the invoice is worse than none
 *  for remittance. Rounding drift lands on the last line.
 *
 *  If the user overrode the rate by hand (it no longer matches the configured
 *  taxes), the split would be a lie: a single line carrying the real rate is
 *  returned instead. */
export function breakdownFor(
  taxes: ResolvedTax[],
  baseCents: number,
  taxCents: number,
  appliedRatePct?: number,
): TaxLine[] {
  if (taxCents <= 0) return [];

  const configured = taxes.reduce((s, t) => s + t.rate, 0);
  const overridden =
    appliedRatePct != null && Math.abs(appliedRatePct - configured) > 0.001;

  if (taxes.length === 0 || overridden) {
    return [{
      name: 'Taxe',
      rate: appliedRatePct ?? configured,
      amount_cents: taxCents,
      tax_config_id: null,
      is_compound: false,
    }];
  }

  const lines: TaxLine[] = taxes.map((t) => ({
    name: t.name,
    rate: t.rate,
    amount_cents: Math.round(baseCents * (t.rate / 100)),
    tax_config_id: t.id,
    is_compound: t.is_compound,
  }));
  const drift = taxCents - lines.reduce((s, l) => s + l.amount_cents, 0);
  if (drift !== 0) lines[lines.length - 1].amount_cents += drift;
  return lines;
}

/** Persist the breakdown of a quote or invoice. Best effort by design: the
 *  document is already saved, and a missing breakdown must not lose it. */
export async function saveAppliedTaxes(
  documentType: 'quote' | 'invoice',
  documentId: string,
  breakdown: TaxLine[],
): Promise<void> {
  if (!documentId) return;
  await supabase.from('applied_taxes').delete().eq('document_type', documentType).eq('document_id', documentId);
  if (breakdown.length === 0) return;
  const { error } = await supabase.from('applied_taxes').insert(
    breakdown.map((t, idx) => ({
      document_type: documentType,
      document_id: documentId,
      tax_config_id: t.tax_config_id,
      name: t.name,
      rate: t.rate,
      amount_cents: t.amount_cents,
      is_compound: t.is_compound,
      sort_order: idx,
    })),
  );
  if (error) console.warn('[taxes] ventilation non enregistrée:', error.message);
}
