import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
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

const ALL_ENTITY_KEYS = ['clients', 'jobs', 'leads', 'invoices', 'quotes', 'teams', 'events'] as const;
type EntityGroupKey = typeof ALL_ENTITY_KEYS[number];

const ENTITY_KEY_TO_TYPE: Record<EntityGroupKey, SearchEntityType> = {
  clients: 'client',
  jobs: 'job',
  leads: 'lead',
  invoices: 'invoice',
  quotes: 'quote',
  teams: 'team',
  events: 'event',
};

async function handleSuggestions(req: import('express').Request, res: import('express').Response) {
  const q = sanitizeQuery(String(req.query.q || ''));
  const limit = clampInt(req.query.limit, 8, 1, 12);

  const emptyGrouped: Record<EntityGroupKey, ReturnType<typeof mapSearchRows>> = {
    clients: [], jobs: [], leads: [], invoices: [], quotes: [], teams: [], events: [],
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
      p_limit: Math.max(48, limit * 4),
      p_offset: 0,
    });

    if (error) throw error;

    const mapped = mapSearchRows((data || []) as SearchRow[]);
    const grouped = { ...emptyGrouped };
    for (const key of ALL_ENTITY_KEYS) {
      grouped[key] = mapped.filter((item) => item.type === ENTITY_KEY_TO_TYPE[key]).slice(0, limit);
    }

    const items = mapped
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);

    return res.json({ query: q, items, grouped });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Search suggestion request failed.' });
  }
}

router.get('/search', handleSuggestions);
router.get('/search/suggestions', handleSuggestions);

router.get('/search/results', async (req, res) => {
  const q = sanitizeQuery(String(req.query.q || ''));
  const tab = parseTab(req.query.tab);
  const pageSize = clampInt(req.query.pageSize, 20, 1, 20);

  const emptyCounts = { clients: 0, jobs: 0, leads: 0, invoices: 0, quotes: 0, teams: 0, events: 0, all: 0 };

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

    if (tab === 'all') {
      const pages: Record<EntityGroupKey, number> = {} as any;
      for (const key of ALL_ENTITY_KEYS) {
        pages[key] = clampInt(req.query[`${key}Page`], 1, 1, 10_000);
      }

      const groupEntries = await Promise.all(
        ALL_ENTITY_KEYS.map(async (key) => {
          const entityType = ENTITY_KEY_TO_TYPE[key];
          const total = counts[key];
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
      groups[key] = key === tab ? selectedGroup : emptyPage(pageSize, counts[key]);
    }

    return res.json({ query: q, tab, counts, groups });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Search results request failed.' });
  }
});

export default router;
