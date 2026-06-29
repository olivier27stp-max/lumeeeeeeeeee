// CRM leads / pipeline. Org-scoped; created_by defaults to auth.uid() and a
// trigger forces org_id. Reps see their own (assigned_to), managers see all.
// Table: leads.

import { supabase } from '../supabase';

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
  { key: 'new', label: 'Nouveau' },
  { key: 'contacted', label: 'Contacté' },
  { key: 'follow_up_1', label: 'Relance 1' },
  { key: 'follow_up_2', label: 'Relance 2' },
  { key: 'quote_sent', label: 'Soumission envoyée' },
  { key: 'won', label: 'Gagné' },
  { key: 'lost', label: 'Perdu' },
];

const COLS =
  'id, first_name, last_name, company, email, phone, source, status, assigned_to, notes, value, created_at';

export async function listLeads(
  orgId: string,
  opts: { assignedTo?: string | null } = {},
): Promise<Lead[]> {
  let q = supabase
    .from('leads')
    .select(COLS)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (opts.assignedTo) q = q.eq('assigned_to', opts.assignedTo);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Lead[];
}

/** The lead source linked to a client (most recent lead), e.g. "referral". */
export async function getClientLeadSource(clientId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('source, created_at')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
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
  const { data, error } = await supabase
    .from('leads')
    .insert({
      org_id: input.orgId,
      first_name: input.firstName.trim() || 'Lead',
      last_name: (input.lastName ?? '').trim(),
      phone: input.phone ?? null,
      email: input.email ?? null,
      company: input.company ?? null,
      source: input.source ?? 'mobile',
      status: input.status ?? 'new',
      assigned_to: input.assignedTo ?? null,
      notes: input.notes ?? null,
      value: input.value ?? 0,
    })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as Lead;
}

export async function updateLeadStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from('leads').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
}
