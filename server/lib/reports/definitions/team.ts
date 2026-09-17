/**
 * Rapports — Équipe et ventes : performance des vendeurs, commissions,
 * feuilles de temps, lien vers la paie.
 */
import type { ReportContext, ReportDefinition, Row } from '../types';
import { COUNT_EXACT } from '../engine';
import { applyPeriod, addDays } from '../dates';
import { L, col, LABELS, optionsFrom, eqFilter, readAll, centsOf, dollarsToCents, ownScope } from '../helpers';
import { lookupMembers, lookupTeams, lookupJobs, lookupInvoices, lookupCommissionRules } from '../lookups';

/**
 * Performance des vendeurs — attribution :
 *  - devis : quotes.salesperson_id, repli created_by ; « envoyé » = statut ≠ brouillon,
 *    « approuvé » = approved ou converted ; période sur created_at
 *  - jobs vendues : jobs.salesperson_id, repli created_by (même règle que le
 *    tableau des ventes) ; période sur sale_date ; jobs annulées exclues
 *  - facturé : invoices.salesperson_id ; statut sent/partial/paid ; période sur issued_at
 *  - encaissé : paiements réussis (paid_at) rattachés à une facture → vendeur de la facture
 */
const salesPerformance: ReportDefinition = {
  id: 'sales-performance',
  category: 'team',
  title: L('Performance des vendeurs', 'Sales performance'),
  description: L("Devis, jobs vendues, facturé et encaissé par vendeur sur la période.", 'Quotes, jobs sold, invoiced and collected per salesperson over the period.'),
  permission: 'financial.view_reports',
  dateFilter: { label: L('Période', 'Period'), default: 'thisMonth' },
  filters: [
    { key: 'team', label: L('Équipe', 'Team'), type: 'select', source: 'teams' },
  ],
  columns: [
    col.text('salesperson', 'Vendeur', 'Salesperson', { width: '1.4fr' }),
    col.text('team', 'Équipe', 'Team', { width: '120px' }),
    col.int('quotes_sent', 'Devis envoyés', 'Quotes sent', { width: '100px' }),
    col.int('quotes_approved', 'Devis approuvés', 'Quotes approved', { width: '110px' }),
    col.percent('approval_rate', "Taux d'approbation", 'Approval rate', { width: '110px' }),
    col.int('jobs_sold', 'Jobs vendues', 'Jobs sold', { width: '100px' }),
    col.money('sold_cents', 'Valeur vendue', 'Sold value'),
    col.money('invoiced_cents', 'Facturé', 'Invoiced'),
    col.money('collected_cents', 'Encaissé', 'Collected'),
  ],
  defaultSort: { key: 'sold_cents', dir: 'desc' },
  source: {
    kind: 'memory',
    loadAll: async (ctx, q) => {
      const to = q.to || ctx.today;
      const from = q.from || addDays(to, -30);
      const acc = new Map<string, Row>();
      const row = (id: string): Row => {
        let r = acc.get(id);
        if (!r) {
          r = { salesperson_id: id, salesperson: '', team_id: null, team: '', quotes_sent: 0, quotes_approved: 0, approval_rate: 0, jobs_sold: 0, sold_cents: 0, invoiced_cents: 0, collected_cents: 0 };
          acc.set(id, r);
        }
        return r;
      };
      const add = (r: Row, key: string, n: number) => { r[key] = Number(r[key]) + n; };
      const NONE = 'unassigned';

      const quotesRows = await readAll(() => applyPeriod(
        ctx.user.from('quotes').select('id,salesperson_id,created_by,status').eq('org_id', ctx.orgId).is('deleted_at', null).order('id'),
        'created_at', 'timestamp', from, to));
      for (const qr of quotesRows) {
        if (qr.status === 'draft') continue;
        const r = row(String(qr.salesperson_id || qr.created_by || NONE));
        add(r, 'quotes_sent', 1);
        if (qr.status === 'approved' || qr.status === 'converted') add(r, 'quotes_approved', 1);
      }

      const jobRows = await readAll(() => applyPeriod(
        ctx.user.from('jobs_active').select('id,salesperson_id,created_by,total_cents,status').eq('org_id', ctx.orgId).order('id'),
        'sale_date', 'date', from, to));
      for (const j of jobRows) {
        if (j.status === 'cancelled') continue;
        const r = row(String(j.salesperson_id || j.created_by || NONE));
        add(r, 'jobs_sold', 1);
        add(r, 'sold_cents', centsOf(j.total_cents));
      }

      const invoiceRows = await readAll(() => applyPeriod(
        ctx.user.from('invoices').select('id,salesperson_id,total_cents').eq('org_id', ctx.orgId).is('deleted_at', null).in('status', ['sent', 'partial', 'paid']).order('id'),
        'issued_at', 'timestamp', from, to));
      for (const inv of invoiceRows) add(row(String(inv.salesperson_id || NONE)), 'invoiced_cents', centsOf(inv.total_cents));

      const paymentRows = await readAll(() => applyPeriod(
        ctx.user.from('payments').select('id,invoice_id,amount_cents').eq('org_id', ctx.orgId).is('deleted_at', null).eq('status', 'succeeded').order('id'),
        'paid_at', 'timestamp', from, to));
      const invoiceOwners = await lookupInvoices(ctx.service, ctx.orgId, paymentRows.map((p) => p.invoice_id));
      for (const p of paymentRows) {
        const owner = invoiceOwners.get(String(p.invoice_id))?.salesperson_id || NONE;
        add(row(owner), 'collected_cents', centsOf(p.amount_cents));
      }

      const ids = Array.from(acc.keys()).filter((k) => k !== NONE);
      const members = await lookupMembers(ctx.service, ctx.orgId, ids);
      const { data: memberships } = await ctx.service.from('memberships').select('user_id, team_id').eq('org_id', ctx.orgId).in('user_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      const teamOf = new Map((memberships || []).map((m) => [m.user_id, m.team_id]));
      const teams = await lookupTeams(ctx.service, ctx.orgId, Array.from(teamOf.values()));
      const out: Row[] = [];
      for (const r of acc.values()) {
        const id = String(r.salesperson_id);
        r.salesperson = id === NONE ? (ctx.lang === 'fr' ? '(non attribué)' : '(unassigned)') : (members.get(id) || `Membre ${id.slice(0, 6)}`);
        r.team_id = teamOf.get(id) || null;
        r.team = teams.get(String(r.team_id)) || '';
        r.approval_rate = Number(r.quotes_sent) > 0 ? Math.round((Number(r.quotes_approved) / Number(r.quotes_sent)) * 1000) / 10 : 0;
        if (q.filters.team && q.filters.team !== 'all' && r.team_id !== q.filters.team) continue;
        out.push(r);
      }
      return out;
    },
  },
};

const commissions: ReportDefinition = {
  id: 'commissions',
  category: 'team',
  title: L('Commissions', 'Commissions'),
  description: L('Commissions générées par vendeur avec règle, base, montant et statut de paiement.', 'Commissions generated per salesperson with rule, base, amount and payment status.'),
  permission: 'financial.view_reports',
  dateFilter: { label: L('Date de création', 'Created date'), default: 'thisMonth' },
  filters: [
    { key: 'status', label: L('Statut', 'Status'), type: 'select', options: optionsFrom(LABELS.commissionStatus) },
    { key: 'user', label: L('Vendeur', 'Salesperson'), type: 'select', source: 'members' },
  ],
  columns: [
    col.date('created_at', 'Créée le', 'Created'),
    col.text('user', 'Vendeur', 'Salesperson', { sortable: false, width: '1.2fr' }),
    col.text('rule', 'Règle', 'Rule', { sortable: false, width: '140px' }),
    col.text('job_number', 'Job', 'Job', { sortable: false, width: '80px' }),
    col.text('invoice_number', 'Facture', 'Invoice', { sortable: false, width: '90px' }),
    col.text('description', 'Description', 'Description', { sortable: false, width: '1.4fr' }),
    col.money('base_cents', 'Base', 'Base', { total: undefined }),
    col.money('amount_cents', 'Commission', 'Commission'),
    col.enum('status', 'Statut', 'Status', LABELS.commissionStatus, { width: '110px' }),
    col.date('approved_at', 'Approuvée le', 'Approved'),
    col.date('paid_at', 'Payée le', 'Paid'),
  ],
  defaultSort: { key: 'created_at', dir: 'desc' },
  source: {
    kind: 'query',
    // Table du module terrain : lue par le serveur avec le client service-role
    // (comme /api/commissions), donc filtre d'org explicite + portée « soi »
    // pour les non-admins.
    build: (ctx, q) => {
      let b = ctx.service.from('fs_commission_entries')
        .select('id,user_id,rule_id,job_id,invoice_id,status,amount,base_amount,description,created_at,approved_at,paid_at', COUNT_EXACT)
        .eq('org_id', ctx.orgId).is('deleted_at', null);
      b = ownScope(b, ctx, 'user_id');
      b = applyPeriod(b, 'created_at', 'timestamp', q.from, q.to);
      b = eqFilter(b, q.filters.status, 'status');
      if (ctx.isAdmin) b = eqFilter(b, q.filters.user, 'user_id');
      return b;
    },
    map: (raw) => ({
      id: raw.id, created_at: raw.created_at, user_id: raw.user_id, user: '', rule_id: raw.rule_id, rule: '',
      job_id: raw.job_id, job_number: '', invoice_id: raw.invoice_id, invoice_number: '', description: raw.description || '',
      base_cents: dollarsToCents(raw.base_amount), amount_cents: dollarsToCents(raw.amount), status: raw.status,
      approved_at: raw.approved_at, paid_at: raw.paid_at,
    }),
    enrich: async (rows, ctx) => {
      const members = await lookupMembers(ctx.service, ctx.orgId, rows.map((r) => r.user_id));
      const rules = await lookupCommissionRules(ctx.service, ctx.orgId, rows.map((r) => r.rule_id));
      const jobsMap = await lookupJobs(ctx.service, ctx.orgId, rows.map((r) => r.job_id));
      const invoices = await lookupInvoices(ctx.service, ctx.orgId, rows.map((r) => r.invoice_id));
      for (const r of rows) {
        r.user = members.get(String(r.user_id)) || '';
        r.rule = rules.get(String(r.rule_id)) || '';
        r.job_number = jobsMap.get(String(r.job_id))?.job_number || '';
        r.invoice_number = invoices.get(String(r.invoice_id))?.invoice_number || '';
      }
    },
  },
};

/** « HH:MM[:SS] » ou ISO → minutes depuis minuit (pauses des feuilles de temps). */
function clockMinutes(value: unknown): number | null {
  if (!value) return null;
  const s = String(value);
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

function breakMinutes(breaks: unknown): number {
  if (!Array.isArray(breaks)) return 0;
  let total = 0;
  for (const b of breaks) {
    if (!b || typeof b !== 'object') continue;
    const start = (b as any).start ?? (b as any).start_at;
    const end = (b as any).end ?? (b as any).end_at;
    if (!start || !end) continue;
    if (String(start).includes('T') && String(end).includes('T')) {
      const diff = (new Date(String(end)).getTime() - new Date(String(start)).getTime()) / 60_000;
      if (Number.isFinite(diff) && diff > 0) total += diff;
      continue;
    }
    const a = clockMinutes(start); const z = clockMinutes(end);
    if (a !== null && z !== null && z > a) total += z - a;
  }
  return Math.round(total);
}

function timesheetHours(raw: Row): number | null {
  const pauses = breakMinutes(raw.breaks);
  if (raw.punch_in_at && raw.punch_out_at) {
    const mins = (new Date(String(raw.punch_out_at)).getTime() - new Date(String(raw.punch_in_at)).getTime()) / 60_000;
    if (!Number.isFinite(mins) || mins <= 0) return null;
    return Math.round(((mins - pauses) / 60) * 100) / 100;
  }
  const a = clockMinutes(raw.punch_in); const z = clockMinutes(raw.punch_out);
  if (a === null || z === null || z <= a) return null;
  return Math.round(((z - a - pauses) / 60) * 100) / 100;
}

const timesheets: ReportDefinition = {
  id: 'timesheets',
  category: 'team',
  title: L('Feuilles de temps', 'Timesheets'),
  description: L('Entrées de temps par employé avec pauses, heures travaillées, job et approbation.', 'Time entries per employee with breaks, worked hours, job and approval.'),
  permission: 'financial.view_reports',
  dateFilter: { label: L('Date', 'Date'), default: 'thisMonth' },
  filters: [
    { key: 'employee', label: L('Employé', 'Employee'), type: 'select', source: 'members' },
    { key: 'team', label: L('Équipe', 'Team'), type: 'select', source: 'teams' },
    { key: 'status', label: L('Statut', 'Status'), type: 'select', options: optionsFrom(LABELS.timesheetStatus) },
  ],
  columns: [
    col.text('employee_name', 'Employé', 'Employee', { width: '1.2fr' }),
    col.date('date', 'Date', 'Date'),
    col.datetime('punch_in_at', 'Entrée', 'Punch in'),
    col.datetime('punch_out_at', 'Sortie', 'Punch out'),
    col.int('break_minutes', 'Pauses (min)', 'Breaks (min)', { sortable: false, total: undefined }),
    col.hours('hours', 'Heures', 'Hours', { sortable: false }),
    col.text('job_number', 'Job', 'Job', { sortable: false, width: '80px' }),
    col.text('team', 'Équipe', 'Team', { sortable: false, width: '120px' }),
    col.enum('status', 'Statut', 'Status', LABELS.timesheetStatus, { width: '100px' }),
    col.enum('approved', 'Approuvée', 'Approved', LABELS.yesNo, { sortable: false, width: '90px' }),
    col.text('notes', 'Notes', 'Notes', { sortable: false, width: '1.2fr' }),
  ],
  defaultSort: { key: 'date', dir: 'desc' },
  source: {
    kind: 'query',
    build: (ctx, q) => {
      // La politique RLS de time_entries n'est pas scopée par org : le filtre
      // d'org explicite est indispensable ici, pas seulement défensif.
      let b = ctx.user.from('time_entries')
        .select('id,employee_id,employee_name,date,punch_in,punch_out,punch_in_at,punch_out_at,breaks,job_id,team_id,status,approved_at,notes', COUNT_EXACT)
        .eq('org_id', ctx.orgId);
      b = ownScope(b, ctx, 'employee_id');
      b = applyPeriod(b, 'date', 'date', q.from, q.to);
      if (ctx.isAdmin) b = eqFilter(b, q.filters.employee, 'employee_id');
      b = eqFilter(b, q.filters.team, 'team_id');
      b = eqFilter(b, q.filters.status, 'status');
      return b;
    },
    map: (raw) => ({
      id: raw.id, employee_id: raw.employee_id, employee_name: raw.employee_name || '', date: raw.date,
      punch_in_at: raw.punch_in_at || (raw.punch_in ? `${raw.date}T${raw.punch_in}` : null),
      punch_out_at: raw.punch_out_at || (raw.punch_out ? `${raw.date}T${raw.punch_out}` : null),
      break_minutes: breakMinutes(raw.breaks), hours: timesheetHours(raw),
      job_id: raw.job_id, job_number: '', team_id: raw.team_id, team: '', status: raw.status || 'completed',
      approved: raw.approved_at ? 'yes' : 'no', notes: raw.notes || '',
    }),
    enrich: async (rows, ctx) => {
      const members = await lookupMembers(ctx.service, ctx.orgId, rows.filter((r) => !r.employee_name).map((r) => r.employee_id));
      const jobsMap = await lookupJobs(ctx.service, ctx.orgId, rows.map((r) => r.job_id));
      const teams = await lookupTeams(ctx.service, ctx.orgId, rows.map((r) => r.team_id));
      for (const r of rows) {
        if (!r.employee_name) r.employee_name = members.get(String(r.employee_id)) || '';
        r.job_number = jobsMap.get(String(r.job_id))?.job_number || '';
        r.team = teams.get(String(r.team_id)) || '';
      }
    },
  },
};

/** La paie a déjà sa page et son export CSV : on y renvoie plutôt que de dupliquer. */
const payroll: ReportDefinition = {
  id: 'payroll',
  category: 'team',
  title: L('Paie', 'Payroll'),
  description: L('Heures, salaire brut, commissions et ajustements par période de paie. Ouvre la page Paie.', 'Hours, gross wages, commissions and adjustments per pay period. Opens the Payroll page.'),
  permission: 'financial.view_reports',
  columns: [],
  filters: [],
  defaultSort: { key: 'id', dir: 'asc' },
  source: { kind: 'memory', loadAll: async () => [] },
  link: '/settings/payroll',
};

export const TEAM_REPORTS: ReportDefinition[] = [salesPerformance, commissions, timesheets, payroll];

export const __test = { breakMinutes, timesheetHours, clockMinutes };
export type { ReportContext };
