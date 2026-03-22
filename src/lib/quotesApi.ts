import { supabase } from './supabase';

// ── Types ──

export interface Quote {
  id: string;
  org_id: string;
  quote_number: string;
  title: string;
  lead_id: string | null;
  client_id: string | null;
  job_id: string | null;
  status: QuoteStatus;
  context_type: 'lead' | 'client' | 'job';
  salesperson_id: string | null;
  created_by: string;
  view_token: string;
  sent_via_email_at: string | null;
  sent_via_sms_at: string | null;
  last_sent_channel: 'email' | 'sms' | null;
  approved_at: string | null;
  declined_at: string | null;
  expired_at: string | null;
  converted_at: string | null;
  valid_until: string | null;
  subtotal_cents: number;
  discount_type: 'percentage' | 'fixed' | null;
  discount_value: number;
  discount_cents: number;
  tax_rate_label: string;
  tax_rate: number;
  tax_cents: number;
  total_cents: number;
  currency: string;
  notes: string | null;
  internal_notes: string | null;
  contract_disclaimer: string | null;
  deposit_required: boolean;
  deposit_type: 'percentage' | 'fixed' | null;
  deposit_value: number;
  deposit_cents: number;
  deposit_status: 'not_required' | 'pending' | 'paid' | 'waived';
  require_payment_method: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type QuoteStatus =
  | 'draft'
  | 'action_required'
  | 'sent'
  | 'awaiting_response'
  | 'approved'
  | 'declined'
  | 'expired'
  | 'converted';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  action_required: 'Action Required',
  sent: 'Sent',
  awaiting_response: 'Awaiting Response',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
  converted: 'Converted',
};

export const QUOTE_STATUS_COLORS: Record<QuoteStatus, string> = {
  draft: 'bg-surface-tertiary text-text-secondary border-outline',
  action_required: 'bg-warning-light text-warning border-warning/30',
  sent: 'bg-info-light text-info border-info/30',
  awaiting_response: 'bg-info-light text-info border-info/30',
  approved: 'bg-success-light text-success border-success/30',
  declined: 'bg-danger-light text-danger border-danger/30',
  expired: 'bg-surface-tertiary text-text-tertiary border-outline',
  converted: 'bg-success-light text-success border-success/30',
};

export interface QuoteLineItem {
  id: string;
  quote_id: string;
  source_service_id: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  sort_order: number;
  is_optional: boolean;
  item_type: 'service' | 'text' | 'heading';
  image_url: string | null;
}

export interface QuoteSection {
  id: string;
  quote_id: string;
  section_type: string;
  title: string | null;
  content: string | null;
  sort_order: number;
  enabled: boolean;
}

export interface QuoteSendLogEntry {
  id: string;
  quote_id: string;
  channel: 'email' | 'sms';
  recipient: string;
  sent_by: string | null;
  sent_at: string;
  delivery_status: string;
}

export interface QuoteStatusHistoryEntry {
  id: string;
  quote_id: string;
  old_status: string | null;
  new_status: string;
  changed_by: string | null;
  changed_at: string;
  reason: string | null;
}

export interface QuoteDetail {
  quote: Quote;
  line_items: QuoteLineItem[];
  sections: QuoteSection[];
  send_log: QuoteSendLogEntry[];
  status_history: QuoteStatusHistoryEntry[];
  lead?: { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; address: string | null; company: string | null } | null;
  client?: { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; address: string | null } | null;
}

// ── Line item input for create/save ──

export interface QuoteLineItemInput {
  source_service_id?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  unit_price_cents: number;
  sort_order: number;
  is_optional?: boolean;
  item_type?: 'service' | 'text' | 'heading';
  image_url?: string | null;
}

export interface QuoteSectionInput {
  section_type: string;
  title?: string | null;
  content?: string | null;
  sort_order: number;
  enabled: boolean;
}

// ── API Functions ──

