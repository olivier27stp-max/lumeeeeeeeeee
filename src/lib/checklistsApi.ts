import { supabase } from './supabase';

const API_BASE = '/api';

export type ChecklistItemType = 'checkbox' | 'text' | 'number' | 'photo' | 'signature';

export interface ChecklistItem {
  id: string;
  type: ChecklistItemType;
  label: string;
  required?: boolean;
}

export interface ChecklistTemplate {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  job_type: string | null;
  items: ChecklistItem[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface JobChecklist {
  id: string;
  org_id: string;
  job_id: string;
  template_id: string | null;
  items: ChecklistItem[];
  responses: Record<string, unknown>;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    'X-Requested-With': 'fetch',
  };
}

// ── Templates ──
export async function listChecklistTemplates(includeInactive = false): Promise<ChecklistTemplate[]> {
  const headers = await authHeaders();
  const url = includeInactive
    ? `${API_BASE}/checklist-templates?include_inactive=true`
    : `${API_BASE}/checklist-templates`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load templates');
  const { templates } = await res.json();
  return templates || [];
}

export interface ChecklistTemplatePayload {
  name: string;
  description?: string | null;
  job_type?: string | null;
  items?: ChecklistItem[];
  is_active?: boolean;
}

export async function createChecklistTemplate(payload: ChecklistTemplatePayload): Promise<ChecklistTemplate> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/checklist-templates`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create template');
  return (await res.json()).template;
}

export async function updateChecklistTemplate(id: string, payload: Partial<ChecklistTemplatePayload>): Promise<ChecklistTemplate> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/checklist-templates/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update template');
  return (await res.json()).template;
}

export async function deleteChecklistTemplate(id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/checklist-templates/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete template');
}

// ── Instances (attached to a job) ──
export async function listJobChecklists(jobId: string): Promise<JobChecklist[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/jobs/${jobId}/checklists`, { headers });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to load checklists');
  return (await res.json()).checklists || [];
}

export async function createJobChecklist(
  jobId: string,
  payload: { template_id?: string | null; items?: ChecklistItem[] },
): Promise<JobChecklist> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/jobs/${jobId}/checklists`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to create checklist');
  return (await res.json()).checklist;
}

export async function updateJobChecklist(
  jobId: string,
  id: string,
  payload: { responses?: Record<string, unknown>; completed?: boolean },
): Promise<JobChecklist> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/jobs/${jobId}/checklists/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to update checklist');
  return (await res.json()).checklist;
}

export async function deleteJobChecklist(jobId: string, id: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/jobs/${jobId}/checklists/${id}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete checklist');
}
