import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

/**
 * A service contract is the client-facing summary of a service-plan job
 * (jobs.job_type = 'recurring'): a 12-month calendar for a given year where
 * each planned month holds the exact visit date. The visits themselves are
 * regular schedule_events; the contract only mirrors the plan. See migration
 * `20260712000000_service_contracts.sql`.
 */
export interface ServiceContractVisitItem {
  name: string;
  qty: number;
  unit_price_cents: number;
}

export interface ServiceContractVisit {
  /** 1..12 */
  month: number;
  /** YYYY-MM-DD */
  date: string;
  /** Année de la visite — absent sur les vieux contrats (= year du contrat). */
  year?: number;
  /** HH:mm — only set when the plan's hours are personalized per visit */
  start_time?: string;
  /** HH:mm — only set when the plan's hours are personalized per visit */
  end_time?: string;
  /** Only set when the plan's products/services are personalized per visit */
  items?: ServiceContractVisitItem[];
}

export interface ServiceContract {
  id: string;
  org_id: string;
  job_id: string;
  client_id: string | null;
  title: string;
  year: number;
  visits: ServiceContractVisit[];
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 = undefined_table; PGRST205 = table not found in PostgREST schema cache
  return error.code === '42P01' || error.code === 'PGRST205' || /service_contracts/.test(error.message || '');
}

function mapContract(raw: any): ServiceContract {
  return {
    id: raw.id,
    org_id: raw.org_id,
    job_id: raw.job_id,
    client_id: raw.client_id ?? null,
    title: raw.title || '',
    year: Number(raw.year),
    visits: Array.isArray(raw.visits)
      ? raw.visits
          .map((v: any): ServiceContractVisit => ({
            month: Number(v?.month),
            date: String(v?.date || ''),
            ...(Number(v?.year) ? { year: Number(v.year) } : {}),
            ...(v?.start_time ? { start_time: String(v.start_time) } : {}),
            ...(v?.end_time ? { end_time: String(v.end_time) } : {}),
            ...(Array.isArray(v?.items)
              ? {
                  items: v.items
                    .map((it: any): ServiceContractVisitItem => ({
                      name: String(it?.name || ''),
                      qty: Number(it?.qty) || 1,
                      unit_price_cents: Number(it?.unit_price_cents) || 0,
                    }))
                    .filter((it: ServiceContractVisitItem) => it.name),
                }
              : {}),
          }))
          .filter((v: ServiceContractVisit) => v.month >= 1 && v.month <= 12 && v.date)
      : [],
    status: raw.status || 'active',
    notes: raw.notes ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

/**
 * Best-effort creation: if the migration hasn't been applied yet the insert
 * silently no-ops (returns null) so job creation never breaks.
 */
export async function createServiceContract(payload: {
  job_id: string;
  client_id?: string | null;
  title: string;
  year: number;
  visits: ServiceContractVisit[];
  notes?: string | null;
}): Promise<ServiceContract | null> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('service_contracts')
    .insert({
      org_id: orgId,
      job_id: payload.job_id,
      client_id: payload.client_id || null,
      title: payload.title,
      year: payload.year,
      visits: payload.visits,
      notes: payload.notes || null,
      status: 'active',
    })
    .select('*')
    .single();
  if (error) {
    if (isMissingTableError(error)) {
      console.warn('[service-contracts] table missing (migration pending) — contract skipped');
      return null;
    }
    throw error;
  }
  return mapContract(data);
}

/** Latest active contract for a job, or null (also null if migration pending). */
export async function getServiceContractByJob(jobId: string): Promise<ServiceContract | null> {
  if (!jobId) return null;
  const { data, error } = await supabase
    .from('service_contracts')
    .select('*')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
  return data ? mapContract(data) : null;
}
