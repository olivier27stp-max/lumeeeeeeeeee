/**
 * Rapports — Clients : liste complète avec coordonnées, source, tags et
 * historique (nombre de jobs, facturé à vie).
 */
import type { ReportDefinition, Row } from '../types';
import { COUNT_EXACT } from '../engine';
import { applyPeriod } from '../dates';
import { L, col, LABELS, optionsFrom, eqFilter, applySearch, centsOf } from '../helpers';
import { lookupMembers, clientDisplayName } from '../lookups';

const CLIENT_COLS = 'id,client_number,first_name,last_name,company,display_as_company,status,email,phone,phones,address,city,province,postal_code,' +
  'source,lead_source,tags,created_at,created_by,last_client_activity_at,archived_at';

/** Téléphones : colonne scalaire + tableau jsonb (objets ou chaînes). */
function phonesOf(raw: Row): string {
  const out: string[] = [];
  if (raw.phone) out.push(String(raw.phone));
  if (Array.isArray(raw.phones)) {
    for (const p of raw.phones) {
      const v = typeof p === 'string' ? p : (p && typeof p === 'object' ? ((p as any).number ?? (p as any).phone ?? (p as any).value ?? '') : '');
      if (v && !out.includes(String(v))) out.push(String(v));
    }
  }
  return out.join(', ');
}

const clients: ReportDefinition = {
  id: 'clients',
  category: 'clients',
  title: L('Liste des clients', 'Client list'),
  description: L('Tous les clients et prospects avec coordonnées, source, tags, nombre de jobs et facturé à vie.', 'All clients and leads with contact details, source, tags, job count and lifetime invoiced.'),
  permission: 'financial.view_reports',
  dateFilter: { label: L('Date de création', 'Created date'), default: 'all' },
  filters: [
    { key: 'status', label: L('Statut', 'Status'), type: 'select', options: optionsFrom(LABELS.clientStatus) },
    { key: 'q', label: L('Recherche', 'Search'), type: 'search', placeholder: L('Nom, compagnie, courriel, téléphone, ville…', 'Name, company, email, phone, city…') },
  ],
  columns: [
    col.text('client_number', 'N°', 'Number', { width: '70px' }),
    col.text('name', 'Nom', 'Name', { sortKey: 'last_name', width: '1.3fr' }),
    col.text('company', 'Compagnie', 'Company', { width: '1.1fr' }),
    col.enum('status', 'Statut', 'Status', LABELS.clientStatus, { width: '100px' }),
    col.text('email', 'Courriel', 'Email', { width: '180px' }),
    col.text('phones', 'Téléphones', 'Phones', { sortable: false, width: '150px' }),
    col.text('address', 'Adresse', 'Address', { sortable: false, width: '1.4fr' }),
    col.text('city', 'Ville', 'City', { width: '120px' }),
    col.text('province', 'Province', 'Province', { width: '80px' }),
    col.text('postal_code', 'Code postal', 'Postal code', { width: '90px' }),
    col.text('source', 'Source', 'Source', { sortKey: 'lead_source', width: '120px' }),
    col.text('tags', 'Tags', 'Tags', { sortable: false, width: '140px' }),
    col.date('created_at', 'Créé le', 'Created'),
    col.text('created_by_name', 'Créé par', 'Created by', { sortable: false, width: '130px' }),
    col.date('last_client_activity_at', 'Dernière activité', 'Last activity'),
    col.int('jobs_count', 'Jobs', 'Jobs', { sortable: false, total: undefined, width: '60px' }),
    col.money('invoiced_cents', 'Facturé à vie', 'Lifetime invoiced', { sortable: false }),
  ],
  defaultSort: { key: 'created_at', dir: 'desc' },
  source: {
    kind: 'query',
    build: (ctx, q) => {
      let b = ctx.user.from('clients').select(CLIENT_COLS, COUNT_EXACT).eq('org_id', ctx.orgId).is('deleted_at', null);
      b = applyPeriod(b, 'created_at', 'timestamp', q.from, q.to);
      b = eqFilter(b, q.filters.status, 'status');
      b = applySearch(b, q.filters.q, ['first_name', 'last_name', 'company', 'email', 'phone', 'city', 'client_number']);
      return b;
    },
    map: (raw) => ({
      id: raw.id, client_number: raw.client_number || '', name: clientDisplayName(raw as any),
      company: raw.company || '', status: raw.status, email: raw.email || '', phones: phonesOf(raw),
      address: raw.address || '', city: raw.city || '', province: raw.province || '', postal_code: raw.postal_code || '',
      source: raw.lead_source || raw.source || '', tags: Array.isArray(raw.tags) ? raw.tags.join(', ') : (raw.tags || ''),
      created_at: raw.created_at, created_by: raw.created_by, created_by_name: '',
      last_client_activity_at: raw.last_client_activity_at, jobs_count: 0, invoiced_cents: 0,
    }),
    enrich: async (rows, ctx) => {
      const members = await lookupMembers(ctx.service, ctx.orgId, rows.map((r) => r.created_by));
      const ids = rows.map((r) => String(r.id));
      const jobsCount = new Map<string, number>();
      const invoiced = new Map<string, number>();
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200);
        const { data: jobsData } = await ctx.user.from('jobs_active').select('client_id').eq('org_id', ctx.orgId).in('client_id', part).limit(5000);
        for (const j of jobsData || []) jobsCount.set(j.client_id, (jobsCount.get(j.client_id) || 0) + 1);
        const { data: invData } = await ctx.user.from('invoices').select('client_id,total_cents').eq('org_id', ctx.orgId)
          .is('deleted_at', null).in('status', ['sent', 'partial', 'paid']).in('client_id', part).limit(5000);
        for (const inv of invData || []) invoiced.set(inv.client_id, (invoiced.get(inv.client_id) || 0) + centsOf(inv.total_cents));
      }
      for (const r of rows) {
        r.created_by_name = members.get(String(r.created_by)) || '';
        r.jobs_count = jobsCount.get(String(r.id)) || 0;
        r.invoiced_cents = invoiced.get(String(r.id)) || 0;
      }
    },
  },
};

export const CLIENT_REPORTS: ReportDefinition[] = [clients];
