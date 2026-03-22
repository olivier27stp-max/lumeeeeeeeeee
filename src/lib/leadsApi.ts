import { supabase } from './supabase';
import { Lead } from '../types';
import Papa from 'papaparse';

export interface CreateLeadInput {
  first_name: string;
  last_name: string;
  email?: string;
  address?: string;
  phone?: string;
  title?: string;
  company?: string;
  source?: string;
  status?: string;
  assigned_to?: string | null;
  notes?: string;
  value?: number;
  tags?: string[];
  schedule?: {
    start_date: string;
    start_time: string;
    end_time: string;
  };
  assigned_team?: string;
  line_items?: Array<Record<string, any>>;
  description?: string;
}

export interface UpdateLeadInput extends Partial<CreateLeadInput> {
  converted_to_client_id?: string | null;
  deleted_at?: string | null;
}

export interface LeadsQuery {
  search?: string;
  sort?: 'recent' | 'oldest';
  status?: string;
  source?: string;
  assignedTo?: string;
}

export interface EmailConflictRecord {
  kind: 'lead' | 'client';
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}

export const LEAD_STATUSES = [
  'new', 'follow_up_1', 'follow_up_2', 'follow_up_3', 'closed', 'lost',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  follow_up_1: 'Follow-up 1',
  follow_up_2: 'Follow-up 2',
  follow_up_3: 'Follow-up 3',
  closed: 'Closed',
  lost: 'Lost',
};

const LEAD_STATUS_MAP: Record<string, string> = {
  New: 'new',
  'Follow-up 1': 'follow_up_1',
  'Follow-up 2': 'follow_up_2',
  'Follow-up 3': 'follow_up_3',
  Closed: 'closed',
  Lost: 'lost',
  // Legacy mappings → new stages
  Contacted: 'follow_up_1',
  'Estimate Sent': 'follow_up_2',
  'Follow-Up': 'follow_up_1',
  Won: 'closed',
  Archived: 'lost',
  Lead: 'new',
  Qualified: 'new',
  Proposal: 'follow_up_1',
  Negotiation: 'follow_up_2',
};

const DB_TO_UI_STATUS: Record<string, string> = {
  new: 'New',
  follow_up_1: 'Follow-up 1',
  follow_up_2: 'Follow-up 2',
  follow_up_3: 'Follow-up 3',
  closed: 'Closed',
  lost: 'Lost',
  // Legacy → new display
  contacted: 'Follow-up 1',
  estimate_sent: 'Follow-up 2',
  follow_up: 'Follow-up 1',
  won: 'Closed',
  archived: 'Lost',
  qualified: 'New',
  quote_sent: 'Follow-up 2',
  lead: 'New',
  proposal: 'Follow-up 1',
  negotiation: 'Follow-up 2',
};

function toDbStatus(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return 'new';
  // Check map first, then try lowercase with underscore normalization
  if (LEAD_STATUS_MAP[raw]) return LEAD_STATUS_MAP[raw];
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
  // Verify it's a valid DB status before returning
  const validStatuses: Set<string> = new Set(LEAD_STATUSES);
  return validStatuses.has(normalized) ? normalized : 'new';
}

function toUiStatus(value?: string): string {
  const raw = String(value || '').trim().toLowerCase();
  return DB_TO_UI_STATUS[raw] || value || 'New';
}

function normalizeLead(raw: any): Lead {
  return {
    id: raw.id,
    org_id: raw.org_id,
    created_by: raw.created_by,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    first_name: raw.first_name || '',
    last_name: raw.last_name || '',
    email: raw.email || '',
    phone: raw.phone || '',
    address: raw.address || null,
    company: raw.company || '',
    title: raw.title || '',
    source: raw.source || '',
    status: toUiStatus(raw.status),
    assigned_to: raw.assigned_to,
    notes: raw.notes,
    value: Number(raw.value || 0),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    schedule: raw.schedule || null,
    assigned_team: raw.assigned_team || null,
    line_items: Array.isArray(raw.line_items) ? raw.line_items : [],
    description: raw.description || null,
    client_id: raw.client_id || null,
    converted_to_client_id: raw.converted_to_client_id || null,
    deleted_at: raw.deleted_at || null,
    user_id: raw.created_by,
  };
}

