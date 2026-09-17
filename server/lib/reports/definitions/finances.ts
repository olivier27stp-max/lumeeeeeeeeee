/**
 * Rapports — Finances.
 *
 * Définitions canoniques (les mêmes que les RPC rpc_insights_*) :
 *  - Facturé  = invoices.total_cents, statut sent/partial/paid, par date d'émission
 *  - Encaissé = payments.amount_cents, statut succeeded, par paid_at
 *  - Solde    = invoices.balance_cents (état au moment de la consultation)
 * Ces trois montants ne sont jamais additionnés entre eux.
 */
import type { ReportContext, ReportDefinition, Row } from '../types';
import { COUNT_EXACT } from '../engine';
import { applyPeriod, addDays, daysBetween, toLocalDate } from '../dates';
import { L, col, LABELS, optionsFrom, eqFilter, applySearch, readAll, centsOf } from '../helpers';
import { lookupClients, lookupMembers, lookupJobs, lookupInvoices } from '../lookups';

const INVOICE_COLS = 'id,invoice_number,subject,client_id,client_name_snapshot,client_email_snapshot,status,issued_at,due_date,' +
  'subtotal_cents,tax_cents,discount_cents,total_cents,paid_cents,balance_cents,paid_at,salesperson_id,job_id,created_at,currency';

function mapInvoice(raw: Row): Row {
  return {
    id: raw.id,
    invoice_number: raw.invoice_number || '',
    client: raw.client_name_snapshot || '',
    client_id: raw.client_id,
    client_email: raw.client_email_snapshot || '',
    subject: raw.subject || '',
    issued_at: raw.issued_at || raw.created_at,
    due_date: raw.due_date,
    status: raw.status,
    subtotal_cents: centsOf(raw.subtotal_cents),
    tax_cents: centsOf(raw.tax_cents),
    discount_cents: centsOf(raw.discount_cents),
    total_cents: centsOf(raw.total_cents),
    paid_cents: centsOf(raw.paid_cents),
    balance_cents: centsOf(raw.balance_cents),
    paid_at: raw.paid_at,
    salesperson_id: raw.salesperson_id,
    salesperson: '',
    job_id: raw.job_id,
    job_number: '',
  };
}

async function enrichInvoices(rows: Row[], ctx: ReportContext) {
  const clients = await lookupClients(ctx.service, ctx.orgId, rows.filter((r) => !r.client).map((r) => r.client_id));
  const members = await lookupMembers(ctx.service, ctx.orgId, rows.map((r) => r.salesperson_id));
  const jobs = await lookupJobs(ctx.service, ctx.orgId, rows.map((r) => r.job_id));
  for (const r of rows) {
    if (!r.client) {
      const c = clients.get(String(r.client_id));
      if (c) { r.client = c.name; if (!r.client_email) r.client_email = c.email; }
    }
    r.salesperson = members.get(String(r.salesperson_id)) || '';
    r.job_number = jobs.get(String(r.job_id))?.job_number || '';
  }
}

/** Filtre de statut « métier » des factures (mêmes valeurs que la page Factures). */
function applyInvoiceStatus(b: any, status: string | undefined, today: string) {
  switch (status) {
    case 'draft': case 'sent': case 'partial': case 'paid': case 'void':
      return b.eq('status', status);
    case 'open':
      return b.in('status', ['sent', 'partial']);
    case 'past_due':
      return b.in('status', ['sent', 'partial']).lt('due_date', today).gt('balance_cents', 0);
    case 'sent_not_due':
      return b.in('status', ['sent', 'partial']).or(`due_date.gte.${today},due_date.is.null`);
    default:
      return b;
  }
}

