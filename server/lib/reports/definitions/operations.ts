/**
 * Rapports — Opérations : jobs, visites, devis.
 */
import type { ReportDefinition, Row } from '../types';
import { COUNT_EXACT } from '../engine';
import { applyPeriod } from '../dates';
import { L, col, LABELS, optionsFrom, eqFilter, applySearch, centsOf, hoursBetween } from '../helpers';
import { lookupClients, lookupMembers, lookupTeams, lookupJobTags, lookupJobs } from '../lookups';

const JOB_COLS = 'id,job_number,title,client_id,client_name,property_address,address,status,derived_status,job_type,' +
  'sale_date,scheduled_at,completed_at,created_at,salesperson_id,assigned_user_id,team_id,tag_ids,subtotal_cents,tax_cents,total_cents,expenses_cents,currency';

const jobs: ReportDefinition = {
  id: 'jobs',
  category: 'operations',
  title: L('Jobs', 'Jobs'),
  description: L('Toutes les jobs avec statut, dates, vendeur, équipe, montants et dépenses.', 'All jobs with status, dates, salesperson, team, amounts and expenses.'),
  permission: 'financial.view_reports',
  dateFilter: {
    label: L('Période', 'Period'), default: 'last90',
    fields: [
      { value: 'sale_date', label: L('Date de vente', 'Sale date') },
      { value: 'created_at', label: L('Date de création', 'Created date') },
      { value: 'scheduled_at', label: L('Date planifiée', 'Scheduled date') },
      { value: 'completed_at', label: L('Date de complétion', 'Completed date') },
    ],
  },
  filters: [
    { key: 'status', label: L('Statut', 'Status'), type: 'select', options: optionsFrom(LABELS.jobDerived) },
    { key: 'job_type', label: L('Type', 'Type'), type: 'select', options: optionsFrom(LABELS.jobType, ['one_off', 'service_plan']) },
    { key: 'salesperson', label: L('Vendeur', 'Salesperson'), type: 'select', source: 'members' },
    { key: 'assigned', label: L('Assigné à', 'Assigned to'), type: 'select', source: 'members' },
    { key: 'team', label: L('Équipe', 'Team'), type: 'select', source: 'teams' },
    { key: 'tag', label: L('Tag', 'Tag'), type: 'select', source: 'jobTags' },
    { key: 'q', label: L('Recherche', 'Search'), type: 'search', placeholder: L('N°, titre, client, adresse…', 'Number, title, client, address…') },
  ],
  columns: [
    col.text('job_number', 'N°', 'Number', { width: '80px' }),
    col.text('title', 'Titre', 'Title', { width: '1.3fr' }),
    col.text('client', 'Client', 'Client', { sortKey: 'client_name', width: '1.2fr' }),
    col.text('property_address', 'Adresse', 'Address', { width: '1.4fr' }),
    col.enum('job_type', 'Type', 'Type', LABELS.jobType, { width: '110px' }),
    col.enum('derived_status', 'Statut', 'Status', LABELS.jobDerived, { width: '120px' }),
    col.date('sale_date', 'Vendue le', 'Sold on'),
    col.date('scheduled_at', 'Planifiée', 'Scheduled'),
    col.date('completed_at', 'Complétée', 'Completed'),
    col.text('salesperson', 'Vendeur', 'Salesperson', { sortable: false, width: '130px' }),
    col.text('assigned', 'Assigné à', 'Assigned to', { sortable: false, width: '130px' }),
    col.text('team', 'Équipe', 'Team', { sortable: false, width: '120px' }),
    col.text('tags', 'Tags', 'Tags', { sortable: false, width: '140px' }),
    col.money('subtotal_cents', 'Sous-total', 'Subtotal'),
    col.money('tax_cents', 'Taxes', 'Taxes', { width: '100px' }),
    col.money('total_cents', 'Total', 'Total'),
    col.money('expenses_cents', 'Dépenses', 'Expenses'),
    col.money('margin_cents', 'Marge (total − dépenses)', 'Margin (total − expenses)', { sortable: false, width: '150px' }),
  ],
  defaultSort: { key: 'sale_date', dir: 'desc' },
  source: {
    kind: 'query',
    build: (ctx, q) => {
      let b = ctx.user.from('jobs_active').select(JOB_COLS, COUNT_EXACT).eq('org_id', ctx.orgId);
      const field = q.dateField && ['sale_date', 'created_at', 'scheduled_at', 'completed_at'].includes(q.dateField) ? q.dateField : 'sale_date';
      b = applyPeriod(b, field, field === 'sale_date' ? 'date' : 'timestamp', q.from, q.to);
      b = eqFilter(b, q.filters.status, 'derived_status');
      if (q.filters.job_type === 'one_off') b = b.or('job_type.eq.one_off,job_type.is.null');
      else if (q.filters.job_type && q.filters.job_type !== 'all') b = b.eq('job_type', q.filters.job_type);
      b = eqFilter(b, q.filters.salesperson, 'salesperson_id');
      b = eqFilter(b, q.filters.assigned, 'assigned_user_id');
      b = eqFilter(b, q.filters.team, 'team_id');
      if (q.filters.tag && q.filters.tag !== 'all') b = b.contains('tag_ids', [q.filters.tag]);
      b = applySearch(b, q.filters.q, ['job_number', 'title', 'client_name', 'property_address']);
      return b;
    },
    map: (raw) => {
      const total = centsOf(raw.total_cents);
      const expenses = centsOf(raw.expenses_cents);
      return {
        id: raw.id, job_number: raw.job_number || '', title: raw.title || '', client_id: raw.client_id, client: raw.client_name || '',
        property_address: raw.property_address || raw.address || '',
        job_type: raw.job_type || 'one_off', derived_status: raw.derived_status || '',
        sale_date: raw.sale_date, scheduled_at: raw.scheduled_at, completed_at: raw.completed_at,
        salesperson_id: raw.salesperson_id, salesperson: '', assigned_user_id: raw.assigned_user_id, assigned: '',
        team_id: raw.team_id, team: '', tag_ids: Array.isArray(raw.tag_ids) ? raw.tag_ids : [], tags: '',
        subtotal_cents: centsOf(raw.subtotal_cents), tax_cents: centsOf(raw.tax_cents), total_cents: total,
        expenses_cents: expenses, margin_cents: total - expenses,
      };
    },
    enrich: async (rows, ctx) => {
      const members = await lookupMembers(ctx.service, ctx.orgId, rows.flatMap((r) => [r.salesperson_id, r.assigned_user_id]));
      const teams = await lookupTeams(ctx.service, ctx.orgId, rows.map((r) => r.team_id));
      const tags = await lookupJobTags(ctx.service, ctx.orgId, rows.flatMap((r) => (r.tag_ids as string[]) || []));
      const clients = await lookupClients(ctx.service, ctx.orgId, rows.filter((r) => !r.client).map((r) => r.client_id));
      for (const r of rows) {
        r.salesperson = members.get(String(r.salesperson_id)) || '';
        r.assigned = members.get(String(r.assigned_user_id)) || '';
        r.team = teams.get(String(r.team_id)) || '';
        r.tags = ((r.tag_ids as string[]) || []).map((id) => tags.get(id)).filter(Boolean).join(', ');
        if (!r.client) r.client = clients.get(String(r.client_id))?.name || '';
      }
    },
  },
};

