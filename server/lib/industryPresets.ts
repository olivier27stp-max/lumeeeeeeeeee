/* industryPresets.ts — per-industry seed data for new tenants.
   Used by the onboarding completion endpoint to pre-populate
   `predefined_services` and to set sensible defaults in
   `company_settings`. End-user visible strings are in French. */

import type { SupabaseClient } from '@supabase/supabase-js';

export type IndustryPreset = {
  jobTypes: Array<{ name: string; estimatedHours: number }>;
  quoteLineItems: Array<{ description: string; unit: string; defaultPrice?: number }>;
  defaultUnit: string;
};

const PRESETS: Record<string, IndustryPreset> = {
  landscaping: {
    jobTypes: [
      { name: 'Tonte de gazon', estimatedHours: 1 },
      { name: 'Taille de haies', estimatedHours: 2 },
      { name: 'Aménagement paysager', estimatedHours: 8 },
      { name: 'Plantation', estimatedHours: 3 },
      { name: 'Nettoyage printemps/automne', estimatedHours: 4 },
    ],
    quoteLineItems: [
      { description: 'Tonte de gazon (résidentiel)', unit: 'visite', defaultPrice: 50 },
      { description: 'Taille de haies', unit: 'm linéaire', defaultPrice: 8 },
      { description: 'Plantation de fleurs annuelles', unit: 'unité', defaultPrice: 5 },
    ],
    defaultUnit: 'visite',
  },

  snow_removal: {
    jobTypes: [
      { name: 'Déneigement saisonnier', estimatedHours: 1 },
      { name: 'Sortie ponctuelle', estimatedHours: 1 },
      { name: 'Déneigement toiture', estimatedHours: 4 },
      { name: 'Épandage sel/abrasif', estimatedHours: 1 },
    ],
    quoteLineItems: [
      { description: 'Contrat saisonnier résidentiel', unit: 'saison', defaultPrice: 450 },
      { description: 'Sortie ponctuelle', unit: 'sortie', defaultPrice: 75 },
      { description: 'Épandage de sel', unit: 'application', defaultPrice: 35 },
    ],
    defaultUnit: 'saison',
  },

  residential_cleaning: {
    jobTypes: [
      { name: 'Ménage régulier', estimatedHours: 2 },
      { name: 'Grand ménage', estimatedHours: 5 },
      { name: 'Ménage déménagement', estimatedHours: 6 },
      { name: 'Lavage de tapis', estimatedHours: 2 },
    ],
    quoteLineItems: [
      { description: 'Ménage résidentiel régulier', unit: 'heure', defaultPrice: 45 },
      { description: 'Grand ménage', unit: 'forfait', defaultPrice: 250 },
      { description: 'Lavage de tapis', unit: 'pièce', defaultPrice: 60 },
    ],
    defaultUnit: 'heure',
  },

  commercial_cleaning: {
    jobTypes: [
      { name: 'Entretien quotidien bureau', estimatedHours: 2 },
      { name: 'Nettoyage hebdomadaire', estimatedHours: 4 },
      { name: 'Décapage de planchers', estimatedHours: 6 },
      { name: 'Nettoyage vitres commercial', estimatedHours: 3 },
    ],
    quoteLineItems: [
      { description: 'Entretien commercial', unit: 'pied carré', defaultPrice: 0.12 },
      { description: 'Forfait mensuel bureau', unit: 'mois', defaultPrice: 800 },
      { description: 'Décapage et cirage', unit: 'pied carré', defaultPrice: 0.45 },
    ],
    defaultUnit: 'pied carré',
  },

  plumbing: {
    jobTypes: [
      { name: 'Débouchage de drain', estimatedHours: 1 },
      { name: 'Installation', estimatedHours: 3 },
      { name: 'Réparation fuite', estimatedHours: 2 },
      { name: 'Urgence 24h', estimatedHours: 2 },
      { name: 'Inspection caméra', estimatedHours: 1 },
    ],
    quoteLineItems: [
      { description: 'Appel de service (1 heure)', unit: 'visite', defaultPrice: 125 },
      { description: 'Débouchage de drain', unit: 'forfait', defaultPrice: 175 },
      { description: 'Heure supplémentaire', unit: 'heure', defaultPrice: 95 },
    ],
    defaultUnit: 'visite',
  },

  electrical: {
    jobTypes: [
      { name: 'Installation luminaire', estimatedHours: 1 },
      { name: 'Dépannage panneau', estimatedHours: 2 },
      { name: 'Mise aux normes', estimatedHours: 8 },
      { name: 'Installation borne VE', estimatedHours: 4 },
      { name: 'Inspection préachat', estimatedHours: 2 },
    ],
    quoteLineItems: [
      { description: 'Appel de service électrique', unit: 'visite', defaultPrice: 135 },
      { description: 'Installation prise', unit: 'unité', defaultPrice: 85 },
      { description: 'Borne de recharge VE', unit: 'forfait', defaultPrice: 1200 },
    ],
    defaultUnit: 'visite',
  },

  roofing: {
    jobTypes: [
      { name: 'Inspection toiture', estimatedHours: 1 },
      { name: 'Réparation localisée', estimatedHours: 3 },
      { name: 'Remplacement complet bardeaux', estimatedHours: 24 },
      { name: 'Réparation solin', estimatedHours: 2 },
    ],
    quoteLineItems: [
      { description: 'Inspection complète', unit: 'forfait', defaultPrice: 200 },
      { description: 'Réfection toiture (bardeaux)', unit: 'pied carré', defaultPrice: 6.5 },
      { description: 'Réparation solin de cheminée', unit: 'forfait', defaultPrice: 450 },
    ],
    defaultUnit: 'pied carré',
  },

  hvac: {
    jobTypes: [
      { name: 'Installation climatiseur', estimatedHours: 6 },
      { name: 'Entretien annuel', estimatedHours: 1 },
      { name: 'Réparation urgence', estimatedHours: 2 },
      { name: 'Installation thermopompe', estimatedHours: 8 },
    ],
    quoteLineItems: [
      { description: 'Entretien préventif annuel', unit: 'forfait', defaultPrice: 175 },
      { description: 'Appel de service urgence', unit: 'visite', defaultPrice: 165 },
      { description: 'Installation thermopompe murale', unit: 'unité', defaultPrice: 3500 },
    ],
    defaultUnit: 'visite',
  },

  window_cleaning: {
    jobTypes: [
      { name: 'Lavage vitres résidentiel intérieur', estimatedHours: 2 },
      { name: 'Lavage vitres résidentiel extérieur', estimatedHours: 2 },
      { name: 'Lavage vitres commercial', estimatedHours: 4 },
      { name: 'Nettoyage gouttières', estimatedHours: 2 },
    ],
    quoteLineItems: [
      { description: 'Lavage vitres résidentiel (int+ext)', unit: 'maison', defaultPrice: 175 },
      { description: 'Lavage vitres commercial', unit: 'vitre', defaultPrice: 8 },
      { description: 'Nettoyage gouttières', unit: 'pied linéaire', defaultPrice: 2.5 },
    ],
    defaultUnit: 'maison',
  },

  other: {
    jobTypes: [],
    quoteLineItems: [],
    defaultUnit: 'unité',
  },
};

