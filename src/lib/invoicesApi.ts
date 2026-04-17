import { startOfMonth, subDays } from 'date-fns';
import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';
import { emitInvoicePaidManually } from './automationEventsApi';

export type InvoiceStatusFilter = 'all' | 'draft' | 'sent_not_due' | 'past_due' | 'paid';
export type InvoiceRangeFilter = 'all' | '30d' | 'this_month' | 'custom';

export type InvoiceSortKey =
  | 'client_asc'
  | 'client_desc'
  | 'invoice_number_asc'
  | 'invoice_number_desc'
  | 'due_date_asc'
  | 'due_date_desc'
  | 'status_asc'
  | 'status_desc'
  | 'total_asc'
  | 'total_desc'
  | 'balance_asc'
  | 'balance_desc';

export interface InvoiceRow {
  id: string;
  client_id: string;
  job_id?: string | null;
  client_name: string;
  invoice_number: string;
  status: string;
  currency?: string;
  subject: string | null;
  issued_at: string | null;
  due_date: string | null;
  total_cents: number;
  balance_cents: number;
  paid_cents: number;
  created_at: string;
  updated_at: string;
  // View tracking
  view_token?: string | null;
  is_viewed?: boolean;
  viewed_at?: string | null;
  view_count?: number;
  last_viewed_at?: string | null;
}

export interface InvoiceItemInput {
  description: string;
  qty: number;
  unit_price_cents: number;
}

export interface InvoiceKpis30d {
  past_due_count: number;
  past_due_total_cents: number;
  sent_not_due_count: number;
  sent_not_due_total_cents: number;
  draft_count: number;
  draft_total_cents: number;
  issued_30d_count: number;
  issued_30d_total_cents: number;
  avg_invoice_30d_cents: number;
  avg_payment_time_days_30d: number | null;
}

export interface InvoiceClientOption {
  id: string;
  name: string;
  email: string | null;
  status: string | null;
}

export interface InvoicesListQuery {
  status: InvoiceStatusFilter;
  range: InvoiceRangeFilter;
  q: string;
  sort: InvoiceSortKey;
  page: number;
  pageSize: number;
  fromDate?: string | null;
  toDate?: string | null;
}

export interface InvoicesListResult {
  rows: InvoiceRow[];
  total: number;
}

