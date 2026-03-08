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

const LEAD_STATUS_MAP: Record<string, string> = {
  Lead: 'new',
  Qualified: 'qualified',
  Proposal: 'contacted',
  Negotiation: 'contacted',
  Closed: 'won',
};

function toDbStatus(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw) return 'new';
  return LEAD_STATUS_MAP[raw] || raw.toLowerCase();
}

function toUiStatus(value?: string): string {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'new') return 'Lead';
  if (raw === 'contacted') return 'Proposal';
  if (raw === 'qualified') return 'Qualified';
  if (raw === 'won') return 'Closed';
  if (raw === 'lost') return 'Lost';
  return value || 'Lead';
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
    company: raw.company || raw.title || '',
    title: raw.title || raw.company || '',
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
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status}).`);
}

export async function convertLeadToClient(leadId: string): Promise<{ lead: Lead; clientId: string }> {
  const { data: clientId, error: rpcError } = await supabase.rpc('convert_lead_to_client', {
    p_lead_id: leadId,
  });
  if (rpcError) throw rpcError;

  const { data: leadData, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('id', leadId)
    .single();
  if (leadError) throw leadError;

  return { lead: normalizeLead(leadData), clientId: String(clientId) };
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

export async function exportAllLeadsCsv(): Promise<string> {
  const pageSize = 1000;
  let from = 0;
  const rows: any[] = [];

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from('leads_active')
      .select('id,first_name,last_name,phone,email,source,status,created_at')
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) throw error;

    const batch = data || [];
    for (const lead of batch) {
      rows.push({
        id: lead.id,
        full_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
        phone: lead.phone || '',
        email: lead.email || '',
        source: lead.source || '',
        status: toUiStatus(lead.status),
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
