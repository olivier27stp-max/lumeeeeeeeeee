/* ═══════════════════════════════════════════════════════════════
   Seeding unifié des valeurs par défaut d'une nouvelle org.

   PROBLÈME résolu : il existe trois portes d'entrée qui ne posaient
   PAS les mêmes données, et elles s'excluent via profiles.onboarding_done :
     A. OnboardingFlow /checkout (CTA du pricing) — org NUE
     B. OnboardingWizard post-login — le SEUL qui semait presets + autos
     C. Webhook lien de paiement — ni presets ni autos (taxes via CheckoutSetup)
   Résultat : selon la porte, une org pouvait finir sans taxes (factures à
   0 % de TPS/TVQ, silencieusement) et sans automatisations.

   seedOrgComplete() garantit le socle sur TOUS les chemins. Chaque brique
   est idempotente et best-effort (une erreur sur l'une ne bloque pas les
   autres ni l'activation de l'abonnement).
   ═══════════════════════════════════════════════════════════════ */

import { SupabaseClient } from '@supabase/supabase-js';
import { seedOrgFromIndustry } from './industryPresets';
import { ensureAutomationPresets } from './automationPresetSeeder';

// ── Catalogue des presets de taxes (source unique) ──
// Déplacé ici depuis server/routes/taxes.ts pour être réutilisable hors
// d'un handler HTTP (webhook Stripe, onboarding serveur). taxes.ts l'importe.
export type TaxPreset = {
  name: string;
  region: string;
  country: string;
  taxes: Array<{ name: string; rate: number; is_compound: boolean; sort_order: number }>;
};

export const TAX_PRESETS: Record<string, TaxPreset> = {
  // ── Canada ──
  QC: { name: 'Quebec (TPS + TVQ)', region: 'QC', country: 'CA', taxes: [
    { name: 'TPS', rate: 5, is_compound: false, sort_order: 0 },
    { name: 'TVQ', rate: 9.975, is_compound: false, sort_order: 1 },
  ]},
  ON: { name: 'Ontario (HST)', region: 'ON', country: 'CA', taxes: [
    { name: 'HST', rate: 13, is_compound: false, sort_order: 0 },
  ]},
  BC: { name: 'British Columbia (GST + PST)', region: 'BC', country: 'CA', taxes: [
    { name: 'GST', rate: 5, is_compound: false, sort_order: 0 },
    { name: 'PST', rate: 7, is_compound: false, sort_order: 1 },
  ]},

  // ── USA ──
  'US-CA': { name: 'California', region: 'US-CA', country: 'US', taxes: [
    { name: 'Sales Tax', rate: 7.25, is_compound: false, sort_order: 0 },
  ]},
  'US-TX': { name: 'Texas', region: 'US-TX', country: 'US', taxes: [
    { name: 'Sales Tax', rate: 6.25, is_compound: false, sort_order: 0 },
  ]},
  'US-FL': { name: 'Florida', region: 'US-FL', country: 'US', taxes: [
    { name: 'Sales Tax', rate: 6, is_compound: false, sort_order: 0 },
  ]},

  // ── International ──
  'UK': { name: 'United Kingdom (VAT)', region: 'UK', country: 'GB', taxes: [
    { name: 'VAT', rate: 20, is_compound: false, sort_order: 0 },
  ]},
  'FR': { name: 'France (TVA)', region: 'FR', country: 'FR', taxes: [
    { name: 'TVA', rate: 20, is_compound: false, sort_order: 0 },
  ]},
  'DE': { name: 'Germany (MwSt)', region: 'DE', country: 'DE', taxes: [
    { name: 'MwSt', rate: 19, is_compound: false, sort_order: 0 },
  ]},
  'AU': { name: 'Australia (GST)', region: 'AU', country: 'AU', taxes: [
    { name: 'GST', rate: 10, is_compound: false, sort_order: 0 },
  ]},
  'MX': { name: 'Mexico (IVA)', region: 'MX', country: 'MX', taxes: [
    { name: 'IVA', rate: 16, is_compound: false, sort_order: 0 },
  ]},

  // ── No Tax ──
  NONE: { name: 'No Tax', region: 'NONE', country: '', taxes: [] },
};