export interface InvoiceDetail {
  invoice: InvoiceRow & {
    job_id?: string | null;
    subtotal_cents: number;
    tax_cents: number;
    paid_at: string | null;
    deleted_at: string | null;
  };
  client: {
    id: string;
    first_name: string;
    last_name: string;
    company: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  items: Array<{
    id: string;
    description: string;
    qty: number;
    unit_price_cents: number;
    line_total_cents: number;
    created_at: string;
  }>;
}

export interface CreateInvoiceFromJobResult {
  invoice_id: string;
  already_exists: boolean;
  status: string;
  invoice: {
    id: string;
    invoice_number?: string | null;
    status?: string;
    client_id?: string | null;
    job_id?: string | null;
    total_cents?: number;
    balance_cents?: number;
    currency?: string;
    updated_at?: string | null;
  };
}

export interface SendInvoiceResult {
  ok: boolean;
  invoice_id: string;
  status: string;
  payment_link?: string;
  channels?: string[];
}

export function formatMoneyFromCents(cents: number, currency = 'CAD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

export function toClientDisplayName(client: { first_name?: string | null; last_name?: string | null; company?: string | null }) {
  const fullName = `${client.first_name || ''} ${client.last_name || ''}`.trim();
  return fullName || client.company || 'Unknown client';
}

export function getInvoiceRowUiStatus(row: InvoiceRow) {
  const dueDate = row.due_date ? new Date(`${row.due_date}T00:00:00`) : null;
  const now = new Date();
  const isPastDue =
    row.balance_cents > 0 &&
    (row.status === 'sent' || row.status === 'partial') &&
    !!dueDate &&
    dueDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (isPastDue) return 'past_due';
  if (row.status === 'draft') return 'draft';
  if (row.status === 'paid') return 'paid';
  if ((row.status === 'sent' || row.status === 'partial') && row.balance_cents > 0) return 'sent_not_due';
  return row.status;
}

export async function fetchInvoicesKpis30d(): Promise<InvoiceKpis30d> {
  const { data, error } = await supabase.rpc('rpc_invoices_kpis_30d', {});
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    past_due_count: Number(row?.past_due_count || 0),
    past_due_total_cents: Number(row?.past_due_total_cents || 0),
    sent_not_due_count: Number(row?.sent_not_due_count || 0),
    sent_not_due_total_cents: Number(row?.sent_not_due_total_cents || 0),
    draft_count: Number(row?.draft_count || 0),
    draft_total_cents: Number(row?.draft_total_cents || 0),
    issued_30d_count: Number(row?.issued_30d_count || 0),
    issued_30d_total_cents: Number(row?.issued_30d_total_cents || 0),
    avg_invoice_30d_cents: Number(row?.avg_invoice_30d_cents || 0),
    avg_payment_time_days_30d: row?.avg_payment_time_days_30d == null ? null : Number(row.avg_payment_time_days_30d),
  };
}

export async function listInvoices(query: InvoicesListQuery): Promise<InvoicesListResult> {
  const { data, error } = await supabase.rpc('rpc_list_invoices', {
    p_status: query.status,
    p_range: query.range,
    p_q: query.q.trim() || null,
    p_sort: query.sort,
    p_limit: query.pageSize,
    p_offset: (query.page - 1) * query.pageSize,
    p_from: query.fromDate || null,
    p_to: query.toDate || null,
    p_org: null,
  });

  if (error) throw error;

  const rows = (data || []) as Array<InvoiceRow & { total_count: number }>;
  return {
    rows: rows.map((row) => ({
      id: row.id,
      client_id: row.client_id,
      client_name: row.client_name,
      invoice_number: row.invoice_number,
      status: row.status,
      subject: row.subject || null,
      issued_at: row.issued_at || null,
      due_date: row.due_date || null,
      total_cents: Number(row.total_cents || 0),
      balance_cents: Number(row.balance_cents || 0),
      paid_cents: Number(row.paid_cents || 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_viewed: !!(row as any).is_viewed,
      viewed_at: (row as any).viewed_at || null,
      view_count: Number((row as any).view_count || 0),
    })),
    total: rows.length > 0 ? Number(rows[0].total_count || 0) : 0,
  };
}

export async function searchActiveClients(query: { q: string; page: number; pageSize: number }): Promise<{
  items: InvoiceClientOption[];
  total: number;
}> {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  let request = supabase
    .from('clients')
    .select('id,first_name,last_name,company,email,status', { count: 'exact' })
    .is('deleted_at', null)
    .range(from, to)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });

  const q = query.q.trim();
  if (q) {
    const safe = q.replace(/,/g, ' ').replace(/%/g, '\\%').replace(/_/g, '\\_');
    request = request.or(
      `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`
    );
  }

  request = request.or('status.is.null,status.eq.active');

  const { data, error, count } = await request;
  if (error) throw error;

  return {
    items: (data || []).map((row: any) => ({
      id: row.id,
      name: toClientDisplayName(row),
      email: row.email || null,
      status: row.status || null,
    })),
    total: Number(count || 0),
  };
}

