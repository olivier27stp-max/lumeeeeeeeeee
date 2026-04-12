import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

export type ArchiveItemType = 'client' | 'lead' | 'job';

export interface ArchivedItem {
  id: string;
  type: ArchiveItemType;
  name: string;
  company?: string | null;
  email?: string | null;
  status?: string | null;
  client_name?: string | null;
  job_number?: string | null;
  archived_at: string;
  archived_by: string | null;
}

export interface ArchiveData {
  clients: ArchivedItem[];
  leads: ArchivedItem[];
  jobs: ArchivedItem[];
}

export async function fetchArchivedItems(): Promise<ArchiveData> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase.rpc('list_archived_items', { p_org_id: orgId });
  if (error) throw error;

  const result = data as any;
  return {
    clients: (result?.clients || []) as ArchivedItem[],
    leads: (result?.leads || []) as ArchivedItem[],
    jobs: (result?.jobs || []) as ArchivedItem[],
  };
}

export async function restoreClient(clientId: string): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase.rpc('restore_client', {
    p_org_id: orgId,
    p_client_id: clientId,
  });
  if (error) throw error;
}

export async function restoreLead(leadId: string): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase.rpc('restore_lead', {
    p_org_id: orgId,
    p_lead_id: leadId,
  });
  if (error) throw error;
}

export async function restoreJob(jobId: string): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase.rpc('restore_job', {
    p_org_id: orgId,
    p_job_id: jobId,
  });
  if (error) throw error;
}

export async function restoreItem(type: ArchiveItemType, id: string): Promise<void> {
  switch (type) {
    case 'client': return restoreClient(id);
    case 'lead': return restoreLead(id);
    case 'job': return restoreJob(id);
  }
}

export async function permanentDeleteItem(type: ArchiveItemType, id: string): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  if (type === 'client') {
    const { error } = await supabase.rpc('delete_client_cascade', {
      p_org_id: orgId,
      p_client_id: id,
      p_deleted_by: null,
    });
    if (error) throw error;
  } else if (type === 'job') {
    const { error } = await supabase.rpc('delete_job_cascade', {
      p_org_id: orgId,
      p_job_id: id,
    });
    if (error) throw error;
  } else if (type === 'lead') {
    const { error } = await supabase.rpc('delete_lead_cascade', {
      p_org_id: orgId,
      p_lead_id: id,
    });
    if (error) throw error;
  }
}