// Canada — remaining provinces/territories (GST / PST / RST / HST).
const CA_MORE: Array<[string, string, Array<[string, number]>]> = [
  ['AB', 'Alberta (GST)', [['GST', 5]]],
  ['MB', 'Manitoba (GST + RST)', [['GST', 5], ['RST', 7]]],
  ['SK', 'Saskatchewan (GST + PST)', [['GST', 5], ['PST', 6]]],
  ['NS', 'Nova Scotia (HST)', [['HST', 14]]],
  ['NB', 'New Brunswick (HST)', [['HST', 15]]],
  ['NL', 'Newfoundland & Labrador (HST)', [['HST', 15]]],
  ['PE', 'Prince Edward Island (HST)', [['HST', 15]]],
  ['CA-TERR', 'Territories (GST)', [['GST', 5]]],
];
for (const [key, name, parts] of CA_MORE) {
  if (TAX_PRESETS[key]) continue;
  TAX_PRESETS[key] = { name, region: key, country: 'CA', taxes: parts.map(([n, r], i) => ({ name: n, rate: r, is_compound: false, sort_order: i })) };
}

// USA — statewide base sales tax for every state (0 = no state sales tax).
// Local (county/city) taxes may add on top; the pro adjusts in Tax Settings.
const US_STATES: Array<[string, string, number]> = [
  ['AL', 'Alabama', 4], ['AK', 'Alaska', 0], ['AZ', 'Arizona', 5.6], ['AR', 'Arkansas', 6.5],
  ['CO', 'Colorado', 2.9], ['CT', 'Connecticut', 6.35], ['DE', 'Delaware', 0], ['GA', 'Georgia', 4],
  ['HI', 'Hawaii', 4], ['ID', 'Idaho', 6], ['IL', 'Illinois', 6.25], ['IN', 'Indiana', 7], ['IA', 'Iowa', 6],
  ['KS', 'Kansas', 6.5], ['KY', 'Kentucky', 6], ['LA', 'Louisiana', 5], ['ME', 'Maine', 5.5],
  ['MD', 'Maryland', 6], ['MA', 'Massachusetts', 6.25], ['MI', 'Michigan', 6], ['MN', 'Minnesota', 6.875],
  ['MS', 'Mississippi', 7], ['MO', 'Missouri', 4.225], ['MT', 'Montana', 0], ['NE', 'Nebraska', 5.5],
  ['NV', 'Nevada', 6.85], ['NH', 'New Hampshire', 0], ['NJ', 'New Jersey', 6.625], ['NM', 'New Mexico', 4.875],
  ['NY', 'New York', 4], ['NC', 'North Carolina', 4.75], ['ND', 'North Dakota', 5], ['OH', 'Ohio', 5.75],
  ['OK', 'Oklahoma', 4.5], ['OR', 'Oregon', 0], ['PA', 'Pennsylvania', 6], ['RI', 'Rhode Island', 7],
  ['SC', 'South Carolina', 6], ['SD', 'South Dakota', 4.2], ['TN', 'Tennessee', 7], ['UT', 'Utah', 6.1],
  ['VT', 'Vermont', 6], ['VA', 'Virginia', 5.3], ['WA', 'Washington', 6.5], ['WV', 'West Virginia', 6],
  ['WI', 'Wisconsin', 5], ['WY', 'Wyoming', 4], ['DC', 'Washington D.C.', 6],
];
for (const [abbr, name, rate] of US_STATES) {
  const key = `US-${abbr}`;
  if (TAX_PRESETS[key]) continue; // keep the hand-tuned CA/TX/FL above
  TAX_PRESETS[key] = { name, region: key, country: 'US', taxes: rate > 0 ? [{ name: 'Sales Tax', rate, is_compound: false, sort_order: 0 }] : [] };
}

/**
 * Applique un preset de taxe (ex. 'QC') à une org, côté serveur, sans
 * session utilisateur (utilisable dans un webhook). Idempotent :
 * n'insère rien si un groupe existe déjà pour cette région.
 *
 * Reproduit exactement la logique de POST /taxes/setup :
 * tax_configs → tax_group → tax_group_items → default sur company_settings.
 *
 * @returns { created: boolean } — false si déjà configuré ou preset inconnu.
 */