export async function createInvoiceDraft(payload: {
  clientId: string;
  subject?: string | null;
  dueDate?: string | null;
  jobId?: string;
}) {
  const { data, error } = await supabase.rpc('rpc_create_invoice_draft', {
    p_client_id: payload.clientId,
    p_subject: payload.subject || null,
    p_due_date: payload.dueDate || null,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  const invoiceId = String(row?.id);

  // Link invoice to job if provided
  if (payload.jobId && invoiceId) {
    await supabase
      .from('invoices')
      .update({ job_id: payload.jobId })
      .eq('id', invoiceId);
  }

  return {
    id: invoiceId,
    invoice_number: String(row?.invoice_number || ''),
  };
}

export async function saveInvoiceDraft(payload: {
  invoiceId: string;
  subject?: string | null;
  dueDate?: string | null;
  taxCents?: number;
  items: InvoiceItemInput[];
}) {
  const sanitizedItems = payload.items
    .map((item) => ({
      description: item.description.trim(),
      qty: Number.isFinite(item.qty) ? Number(item.qty) : 0,
      unit_price_cents: Number.isFinite(item.unit_price_cents) ? Math.round(item.unit_price_cents) : 0,
    }))
    .filter((item) => item.description && item.qty > 0 && item.unit_price_cents >= 0);

  const { data, error } = await supabase.rpc('rpc_save_invoice_draft', {
    p_invoice_id: payload.invoiceId,
    p_subject: payload.subject || null,
    p_due_date: payload.dueDate || null,
    p_tax_cents: Math.max(0, Math.round(payload.taxCents || 0)),
    p_items: sanitizedItems,
  });
  if (error) throw error;

  return data as any;
}

export async function getInvoiceById(invoiceId: string): Promise<InvoiceDetail | null> {
  const { data: invoiceRow, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .maybeSingle();

  if (invoiceError) throw invoiceError;
  if (!invoiceRow) return null;

  const { data: itemsRows, error: itemsError } = await supabase
    .from('invoice_items')
    .select('id,description,qty,unit_price_cents,line_total_cents,created_at')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });
  if (itemsError) throw itemsError;

  const { data: clientRow, error: clientError } = await supabase
    .from('clients')
    .select('id,first_name,last_name,company,email,phone')
    .is('deleted_at', null)
    .eq('id', invoiceRow.client_id)
    .maybeSingle();
  if (clientError) throw clientError;

  return {
    invoice: {
      id: invoiceRow.id,
      client_id: invoiceRow.client_id,
      job_id: invoiceRow.job_id || null,
      client_name: clientRow ? toClientDisplayName(clientRow) : 'Unknown client',
      invoice_number: invoiceRow.invoice_number,
      status: invoiceRow.status,
      currency: invoiceRow.currency || 'CAD',
      subject: invoiceRow.subject || null,
      issued_at: invoiceRow.issued_at || null,
      due_date: invoiceRow.due_date || null,
      total_cents: Number(invoiceRow.total_cents || 0),
      balance_cents: Number(invoiceRow.balance_cents || 0),
      paid_cents: Number(invoiceRow.paid_cents || 0),
      subtotal_cents: Number(invoiceRow.subtotal_cents || 0),
      tax_cents: Number(invoiceRow.tax_cents || 0),
      paid_at: invoiceRow.paid_at || null,
      created_at: invoiceRow.created_at,
      updated_at: invoiceRow.updated_at,
      deleted_at: invoiceRow.deleted_at || null,
      view_token: invoiceRow.view_token || null,
      is_viewed: !!invoiceRow.is_viewed,
      viewed_at: invoiceRow.viewed_at || null,
      view_count: Number(invoiceRow.view_count || 0),
      last_viewed_at: invoiceRow.last_viewed_at || null,
    },
    client: clientRow
      ? {
          id: clientRow.id,
          first_name: clientRow.first_name,
          last_name: clientRow.last_name,
          company: clientRow.company,
          email: clientRow.email,
          phone: clientRow.phone,
        }
      : null,
    items: (itemsRows || []).map((item: any) => ({
      id: item.id,
      description: item.description,
      qty: Number(item.qty || 0),
      unit_price_cents: Number(item.unit_price_cents || 0),
      line_total_cents: Number(item.line_total_cents || 0),
      created_at: item.created_at,
    })),
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

export async function createInvoiceFromJob(payload: {
  orgId?: string;
  jobId: string;
  sendNow: boolean;
}): Promise<CreateInvoiceFromJobResult> {
  const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch('/api/invoices/from-job', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      orgId: payload.orgId || null,
      jobId: payload.jobId,
      sendNow: payload.sendNow,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || `Request failed (${response.status}).`);
  }

  return body as CreateInvoiceFromJobResult;
}

export async function finishJobAndPrepareInvoice(payload: { orgId?: string; jobId: string }) {
  const { data, error } = await supabase.rpc('finish_job_and_prepare_invoice', {
    p_org_id: payload.orgId || null,
    p_job_id: payload.jobId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const invoiceId = String(row?.invoice_id || '').trim();
  if (!invoiceId) {
    throw new Error('Invoice preparation succeeded but invoice_id is missing.');
  }
  return {
    ok: Boolean(row?.ok ?? true),
    invoice_id: invoiceId,
    already_exists: Boolean(row?.already_exists),
  };
}

export async function sendInvoice(payload: {
  orgId?: string;
  invoiceId: string;
  channels?: string[];
  toEmail?: string | null;
  toPhone?: string | null;
  emailTemplateId?: string | null;
  subject?: string | null;
  body?: string | null;
}): Promise<SendInvoiceResult> {
  const channels = payload.channels && payload.channels.length > 0 ? payload.channels : ['email'];

  // Use the backend email route for sending (the send_invoice RPC does not exist)
  if (channels.includes('email') && payload.toEmail) {
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
    const API_BASE = import.meta.env.VITE_API_URL || '';
    const response = await fetch(`${API_BASE}/api/emails/send-invoice`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        invoiceId: payload.invoiceId,
        emailTemplateId: payload.emailTemplateId || null,
        subject: payload.subject || null,
        body: payload.body || null,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.error || `Failed to send invoice email (${response.status}).`);
    }
  }

  // For SMS channel, use the communications API
  if (channels.includes('sms') && payload.toPhone) {
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
    const API_BASE = import.meta.env.VITE_API_URL || '';
    await fetch(`${API_BASE}/api/communications/send-sms`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to: payload.toPhone,
        body: `You have a new invoice. Please check your email for details.`,
        client_id: null,
        job_id: null,
      }),
    }).catch(() => {});
  }

  return {
    ok: true,
    invoice_id: payload.invoiceId,
    status: 'sent',
    channels,
  };
}