/** Statut de visite « planifiée » = ni complétée ni annulée (colonne libre en base). */
function applyVisitStatus(b: any, status: string | undefined) {
  if (!status || status === 'all') return b;
  if (status === 'scheduled') return b.or('status.is.null,status.not.in.("completed","cancelled","canceled")');
  if (status === 'cancelled') return b.in('status', ['cancelled', 'canceled']);
  return b.eq('status', status);
}

const visits: ReportDefinition = {
  id: 'visits',
  category: 'operations',
  title: L('Visites', 'Visits'),
  description: L("Visites planifiées au calendrier avec job, client, adresse, assigné et durée.", 'Scheduled calendar visits with job, client, address, assignee and duration.'),
  permission: 'financial.view_reports',
  dateFilter: { label: L('Date de visite', 'Visit date'), default: 'last30' },
  filters: [
    { key: 'status', label: L('Statut', 'Status'), type: 'select', options: optionsFrom(LABELS.visitStatus, ['scheduled', 'completed', 'cancelled']) },
    { key: 'assigned', label: L('Assigné à', 'Assigned to'), type: 'select', source: 'members' },
    { key: 'team', label: L('Équipe', 'Team'), type: 'select', source: 'teams' },
  ],
  columns: [
    col.datetime('start_at', 'Début', 'Start'),
    col.datetime('end_at', 'Fin', 'End'),
    col.hours('duration_hours', 'Durée (h)', 'Duration (h)', { sortable: false }),
    col.text('job_number', 'Job', 'Job', { sortable: false, width: '80px' }),
    col.text('client', 'Client', 'Client', { sortable: false, width: '1.2fr' }),
    col.text('address', 'Adresse', 'Address', { sortable: false, width: '1.4fr' }),
    col.text('title', 'Titre', 'Title', { width: '1.2fr' }),
    col.text('assigned', 'Assigné à', 'Assigned to', { sortable: false, width: '130px' }),
    col.text('team', 'Équipe', 'Team', { sortable: false, width: '120px' }),
    col.enum('status', 'Statut', 'Status', LABELS.visitStatus, { width: '110px' }),
  ],
  defaultSort: { key: 'start_at', dir: 'asc' },
  source: {
    kind: 'query',
    build: (ctx, q) => {
      let b = ctx.user.from('schedule_events')
        .select('id,job_id,title,start_at,end_at,assigned_user,team_id,status', COUNT_EXACT)
        .eq('org_id', ctx.orgId).is('deleted_at', null).not('start_at', 'is', null);
      b = applyPeriod(b, 'start_at', 'timestamp', q.from, q.to);
      b = applyVisitStatus(b, q.filters.status);
      b = eqFilter(b, q.filters.assigned, 'assigned_user');
      b = eqFilter(b, q.filters.team, 'team_id');
      return b;
    },
    map: (raw) => ({
      id: raw.id, job_id: raw.job_id, job_number: '', client: '', address: '', title: raw.title || '',
      start_at: raw.start_at, end_at: raw.end_at, duration_hours: hoursBetween(raw.start_at, raw.end_at),
      assigned_user: raw.assigned_user, assigned: '', team_id: raw.team_id, team: '',
      status: raw.status === 'canceled' ? 'cancelled' : (raw.status || 'scheduled'),
    }),
    enrich: async (rows, ctx) => {
      const jobsMap = await lookupJobs(ctx.service, ctx.orgId, rows.map((r) => r.job_id));
      const members = await lookupMembers(ctx.service, ctx.orgId, rows.map((r) => r.assigned_user));
      const teams = await lookupTeams(ctx.service, ctx.orgId, rows.map((r) => r.team_id));
      for (const r of rows) {
        const j = jobsMap.get(String(r.job_id));
        if (j) { r.job_number = j.job_number; r.client = j.client_name; r.address = j.property_address; if (!r.title) r.title = j.title; }
        r.assigned = members.get(String(r.assigned_user)) || '';
        r.team = teams.get(String(r.team_id)) || '';
      }
    },
  },
};

