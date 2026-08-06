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

// job_checklists has no `name` column — the label lives on the template it was
// created from. We embed it. Two foreign keys point at checklist_templates
// (id, and the composite org_id+template_id), so the relationship has to be
// named explicitly or PostgREST refuses the embed as ambiguous.
const CHECKLIST_COLS =
  'id, job_id, template_id, items, responses, completed_at, completed_by, ' +
  'checklist_templates!job_checklists_template_id_fkey(name)';

function toChecklist(row: any): JobChecklist {
  const { checklist_templates, ...rest } = row ?? {};
  const tpl = Array.isArray(checklist_templates) ? checklist_templates[0] : checklist_templates;
  return { ...rest, name: (tpl?.name as string | undefined) ?? null } as JobChecklist;
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
    .select(CHECKLIST_COLS)
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toChecklist);
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
      items: input.template.items,
      responses: {},
    })
    .select(CHECKLIST_COLS)
    .single();
  if (error) throw new Error(error.message);
  return toChecklist(data);
}

export async function getJobChecklist(id: string): Promise<JobChecklist | null> {
  const { data, error } = await supabase
    .from('job_checklists')
    .select(CHECKLIST_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toChecklist(data) : null;
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