// ── Invoice update/edit ──

export async function updateInvoiceFields(
  invoiceId: string,
  fields: {
    subject?: string | null;
    due_date?: string | null;
    notes?: string | null;
    internal_notes?: string | null;
    template_id?: string | null;
  },
  expectedVersion?: number,
) {
  let query = supabase
    .from('invoices')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', invoiceId);
  if (expectedVersion != null) query = query.eq('version', expectedVersion);
  const { error } = await query;
  if (error?.code === 'PGRST116' && expectedVersion != null) {
    throw new Error('This invoice was modified by another user. Please refresh and try again.');
  }
  if (error) throw error;
}

export async function updateInvoiceRecurrence(
  invoiceId: string,
  fields: { is_recurring: boolean; recurrence_interval?: string | null; next_recurrence_date?: string | null },
) {
  const { error } = await supabase
    .from('invoices')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', invoiceId);
  if (error) throw error;
}

export async function voidInvoice(invoiceId: string) {
  const { error } = await supabase
    .from('invoices')
    .update({ status: 'void', updated_at: new Date().toISOString() })
    .eq('id', invoiceId);
  if (error) throw error;
}

export async function revertToDraft(invoiceId: string) {
  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'draft',
      issued_at: null,
      sent_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId);
  if (error) throw error;
}

export async function duplicateInvoice(invoiceId: string): Promise<string> {
  // Fetch original invoice
  const detail = await getInvoiceById(invoiceId);
  if (!detail) throw new Error('Invoice not found.');

  // Create new draft
  const draft = await createInvoiceDraft({
    clientId: detail.invoice.client_id,
    subject: detail.invoice.subject ? `${detail.invoice.subject} (Copy)` : null,
    dueDate: null,
  });

  // Save items to new invoice
  await saveInvoiceDraft({
    invoiceId: draft.id,
    subject: detail.invoice.subject ? `${detail.invoice.subject} (Copy)` : null,
    dueDate: null,
    taxCents: detail.invoice.tax_cents,
    items: detail.items.map((item) => ({
      description: item.description,
      qty: item.qty,
      unit_price_cents: item.unit_price_cents,
    })),
  });

  return draft.id;
}