export async function createQuote(payload: {
  lead_id?: string | null;
  client_id?: string | null;
  title: string;
  salesperson_id?: string | null;
  context_type?: 'lead' | 'client' | 'job';
  currency?: string;
  valid_days?: number;
  notes?: string | null;
  contract_disclaimer?: string | null;
  deposit_required?: boolean;
  deposit_type?: 'percentage' | 'fixed' | null;
  deposit_value?: number;
  require_payment_method?: boolean;
  tax_rate?: number;
  tax_rate_label?: string;
  discount_type?: 'percentage' | 'fixed' | null;
  discount_value?: number;
  line_items: QuoteLineItemInput[];
  sections?: QuoteSectionInput[];
}): Promise<QuoteDetail> {
  // 1. Create quote via RPC
  const { data: rpcResult, error: rpcError } = await supabase.rpc('rpc_create_quote', {
    p_lead_id: payload.lead_id || null,
    p_client_id: payload.client_id || null,
    p_title: payload.title,
    p_salesperson_id: payload.salesperson_id || null,
    p_context_type: payload.context_type || 'lead',
    p_currency: payload.currency || 'CAD',
    p_valid_days: payload.valid_days || 30,
    p_notes: payload.notes || null,
    p_contract: payload.contract_disclaimer || null,
    p_deposit_required: payload.deposit_required || false,
    p_require_payment_method: payload.require_payment_method || false,
  });
  if (rpcError) throw rpcError;

  const quoteId = String((rpcResult as any)?.quote_id || '');
  if (!quoteId) throw new Error('Quote created but quote_id is missing.');

  // 2. Update tax/discount/deposit settings
  {
    const updatePayload: Record<string, any> = {};
    if (payload.tax_rate !== undefined) updatePayload.tax_rate = payload.tax_rate;
    if (payload.tax_rate_label) updatePayload.tax_rate_label = payload.tax_rate_label;
    if (payload.discount_type !== undefined) updatePayload.discount_type = payload.discount_type || null;
    if (payload.discount_value !== undefined) updatePayload.discount_value = payload.discount_value || 0;
    if (payload.deposit_type !== undefined) updatePayload.deposit_type = payload.deposit_type || null;
    if (payload.deposit_value !== undefined) updatePayload.deposit_value = payload.deposit_value || 0;
    if (Object.keys(updatePayload).length > 0) {
      const { error: updErr } = await supabase.from('quotes').update(updatePayload).eq('id', quoteId);
      if (updErr) console.error('[createQuote] settings update failed:', updErr.message);
    }
  }

  // 3. Insert line items
  if (payload.line_items.length > 0) {
    const rows = payload.line_items
      .filter(item => item.name.trim() || item.item_type === 'text')
      .map(item => ({
        quote_id: quoteId,
        source_service_id: item.source_service_id || null,
        name: item.name.trim(),
        description: item.description || null,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
        total_cents: Math.round(item.quantity * item.unit_price_cents),
        sort_order: item.sort_order,
        is_optional: item.is_optional || false,
        item_type: item.item_type || 'service',
        image_url: item.image_url || null,
      }));
    if (rows.length > 0) {
      const { error: itemsError } = await supabase.from('quote_line_items').insert(rows);
      if (itemsError) throw itemsError;
    }
  }

  // 4. Insert sections
  if (payload.sections && payload.sections.length > 0) {
    const sectionRows = payload.sections.map(s => ({
      quote_id: quoteId,
      section_type: s.section_type,
      title: s.title || null,
      content: s.content || null,
      sort_order: s.sort_order,
      enabled: s.enabled,
    }));
    const { error: secErr } = await supabase.from('quote_sections').insert(sectionRows);
    if (secErr) console.error('[createQuote] sections insert failed:', secErr.message);
  }

  // 5. Recalculate totals
  await supabase.rpc('rpc_recalculate_quote', { p_quote_id: quoteId });

  // 6. Return full detail
  return getQuoteById(quoteId) as Promise<QuoteDetail>;
}

