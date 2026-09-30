// Owner/admin dashboard stats: revenue (invoiced / collected), outstanding
// balances, and jobs completed — for a given period start.

import { supabase } from '../supabase';
import { formatCurrencyCents } from '../format';

export interface DashboardStats {
  invoicedCents: number; // total invoiced in the period
  paidCents: number; // money actually received in the period (payments table)
  outstandingCents: number; // ALL open balances (not period-bound)
  invoiceCount: number; // invoices in the period
  paidInvoiceCount: number; // fully-paid invoices in the period
  jobsToday: number; // jobs on today's schedule
  quotesPending: number; // quotes still awaiting a client decision (all-time)
}

/** Payment rows in these states mean no money arrived.
 *
 * The taxonomy drifted across integrations — Stripe writes 'succeeded', PayPal
 * maps COMPLETED to 'succeeded', other paths write 'completed'. Listing what to
 * exclude rather than what to include means a new provider spelling its success
 * state differently still counts, instead of silently reporting zero. */
const NOT_RECEIVED = new Set(['pending', 'failed', 'refunded', 'canceled', 'cancelled', 'unknown']);

const PAGE = 1000; // PostgREST returns at most 1000 rows per request

/** Read every row of a filtered table, page by page.
 *
 * These totals used to be summed from a single unpaginated request, so past
 * 1000 invoices the money was added up from a slice of the books — understated,
 * with no error anywhere. Silent wrong numbers are worse than no numbers.
 */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function getDashboard(orgId: string, periodStartISO: string): Promise<DashboardStats> {
  // Sans `.is('deleted_at', null)` les chiffres de l'accueil comptent les
  // documents supprimés depuis le bureau.
  const rows = await fetchAll<any>((from, to) =>
    supabase
      .from('invoices')
      .select('total_cents, balance_cents, issued_at, created_at')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .range(from, to),
  );

  let invoicedCents = 0;
  let outstandingCents = 0;
  let invoiceCount = 0;
  let paidInvoiceCount = 0;

  // Compare instants, not strings: PostgREST renders timestamptz as
  // `...+00:00` while toISOString() ends in `.000Z`, so a row landing on the
  // exact boundary second sorted the wrong way under `>=` on text.
  const periodStartMs = Date.parse(periodStartISO);

  for (const r of rows) {
    const total = r.total_cents ?? 0;
    const balance = r.balance_cents ?? 0;
    if (balance > 0) outstandingCents += balance; // all-time outstanding
    const when = r.issued_at ?? r.created_at;
    const whenMs = when ? Date.parse(when) : NaN;
    if (!Number.isNaN(whenMs) && whenMs >= periodStartMs) {
      invoicedCents += total;
      invoiceCount += 1;
      if (balance <= 0) paidInvoiceCount += 1;
    }
  }

  // "Collected" now means money that actually arrived during the period, read
  // from the payments ledger. It used to be (total − balance) over invoices
  // ISSUED in the period, so a client settling last month's invoice today was
  // invisible — the headline under-reported every business that gets paid late.
  // `payment_date` is the column every writer fills (server/lib/payments.ts);
  // `paid_at` on this table is legacy and mostly empty.
  const payments = await fetchAll<any>((from, to) =>
    supabase
      .from('payments')
      .select('amount_cents, status')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .gte('payment_date', periodStartISO)
      .range(from, to),
  );
  let paidCents = 0;
  for (const p of payments) {
    if (NOT_RECEIVED.has(String(p.status ?? '').toLowerCase())) continue;
    paidCents += p.amount_cents ?? 0;
  }

  // Today's schedule — more useful in the morning than a count of finished work.
  // A count, not a page of ids: `head: true` ships no rows and is not capped.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const a = dayStart.toISOString();
  const b = dayEnd.toISOString();
  const { count: jobsToday, error: jobsErr } = await supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('deleted_at', null)
    // Both columns, because the app's own "today" list reads both (api/jobs.ts):
    // some jobs carry scheduled_at, others only start_at. Filtering on one would
    // quietly report fewer jobs than the schedule screen shows.
    .or(`and(scheduled_at.gte.${a},scheduled_at.lt.${b}),and(start_at.gte.${a},start_at.lt.${b})`);
  if (jobsErr) throw new Error(jobsErr.message);

  // Quotes still pending a client decision (sent/draft/pending — not closed).
  const closed = ['approved', 'declined', 'converted', 'expired'];
  const { count: quotesPending, error: quotesErr } = await supabase
    .from('quotes')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('deleted_at', null)
    // `not.in` alone would drop rows with no status, which the previous
    // client-side filter counted as pending; the or() keeps them.
    .or(`status.is.null,status.not.in.(${closed.join(',')})`);
  if (quotesErr) throw new Error(quotesErr.message);

  return {
    invoicedCents,
    paidCents,
    outstandingCents,
    invoiceCount,
    paidInvoiceCount,
    jobsToday: jobsToday ?? 0,
    quotesPending: quotesPending ?? 0,
  };
}