async function getAuthHeaders(extra?: Record<string, string>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('You need to be authenticated for this action.');
  return {
    Authorization: `Bearer ${token}`,
    ...(extra || {}),
  };
}

function buildSearchFilter(search: string): string {
  const safe = search.replace(/,/g, ' ').trim().replace(/%/g, '\\%').replace(/_/g, '\\_');
  return [
    `first_name.ilike.%${safe}%`,
    `last_name.ilike.%${safe}%`,
    `title.ilike.%${safe}%`,
    `company.ilike.%${safe}%`,
    `email.ilike.%${safe}%`,
    `phone.ilike.%${safe}%`,
  ].join(',');
}

export async function fetchLeadsScoped(query: LeadsQuery = {}): Promise<Lead[]> {
  const sortAscending = query.sort === 'oldest';
  let request = supabase
    .from('leads_active')
    .select('*')
    .order('created_at', { ascending: sortAscending });

  if (query.search?.trim()) request = request.or(buildSearchFilter(query.search));
  if (query.status && query.status !== 'All') request = request.eq('status', toDbStatus(query.status));
  if (query.source && query.source !== 'All') request = request.eq('source', query.source);
  if (query.assignedTo && query.assignedTo !== 'All') request = request.eq('assigned_to', query.assignedTo);

  const { data, error } = await request;
  if (error) throw error;
  return (data || []).map(normalizeLead);
}

export async function createLeadScoped(input: CreateLeadInput): Promise<Lead> {
  const fullName = `${input.first_name || ''} ${input.last_name || ''}`.trim();
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info('[lead:create] request', {
      org_id: null,
      stage: toDbStatus(input.status),
      name: fullName,
      email: (input.email || '').trim() || null,
    });
  }
  const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch('/api/leads/create', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      full_name: fullName,
      email: input.email?.trim() || null,
      address: input.address?.trim() || null,
      phone: input.phone?.trim() || null,
      title: input.title?.trim() || input.company?.trim() || null,
      value: Number(input.value || 0),
      notes: input.notes?.trim() || null,
      orgId: null,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info('[lead:create] response', {
      status: response.status,
      ok: response.ok,
      dataLength: payload?.lead?.id ? 1 : 0,
      errorCode: payload?.code || null,
      errorMessage: payload?.error || null,
    });
  }
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);

  const leadRow = (payload as any)?.lead || null;
  if (!leadRow?.id) throw new Error('Lead created but lead row is missing.');
  return normalizeLead(leadRow);
}

export async function findEmailConflict(email: string): Promise<EmailConflictRecord | null> {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;

  const { data: leadData, error: leadError } = await supabase
    .from('leads_active')
    .select('id,first_name,last_name,email')
    .ilike('email', normalized)
    .limit(1)
    .maybeSingle();
  if (leadError) throw leadError;
  if (leadData?.id) {
    return {
      kind: 'lead',
      id: String(leadData.id),
      first_name: leadData.first_name,
      last_name: leadData.last_name,
      email: leadData.email,
    };
  }

  const { data: clientData, error: clientError } = await supabase
    .from('clients_active')
    .select('id,first_name,last_name,email')
    .ilike('email', normalized)
    .limit(1)
    .maybeSingle();
  if (clientError) throw clientError;
  if (!clientData?.id) return null;
  return {
    kind: 'client',
    id: String(clientData.id),
    first_name: clientData.first_name,
    last_name: clientData.last_name,
    email: clientData.email,
  };
}

