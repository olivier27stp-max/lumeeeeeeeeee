import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

/** Unité de tarification d'un service : forfait, $/pi linéaire ou $/pi². */
export type ServicePricingUnit = 'flat' | 'linear_ft' | 'sq_ft';

export interface PredefinedService {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  default_price_cents: number;
  category: string | null;
  default_duration_minutes: number | null;
  is_active: boolean;
  sort_order: number;
  /** flat = forfait (défaut historique); linear_ft/sq_ft = tarifé à la mesure. */
  pricing_unit: ServicePricingUnit;
  /** Attaché automatiquement aux nouvelles mesures du type correspondant. */
  measure_default: boolean;
  created_at: string;
  updated_at: string;
}

export async function listPredefinedServices(): Promise<PredefinedService[]> {
  // Filter by the ACTIVE org explicitly — RLS alone lets every org the user
  // belongs to through, which mixes catalogs for multi-office companies.
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('predefined_services')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as PredefinedService[];
}

export async function createPredefinedService(service: {
  name: string;
  description?: string;
  default_price_cents: number;
  category?: string;
  default_duration_minutes?: number;
  pricing_unit?: ServicePricingUnit;
  measure_default?: boolean;
}): Promise<PredefinedService> {
  // Use the ACTIVE org — resolving via `memberships … limit(1)` picked an
  // arbitrary org for multi-org users, so services landed in the wrong company.
  const orgId = await getCurrentOrgIdOrThrow();

  const base = {
    org_id: orgId,
    name: service.name,
    description: service.description || null,
    default_price_cents: service.default_price_cents,
    category: service.category || null,
    default_duration_minutes: service.default_duration_minutes || null,
  };
  let { data, error } = await supabase
    .from('predefined_services')
    .insert({
      ...base,
      pricing_unit: service.pricing_unit || 'flat',
      measure_default: service.measure_default ?? false,
    })
    .select()
    .single();
  // Migration 20260802100000 pas encore appliquée : on retombe sur les champs
  // historiques pour ne jamais bloquer la création de services.
  if (error && /pricing_unit|measure_default/.test(error.message || '')) {
    ({ data, error } = await supabase.from('predefined_services').insert(base).select().single());
  }
  if (error) throw error;
  return data as PredefinedService;
}

export async function updatePredefinedService(id: string, updates: Partial<{
  name: string;
  description: string;
  default_price_cents: number;
  category: string;
  default_duration_minutes: number;
  is_active: boolean;
  sort_order: number;
  pricing_unit: ServicePricingUnit;
  measure_default: boolean;
}>): Promise<PredefinedService> {
  let { data, error } = await supabase
    .from('predefined_services')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  // Migration 20260802100000 pas encore appliquée : réessaie sans les champs
  // d'unité de tarification pour ne jamais bloquer l'édition de services.
  if (error && /pricing_unit|measure_default/.test(error.message || '')) {
    const { pricing_unit: _pu, measure_default: _md, ...legacy } = updates as Record<string, unknown>;
    ({ data, error } = await supabase
      .from('predefined_services')
      .update({ ...legacy, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single());
  }
  if (error) throw error;
  return data as PredefinedService;
}

/**
 * Soft delete: quotes/jobs keep referencing the row, it just stops being
 * offered in pickers. Hard delete would orphan historical line items.
 */
export async function archivePredefinedService(id: string): Promise<void> {
  const { error } = await supabase
    .from('predefined_services')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