export async function seedTaxPreset(
  admin: SupabaseClient,
  orgId: string,
  presetKey: string,
  makeDefault = true,
): Promise<{ created: boolean }> {
  if (!orgId || !presetKey || presetKey === 'LATER' || presetKey === 'NONE') {
    return { created: false };
  }
  const preset = TAX_PRESETS[presetKey];
  if (!preset) {
    console.warn(`[seedTaxPreset] preset inconnu '${presetKey}' pour org ${orgId}`);
    return { created: false };
  }

  // Une seule région par code — même garde que le handler HTTP (évite les
  // groupes/taxes dupliqués au rejeu). supabase-js ne throw pas : on lit l'erreur.
  const { data: existingGroup, error: exErr } = await admin
    .from('tax_groups')
    .select('id')
    .eq('org_id', orgId)
    .eq('region', preset.region)
    .limit(1)
    .maybeSingle();
  if (exErr) {
    console.warn(`[seedTaxPreset] tax_groups lookup failed for org ${orgId}:`, exErr.message);
    return { created: false };
  }
  if (existingGroup) return { created: false };

  // Create tax configs
  const configRows = preset.taxes.map((t) => ({
    org_id: orgId, name: t.name, rate: t.rate, type: 'percentage' as const,
    region: preset.region, country: preset.country,
    is_compound: t.is_compound, sort_order: t.sort_order,
  }));

  let configIds: string[] = [];
  if (configRows.length > 0) {
    const { data: configs, error } = await admin.from('tax_configs').insert(configRows).select('id');
    if (error) throw error;
    configIds = (configs || []).map((c: any) => c.id);
  }

  // Clear existing default if setting a new one
  if (makeDefault) {
    const { error: clearErr } = await admin.from('tax_groups').update({ is_default: false })
      .eq('org_id', orgId).eq('is_default', true);
    if (clearErr) throw clearErr;
  }

  // Create tax group
  const { data: group, error: gErr } = await admin.from('tax_groups').insert({
    org_id: orgId, name: preset.name, region: preset.region,
    country: preset.country, is_default: !!makeDefault,
  }).select('*').single();
  if (gErr) throw gErr;

  // Link configs to group — sans ces liens le groupe ne taxe RIEN.
  if (configIds.length > 0) {
    const linkRows = configIds.map((cid, idx) => ({
      tax_group_id: group.id, tax_config_id: cid, sort_order: idx,
    }));
    const { error: linkErr } = await admin.from('tax_group_items').insert(linkRows);
    if (linkErr) throw linkErr;
  }

  // Set as company default if requested
  if (makeDefault) {
    const { error: defErr } = await admin.from('company_settings').update({ default_tax_group_id: group.id })
      .eq('org_id', orgId);
    if (defErr) throw defErr;
  }

  return { created: true };
}

/**
 * Socle complet d'une nouvelle org, garanti sur TOUTES les portes d'entrée.
 * Chaque brique est idempotente et isolée : un échec (ou une absence
 * d'industrie) ne bloque jamais les autres ni l'activation du compte.
 *
 * @param industry  Industrie saisie par le client. Si absente/vide, le
 *   catalogue de services est simplement sauté — on n'impose JAMAIS de faux
 *   services. Taxes et automatisations, elles, sont universelles → toujours.
 * @param taxRegion Code de région fiscale (défaut 'QC' — cible Québec).
 */
export async function seedOrgComplete(
  admin: SupabaseClient,
  orgId: string,
  opts: { industry?: string | null; taxRegion?: string | null } = {},
): Promise<{ industry: boolean; automations: boolean; taxes: boolean }> {
  const result = { industry: false, automations: false, taxes: false };
  if (!orgId) return result;

  // 1. Catalogue de services métier — uniquement si l'industrie est connue.
  const industry = (opts.industry || '').trim();
  if (industry) {
    try {
      await seedOrgFromIndustry(admin, orgId, industry);
      result.industry = true;
    } catch (err: any) {
      console.warn(`[seedOrgComplete] seedOrgFromIndustry failed for org ${orgId}:`, err?.message);
    }
  }

  // 2. Les 34 automatisations canoniques (universelles — toujours).
  try {
    await ensureAutomationPresets(admin, orgId, { activateAll: true });
    result.automations = true;
  } catch (err: any) {
    console.warn(`[seedOrgComplete] ensureAutomationPresets failed for org ${orgId}:`, err?.message);
  }

  // 3. Taxes (universelles au QC — toujours, sauf région explicitement 'NONE'/'LATER').
  const taxRegion = (opts.taxRegion || 'QC').trim();
  try {
    const r = await seedTaxPreset(admin, orgId, taxRegion, true);
    result.taxes = r.created;
  } catch (err: any) {
    console.warn(`[seedOrgComplete] seedTaxPreset failed for org ${orgId}:`, err?.message);
  }

  return result;
}