const invoices: ReportDefinition = {
  id: 'invoices',
  category: 'finances',
  title: L('Factures', 'Invoices'),
  description: L('Toutes les factures avec sous-total, taxes, montant payé et solde.', 'All invoices with subtotal, taxes, amount paid and balance.'),
  permission: 'financial.view_reports',
  dateFilter: {
    label: L('Période', 'Period'), default: 'last90',
    fields: [
      { value: 'issued_at', label: L("Date d'émission", 'Issue date') },
      { value: 'due_date', label: L("Date d'échéance", 'Due date') },
      { value: 'paid_at', label: L('Date de paiement', 'Paid date') },
      { value: 'created_at', label: L('Date de création', 'Created date') },
    ],
  },
  filters: [
    {
      key: 'status', label: L('Statut', 'Status'), type: 'select',
      options: [
        { value: 'open', label: L('Ouvertes (envoyées + partielles)', 'Open (sent + partial)') },
        { value: 'past_due', label: L('En retard', 'Past due') },
        { value: 'sent_not_due', label: L('Envoyées, non échues', 'Sent, not due') },
        ...optionsFrom(LABELS.invoiceStatus),
      ],
    },
    { key: 'salesperson', label: L('Vendeur', 'Salesperson'), type: 'select', source: 'members' },
    { key: 'q', label: L('Recherche', 'Search'), type: 'search', placeholder: L('N°, client, sujet…', 'Number, client, subject…') },
  ],
  columns: [
    col.text('invoice_number', 'N°', 'Number', { width: '90px' }),
    col.text('client', 'Client', 'Client', { sortKey: 'client_name_snapshot', width: '1.4fr' }),
    col.text('subject', 'Sujet', 'Subject', { width: '1.2fr' }),
    col.date('issued_at', 'Émise le', 'Issued'),
    col.date('due_date', 'Échéance', 'Due'),
    col.enum('status', 'Statut', 'Status', LABELS.invoiceStatus, { width: '110px' }),
    col.money('subtotal_cents', 'Sous-total', 'Subtotal'),
    col.money('discount_cents', 'Rabais', 'Discount', { width: '100px' }),
    col.money('tax_cents', 'Taxes', 'Taxes', { width: '100px' }),
    col.money('total_cents', 'Total', 'Total'),
    col.money('paid_cents', 'Payé', 'Paid'),
    col.money('balance_cents', 'Solde', 'Balance'),
    col.date('paid_at', 'Payée le', 'Paid on'),
    col.text('salesperson', 'Vendeur', 'Salesperson', { sortable: false, width: '140px' }),
    col.text('job_number', 'Job', 'Job', { sortable: false, width: '80px' }),
    col.text('client_email', 'Courriel', 'Email', { sortable: false, width: '180px' }),
  ],
  defaultSort: { key: 'issued_at', dir: 'desc' },
  source: {
    kind: 'query',
    build: (ctx, q) => {
      let b = ctx.user.from('invoices').select(INVOICE_COLS, COUNT_EXACT).eq('org_id', ctx.orgId).is('deleted_at', null);
      const field = q.dateField && ['issued_at', 'due_date', 'paid_at', 'created_at'].includes(q.dateField) ? q.dateField : 'issued_at';
      b = applyPeriod(b, field, field === 'due_date' ? 'date' : 'timestamp', q.from, q.to);
      b = applyInvoiceStatus(b, q.filters.status, ctx.today);
      b = eqFilter(b, q.filters.salesperson, 'salesperson_id');
      b = applySearch(b, q.filters.q, ['invoice_number', 'subject', 'client_name_snapshot', 'client_email_snapshot']);
      return b;
    },
    map: mapInvoice,
    enrich: enrichInvoices,
  },
};

/** Tranches de retard : bornes de due_date pour un filtre côté base. */
function bucketBounds(bucket: string, today: string): { from?: string; to?: string } | null {
  switch (bucket) {
    case '1_30': return { from: addDays(today, -30), to: addDays(today, -1) };
    case '31_60': return { from: addDays(today, -60), to: addDays(today, -31) };
    case '61_90': return { from: addDays(today, -90), to: addDays(today, -61) };
    case '90_plus': return { to: addDays(today, -91) };
    default: return null;
  }
}

const AGING_LABELS = {
  '1_30': L('1 à 30 jours', '1–30 days'), '31_60': L('31 à 60 jours', '31–60 days'),
  '61_90': L('61 à 90 jours', '61–90 days'), '90_plus': L('Plus de 90 jours', 'Over 90 days'),
};

