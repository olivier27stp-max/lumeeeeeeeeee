// Materials / expenses logged by a tech on a job. Table: job_materials (see
// migration 20260704000000_job_materials.sql — run it in Supabase if not yet).
// Reads gracefully so the UI doesn't crash before the table exists.

import { supabase } from '../supabase';

export interface JobMaterial {
  id: string;
  job_id: string;
  name: string;
  quantity: number;
  unit: string | null;
  unit_cost_cents: number | null;
  note: string | null;
  created_at: string;
}

export async function listJobMaterials(jobId: string): Promise<JobMaterial[]> {
  const { data, error } = await supabase
    .from('job_materials')
    .select('id, job_id, name, quantity, unit, unit_cost_cents, note, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) return []; // table may not exist yet
  return (data ?? []) as JobMaterial[];
}

export async function addJobMaterial(input: {
  orgId: string;
  jobId: string;
  createdBy: string;
  name: string;
  quantity?: number;
  unit?: string | null;
  unitCostCents?: number | null;
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase.from('job_materials').insert({
    org_id: input.orgId,
    job_id: input.jobId,
    created_by: input.createdBy,
    name: input.name.trim(),
    quantity: input.quantity ?? 1,
    unit: input.unit ?? null,
    unit_cost_cents: input.unitCostCents ?? null,
    note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function deleteJobMaterial(id: string): Promise<void> {
  const { error } = await supabase.from('job_materials').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
