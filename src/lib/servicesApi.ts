import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

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
}): Promise<PredefinedService> {
  // Use the ACTIVE org — resolving via `memberships … limit(1)` picked an
  // arbitrary org for multi-org users, so services landed in the wrong company.
  const orgId = await getCurrentOrgIdOrThrow();

  const { data, error } = await supabase
    .from('predefined_services')
    .insert({
      org_id: orgId,
      name: service.name,
      description: service.description || null,
      default_price_cents: service.default_price_cents,
      category: service.category || null,
      default_duration_minutes: service.default_duration_minutes || null,
    })
    .select()
    .single();
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
}>): Promise<PredefinedService> {
  const { data, error } = await supabase
    .from('predefined_services')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
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