const agedReceivables: ReportDefinition = {
  id: 'aged-receivables',
  category: 'finances',
  title: L('Comptes clients en retard', 'Aged receivables'),
  description: L("Factures échues avec solde impayé, classées par tranche de retard. État au moment de la consultation.", 'Past-due invoices with an unpaid balance, grouped by aging bucket. Snapshot as of today.'),
  permission: 'financial.view_reports',
  filters: [
    { key: 'bucket', label: L('Tranche', 'Bucket'), type: 'select', options: optionsFrom(AGING_LABELS) },
    { key: 'salesperson', label: L('Vendeur', 'Salesperson'), type: 'select', source: 'members' },
    { key: 'q', label: L('Recherche', 'Search'), type: 'search', placeholder: L('N°, client…', 'Number, client…') },
  ],
  columns: [
    col.text('client', 'Client', 'Client', { sortKey: 'client_name_snapshot', width: '1.4fr' }),
    col.text('invoice_number', 'N°', 'Number', { width: '90px' }),
    col.date('issued_at', 'Émise le', 'Issued'),
    col.date('due_date', 'Échéance', 'Due'),
    col.int('days_overdue', 'Jours de retard', 'Days overdue', { sortable: false, total: undefined }),
    col.enum('bucket', 'Tranche', 'Bucket', AGING_LABELS, { sortable: false }),
    col.money('total_cents', 'Total', 'Total'),
    col.money('paid_cents', 'Payé', 'Paid'),
    col.money('balance_cents', 'Solde', 'Balance'),
    col.text('salesperson', 'Vendeur', 'Salesperson', { sortable: false, width: '140px' }),
    col.text('client_email', 'Courriel', 'Email', { sortable: false, width: '180px' }),
  ],
  defaultSort: { key: 'due_date', dir: 'asc' },
  source: {
    kind: 'query',
    build: (ctx, q) => {
      let b = ctx.user.from('invoices').select(INVOICE_COLS, COUNT_EXACT)
        .eq('org_id', ctx.orgId).is('deleted_at', null)
        .in('status', ['sent', 'partial']).gt('balance_cents', 0).lt('due_date', ctx.today);
      const bounds = bucketBounds(q.filters.bucket || '', ctx.today);
      if (bounds) b = applyPeriod(b, 'due_date', 'date', bounds.from, bounds.to);
      b = eqFilter(b, q.filters.salesperson, 'salesperson_id');
      b = applySearch(b, q.filters.q, ['invoice_number', 'client_name_snapshot', 'client_email_snapshot']);
      return b;
    },
    map: (raw, ctx) => {
      const row = mapInvoice(raw);
      const days = raw.due_date ? daysBetween(String(raw.due_date), ctx.today) : 0;
      row.days_overdue = days;
      row.bucket = days <= 30 ? '1_30' : days <= 60 ? '31_60' : days <= 90 ? '61_90' : '90_plus';
      return row;
    },
    enrich: enrichInvoices,
  },
};

