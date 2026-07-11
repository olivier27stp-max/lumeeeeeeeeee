// Billing reads (invoices + quotes) for the admin/owner money layer. Gated in
// the UI behind canSeePricing — technicians never call this. v1 is read-only;
// on-device Stripe payment collection is a v2 follow-up.

import { supabase } from '../supabase';

export interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  status: string | null;
  subject: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  balance_cents: number | null;
  currency: string | null;
  due_date: string | null;
  job_id: string | null;
  client_id: string | null;
  created_at: string | null;
}

export interface InvoiceItemRow {
  id: string;
  description: string | null;
  qty: number | null;
  unit_price_cents: number | null;
  line_total_cents: number | null;
}

export interface QuoteRow {
  id: string;
  quote_number: string | null;
  status: string | null;
  total_cents: number | null;
  job_id: string | null;
  client_id: string | null;
  view_token: string | null;
  created_at: string | null;
}

const INVOICE_COLS =
  'id, invoice_number, status, subject, subtotal_cents, tax_cents, total_cents, balance_cents, currency, due_date, job_id, client_id, created_at';
const QUOTE_COLS =
  'id, quote_number, status, total_cents, job_id, client_id, view_token, created_at';

export async function listInvoicesForJob(jobId: string): Promise<InvoiceRow[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_COLS)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvoiceRow[];
}

export async function getInvoice(id: string): Promise<InvoiceRow | null> {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as InvoiceRow | null) ?? null;
}

/** Line items for an invoice, in entry order — used to render the in-app preview. */
export async function listInvoiceItems(invoiceId: string): Promise<InvoiceItemRow[]> {
  const { data, error } = await supabase
    .from('invoice_items')
    .select('id, description, qty, unit_price_cents, line_total_cents')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvoiceItemRow[];
}

export interface QuoteDetail {
  id: string;
  quote_number: string | null;
  title: string | null;
  status: string | null;
  client_id: string | null;
  view_token: string | null;
  currency: string | null;
  subtotal_cents: number | null;
  discount_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  deposit_required: boolean | null;
  deposit_type: string | null;
  deposit_value: number | null;
  valid_until: string | null;
}

export interface QuoteItemRow {
  id: string;
  name: string | null;
  quantity: number | null;
  unit_price_cents: number | null;
  total_cents: number | null;
}

const QUOTE_DETAIL_COLS =
  'id, quote_number, title, status, client_id, view_token, currency, subtotal_cents, discount_cents, tax_cents, total_cents, deposit_required, deposit_type, deposit_value, valid_until';

/** Full quote (header) for the in-app send screen / PDF. */
export async function getQuote(id: string): Promise<QuoteDetail | null> {
  const { data, error } = await supabase
    .from('quotes')
    .select(QUOTE_DETAIL_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as QuoteDetail | null) ?? null;
}

