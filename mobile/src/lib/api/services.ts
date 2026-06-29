// Predefined services catalog (same as the web's quote/job service picker).
import { supabase } from '../supabase';

export interface PredefinedService {
  id: string;
  name: string;
  description: string | null;
  default_price_cents: number;
  category: string | null;
}

export async function listServices(orgId: string, search = ''): Promise<PredefinedService[]> {
  let q = supabase
    .from('predefined_services')
    .select('id, name, description, default_price_cents, category')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(50);
  if (search.trim().length > 0) q = q.ilike('name', `%${search.trim()}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as PredefinedService[];
}

/** Create a new catalog service (the "create new service" option). */
export async function createService(params: {
  orgId: string;
  name: string;
  defaultPriceCents: number;
  description?: string | null;
}): Promise<PredefinedService> {
  const { data, error } = await supabase
    .from('predefined_services')
    .insert({
      org_id: params.orgId,
      name: params.name,
      default_price_cents: params.defaultPriceCents,
      description: params.description ?? null,
      is_active: true,
    })
    .select('id, name, description, default_price_cents, category')
    .single();
  if (error) throw new Error(error.message);
  return data as PredefinedService;
}