export function getIndustryPreset(industry: string): IndustryPreset {
  return PRESETS[industry] || PRESETS.other;
}

/** Returns the list of supported industry keys (for validation). */
export function listIndustries(): string[] {
  return Object.keys(PRESETS);
}

/**
 * Seed an organization with industry-specific defaults.
 * - Inserts predefined_services for each quote line item (best-effort)
 * - Sets company_settings.industry + default_unit
 */
export async function seedOrgFromIndustry(
  serviceClient: SupabaseClient,
  orgId: string,
  industry: string,
): Promise<void> {
  if (!orgId || !industry) return;
  const preset = getIndustryPreset(industry);

  // 1. Upsert company_settings (industry + default_unit)
  // supabase-js ne leve pas : l'erreur est dans la reponse, pas dans un throw.
  const { error: settingsErr } = await serviceClient
    .from('company_settings')
    .upsert(
      {
        org_id: orgId,
        industry,
        default_unit: preset.defaultUnit,
      },
      { onConflict: 'org_id' },
    );
  if (settingsErr) {
    console.warn(`[industryPresets] company_settings upsert failed for org ${orgId}:`, settingsErr.message);
  }

  // 2. Insert predefined_services — one row per quote line item.
  //    Skip if the org already has predefined services (don't double-seed).
  if (preset.quoteLineItems.length === 0) return;

  const { data: existing, error: existingErr } = await serviceClient
    .from('predefined_services')
    .select('id')
    .eq('org_id', orgId)
    .limit(1);
  if (existingErr) {
    // Lecture en echec : impossible de savoir si l'org est deja semee — mieux
    // vaut ne rien inserer que de doubler le catalogue de services.
    console.warn(`[industryPresets] predefined_services lookup failed for org ${orgId}:`, existingErr.message);
    return;
  }
  if (existing && existing.length > 0) return;

  const rows = preset.quoteLineItems.map((item, idx) => ({
    org_id: orgId,
    name: item.description,
    description: item.description,
    default_price_cents: Math.round((item.defaultPrice || 0) * 100),
    category: industry,
    default_duration_minutes: 60,
    is_active: true,
    sort_order: idx,
  }));
  const { error: seedErr } = await serviceClient.from('predefined_services').insert(rows);
  if (seedErr) {
    console.warn(`[industryPresets] predefined_services seed failed for org ${orgId}:`, seedErr.message);
  }
}
