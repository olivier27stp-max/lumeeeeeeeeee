// Billing reads (invoices + quotes) for the admin/owner money layer. Gated in
// the UI behind canSeePricing — technicians never call this. v1 is read-only;
// on-device Stripe payment collection is a v2 follow-up.

import { supabase } from '../supabase';

export interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  status: string | null;
  total_cents: number | null;
  balance_cents: number | null;
  due_date: string | null;
  job_id: string | null;
  client_id: string | null;
  created_at: string | null;
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
  'id, invoice_number, status, total_cents, balance_cents, due_date, job_id, client_id, created_at';
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

/** Best-effort: stamp the invoice as sent (mirrors the web's server behavior). */
export async function markInvoiceSent(invoiceId: string): Promise<void> {
  await supabase
    .from('invoices')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', invoiceId);
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