export async function updateLeadScoped(id: string, input: UpdateLeadInput): Promise<Lead> {
  const payload: Record<string, any> = {};
  if (input.first_name !== undefined) payload.first_name = input.first_name.trim();
  if (input.last_name !== undefined) payload.last_name = input.last_name.trim();
  if (input.email !== undefined) payload.email = input.email?.trim() || null;
  if (input.phone !== undefined) payload.phone = input.phone?.trim() || null;
  if (input.address !== undefined) payload.address = input.address?.trim() || null;
  if (input.title !== undefined) payload.title = input.title?.trim() || null;
  if (input.company !== undefined) payload.company = input.company?.trim() || null;
  if (input.source !== undefined) payload.source = input.source?.trim() || null;
  if (input.status !== undefined) payload.status = toDbStatus(input.status);
  if (input.assigned_to !== undefined) payload.assigned_to = input.assigned_to || null;
  if (input.notes !== undefined) payload.notes = input.notes?.trim() || null;
  if (input.value !== undefined) payload.value = Number(input.value || 0);
  if (input.tags !== undefined) payload.tags = input.tags || [];
  if (input.schedule !== undefined) payload.schedule = input.schedule || null;
  if (input.assigned_team !== undefined) payload.assigned_team = input.assigned_team || null;
  if (input.line_items !== undefined) payload.line_items = input.line_items || [];
  if (input.description !== undefined) payload.description = input.description || null;
  if (input.converted_to_client_id !== undefined) payload.converted_to_client_id = input.converted_to_client_id;
  if (input.deleted_at !== undefined) payload.deleted_at = input.deleted_at;

  const { data, error } = await supabase.from('leads').update(payload).eq('id', id).select('*').single();
  if (error) throw error;

  // Sync lead status → pipeline deal stage (blocking with error handling)
  if (input.status !== undefined) {
    const dbStatus = toDbStatus(input.status);
    try {
      const { data: deal } = await supabase
        .from('pipeline_deals')
        .select('id')
        .eq('lead_id', id)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (deal?.id) {
        const { error: stageErr } = await supabase.rpc('set_deal_stage', { p_deal_id: deal.id, p_stage: dbStatus });
        if (stageErr) console.error('Lead→Deal stage sync failed:', stageErr.message);
      }
    } catch (syncErr) {
      console.error('Lead→Deal sync error:', syncErr);
    }
  }

  // Sync contact fields to the linked client record (blocking with error handling)
  const clientId = data.client_id || data.converted_to_client_id;
  if (clientId) {
    const clientUpdate: Record<string, any> = {};
    if (input.first_name !== undefined) clientUpdate.first_name = input.first_name.trim();
    if (input.last_name !== undefined) clientUpdate.last_name = input.last_name.trim();
    if (input.email !== undefined) clientUpdate.email = input.email?.trim() || null;
    if (input.phone !== undefined) clientUpdate.phone = input.phone?.trim() || null;
    if (input.address !== undefined) clientUpdate.address = input.address?.trim() || null;
    if (input.company !== undefined) clientUpdate.company = input.company?.trim() || null;
    if (Object.keys(clientUpdate).length > 0) {
      clientUpdate.updated_at = new Date().toISOString();
      const { error: syncErr } = await supabase.from('clients').update(clientUpdate).eq('id', clientId);
      if (syncErr) console.error('Lead→Client sync failed:', syncErr.message);
    }
  }

  return normalizeLead(data);
}

