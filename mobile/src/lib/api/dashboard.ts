// Owner/admin dashboard stats: revenue (invoiced / collected), outstanding
// balances, and jobs completed — for a given period start.

import { supabase } from '../supabase';
import { formatCurrencyCents } from '../format';

export interface DashboardStats {
  invoicedCents: number; // total invoiced in the period
  paidCents: number; // collected in the period (total − remaining balance)
  outstandingCents: number; // ALL open balances (not period-bound)
  invoiceCount: number; // invoices in the period
  paidInvoiceCount: number; // fully-paid invoices in the period
  jobsCompleted: number; // jobs completed in the period
  quotesPending: number; // quotes still awaiting a client decision (all-time)
}

export async function getDashboard(orgId: string, periodStartISO: string): Promise<DashboardStats> {
  // Sans `.is('deleted_at', null)` les chiffres de l'accueil comptent les
  // documents supprimés depuis le bureau.
  const { data: inv, error } = await supabase
    .from('invoices')
    .select('total_cents, balance_cents, issued_at, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null);
  if (error) throw new Error(error.message);

  const rows = (inv ?? []) as any[];
  let invoicedCents = 0;
  let paidCents = 0;
  let outstandingCents = 0;
  let invoiceCount = 0;
  let paidInvoiceCount = 0;

  for (const r of rows) {
    const total = r.total_cents ?? 0;
    const balance = r.balance_cents ?? 0;
    if (balance > 0) outstandingCents += balance; // all-time outstanding
    const when = r.issued_at ?? r.created_at;
    if (when && when >= periodStartISO) {
      invoicedCents += total;
      invoiceCount += 1;
      paidCents += Math.max(0, total - balance);
      if (balance <= 0) paidInvoiceCount += 1;
    }
  }

  const { data: jobs } = await supabase
    .from('jobs')
    .select('id')
    .eq('org_id', orgId)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .gte('completed_at', periodStartISO);

  // Quotes still pending a client decision (sent/draft/pending — not closed).
  const { data: quotes } = await supabase
    .from('quotes')
    .select('status')
    .eq('org_id', orgId)
    .is('deleted_at', null);
  const closed = ['approved', 'declined', 'converted', 'expired'];
  const quotesPending = (quotes ?? []).filter((q: any) => !closed.includes(q.status ?? '')).length;

  return {
    invoicedCents,
    paidCents,
    outstandingCents,
    invoiceCount,
    paidInvoiceCount,
    jobsCompleted: (jobs ?? []).length,
    quotesPending,
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
 * Reads are defensive (select '*') so schema differences can't break it.
 */
export async function getActionItems(orgId: string): Promise<ActionItem[]> {
  const items: ActionItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  const { data: invRows } = await supabase
    .from('invoices')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null);
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

  const { data: quoteRows } = await supabase
    .from('quotes')
    .select('*')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .eq('status', 'approved');
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

  const { data: jobRows } = await supabase
    .from('jobs')
    .select('id, title, requires_invoicing, status')
    .eq('org_id', orgId)
    .eq('status', 'completed')
    .eq('requires_invoicing', true)
    .is('deleted_at', null);
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