export async function getQuoteById(quoteId: string): Promise<QuoteDetail | null> {
  const { data: quote, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .is('deleted_at', null)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }

  // Fetch related data in parallel
  const [itemsRes, sectionsRes, sendLogRes, historyRes] = await Promise.all([
    supabase.from('quote_line_items').select('*').eq('quote_id', quoteId).order('sort_order'),
    supabase.from('quote_sections').select('*').eq('quote_id', quoteId).order('sort_order'),
    supabase.from('quote_send_log').select('*').eq('quote_id', quoteId).order('sent_at', { ascending: false }).limit(20),
    supabase.from('quote_status_history').select('*').eq('quote_id', quoteId).order('changed_at', { ascending: false }).limit(20),
  ]);

  // Fetch lead/client if referenced
  let lead = null;
  let client = null;
  if (quote.lead_id) {
    const { data } = await supabase
      .from('leads').select('id,first_name,last_name,email,phone,address,company')
      .eq('id', quote.lead_id).maybeSingle();
    lead = data;
  }
  if (quote.client_id) {
    const { data } = await supabase
      .from('clients').select('id,first_name,last_name,email,phone,address')
      .eq('id', quote.client_id).maybeSingle();
    client = data;
  }

  return {
    quote: quote as Quote,
    line_items: (itemsRes.data || []) as QuoteLineItem[],
    sections: (sectionsRes.data || []) as QuoteSection[],
    send_log: (sendLogRes.data || []) as QuoteSendLogEntry[],
    status_history: (historyRes.data || []) as QuoteStatusHistoryEntry[],
    lead,
    client,
  };
}

export async function listQuotesForLead(leadId: string): Promise<Quote[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select('*')
    .eq('lead_id', leadId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as Quote[];
}

export async function updateQuoteStatus(
  quoteId: string,
  newStatus: QuoteStatus,
  reason?: string
): Promise<Quote> {
  // Get current status
  const { data: current, error: fetchErr } = await supabase
    .from('quotes').select('status').eq('id', quoteId).single();
  if (fetchErr) throw fetchErr;

  const updatePayload: Record<string, any> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  };

  // Set timestamp fields based on status
  if (newStatus === 'approved') updatePayload.approved_at = new Date().toISOString();
  if (newStatus === 'declined') updatePayload.declined_at = new Date().toISOString();
  if (newStatus === 'expired') updatePayload.expired_at = new Date().toISOString();
  if (newStatus === 'converted') updatePayload.converted_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('quotes').update(updatePayload).eq('id', quoteId).select('*').single();
  if (error) throw error;

  // Log status change
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from('quote_status_history').insert({
    quote_id: quoteId,
    old_status: current.status,
    new_status: newStatus,
    changed_by: user?.id || null,
    reason: reason || null,
  });

  return data as Quote;
}

export async function updateQuote(
  quoteId: string,
  payload: Partial<Pick<Quote,
    'title' | 'notes' | 'internal_notes' | 'contract_disclaimer' |
    'tax_rate' | 'tax_rate_label' | 'discount_type' | 'discount_value' |
    'deposit_required' | 'deposit_type' | 'deposit_value' | 'require_payment_method' |
    'valid_until'
  >>
): Promise<Quote> {
  const { data, error } = await supabase
    .from('quotes')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', quoteId)
    .select('*')
    .single();
  if (error) throw error;

  // Recalculate totals if financial fields changed
  if (payload.tax_rate !== undefined || payload.discount_type !== undefined || payload.discount_value !== undefined) {
    await supabase.rpc('rpc_recalculate_quote', { p_quote_id: quoteId });
  }

  return data as Quote;
}

export async function saveQuoteLineItems(
  quoteId: string,
  items: QuoteLineItemInput[]
): Promise<QuoteLineItem[]> {
  // Delete existing items
  await supabase.from('quote_line_items').delete().eq('quote_id', quoteId);

  // Insert new items
  if (items.length > 0) {
    const rows = items.map(item => ({
      quote_id: quoteId,
      source_service_id: item.source_service_id || null,
      name: item.name.trim(),
      description: item.description || null,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      total_cents: Math.round(item.quantity * item.unit_price_cents),
      sort_order: item.sort_order,
      is_optional: item.is_optional || false,
      item_type: item.item_type || 'service',
      image_url: item.image_url || null,
    }));
    const { error } = await supabase.from('quote_line_items').insert(rows);
    if (error) throw error;
  }

  // Recalculate
  await supabase.rpc('rpc_recalculate_quote', { p_quote_id: quoteId });

  const { data } = await supabase
    .from('quote_line_items').select('*').eq('quote_id', quoteId).order('sort_order');
  return (data || []) as QuoteLineItem[];
}

export async function deleteQuote(quoteId: string): Promise<void> {
  const { error } = await supabase
    .from('quotes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', quoteId);
  if (error) throw error;
}