const payments: ReportDefinition = {
  id: 'payments',
  category: 'finances',
  title: L('Paiements', 'Payments'),
  description: L('Transactions encaissées par méthode et fournisseur, avec frais et montant net.', 'Collected transactions by method and provider, with fees and net amount.'),
  permission: 'financial.view_reports',
  dateFilter: { label: L('Date de paiement', 'Paid date'), default: 'last90' },
  filters: [
    { key: 'status', label: L('Statut', 'Status'), type: 'select', options: optionsFrom(LABELS.paymentStatus), default: 'succeeded' },
    { key: 'method', label: L('Méthode', 'Method'), type: 'select', options: optionsFrom(LABELS.paymentMethod) },
    { key: 'provider', label: L('Fournisseur', 'Provider'), type: 'select', options: optionsFrom(LABELS.paymentProvider) },
  ],
  columns: [
    col.datetime('paid_at', 'Payé le', 'Paid at'),
    col.text('client', 'Client', 'Client', { sortable: false, width: '1.4fr' }),
    col.text('invoice_number', 'Facture', 'Invoice', { sortable: false, width: '90px' }),
    col.enum('method', 'Méthode', 'Method', LABELS.paymentMethod, { width: '120px' }),
    col.enum('provider', 'Fournisseur', 'Provider', LABELS.paymentProvider, { width: '110px' }),
    col.enum('status', 'Statut', 'Status', LABELS.paymentStatus, { width: '110px' }),
    col.money('amount_cents', 'Montant', 'Amount'),
    col.money('fee_cents', 'Frais', 'Fees', { width: '100px' }),
    col.money('net_cents', 'Net', 'Net'),
    col.text('failure_reason', "Motif d'échec", 'Failure reason', { sortable: false, width: '1fr' }),
  ],
  defaultSort: { key: 'paid_at', dir: 'desc' },
  source: {
    kind: 'query',
    build: (ctx, q) => {
      let b = ctx.user.from('payments')
        .select('id,paid_at,client_id,invoice_id,job_id,method,provider,status,amount_cents,stripe_fee_amount,application_fee_amount,net_amount,currency,failure_reason', COUNT_EXACT)
        .eq('org_id', ctx.orgId).is('deleted_at', null);
      b = applyPeriod(b, 'paid_at', 'timestamp', q.from, q.to);
      b = eqFilter(b, q.filters.status, 'status');
      b = eqFilter(b, q.filters.method, 'method');
      b = eqFilter(b, q.filters.provider, 'provider');
      return b;
    },
    map: (raw) => {
      const amount = centsOf(raw.amount_cents);
      const fee = centsOf(raw.stripe_fee_amount) + centsOf(raw.application_fee_amount);
      const net = raw.net_amount !== null && raw.net_amount !== undefined ? centsOf(raw.net_amount) : amount - fee;
      return {
        id: raw.id, paid_at: raw.paid_at, client_id: raw.client_id, client: '', invoice_id: raw.invoice_id, invoice_number: '',
        method: raw.method || '', provider: raw.provider || '', status: raw.status,
        amount_cents: amount, fee_cents: fee, net_cents: net, failure_reason: raw.failure_reason || '',
      };
    },
    enrich: async (rows, ctx) => {
      const clients = await lookupClients(ctx.service, ctx.orgId, rows.map((r) => r.client_id));
      const invoices = await lookupInvoices(ctx.service, ctx.orgId, rows.map((r) => r.invoice_id));
      for (const r of rows) {
        r.client = clients.get(String(r.client_id))?.name || '';
        r.invoice_number = invoices.get(String(r.invoice_id))?.invoice_number || '';
      }
    },
  },
};

const clientBalances: ReportDefinition = {
  id: 'client-balances',
  category: 'finances',
  title: L('Soldes par client', 'Client balances'),
  description: L('Qui doit quoi : factures ouvertes regroupées par client, avec la part échue.', 'Who owes what: open invoices grouped by client, with the overdue portion.'),
  permission: 'financial.view_reports',
  filters: [
    { key: 'q', label: L('Recherche', 'Search'), type: 'search', placeholder: L('Client…', 'Client…') },
  ],
  columns: [
    col.text('client', 'Client', 'Client', { width: '1.6fr' }),
    col.int('open_count', 'Factures ouvertes', 'Open invoices', { width: '110px' }),
    col.money('total_cents', 'Facturé ouvert', 'Open invoiced'),
    col.money('paid_cents', 'Payé', 'Paid'),
    col.money('balance_cents', 'Solde', 'Balance'),
    col.money('overdue_cents', 'Dont échu', 'Of which overdue'),
    col.date('oldest_due', 'Plus ancienne échéance', 'Oldest due date', { width: '140px' }),
    col.text('client_email', 'Courriel', 'Email', { sortable: false, width: '180px' }),
  ],
  defaultSort: { key: 'balance_cents', dir: 'desc' },
  source: {
    kind: 'memory',
    loadAll: async (ctx, q) => {
      const rows = await readAll(() => ctx.user.from('invoices')
        .select('id,client_id,client_name_snapshot,client_email_snapshot,due_date,total_cents,paid_cents,balance_cents')
        .eq('org_id', ctx.orgId).is('deleted_at', null)
        .in('status', ['sent', 'partial']).gt('balance_cents', 0).order('id'));
      const groups = new Map<string, Row>();
      for (const inv of rows) {
        const key = String(inv.client_id || `snapshot:${inv.client_name_snapshot || ''}`);
        let g = groups.get(key);
        if (!g) {
          g = { client_id: inv.client_id, client: inv.client_name_snapshot || '', client_email: inv.client_email_snapshot || '',
            open_count: 0, total_cents: 0, paid_cents: 0, balance_cents: 0, overdue_cents: 0, oldest_due: null };
          groups.set(key, g);
        }
        g.open_count = Number(g.open_count) + 1;
        g.total_cents = Number(g.total_cents) + centsOf(inv.total_cents);
        g.paid_cents = Number(g.paid_cents) + centsOf(inv.paid_cents);
        g.balance_cents = Number(g.balance_cents) + centsOf(inv.balance_cents);
        if (inv.due_date && String(inv.due_date) < ctx.today) g.overdue_cents = Number(g.overdue_cents) + centsOf(inv.balance_cents);
        if (inv.due_date && (!g.oldest_due || String(inv.due_date) < String(g.oldest_due))) g.oldest_due = inv.due_date;
      }
      const out = Array.from(groups.values());
      const clients = await lookupClients(ctx.service, ctx.orgId, out.filter((r) => !r.client).map((r) => r.client_id));
      for (const r of out) {
        const c = clients.get(String(r.client_id));
        if (c) { if (!r.client) r.client = c.name; if (!r.client_email) r.client_email = c.email; }
      }
      const term = (q.filters.q || '').trim().toLowerCase();
      return term ? out.filter((r) => String(r.client).toLowerCase().includes(term) || String(r.client_email).toLowerCase().includes(term)) : out;
    },
  },
};

