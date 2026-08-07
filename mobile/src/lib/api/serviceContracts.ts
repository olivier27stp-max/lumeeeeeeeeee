// Contrats de service — portage de src/lib/serviceContractsApi.ts (web).
// Un plan de service peut créer son contrat : la liste des visites y est figée
// en jsonb, telle qu'elle a été planifiée.

import { supabase } from '../supabase';

export interface ServiceContractVisit {
  /** 1..12 */
  month: number;
  /** YYYY-MM-DD */
  date: string;
  year?: number;
  /** HH:mm — seulement si les heures sont personnalisées pour cette visite */
  start_time?: string;
  /** HH:mm — idem */
  end_time?: string;
  /** Seulement quand les produits/services sont personnalisés par visite. */
  items?: { name: string; qty: number; unit_price_cents: number }[];
}

export async function createServiceContract(payload: {
  orgId: string;
  job_id: string;
  client_id?: string | null;
  title: string;
  year: number;
  visits: ServiceContractVisit[];
  notes?: string | null;
}): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('service_contracts')
    .insert({
      org_id: payload.orgId,
      job_id: payload.job_id,
      client_id: payload.client_id || null,
      created_by: userData?.user?.id ?? null,
      title: payload.title,
      year: payload.year,
      visits: payload.visits,
      notes: payload.notes || null,
      status: 'active',
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data?.id as string) ?? null;
}
