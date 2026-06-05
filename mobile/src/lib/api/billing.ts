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
  created_at: string | null;
}

const INVOICE_COLS =
  'id, invoice_number, status, total_cents, balance_cents, due_date, job_id, client_id, created_at';
const QUOTE_COLS = 'id, quote_number, status, total_cents, job_id, client_id, created_at';

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

export async function listInvoicesForClient(clientId: string): Promise<InvoiceRow[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_COLS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as InvoiceRow[];
}