/** Line items for a quote, in entry order. */
export async function listQuoteItems(quoteId: string): Promise<QuoteItemRow[]> {
  const { data, error } = await supabase
    .from('quote_line_items')
    .select('id, name, quantity, unit_price_cents, total_cents')
    .eq('quote_id', quoteId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as QuoteItemRow[];
}

export async function listQuotesForJob(jobId: string): Promise<QuoteRow[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select(QUOTE_COLS)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as QuoteRow[];
}

/**
 * Get (or create) a public payment link for an invoice, then return the full
 * URL the client opens to pay: `${EXPO_PUBLIC_WEB_URL}/pay/:public_token`.
 * Works against Supabase directly (payment_requests RLS allows org members to
 * read/insert); the secure web page handles Stripe. Requires EXPO_PUBLIC_WEB_URL.
 */
export async function getOrCreatePaymentToken(params: {
  orgId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
}): Promise<string> {
  if (!params.amountCents || params.amountCents <= 0) {
    throw new Error('This invoice has nothing left to pay.');
  }

  // Reuse an existing open request for this invoice if there is one.
  const { data: existing } = await supabase
    .from('payment_requests')
    .select('public_token, status')
    .eq('org_id', params.orgId)
    .eq('invoice_id', params.invoiceId)
    .in('status', ['pending', 'sent'])
    .maybeSingle();

  let token = existing?.public_token as string | undefined;

  if (!token) {
    const { data, error } = await supabase
      .from('payment_requests')
      .insert({
        org_id: params.orgId,
        invoice_id: params.invoiceId,
        amount_cents: params.amountCents,
        currency: params.currency || 'CAD',
      })
      .select('public_token')
      .single();
    if (error) throw new Error(error.message);
    token = data.public_token as string;
  }

  return token;
}

/**
 * Finish a job and prepare its invoice — the SAME flow the desktop uses on
 * "complete job". Calls the `finish_job_and_prepare_invoice` Postgres RPC, which
 * creates the invoice draft from the job (totals, taxes, line items) or returns
 * the existing one. Returns the invoice id to open. Mirrors
 * src/lib/invoicesApi.ts → finishJobAndPrepareInvoice.
 */
export async function finishJobAndPrepareInvoice(params: {
  orgId?: string | null;
  jobId: string;
}): Promise<{ invoiceId: string; alreadyExists: boolean }> {
  const { data, error } = await supabase.rpc('finish_job_and_prepare_invoice', {
    p_org_id: params.orgId ?? null,
    p_job_id: params.jobId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  const invoiceId = String(row?.invoice_id ?? '').trim();
  if (!invoiceId) throw new Error('Invoice preparation succeeded but invoice_id is missing.');
  return { invoiceId, alreadyExists: Boolean(row?.already_exists) };
}

export async function getOrCreatePaymentLink(params: {
  orgId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
}): Promise<string> {
  const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
  if (!webUrl) {
    throw new Error(
      'Set EXPO_PUBLIC_WEB_URL (your deployed Lume web app URL) to generate payment links.',
    );
  }
  const token = await getOrCreatePaymentToken(params);
  return `${webUrl.replace(/\/$/, '')}/pay/${token}`;
}

/**
 * Public link a client opens to view + approve/decline a quote:
 * `${EXPO_PUBLIC_WEB_URL}/quote/:view_token`. The quote's view_token is
 * DB-generated; org members can read it under RLS.
 */
export function quoteShareLink(viewToken: string): string {
  const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
  if (!webUrl) {
    throw new Error('Set EXPO_PUBLIC_WEB_URL (your deployed Lume web app URL) to send quotes.');
  }
  return `${webUrl.replace(/\/$/, '')}/quote/${viewToken}`;
}

/** Mark a quote as sent (org members can update under RLS; never downgrades). */
export async function markQuoteSent(quoteId: string): Promise<void> {
  await supabase
    .from('quotes')
    .update({ sent_via_sms_at: new Date().toISOString(), last_sent_channel: 'sms' })
    .eq('id', quoteId);
  // Only flip to 'sent' from a pre-send status, so an approved quote isn't reset.
  await supabase
    .from('quotes')
    .update({ status: 'sent' })
    .eq('id', quoteId)
    .in('status', ['draft', 'action_required']);
}

/** Next document number for the org (max existing numeric + 1). */
async function nextNumber(table: 'quotes' | 'invoices', col: string, orgId: string): Promise<string> {
  const { data } = await supabase.from(table).select(col).eq('org_id', orgId).limit(500);
  let max = 0;
  for (const r of (data ?? []) as any[]) {
    const n = parseInt(String(r[col]).replace(/\D/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

export interface LineItemInput {
  name: string;
  qty: number;
  unit_price_cents: number;
}

function computeTotals(items: LineItemInput[], taxRatePct: number) {
  const subtotal = items.reduce((s, i) => s + Math.round(i.qty * i.unit_price_cents), 0);
  const tax = Math.round((subtotal * (taxRatePct || 0)) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/** Create a quote + its line items, matching the web's shape (totals computed). */
export async function createQuote(params: {
  orgId: string;
  clientId: string;
  userId: string;
  title: string;
  items: LineItemInput[];
  taxRatePct: number;
  validDays?: number;
  discountType?: 'percentage' | 'fixed' | null;
  discountValue?: number;
  notes?: string | null;
  depositRequired?: boolean;
  depositType?: 'percentage' | 'fixed' | null;
  depositValue?: number;
}): Promise<{ id: string; viewToken: string | null }> {
  const subtotal = params.items.reduce((s, i) => s + Math.round(i.qty * i.unit_price_cents), 0);
  // Discount (web: percentage of subtotal, or fixed dollars).
  let discount = 0;
  if (params.discountType === 'percentage') discount = Math.round((subtotal * (params.discountValue || 0)) / 100);
  else if (params.discountType === 'fixed') discount = Math.round((params.discountValue || 0) * 100);
  discount = Math.min(discount, subtotal);
  const tax = Math.round(((subtotal - discount) * (params.taxRatePct || 0)) / 100);
  const total = subtotal - discount + tax;

  const quote_number = await nextNumber('quotes', 'quote_number', params.orgId);
  const validUntil = params.validDays
    ? new Date(Date.now() + params.validDays * 86400000).toISOString().slice(0, 10)
    : null;

  const { data, error } = await supabase
    .from('quotes')
    .insert({
      org_id: params.orgId,
      client_id: params.clientId,
      created_by: params.userId,
      quote_number,
      title: params.title,
      status: 'draft',
      context_type: 'client',
      currency: 'CAD',
      subtotal_cents: subtotal,
      discount_cents: discount,
      discount_type: params.discountType ?? null,
      discount_value: params.discountValue ?? null,
      tax_cents: tax,
      total_cents: total,
      tax_rate: params.taxRatePct || 0,
      valid_until: validUntil,
      notes: params.notes ?? null,
      deposit_required: params.depositRequired ?? false,
      deposit_type: params.depositRequired ? params.depositType ?? null : null,
      deposit_value: params.depositRequired ? params.depositValue ?? null : null,
    })
    .select('id, view_token')
    .single();
  if (error) throw new Error(error.message);
  const quoteRow = data as { id: string; view_token: string | null };
  const quoteId = quoteRow.id;

  if (params.items.length) {
    const rows = params.items.map((it, idx) => ({
      quote_id: quoteId,
      name: it.name || 'Item',
      quantity: it.qty,
      unit_price_cents: it.unit_price_cents,
      total_cents: Math.round(it.qty * it.unit_price_cents),
      sort_order: idx,
      is_optional: false,
      item_type: 'service',
    }));
    const { error: liErr } = await supabase.from('quote_line_items').insert(rows);
    if (liErr) throw new Error(liErr.message);
  }
  return { id: quoteId, viewToken: quoteRow.view_token };
}

/** Create an invoice + its items, matching the web's shape (totals computed). */
export async function createInvoice(params: {
  orgId: string;
  clientId: string;
  subject: string;
  dueDate: string | null;
  items: LineItemInput[];
  taxRatePct: number;
}): Promise<{ id: string }> {
  const { subtotal, tax, total } = computeTotals(params.items, params.taxRatePct);
  const invoice_number = await nextNumber('invoices', 'invoice_number', params.orgId);

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      org_id: params.orgId,
      client_id: params.clientId,
      invoice_number,
      status: 'draft',
      subject: params.subject || null,
      due_date: params.dueDate,
      currency: 'CAD',
      subtotal_cents: subtotal,
      tax_cents: tax,
      total_cents: total,
      paid_cents: 0,
      balance_cents: total,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const invoiceId = (data as { id: string }).id;

  if (params.items.length) {
    const rows = params.items.map((it) => ({
      org_id: params.orgId,
      invoice_id: invoiceId,
      description: it.name || 'Item',
      qty: it.qty,
      unit_price_cents: it.unit_price_cents,
      line_total_cents: Math.round(it.qty * it.unit_price_cents),
    }));
    const { error: liErr } = await supabase.from('invoice_items').insert(rows);
    if (liErr) throw new Error(liErr.message);
  }
  return { id: invoiceId };
}

/** Best-effort: stamp the invoice as sent (mirrors the web's server behavior).
 * Also defaults the payment term to net-30: if no due date was set when the
 * invoice was created, the due date becomes 30 days after it's sent. An explicit
 * due date the user typed is never overwritten. */
export async function markInvoiceSent(invoiceId: string): Promise<void> {
  const now = new Date();
  const due = new Date(now);
  due.setDate(due.getDate() + 30);
  const dueDate = due.toISOString().slice(0, 10); // YYYY-MM-DD

  const { data: existing } = await supabase
    .from('invoices')
    .select('issued_at, due_date, status')
    .eq('id', invoiceId)
    .single();

  // The web marks an invoice sent via `issued_at` + status 'sent' — there is no
  // `sent_at` column (writing it was a silent no-op, so the web never saw the
  // send). Preserve an existing issued_at so the original send date stands, and
  // only bump draft → sent (never downgrade a partial/paid invoice).
  const patch: { issued_at: string; due_date?: string; status?: string } = {
    issued_at: existing?.issued_at ?? now.toISOString(),
  };
  if (!existing?.due_date) patch.due_date = dueDate;
  if (existing?.status === 'draft') patch.status = 'sent';

  const { error } = await supabase.from('invoices').update(patch).eq('id', invoiceId);
  if (error) throw new Error(error.message);
}

/** Void (cancel) an invoice: status → 'void', no balance due. Org members can
 * update invoices under RLS, same as markInvoiceSent. */
export async function voidInvoice(invoiceId: string): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({ status: 'void', balance_cents: 0 })
    .eq('id', invoiceId);
  if (error) throw new Error(error.message);
}

export async function listQuotesForClient(clientId: string): Promise<QuoteRow[]> {
  const { data, error } = await supabase
    .from('quotes')
    .select(QUOTE_COLS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as QuoteRow[];
}

export async function listInvoicesForClient(clientId: string): Promise<InvoiceRow[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_COLS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvoiceRow[];
}

/**
 * The org's default tax rate (%) — the sum of its ACTIVE percentage tax_configs,
 * set on the desktop (Settings → Taxes). So a quote/invoice created on mobile
 * uses the SAME taxes as the web instead of a hardcoded value. Returns null when
 * the org has no tax configured (callers fall back to their own default).
 */
export async function getOrgTaxRatePct(orgId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('tax_configs')
    .select('rate, type, is_active')
    .eq('org_id', orgId)
    .eq('is_active', true);
  if (error || !data || data.length === 0) return null;
  const total = data
    .filter((t: any) => t.type === 'percentage')
    .reduce((s: number, t: any) => s + (Number(t.rate) || 0), 0);
  return total > 0 ? total : null;
}