export async function duplicateQuote(quoteId: string): Promise<QuoteDetail> {
  const source = await getQuoteById(quoteId);
  if (!source) throw new Error('Quote not found.');

  return createQuote({
    lead_id: source.quote.lead_id,
    client_id: source.quote.client_id,
    title: `${source.quote.title} (Copy)`,
    salesperson_id: source.quote.salesperson_id,
    context_type: source.quote.context_type,
    currency: source.quote.currency,
    notes: source.quote.notes,
    contract_disclaimer: source.quote.contract_disclaimer,
    deposit_required: source.quote.deposit_required,
    require_payment_method: source.quote.require_payment_method,
    tax_rate: source.quote.tax_rate,
    tax_rate_label: source.quote.tax_rate_label,
    discount_type: source.quote.discount_type,
    discount_value: source.quote.discount_value,
    line_items: source.line_items.map((item, i) => ({
      source_service_id: item.source_service_id,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      sort_order: i,
      is_optional: item.is_optional,
      item_type: item.item_type,
      image_url: item.image_url,
    })),
    sections: source.sections.map((s, i) => ({
      section_type: s.section_type,
      title: s.title,
      content: s.content,
      sort_order: i,
      enabled: s.enabled,
    })),
  });
}

export async function sendQuoteEmail(quoteId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Not authenticated.');

  const res = await fetch('/api/quotes/send-email', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || 'Failed to send quote email.');
}

export async function sendQuoteSms(quoteId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Not authenticated.');

  const res = await fetch('/api/quotes/send-sms', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || 'Failed to send quote SMS.');
}

export async function convertQuoteToJob(quoteId: string): Promise<{ jobId: string }> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Not authenticated.');

  const res = await fetch('/api/quotes/convert-to-job', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || 'Failed to convert quote.');
  return { jobId: payload.jobId };
}

export async function convertQuoteToInvoice(quoteId: string): Promise<{ invoiceId: string }> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Not authenticated.');

  const res = await fetch('/api/quotes/convert-to-invoice', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteId }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || 'Failed to convert quote to invoice.');
  return { invoiceId: payload.invoiceId };
}

