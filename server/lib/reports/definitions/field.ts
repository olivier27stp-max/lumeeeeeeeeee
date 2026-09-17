/**
 * Rapports — Terrain : pipeline et activité porte-à-porte.
 */
import type { ReportDefinition } from '../types';
import { COUNT_EXACT } from '../engine';
import { applyPeriod } from '../dates';
import { L, col, LABELS, optionsFrom, eqFilter, applySearch, centsOf, ownScope } from '../helpers';
import { lookupClients, lookupMembers, lookupJobs } from '../lookups';

const pipeline: ReportDefinition = {
  id: 'pipeline',
  category: 'field',
  title: L('Pipeline', 'Pipeline'),
  description: L('Deals du pipeline avec étape, valeur, représentant, source et raison de perte.', 'Pipeline deals with stage, value, rep, source and loss reason.'),
  permission: 'financial.view_reports',
  dateFilter: {
    label: L('Période', 'Period'), default: 'last90',
    fields: [
      { value: 'created_at', label: L('Date de création', 'Created date') },
      { value: 'won_at', label: L('Date de gain', 'Won date') },
      { value: 'lost_at', label: L('Date de perte', 'Lost date') },
    ],
  },
  filters: [
    { key: 'stage', label: L('Étape', 'Stage'), type: 'select', options: optionsFrom(LABELS.pipelineStage) },
    { key: 'rep', label: L('Représentant', 'Rep'), type: 'select', source: 'members' },
    { key: 'q', label: L('Recherche', 'Search'), type: 'search', placeholder: L('Titre, source, raison…', 'Title, source, reason…') },
  ],
  columns: [
    col.date('created_at', 'Créé le', 'Created'),
    col.text('title', 'Titre', 'Title', { width: '1.2fr' }),
    col.text('contact', 'Client / prospect', 'Client / lead', { sortable: false, width: '1.2fr' }),
    col.enum('stage', 'Étape', 'Stage', LABELS.pipelineStage, { width: '130px' }),
    col.money('value_cents', 'Valeur', 'Value'),
    col.int('probability', 'Probabilité (%)', 'Probability (%)', { total: undefined, width: '100px' }),
    col.text('rep', 'Représentant', 'Rep', { sortable: false, width: '130px' }),
    col.text('source', 'Source', 'Source', { width: '110px' }),
    col.date('won_at', 'Gagné le', 'Won'),
    col.date('lost_at', 'Perdu le', 'Lost'),
    col.text('lost_reason', 'Raison de perte', 'Loss reason', { width: '1.2fr' }),
    col.text('job_number', 'Job', 'Job', { sortable: false, width: '80px' }),
  ],
  defaultSort: { key: 'created_at', dir: 'desc' },
  source: {
    kind: 'query',
    build: (ctx, q) => {
      let b = ctx.user.from('pipeline_deals')
        .select('id,title,lead_id,client_id,job_id,stage,value_cents,probability,rep_id,created_by,source,won_at,lost_at,lost_reason,created_at', COUNT_EXACT)
        .eq('org_id', ctx.orgId).is('deleted_at', null);
      const field = q.dateField && ['created_at', 'won_at', 'lost_at'].includes(q.dateField) ? q.dateField : 'created_at';
      b = applyPeriod(b, field, 'timestamp', q.from, q.to);
      b = eqFilter(b, q.filters.stage, 'stage');
      b = eqFilter(b, q.filters.rep, 'rep_id');
      b = applySearch(b, q.filters.q, ['title', 'source', 'lost_reason']);
      return b;
    },
    map: (raw) => ({
      id: raw.id, created_at: raw.created_at, title: raw.title || '', contact_id: raw.client_id || raw.lead_id, contact: '',
      stage: raw.stage, value_cents: centsOf(raw.value_cents), probability: raw.probability ?? null,
      rep_id: raw.rep_id || raw.created_by, rep: '', source: raw.source || '',
      won_at: raw.won_at, lost_at: raw.lost_at, lost_reason: raw.lost_reason || '', job_id: raw.job_id, job_number: '',
    }),
    enrich: async (rows, ctx) => {
      const clients = await lookupClients(ctx.service, ctx.orgId, rows.map((r) => r.contact_id));
      const members = await lookupMembers(ctx.service, ctx.orgId, rows.map((r) => r.rep_id));
      const jobsMap = await lookupJobs(ctx.service, ctx.orgId, rows.map((r) => r.job_id));
      for (const r of rows) {
        r.contact = clients.get(String(r.contact_id))?.name || '';
        r.rep = members.get(String(r.rep_id)) || '';
        r.job_number = jobsMap.get(String(r.job_id))?.job_number || '';
      }
    },
  },
};

const fieldActivity: ReportDefinition = {
  id: 'field-activity',
  category: 'field',
  title: L('Activité terrain', 'Field activity'),
  description: L('Portes cognées, conversations, prospects, devis et ventes par représentant et par jour.', 'Doors knocked, conversations, leads, quotes and sales per rep per day.'),
  permission: 'financial.view_reports',
  dateFilter: { label: L('Date', 'Date'), default: 'last30' },
  filters: [
    { key: 'rep', label: L('Représentant', 'Rep'), type: 'select', source: 'members' },
  ],
  columns: [
    col.date('date', 'Date', 'Date'),
    col.text('rep', 'Représentant', 'Rep', { sortable: false, width: '1.2fr' }),
    col.int('knocks', 'Portes', 'Doors'),
    col.int('no_answers', 'Sans réponse', 'No answer', { width: '100px' }),
    col.int('leads', 'Prospects', 'Leads'),
    col.int('quotes_sent', 'Devis envoyés', 'Quotes sent', { width: '100px' }),
    col.int('sales', 'Ventes', 'Sales'),
    col.int('callbacks', 'Rappels', 'Callbacks'),
    col.percent('conversion_rate', 'Conversion (%)', 'Conversion (%)', { width: '100px' }),
    col.money('revenue_cents', 'Revenu', 'Revenue'),
  ],
  defaultSort: { key: 'date', dir: 'desc' },
  source: {
    kind: 'query',
    // Statistiques pré-agrégées du module terrain (écrites par le serveur) :
    // lecture service-role avec org explicite + portée « soi » pour les non-admins.
    build: (ctx, q) => {
      let b = ctx.service.from('field_daily_stats')
        .select('id,user_id,date,knocks,no_answers,leads,quotes_sent,sales,callbacks,conversion_rate,revenue_cents', COUNT_EXACT)
        .eq('org_id', ctx.orgId);
      b = ownScope(b, ctx, 'user_id');
      b = applyPeriod(b, 'date', 'date', q.from, q.to);
      if (ctx.isAdmin) b = eqFilter(b, q.filters.rep, 'user_id');
      return b;
    },
    map: (raw) => ({
      id: raw.id, date: raw.date, user_id: raw.user_id, rep: '',
      knocks: Number(raw.knocks) || 0, no_answers: Number(raw.no_answers) || 0, leads: Number(raw.leads) || 0,
      quotes_sent: Number(raw.quotes_sent) || 0, sales: Number(raw.sales) || 0, callbacks: Number(raw.callbacks) || 0,
      conversion_rate: Number(raw.conversion_rate) || 0, revenue_cents: centsOf(raw.revenue_cents),
    }),
    enrich: async (rows, ctx) => {
      const members = await lookupMembers(ctx.service, ctx.orgId, rows.map((r) => r.user_id));
      for (const r of rows) r.rep = members.get(String(r.user_id)) || '';
    },
  },
};

export const FIELD_REPORTS: ReportDefinition[] = [pipeline, fieldActivity];
