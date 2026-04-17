import { Router } from 'express';
import { sendSafeError } from '../lib/error-handler';
import { SupabaseClient } from '@supabase/supabase-js';
import { requireAuthedClient } from '../lib/supabase';
import { getUserContext, isFinanciallyRestricted, hasPermission, stripFinancialFields, filterFinancialEntities } from '../lib/rbac';
import {
  sanitizeQuery,
  clampInt,
  parseTab,
  mapSearchRows,
  parseCountRows,
  toEntityType,
  emptyPage,
  searchByType,
  SearchRow,
  SearchEntityType,
  SearchTab,
} from '../lib/helpers';

const router = Router();

const ALL_ENTITY_KEYS = ['clients', 'jobs', 'leads', 'invoices', 'quotes', 'requests', 'teams', 'events'] as const;
type EntityGroupKey = typeof ALL_ENTITY_KEYS[number];

const ENTITY_KEY_TO_TYPE: Record<EntityGroupKey, SearchEntityType> = {
  clients: 'client',
  jobs: 'job',
  leads: 'lead',
  invoices: 'invoice',
  quotes: 'quote',
  requests: 'request',
  teams: 'team',
  events: 'event',
};

type MappedItem = ReturnType<typeof mapSearchRows>[number];

// ── Relationship expansion ──
// When client matches are found, also fetch related jobs, quotes, invoices, requests
// linked to those clients — even if the search term didn't directly match those entities.
async function expandClientRelationships(
  client: SupabaseClient,
  orgId: string,
  clientIds: string[],
  existingIds: Set<string>,
  limitPerType: number,
): Promise<MappedItem[]> {
  if (clientIds.length === 0) return [];

  const expanded: MappedItem[] = [];

  // Fetch related jobs
  const { data: jobs } = await client
    .from('jobs')
    .select('id, title, job_number, client_id, client_name, status, total_cents, currency, scheduled_at, property_address, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .in('client_id', clientIds)
    .order('created_at', { ascending: false })
    .limit(limitPerType);

  for (const j of jobs || []) {
    if (existingIds.has(j.id)) continue;
    existingIds.add(j.id);
    expanded.push({
      type: 'job',
      id: j.id,
      title: j.title || j.job_number || 'Job',
      subtitle: j.client_name || j.property_address || j.status || j.job_number || 'Job',
      status: j.status || null,
      amountCents: j.total_cents ?? null,
      currency: j.currency || null,
      date: j.scheduled_at || null,
      clientId: j.client_id || null,
      clientName: j.client_name || null,
      createdAt: j.created_at,
      rank: 0.5,
    });
  }

  // Fetch related quotes
  const { data: quotes } = await client
    .from('quotes')
    .select('id, quote_number, title, client_id, status, total_cents, currency, valid_until, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .in('client_id', clientIds)
    .order('created_at', { ascending: false })
    .limit(limitPerType);

  for (const q of quotes || []) {
    if (existingIds.has(q.id)) continue;
    existingIds.add(q.id);
    // Find the client name from matched clients
    expanded.push({
      type: 'quote',
      id: q.id,
      title: q.quote_number || 'Quote',
      subtitle: q.title || 'Quote',
      status: q.status || null,
      amountCents: q.total_cents ?? null,
      currency: q.currency || null,
      date: q.valid_until || null,
      clientId: q.client_id || null,
      clientName: null,
      createdAt: q.created_at,
      rank: 0.5,
    });
  }

  // Fetch related invoices
  const { data: invoices } = await client
    .from('invoices')
    .select('id, invoice_number, subject, client_id, status, total_cents, due_date, created_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .in('client_id', clientIds)
    .order('created_at', { ascending: false })
    .limit(limitPerType);

  for (const inv of invoices || []) {
    if (existingIds.has(inv.id)) continue;
    existingIds.add(inv.id);
    expanded.push({
      type: 'invoice',
      id: inv.id,
      title: inv.invoice_number || 'Invoice',
      subtitle: inv.subject || 'Invoice',
      status: inv.status || null,
      amountCents: inv.total_cents ?? null,
      currency: 'CAD',
      date: inv.due_date || null,
      clientId: inv.client_id || null,
      clientName: null,
      createdAt: inv.created_at,
      rank: 0.5,
    });
  }

  // Fetch related requests (form_submissions)
  const { data: requests } = await client
    .from('form_submissions')
    .select('id, first_name, last_name, company, email, phone, city, client_id, created_at')
    .eq('org_id', orgId)
    .in('client_id', clientIds)
    .order('created_at', { ascending: false })
    .limit(limitPerType);

  for (const r of requests || []) {
    if (existingIds.has(r.id)) continue;
    existingIds.add(r.id);
    expanded.push({
      type: 'request' as SearchEntityType,
      id: r.id,
      title: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Request',
      subtitle: r.company || r.email || r.phone || r.city || 'Request',
      status: null,
      amountCents: null,
      currency: null,
      date: r.created_at || null,
      clientId: r.client_id || null,
      clientName: [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
      createdAt: r.created_at,
      rank: 0.5,
    });
  }

  return expanded;
}

// Fill in missing clientName on expanded items
function enrichClientNames(items: MappedItem[], clientMap: Map<string, string>) {
  for (const item of items) {
    if (!item.clientName && item.clientId && clientMap.has(item.clientId)) {
      item.clientName = clientMap.get(item.clientId)!;
    }
  }
}

async function handleSuggestions(req: import('express').Request, res: import('express').Response) {
  const q = sanitizeQuery(String(req.query.q || ''));
  const limit = clampInt(req.query.limit, 8, 1, 12);

  const emptyGrouped: Record<EntityGroupKey, ReturnType<typeof mapSearchRows>> = {
    clients: [], jobs: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [],
  };

  if (!q) {
    return res.json({ query: q, items: [], grouped: emptyGrouped });
  }

  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const { data, error } = await client.rpc('search_global', {
      p_org: orgId,
      p_q: q,
      p_limit: Math.max(48, limit * 6),
      p_offset: 0,
    });

    if (error) throw error;

    const mapped = mapSearchRows((data || []) as SearchRow[]);

    // Build a set of all existing entity IDs to avoid duplicates
    const existingIds = new Set(mapped.map((item) => item.id));

    // Extract matched client IDs for relationship expansion
    const matchedClientIds = mapped
      .filter((item) => item.type === 'client')
      .map((item) => item.id);

    // Build client name map from matched clients
    const clientNameMap = new Map<string, string>();
    for (const item of mapped) {
      if (item.type === 'client') {
        clientNameMap.set(item.id, item.title);
      }
    }

    // Expand relationships: fetch related entities for matched clients
    const expandedItems = await expandClientRelationships(
      client, orgId, matchedClientIds, existingIds, limit
    );

    // Enrich client names on expanded items
    enrichClientNames(expandedItems, clientNameMap);

    // Merge: direct results first, then expanded
    let allItems = [...mapped, ...expandedItems];

    // ── RBAC: Filter financial entities for restricted roles ──
    const ctx = req.userContext || await getUserContext(client, auth.user.id, orgId);
    if (ctx) {
      // Remove invoice/payment entities if user lacks financial access
      allItems = filterFinancialEntities(ctx, allItems);
      // Strip financial fields (amountCents) from remaining items
      if (isFinanciallyRestricted(ctx)) {
        allItems = allItems.map(item => {
          if ('amountCents' in item) return { ...item, amountCents: null };
          return item;
        });
      }
    }

    // Group results
    const grouped = { ...emptyGrouped };
    for (const key of ALL_ENTITY_KEYS) {
      grouped[key] = allItems.filter((item) => item.type === ENTITY_KEY_TO_TYPE[key]).slice(0, limit);
    }

    const items = allItems
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);

    return res.json({ query: q, items, grouped });
  } catch (error: any) {
    return sendSafeError(res, error, 'Search suggestion request failed.', '[search/suggestions]');
  }
}

router.get('/search', handleSuggestions);
router.get('/search/suggestions', handleSuggestions);

router.get('/search/results', async (req, res) => {
  const q = sanitizeQuery(String(req.query.q || ''));
  const tab = parseTab(req.query.tab);
  const pageSize = clampInt(req.query.pageSize, 20, 1, 20);

  const emptyCounts = { clients: 0, jobs: 0, leads: 0, invoices: 0, quotes: 0, requests: 0, teams: 0, events: 0, all: 0 };

  if (!q) {
    const emptyGroups: Record<EntityGroupKey, ReturnType<typeof emptyPage>> = {} as any;
    for (const key of ALL_ENTITY_KEYS) {
      emptyGroups[key] = emptyPage(pageSize);
    }
    return res.json({ query: q, tab, counts: emptyCounts, groups: emptyGroups });
  }

  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const { data: countRows, error: countError } = await client.rpc('search_global_counts', {
      p_org: orgId,
      p_q: q,
    });

    if (countError) throw countError;

    const counts = parseCountRows((countRows || []) as Array<{ entity_type: SearchEntityType; total: number }>);

    // ── RBAC: Zero out financial entity counts for restricted roles ──
    const ctx = req.userContext || await getUserContext(client, auth.user.id, orgId);
    if (ctx && isFinanciallyRestricted(ctx)) {
      counts.invoices = 0;
      counts.all = Object.values(counts).reduce((sum, v) => sum + (typeof v === 'number' ? v : 0), 0);
    }

    if (tab === 'all') {
      const pages: Record<EntityGroupKey, number> = {} as any;
      for (const key of ALL_ENTITY_KEYS) {
        pages[key] = clampInt(req.query[`${key}Page`], 1, 1, 10_000);
      }

      const groupEntries = await Promise.all(
        ALL_ENTITY_KEYS.map(async (key) => {
          const entityType = ENTITY_KEY_TO_TYPE[key];
          const total = counts[key] || 0;
          const result = await searchByType(client, orgId, q, entityType, pageSize, pages[key], total);
          return [key, result] as const;
        })
      );

      const groups: Record<string, ReturnType<typeof emptyPage>> = {};
      for (const [key, result] of groupEntries) {
        groups[key] = result;
      }

      return res.json({ query: q, tab, counts, groups });
    }

    const page = clampInt(req.query.page, 1, 1, 10_000);
    const targetType = toEntityType(tab as Exclude<SearchTab, 'all'>);
    const selectedTotal = counts[tab as EntityGroupKey] || 0;
    const selectedGroup = await searchByType(client, orgId, q, targetType, pageSize, page, selectedTotal);

    const groups: Record<string, ReturnType<typeof emptyPage>> = {};
    for (const key of ALL_ENTITY_KEYS) {
      groups[key] = key === tab ? selectedGroup : emptyPage(pageSize, counts[key] || 0);
    }

    return res.json({ query: q, tab, counts, groups });
  } catch (error: any) {
    return sendSafeError(res, error, 'Search results request failed.', '[search/results]');
  }
});

export default router;