export async function deleteLeadScoped(id: string): Promise<void> {
  const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch('/api/leads/soft-delete', {
    method: 'POST',
    headers,
    body: JSON.stringify({ leadId: id, orgId: null }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to delete lead (${response.status}).`);
  }
}

export async function convertLeadToClient(leadId: string): Promise<{ lead: Lead; clientId: string }> {
  // Fetch the lead first
  const { data: leadRow, error: leadFetchError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();
  if (leadFetchError) throw leadFetchError;
  if (!leadRow) throw new Error('Lead not found.');

  // With the new sync model, every lead already has a client_id
  const clientId = leadRow.client_id || leadRow.converted_to_client_id;
  if (!clientId) throw new Error('Lead has no linked client. Please contact support.');

  // Promote client status from 'lead' to 'active'
  await supabase
    .from('clients')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', clientId)
    .eq('status', 'lead');

  // Mark lead as converted/closed
  const { data: updatedLead, error: updateError } = await supabase
    .from('leads')
    .update({
      converted_to_client_id: clientId,
      status: 'closed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)
    .select('*')
    .single();
  if (updateError) throw updateError;

  return { lead: normalizeLead(updatedLead), clientId: String(clientId) };
}

/**
 * Resolve the client_id for a lead. Every lead should have a client_id now.
 * Returns the client_id or null if the lead doesn't exist.
 */
export async function resolveClientIdForLead(leadId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('client_id, converted_to_client_id')
    .eq('id', leadId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const clientId = data.client_id || data.converted_to_client_id || null;
  if (clientId) return clientId;

  // Fallback: ask server to resolve (it can create a client for legacy leads)
  try {
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
    const response = await fetch('/api/leads/resolve-client', {
      method: 'POST',
      headers,
      body: JSON.stringify({ leadId }),
    });
    if (response.ok) {
      const payload = await response.json();
      if (payload?.clientId) return payload.clientId;
    }
  } catch {
    // Server fallback failed — return null gracefully
  }
  return null;
}

export async function createLeadQuick(input: {
  full_name: string;
  email?: string | null;
  phone?: string | null;
  org_id?: string | null;
}): Promise<Lead> {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info('[lead:quick-create] request', {
      org_id: input.org_id ?? null,
      stage: 'qualified',
      name: input.full_name,
      email: input.email ?? null,
    });
  }
  const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch('/api/leads/create', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      full_name: input.full_name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      title: null,
      value: 0,
      notes: null,
      orgId: input.org_id ?? null,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.info('[lead:quick-create] response', {
      status: response.status,
      ok: response.ok,
      dataLength: payload?.lead?.id ? 1 : 0,
      errorCode: payload?.code || null,
      errorMessage: payload?.error || null,
    });
  }
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
  const leadRow = (payload as any)?.lead || null;
  if (!leadRow?.id) throw new Error('Lead created but lead row is missing.');
  return normalizeLead(leadRow);
}

export async function updateLeadStatus(leadId: string, status: LeadStatus): Promise<{ ok: boolean; changed: boolean }> {
  const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch('/api/leads/update-status', {
    method: 'POST',
    headers,
    body: JSON.stringify({ leadId, status, orgId: null }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Failed to update status (${response.status}).`);
  return payload;
}

export async function convertLeadToJob(
  leadId: string,
  jobTitle?: string,
): Promise<{ ok: boolean; lead_id: string; client_id: string; job_id: string; job_title: string }> {
  const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch('/api/leads/convert-to-job', {
    method: 'POST',
    headers,
    body: JSON.stringify({ leadId, jobTitle: jobTitle || undefined, orgId: null }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `Failed to convert lead (${response.status}).`);
  return payload;
}

export async function exportAllLeadsCsv(): Promise<string> {
  const pageSize = 1000;
  let from = 0;
  const rows: any[] = [];

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('leads_active')
      .select('id,first_name,last_name,phone,email,company,address,source,status,value,assigned_to,notes,tags,created_at')
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) throw error;

    const batch = data || [];
    for (const lead of batch) {
      rows.push({
        id: lead.id,
        first_name: lead.first_name || '',
        last_name: lead.last_name || '',
        full_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
        phone: lead.phone || '',
        email: lead.email || '',
        company: (lead as any).company || '',
        address: (lead as any).address || '',
        source: lead.source || '',
        status: toUiStatus(lead.status),
        value: (lead as any).value || 0,
        assigned_to: (lead as any).assigned_to || '',
        notes: (lead as any).notes || '',
        tags: Array.isArray((lead as any).tags) ? (lead as any).tags.join(', ') : '',
        created_at: lead.created_at,
      });
    }

    if (batch.length < pageSize) break;
    from += pageSize;
  }

  return Papa.unparse(rows, {
    columns: ['id', 'full_name', 'phone', 'email', 'source', 'status', 'created_at'],
  });
}