// ── Action Required feed ─────────────────────────────────────────────────────

export interface ActionItem {
  id: string;
  kind: 'invoice' | 'quote' | 'job';
  title: string;
  subtitle?: string;
  route?: string;
  tint: string; // status colour
}

/**
 * Things that need the owner/admin's attention:
 *  - unpaid / overdue invoices
 *  - approved quotes waiting to be invoiced
 *  - completed jobs that still need an invoice
 * Les erreurs remontent : un échec de requête ne doit pas se déguiser en
 * « rien à traiter ».
 */
export async function getActionItems(orgId: string): Promise<ActionItem[]> {
  const items: ActionItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const { data: invRows, error: invErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null);
  if (invErr) throw new Error(invErr.message);
  const invoices = (invRows ?? []) as any[];
  for (const r of invoices) {
    if ((r.balance_cents ?? 0) > 0) {
      const overdue = r.due_date && String(r.due_date).slice(0, 10) < today;
      items.push({
        id: `inv-${r.id}`,
        kind: 'invoice',
        title: `Facture ${r.invoice_number ?? ''} ${overdue ? 'en retard' : 'due'}`.trim(),
        subtitle: `${formatCurrencyCents(r.balance_cents, 'CAD')} à recevoir`,
        route: r.job_id ? `/(app)/jobs/${r.job_id}` : undefined,
        tint: overdue ? '#DC2626' : '#CA8A04',
      });
    }
  }

  const { data: quoteRows, error: quoteRowsErr } = await supabase
    .from('quotes')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('status', 'approved');
  if (quoteRowsErr) throw new Error(quoteRowsErr.message);
  for (const r of (quoteRows ?? []) as any[]) {
    items.push({
      id: `q-${r.id}`,
      kind: 'quote',
      title: `Soumission ${r.quote_number ?? ''} approuvée`.trim(),
      subtitle: 'À convertir en facture',
      route: r.job_id ? `/(app)/jobs/${r.job_id}` : undefined,
      tint: '#16A34A',
    });
  }

  const { data: jobRows, error: jobRowsErr } = await supabase
    .from('jobs')
    .select('id, title, requires_invoicing, status')
    .eq('org_id', orgId)
    .eq('status', 'completed')
    .eq('requires_invoicing', true)
    .is('deleted_at', null);
  if (jobRowsErr) throw new Error(jobRowsErr.message);
  const invoicedJobIds = new Set(invoices.map((r) => r.job_id).filter(Boolean));
  for (const r of (jobRows ?? []) as any[]) {
    if (!invoicedJobIds.has(r.id)) {
      items.push({
        id: `job-${r.id}`,
        kind: 'job',
        title: `Job à facturer : ${r.title}`,
        subtitle: 'Complété, aucune facture',
        route: `/(app)/jobs/${r.id}`,
        tint: '#7C3AED',
      });
    }
  }

  return items;
}
