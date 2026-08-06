// CRM leads / pipeline.
//
// A lead IS a row of `clients` with status='lead' — the standalone `leads`
// table was removed by migration 20260705000000_eliminate_leads_table.sql.
// The funnel stage lives in the separate `clients.lead_status` column, which
// this module exposes as `Lead.status` so callers keep working.
//
// Creating a lead writes two rows, exactly like the web server route
// (server/routes/leads.ts): the client, then its pipeline card. Without the
// second one the lead is invisible in the desktop pipeline.

import { supabase } from '../supabase';
import { tr } from '@/lib/i18n';

export interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  assigned_to: string | null;
  notes: string | null;
  value: number;
  created_at: string;
}

/** Display order + labels for the D2D / sales pipeline stages. */
export const LEAD_STAGES: { key: string; label: string }[] = [
  { key: 'new_prospect', label: 'Nouveau' },
  { key: 'no_response', label: 'Sans réponse' },
  { key: 'quote_sent', label: 'Soumission envoyée' },
  { key: 'closed_won', label: 'Gagné' },
  { key: 'closed_lost', label: 'Perdu' },
];

/** Legacy slugs still present in older rows → canonical stage. */
const LEGACY_STAGES: Record<string, string> = {
  new: 'new_prospect',
  contacted: 'no_response',
  follow_up_1: 'no_response',
  follow_up_2: 'no_response',
  follow_up_3: 'no_response',
  won: 'closed_won',
  closed: 'closed_won',
  lost: 'closed_lost',
};

export function normalizeStage(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return 'new_prospect';
  return LEGACY_STAGES[s] ?? s;
}

// `status` is aliased onto lead_status: callers speak stages, not client state.
const COLS =
  'id, first_name, last_name, company, email, phone, source, status:lead_status, assigned_to, notes, value, created_at';

function toLead(row: any): Lead {
  return { ...row, status: normalizeStage(row?.status), value: Number(row?.value ?? 0) } as Lead;
}

export async function listLeads(
  orgId: string,
  opts: { assignedTo?: string | null } = {},
): Promise<Lead[]> {
  let q = supabase
    .from('clients')
    .select(COLS)
    .eq('org_id', orgId)
    .eq('status', 'lead')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (opts.assignedTo) q = q.eq('assigned_to', opts.assignedTo);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(toLead);
}

/** The lead source of a client, e.g. "referral". The lead id IS the client id. */
export async function getClientLeadSource(clientId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('source')
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) return null;
  return (data?.source as string | null) ?? null;
}

export async function createLead(input: {
  orgId: string;
  firstName: string;
  lastName?: string;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  source?: string | null;
  status?: string;
  assignedTo?: string | null;
  notes?: string | null;
  value?: number;
}): Promise<Lead> {
  // Both clients and pipeline_deals require created_by = auth.uid() (RLS).
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) throw new Error(tr().mobileErrors.sessionExpired);

  const stage = normalizeStage(input.status);
  const value = Number.isFinite(input.value) ? Number(input.value) : 0;
  const company = input.company ?? null;
  const firstName = input.firstName.trim() || 'Lead';
  const lastName = (input.lastName ?? '').trim();

  const { data: created, error } = await supabase
    .from('clients')
    .insert({
      org_id: input.orgId,
      created_by: userId,
      status: 'lead',
      lead_status: stage,
      first_name: firstName,
      last_name: lastName,
      phone: input.phone ?? null,
      email: input.email ?? null,
      company,
      title: company,
      source: input.source ?? 'mobile',
      assigned_to: input.assignedTo ?? null,
      notes: input.notes ?? null,
      value,
    })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);

  // The pipeline card. If it fails, roll the client back rather than leaving a
  // lead that no desktop view can see.
  const { error: dealError } = await supabase.from('pipeline_deals').insert({
    org_id: input.orgId,
    created_by: userId,
    lead_id: created.id,
    rep_id: input.assignedTo ?? userId,
    stage,
    title: company || [firstName, lastName].filter(Boolean).join(' '),
    value,
    notes: input.notes ?? null,
  });
  if (dealError) {
    await supabase
      .from('clients')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', created.id);
    throw new Error(dealError.message);
  }

  return toLead(created);
}

export async function updateLeadStatus(id: string, status: string): Promise<void> {
  const stage = normalizeStage(status);
  // Won leads become real clients — same promotion the web performs.
  const patch: Record<string, unknown> =
    stage === 'closed_won'
      ? { lead_status: stage, status: 'active', updated_at: new Date().toISOString() }
      : { lead_status: stage, updated_at: new Date().toISOString() };

  const { error } = await supabase.from('clients').update(patch).eq('id', id);
  if (error) throw new Error(error.message);

  // Keep the desktop pipeline card in step with the stage shown on mobile.
  const { error: dealError } = await supabase
    .from('pipeline_deals')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('lead_id', id)
    .is('deleted_at', null);
  if (dealError) throw new Error(dealError.message);
}