const revenueByPeriod: ReportDefinition = {
  id: 'revenue-by-period',
  category: 'finances',
  title: L('Revenus par période', 'Revenue by period'),
  description: L("Facturé (factures émises) et encaissé (paiements réussis) par mois, semaine ou jour. Mêmes définitions que Statistiques.", 'Invoiced (issued invoices) and collected (successful payments) by month, week or day. Same definitions as Statistics.'),
  permission: 'financial.view_reports',
  dateFilter: { label: L('Période', 'Period'), default: 'last12m' },
  filters: [
    {
      key: 'granularity', label: L('Regroupement', 'Group by'), type: 'select', default: 'month',
      options: [
        { value: 'month', label: L('Mois', 'Month') },
        { value: 'week', label: L('Semaine', 'Week') },
        { value: 'day', label: L('Jour', 'Day') },
      ],
    },
  ],
  columns: [
    col.date('period', 'Période', 'Period', { width: '140px' }),
    col.money('invoiced_cents', 'Facturé', 'Invoiced'),
    col.money('collected_cents', 'Encaissé', 'Collected'),
    col.money('difference_cents', 'Facturé − encaissé', 'Invoiced − collected', { total: undefined }),
  ],
  defaultSort: { key: 'period', dir: 'asc' },
  source: {
    kind: 'memory',
    loadAll: async (ctx, q) => {
      const granularity = ['month', 'week', 'day'].includes(q.filters.granularity || '') ? q.filters.granularity : 'month';
      const to = q.to || ctx.today;
      const from = q.from || addDays(to, -365);
      const { data, error } = await ctx.user.rpc('rpc_insights_revenue_series', { p_org: ctx.orgId, p_from: from, p_to: to, p_granularity: granularity });
      if (error) throw new Error(error.message);
      return (data || []).map((r: Row) => {
        const invoiced = centsOf(r.invoiced_cents);
        const collected = centsOf(r.revenue_cents);
        return { period: String(r.bucket_start).slice(0, 10), invoiced_cents: invoiced, collected_cents: collected, difference_cents: invoiced - collected };
      });
    },
  },
};