const QUOTE_COLS = 'id,quote_number,title,client_id,status,quote_type,salesperson_id,created_by,created_at,sent_via_email_at,sent_via_sms_at,' +
  'approved_at,declined_at,converted_at,valid_until,subtotal_cents,discount_cents,tax_cents,total_cents,deposit_cents,view_count';

const quotes: ReportDefinition = {
  id: 'quotes',
  category: 'operations',
  title: L('Devis', 'Quotes'),
  description: L('Tous les devis avec statut, vendeur, dates clés, montants et nombre de vues.', 'All quotes with status, salesperson, key dates, amounts and view count.'),
  permission: 'financial.view_reports',
  dateFilter: {
    label: L('Période', 'Period'), default: 'last90',
    fields: [
      { value: 'created_at', label: L('Date de création', 'Created date') },
      { value: 'approved_at', label: L("Date d'approbation", 'Approved date') },
      { value: 'declined_at', label: L('Date de refus', 'Declined date') },
    ],
  },
  filters: [
    { key: 'status', label: L('Statut', 'Status'), type: 'select', options: optionsFrom(LABELS.quoteStatus) },
    { key: 'quote_type', label: L('Type', 'Type'), type: 'select', options: optionsFrom(LABELS.quoteType) },
    { key: 'salesperson', label: L('Vendeur', 'Salesperson'), type: 'select', source: 'members' },
    { key: 'q', label: L('Recherche', 'Search'), type: 'search', placeholder: L('N°, titre…', 'Number, title…') },
  ],
  columns: [
    col.text('quote_number', 'N°', 'Number', { width: '80px' }),
    col.text('title', 'Titre', 'Title', { width: '1.3fr' }),
    col.text('client', 'Client', 'Client', { sortable: false, width: '1.2fr' }),
    col.enum('quote_type', 'Type', 'Type', LABELS.quoteType, { width: '110px' }),
    col.enum('status', 'Statut', 'Status', LABELS.quoteStatus, { width: '150px' }),
    col.text('salesperson', 'Vendeur', 'Salesperson', { sortable: false, width: '130px' }),
    col.date('created_at', 'Créé le', 'Created'),
    col.date('sent_at', 'Envoyé le', 'Sent', { sortable: false }),
    col.date('approved_at', 'Approuvé le', 'Approved'),
    col.date('declined_at', 'Refusé le', 'Declined'),
    col.date('valid_until', "Valide jusqu'au", 'Valid until'),
    col.money('subtotal_cents', 'Sous-total', 'Subtotal'),
    col.money('tax_cents', 'Taxes', 'Taxes', { width: '100px' }),
    col.money('total_cents', 'Total', 'Total'),
    col.money('deposit_cents', 'Dépôt', 'Deposit', { width: '100px' }),
    col.int('view_count', 'Vues', 'Views', { total: undefined, width: '70px' }),
  ],
  defaultSort: { key: 'created_at', dir: 'desc' },
  source: {
    kind: 'query',
    build: (ctx, q) => {
      let b = ctx.user.from('quotes').select(QUOTE_COLS, COUNT_EXACT).eq('org_id', ctx.orgId).is('deleted_at', null);
      const field = q.dateField && ['created_at', 'approved_at', 'declined_at'].includes(q.dateField) ? q.dateField : 'created_at';
      b = applyPeriod(b, field, 'timestamp', q.from, q.to);
      b = eqFilter(b, q.filters.status, 'status');
      b = eqFilter(b, q.filters.quote_type, 'quote_type');
      b = eqFilter(b, q.filters.salesperson, 'salesperson_id');
      b = applySearch(b, q.filters.q, ['quote_number', 'title']);
      return b;
    },
    map: (raw) => {
      const sent = [raw.sent_via_email_at, raw.sent_via_sms_at].filter(Boolean).map(String).sort();
      return {
        id: raw.id, quote_number: raw.quote_number || '', title: raw.title || '', client_id: raw.client_id, client: '',
        quote_type: raw.quote_type || 'one_off', status: raw.status,
        salesperson_id: raw.salesperson_id || raw.created_by, salesperson: '',
        created_at: raw.created_at, sent_at: sent.length ? sent[sent.length - 1] : null,
        approved_at: raw.approved_at, declined_at: raw.declined_at, valid_until: raw.valid_until,
        subtotal_cents: centsOf(raw.subtotal_cents), tax_cents: centsOf(raw.tax_cents), total_cents: centsOf(raw.total_cents),
        deposit_cents: centsOf(raw.deposit_cents), view_count: Number(raw.view_count) || 0,
      };
    },
    enrich: async (rows, ctx) => {
      const clients = await lookupClients(ctx.service, ctx.orgId, rows.map((r) => r.client_id));
      const members = await lookupMembers(ctx.service, ctx.orgId, rows.map((r) => r.salesperson_id));
      for (const r of rows) {
        r.client = clients.get(String(r.client_id))?.name || '';
        r.salesperson = members.get(String(r.salesperson_id)) || '';
      }
    },
  },
};

export const OPERATIONS_REPORTS: ReportDefinition[] = [jobs, visits, quotes];