export async function listAllQuotes(opts?: {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ data: Quote[]; total: number }> {
  const page = opts?.page || 1;
  const pageSize = opts?.pageSize || 20;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('quotes')
    .select('*, clients(first_name, last_name, company), leads(first_name, last_name, company)', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (opts?.status && opts.status !== 'all') {
    query = query.eq('status', opts.status);
  }

  if (opts?.search) {
    query = query.or(`quote_number.ilike.%${opts.search}%,title.ilike.%${opts.search}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { data: (data || []) as Quote[], total: count || 0 };
}

export const PENDING_QUOTE_STATUSES: QuoteStatus[] = ['sent', 'awaiting_response', 'action_required'];

export async function fetchQuoteKpis(): Promise<{
  total_count: number;
  pending_count: number;
  approved_count: number;
  total_value_cents: number;
  pending_value_cents: number;
  approved_value_cents: number;
}> {
  const [allRes, pendingRes, approvedRes] = await Promise.all([
    supabase.from('quotes').select('total_cents', { count: 'exact' }).is('deleted_at', null),
    supabase.from('quotes').select('total_cents, lead_id, client_id').is('deleted_at', null).in('status', PENDING_QUOTE_STATUSES),
    supabase.from('quotes').select('total_cents', { count: 'exact' }).is('deleted_at', null).eq('status', 'approved'),
  ]);

  const sumCents = (rows: any[]) => rows.reduce((s, r) => s + Number(r.total_cents || 0), 0);

  // Filter pending quotes: exclude those whose linked lead or client has been soft-deleted
  const pendingQuotes = pendingRes.data || [];
  let pendingRows = pendingQuotes;

  if (pendingQuotes.length > 0) {
    const leadIds = [...new Set(pendingQuotes.filter((q: any) => q.lead_id).map((q: any) => q.lead_id))];
    const clientIds = [...new Set(pendingQuotes.filter((q: any) => q.client_id).map((q: any) => q.client_id))];

    const [leadsRes, clientsRes] = await Promise.all([
      leadIds.length > 0
        ? supabase.from('leads').select('id, deleted_at').in('id', leadIds)
        : Promise.resolve({ data: [] }),
      clientIds.length > 0
        ? supabase.from('clients').select('id, deleted_at').in('id', clientIds)
        : Promise.resolve({ data: [] }),
    ]);

    const deletedLeadIds = new Set((leadsRes.data || []).filter((l: any) => l.deleted_at).map((l: any) => l.id));
    const deletedClientIds = new Set((clientsRes.data || []).filter((c: any) => c.deleted_at).map((c: any) => c.id));

    pendingRows = pendingQuotes.filter((q: any) => {
      if (q.lead_id && deletedLeadIds.has(q.lead_id)) return false;
      if (q.client_id && deletedClientIds.has(q.client_id)) return false;
      return true;
    });
  }

  return {
    total_count: allRes.count || 0,
    pending_count: pendingRows.length,
    approved_count: approvedRes.count || 0,
    total_value_cents: sumCents(allRes.data || []),
    pending_value_cents: sumCents(pendingRows),
    approved_value_cents: sumCents(approvedRes.data || []),
  };
}

/** Fetch all pending quotes with full context for the Leads page pending quotes view. */
export async function fetchPendingQuotes(): Promise<Array<Quote & { lead_name?: string; client_name?: string }>> {
  const { data: quotes, error } = await supabase
    .from('quotes')
    .select('*')
    .is('deleted_at', null)
    .in('status', PENDING_QUOTE_STATUSES)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!quotes || quotes.length === 0) return [];

  // Collect unique lead_ids and client_ids to look up names and deletion status
  const leadIds = [...new Set(quotes.filter((q: any) => q.lead_id).map((q: any) => q.lead_id))];
  const clientIds = [...new Set(quotes.filter((q: any) => q.client_id).map((q: any) => q.client_id))];

  // Fetch leads and clients in parallel
  const [leadsRes, clientsRes] = await Promise.all([
    leadIds.length > 0
      ? supabase.from('leads').select('id, first_name, last_name, deleted_at').in('id', leadIds)
      : Promise.resolve({ data: [] }),
    clientIds.length > 0
      ? supabase.from('clients').select('id, company, first_name, last_name, deleted_at').in('id', clientIds)
      : Promise.resolve({ data: [] }),
  ]);

  const leadsMap = new Map((leadsRes.data || []).map((l: any) => [l.id, l]));
  const clientsMap = new Map((clientsRes.data || []).map((c: any) => [c.id, c]));

  return quotes
    .filter((q: any) => {
      // Exclude quotes whose linked lead or client has been soft-deleted
      if (q.lead_id) {
        const lead = leadsMap.get(q.lead_id);
        if (lead?.deleted_at) return false;
      }
      if (q.client_id) {
        const client = clientsMap.get(q.client_id);
        if (client?.deleted_at) return false;
      }
      return true;
    })
    .map((q: any) => {
      const lead = q.lead_id ? leadsMap.get(q.lead_id) : null;
      const client = q.client_id ? clientsMap.get(q.client_id) : null;
      const leadName = lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : undefined;
      const clientName = client
        ? client.company || `${client.first_name || ''} ${client.last_name || ''}`.trim()
        : undefined;
      return { ...q, lead_name: leadName, client_name: clientName } as Quote & { lead_name?: string; client_name?: string };
    });
}

/** Fetch job line items linked to a lead (for importing into quote) */
export async function fetchLeadJobLineItems(leadId: string): Promise<Array<{
  name: string;
  description: string | null;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  job_id: string;
  job_title: string;
}>> {
  // Find jobs linked to this lead
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('lead_id', leadId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!jobs || jobs.length === 0) return [];

  const jobIds = jobs.map(j => j.id);
  const jobMap = Object.fromEntries(jobs.map(j => [j.id, j.title || 'Job']));

  const { data: items } = await supabase
    .from('job_line_items')
    .select('name, qty, unit_price_cents, total_cents, job_id')
    .in('job_id', jobIds);

  if (!items) return [];

  return items.map((i: any) => ({
    name: i.name || '',
    description: null,
    quantity: Number(i.qty || 1),
    unit_price_cents: Number(i.unit_price_cents || 0),
    total_cents: Number(i.total_cents || 0),
    job_id: i.job_id,
    job_title: jobMap[i.job_id] || 'Job',
  }));
}

export function formatQuoteMoney(cents: number, currency = 'CAD'): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}