const taxes: ReportDefinition = {
  id: 'taxes',
  category: 'finances',
  title: L('Taxes facturées', 'Invoiced taxes'),
  description: L("Détail des taxes par facture émise (envoyée, partielle ou payée), pour préparer les remises. Filtre par nom de taxe pour obtenir le total d'une taxe.", 'Tax breakdown per issued invoice (sent, partial or paid), to prepare remittances. Filter by tax name to get one tax total.'),
  permission: 'financial.view_reports',
  dateFilter: { label: L("Date d'émission", 'Issue date'), default: 'thisMonth' },
  filters: [
    { key: 'tax', label: L('Taxe', 'Tax'), type: 'search', placeholder: L('Nom de la taxe (TPS, TVQ…)', 'Tax name (GST, QST…)') },
    { key: 'q', label: L('Recherche', 'Search'), type: 'search', placeholder: L('N°, client…', 'Number, client…') },
  ],
  columns: [
    col.text('invoice_number', 'N°', 'Number', { width: '90px' }),
    col.text('client', 'Client', 'Client', { width: '1.4fr' }),
    col.date('issued_at', 'Émise le', 'Issued'),
    col.enum('status', 'Statut', 'Status', LABELS.invoiceStatus, { width: '100px' }),
    col.text('tax_name', 'Taxe', 'Tax', { width: '140px' }),
    col.percent('rate', 'Taux', 'Rate', { width: '80px' }),
    col.money('base_cents', 'Base (sous-total − rabais)', 'Base (subtotal − discount)', { total: undefined, width: '150px' }),
    col.money('amount_cents', 'Montant de taxe', 'Tax amount'),
    col.money('invoice_total_cents', 'Total facture', 'Invoice total', { total: undefined }),
  ],
  defaultSort: { key: 'issued_at', dir: 'desc' },
  source: {
    kind: 'memory',
    loadAll: async (ctx, q) => {
      const invoices = await readAll(() => applyPeriod(
        ctx.user.from('invoices')
          .select('id,invoice_number,client_id,client_name_snapshot,issued_at,created_at,status,subtotal_cents,discount_cents,tax_cents,total_cents')
          .eq('org_id', ctx.orgId).is('deleted_at', null).in('status', ['sent', 'partial', 'paid']).order('id'),
        'issued_at', 'timestamp', q.from, q.to));
      const byId = new Map(invoices.map((i) => [String(i.id), i]));
      const out: Row[] = [];
      const seen = new Set<string>();
      const ids = invoices.map((i) => String(i.id));
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200);
        const { data, error } = await ctx.user.from('applied_taxes')
          .select('document_id,name,rate,amount_cents,is_compound')
          .eq('document_type', 'invoice').in('document_id', part);
        if (error) throw new Error(error.message);
        for (const t of data || []) {
          const inv = byId.get(String(t.document_id));
          if (!inv) continue;
          seen.add(String(inv.id));
          out.push(taxRow(inv, String(t.name || ''), Number(t.rate) || 0, centsOf(t.amount_cents)));
        }
      }
      // Factures avec taxes mais sans détail (anciennes données) : une ligne
      // « non détaillée » pour que le total reste vrai.
      for (const inv of invoices) {
        if (seen.has(String(inv.id)) || centsOf(inv.tax_cents) === 0) continue;
        out.push(taxRow(inv, ctx.lang === 'fr' ? '(non détaillée)' : '(not itemized)', 0, centsOf(inv.tax_cents)));
      }
      const tax = (q.filters.tax || '').trim().toLowerCase();
      const term = (q.filters.q || '').trim().toLowerCase();
      let rows = out;
      if (tax) rows = rows.filter((r) => String(r.tax_name).toLowerCase().includes(tax));
      if (term) rows = rows.filter((r) => String(r.invoice_number).toLowerCase().includes(term) || String(r.client).toLowerCase().includes(term));
      const clients = await lookupClients(ctx.service, ctx.orgId, rows.filter((r) => !r.client).map((r) => r.client_id));
      for (const r of rows) if (!r.client) r.client = clients.get(String(r.client_id))?.name || '';
      return rows;
    },
  },
};

function taxRow(inv: Row, name: string, rate: number, amount: number): Row {
  return {
    invoice_id: inv.id,
    invoice_number: inv.invoice_number || '',
    client_id: inv.client_id,
    client: inv.client_name_snapshot || '',
    issued_at: toLocalDate(inv.issued_at || inv.created_at),
    status: inv.status,
    tax_name: name,
    rate,
    base_cents: centsOf(inv.subtotal_cents) - centsOf(inv.discount_cents),
    amount_cents: amount,
    invoice_total_cents: centsOf(inv.total_cents),
  };
}

export const FINANCE_REPORTS: ReportDefinition[] = [invoices, agedReceivables, payments, clientBalances, revenueByPeriod, taxes];
