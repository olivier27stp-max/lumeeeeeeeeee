// Job billing split — payment schedule (milestones) CRUD + per-milestone
// invoice creation. When jobs.billing_split is true, the job is billed
// through these milestones instead of a single full invoice.
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import type { CreateInvoiceFromJobResult } from './invoicesApi';

export interface JobBillingMilestone {
  id: string;
  job_id: string;
  position: number;
  label: string;
  percent: number | null;
  amount_cents: number;
  due_date: string | null;
}

export interface JobBillingMilestoneDraft {
  id?: string | null; // existing row id, or null/undefined for a new row
  position: number;
  label: string;
  percent: number | null;
  amount_cents: number;
  due_date: string | null;
}

function mapRow(raw: any): JobBillingMilestone {
  return {
    id: raw.id,
    job_id: raw.job_id,
    position: Number(raw.position || 0),
    label: raw.label || '',
    percent: raw.percent === null || raw.percent === undefined ? null : Number(raw.percent),
    amount_cents: Number(raw.amount_cents || 0),
    due_date: raw.due_date || null,
  };
}

export async function listJobBillingMilestones(jobId: string): Promise<JobBillingMilestone[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('job_billing_milestones')
    .select('id,job_id,position,label,percent,amount_cents,due_date')
    .eq('org_id', orgId)
    .eq('job_id', jobId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapRow);
}

/**
 * Persist the full schedule: rows missing from `drafts` are deleted,
 * rows with an id are updated, rows without an id are inserted.
 * Returns the fresh list (with ids for the new rows).
 */
export async function saveJobBillingMilestones(
  jobId: string,
  drafts: JobBillingMilestoneDraft[],
): Promise<JobBillingMilestone[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const existing = await listJobBillingMilestones(jobId);
  const keepIds = new Set(drafts.map((d) => d.id).filter(Boolean) as string[]);
  const toDelete = existing.filter((m) => !keepIds.has(m.id)).map((m) => m.id);

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from('job_billing_milestones')
      .delete()
      .in('id', toDelete)
      .eq('org_id', orgId)
      .eq('job_id', jobId);
    if (error) throw error;
  }

  for (const draft of drafts) {
    const fields = {
      position: draft.position,
      label: draft.label.trim(),
      percent: draft.percent,
      amount_cents: Math.max(0, Math.round(draft.amount_cents)),
      due_date: draft.due_date || null,
    };
    if (draft.id) {
      const { error } = await supabase
        .from('job_billing_milestones')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', draft.id)
        .eq('org_id', orgId)
        .eq('job_id', jobId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('job_billing_milestones')
        .insert({ ...fields, org_id: orgId, job_id: jobId });
      if (error) throw error;
    }
  }

  return listJobBillingMilestones(jobId);
}

export async function setJobBillingSplit(jobId: string, split: boolean): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase
    .from('jobs')
    .update({ billing_split: split, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('org_id', orgId);
  if (error) throw error;
}

/**
 * Facture d'une visite terminée (jobs.billing_mode = 'per_visit') — le
 * serveur calcule la part de la visite (total du job ÷ nb de visites, la
 * dernière prend le reste exact). Idempotent : une visite = une facture.
 */
export async function createInvoiceForVisit(payload: {
  jobId: string;
  visitId: string;
  sendNow?: boolean;
}): Promise<CreateInvoiceFromJobResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You need to be authenticated for this action.');

  const response = await fetch('/api/invoices/from-job', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jobId: payload.jobId,
      visitId: payload.visitId,
      sendNow: Boolean(payload.sendNow),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || `Request failed (${response.status}).`);
  }
  return body as CreateInvoiceFromJobResult;
}

export async function createInvoiceForMilestone(payload: {
  jobId: string;
  milestoneId: string;
  sendNow?: boolean;
}): Promise<CreateInvoiceFromJobResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You need to be authenticated for this action.');

  const response = await fetch('/api/invoices/from-job', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jobId: payload.jobId,
      milestoneId: payload.milestoneId,
      sendNow: Boolean(payload.sendNow),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || `Request failed (${response.status}).`);
  }
  return body as CreateInvoiceFromJobResult;
}
