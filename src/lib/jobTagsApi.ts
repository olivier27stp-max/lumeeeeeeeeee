import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

/**
 * Étiquettes de jobs par organisation (table job_tags) + assignation via
 * jobs.tag_ids (uuid[]). Aucun tag par défaut : la liste démarre vide et
 * tout est créé par l'utilisateur (nom + couleur) depuis le menu déroulant.
 */
export interface JobTagRecord {
  id: string;
  org_id: string;
  name: string;
  color_hex: string;
}

const TAG_COLUMNS = 'id,org_id,name,color_hex';

export async function listJobTags(): Promise<JobTagRecord[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('job_tags')
    .select(TAG_COLUMNS)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('name');
  // Table absente tant que la migration 20260752000000 n'est pas appliquée :
  // la feature reste silencieusement vide plutôt que de casser la page.
  if (error) return [];
  return data || [];
}

export async function createJobTag(name: string, colorHex: string): Promise<JobTagRecord> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('job_tags')
    .insert({ org_id: orgId, name: name.trim(), color_hex: colorHex })
    .select(TAG_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function updateJobTag(
  id: string,
  patch: { name?: string; color_hex?: string },
): Promise<JobTagRecord> {
  const { data, error } = await supabase
    .from('job_tags')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(TAG_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function softDeleteJobTag(id: string): Promise<void> {
  const { error } = await supabase
    .from('job_tags')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Remplace la liste de tags d'une job (écrit jobs.tag_ids). */
export async function setJobTagIds(jobId: string, tagIds: string[]): Promise<void> {
  const { error } = await supabase
    .from('jobs')
    .update({ tag_ids: tagIds })
    .eq('id', jobId);
  if (error) throw error;
}
