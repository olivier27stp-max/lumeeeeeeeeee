import { startOfMonth, subDays } from 'date-fns';
import { supabase } from './supabase';

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
    .from('clients_active')
    .select('id,first_name,last_name,company,email,status', { count: 'exact' })
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
}) {
  const { data, error } = await supabase.rpc('rpc_create_invoice_draft', {
    p_client_id: payload.clientId,
    p_subject: payload.subject || null,
    p_due_date: payload.dueDate || null,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    id: String(row?.id),
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
    .from('clients_active')
    .select('id,first_name,last_name,company,email,phone')
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
}): Promise<SendInvoiceResult> {
  const channels = payload.channels && payload.channels.length > 0 ? payload.channels : ['email', 'sms'];
  let lastRow: any = null;
  for (const channel of channels) {
    const toValue = channel === 'email' ? payload.toEmail || null : payload.toPhone || null;
    if (!toValue) continue;
    const { data, error } = await supabase.rpc('send_invoice', {
      p_org_id: payload.orgId || null,
      p_invoice_id: payload.invoiceId,
      p_channel: channel,
      p_to: toValue,
    });
    if (error) throw error;
    lastRow = Array.isArray(data) ? data[0] : data;
  }

  const row = lastRow || {};
  return {
    ok: Boolean(row?.ok ?? true),
    invoice_id: String(row?.invoice_id || payload.invoiceId),
    status: String(row?.status || 'sent'),
    payment_link: row?.payment_link ? String(row.payment_link) : undefined,
    channels,
  };
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
