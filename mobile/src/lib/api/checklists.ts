// Job checklists / on-site forms. Templates are created on the desktop (admin
// only per RLS); technicians attach a template to a job and fill it in.
// Tables: checklist_templates (read), job_checklists (member read/write).

import { supabase } from '../supabase';

export type ChecklistItemType = 'checkbox' | 'text' | 'number' | 'photo' | 'signature';

export interface ChecklistItem {
  id: string;
  type: ChecklistItemType;
  label: string;
  required?: boolean;
}

export interface ChecklistTemplate {
  id: string;
  name: string;
  description: string | null;
  job_type: string | null;
  items: ChecklistItem[];
}

export interface JobChecklist {
  id: string;
  job_id: string;
  template_id: string | null;
  name: string | null;
  items: ChecklistItem[];
  responses: Record<string, unknown>;
  completed_at: string | null;
  completed_by: string | null;
}

/** Active templates for the org (optionally filtered to a job_type). */
export async function listChecklistTemplates(
  orgId: string,
  jobType?: string | null,
): Promise<ChecklistTemplate[]> {
  let q = supabase
    .from('checklist_templates')
    .select('id, name, description, job_type, items')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('name', { ascending: true });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as ChecklistTemplate[];
  // Show templates with no job_type (universal) + those matching this job.
  if (jobType) rows = rows.filter((t) => !t.job_type || t.job_type === jobType);
  return rows;
}

/** Checklist instances attached to a job. */
export async function listJobChecklists(jobId: string): Promise<JobChecklist[]> {
  const { data, error } = await supabase
    .from('job_checklists')
    .select('id, job_id, template_id, name, items, responses, completed_at, completed_by')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as JobChecklist[];
}

/** Attach a template to a job (snapshots the template's items). */
export async function attachChecklist(input: {
  orgId: string;
  jobId: string;
  template: ChecklistTemplate;
}): Promise<JobChecklist> {
  const { data, error } = await supabase
    .from('job_checklists')
    .insert({
      org_id: input.orgId,
      job_id: input.jobId,
      template_id: input.template.id,
      name: input.template.name,
      items: input.template.items,
      responses: {},
    })
    .select('id, job_id, template_id, name, items, responses, completed_at, completed_by')
    .single();
  if (error) throw new Error(error.message);
  return data as JobChecklist;
}

export async function getJobChecklist(id: string): Promise<JobChecklist | null> {
  const { data, error } = await supabase
    .from('job_checklists')
    .select('id, job_id, template_id, name, items, responses, completed_at, completed_by')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as JobChecklist | null) ?? null;
}

/** Save in-progress responses (no completion). */
export async function saveChecklistResponses(
  id: string,
  responses: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('job_checklists')
    .update({ responses })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Save responses and mark the checklist complete. */
export async function completeChecklist(
  id: string,
  responses: Record<string, unknown>,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('job_checklists')
    .update({ responses, completed_at: new Date().toISOString(), completed_by: userId })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