export async function markInvoicePaidManually(invoiceId: string) {
  // Get current invoice to know total
  const { data: inv, error: fetchErr } = await supabase
    .from('invoices')
    .select('total_cents')
    .eq('id', invoiceId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!inv) throw new Error('Invoice not found');

  const { error } = await supabase
    .from('invoices')
    .update({
      paid_cents: inv.total_cents,
      balance_cents: 0,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId);
  if (error) throw error;

  // Emit automation event to stop invoice reminders and trigger payment workflows
  emitInvoicePaidManually({ invoiceId });
}

// ── Job line items for invoice prefill ──

export async function getJobLineItems(jobId: string) {
  const { data, error } = await supabase
    .from('job_line_items')
    .select('id,name,qty,unit_price_cents,total_cents')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((item: any) => ({
    id: item.id,
    description: item.name || '',
    qty: Number(item.qty || 0),
    unit_price_cents: Number(item.unit_price_cents || 0),
    line_total_cents: Number(item.total_cents || 0),
    source_type: 'job_line_item' as const,
    source_id: item.id,
  }));
}

// ── Visual template listing with layout info ──

export async function listVisualTemplates() {
  const { data, error } = await supabase
    .from('invoice_templates')
    .select('id,name,slug,description,layout_type,is_default,is_system_template,branding,archived_at')
    .is('archived_at', null)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as Array<{
    id: string;
    name: string;
    slug: string | null;
    description: string;
    layout_type: string;
    is_default: boolean;
    is_system_template: boolean;
    branding: Record<string, any>;
  }>;
}

// ── Send events history ──

export async function getInvoiceSendEvents(invoiceId: string) {
  const { data, error } = await supabase
    .from('invoice_send_events')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── Company settings for invoice rendering ──

export async function getCompanySettings() {
  const { data, error } = await supabase
    .from('company_settings')
    .select('company_name, email, phone, street1, city, province, postal_code, logo_url')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { company_name: null, company_email: null, company_phone: null, company_address: null, company_logo_url: null };
  const address = [data.street1, data.city, data.province, data.postal_code].filter(Boolean).join(', ') || null;
  return {
    company_name: data.company_name || null,
    company_email: data.email || null,
    company_phone: data.phone || null,
    company_address: address,
    company_logo_url: data.logo_url || null,
  };
}

/** Fetch applied tax breakdown for an invoice (from applied_taxes audit table) */
export async function getInvoiceAppliedTaxes(invoiceId: string): Promise<Array<{ name: string; rate: number; amount_cents: number; registration_number?: string | null }>> {
  const { data, error } = await supabase
    .from('applied_taxes')
    .select('name, rate, amount_cents, is_compound, sort_order, tax_config_id')
    .eq('document_type', 'invoice')
    .eq('document_id', invoiceId)
    .order('sort_order');
  if (error || !data || data.length === 0) return [];

  // Fetch registration numbers from tax_configs for each applied tax
  const configIds = data.map((t: any) => t.tax_config_id).filter(Boolean);
  let regNumMap = new Map<string, string>();
  if (configIds.length > 0) {
    const { data: configs } = await supabase
      .from('tax_configs')
      .select('id, registration_number')
      .in('id', configIds);
    for (const c of configs || []) {
      if (c.registration_number) regNumMap.set(c.id, c.registration_number);
    }
  }

  return data.map((t: any) => ({
    name: t.name,
    rate: Number(t.rate),
    amount_cents: t.amount_cents,
    registration_number: (t.tax_config_id && regNumMap.get(t.tax_config_id)) || null,
  }));
}

export async function listInvoiceTemplates() {
  const { data, error } = await supabase
    .from('invoice_templates')
    .select('id,name,content,is_default,updated_at')
    .is('deleted_at', null)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getOrgBillingSettings() {
  const { data, error } = await supabase.from('org_billing_settings').select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export function defaultCustomRange(range: InvoiceRangeFilter) {
  if (range === '30d') {
    const to = new Date();
    const from = subDays(to, 30);
    return {
      fromDate: from.toISOString().slice(0, 10),
      toDate: to.toISOString().slice(0, 10),
    };
  }

  if (range === 'this_month') {
    const to = new Date();
    const from = startOfMonth(to);
    return {
      fromDate: from.toISOString().slice(0, 10),
      toDate: to.toISOString().slice(0, 10),
    };
  }

  return { fromDate: null, toDate: null };
}

/** Hard delete an invoice and all its items/payments via RPC. */
export async function deleteInvoice(invoiceId: string): Promise<void> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { error } = await supabase.rpc('delete_invoice_cascade', {
    p_org_id: orgId,
    p_invoice_id: invoiceId,
  });
  if (error) throw error;
}
