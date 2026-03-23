import { supabase } from './supabase';

export type SearchEntityType = 'client' | 'job' | 'lead' | 'invoice' | 'quote' | 'request' | 'team' | 'event';
export type SearchTab = 'all' | 'clients' | 'jobs' | 'leads' | 'invoices' | 'quotes' | 'requests' | 'teams' | 'events';

export const ALL_ENTITY_GROUP_KEYS = ['clients', 'jobs', 'leads', 'invoices', 'quotes', 'requests', 'teams', 'events'] as const;
export type EntityGroupKey = typeof ALL_ENTITY_GROUP_KEYS[number];

export interface SearchEntityItem {
  type: SearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  amountCents: number | null;
  currency: string | null;
  date: string | null;
  clientId: string | null;
  clientName: string | null;
  createdAt: string;
  rank: number;
}

export interface PaginatedSearchGroup {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: SearchEntityItem[];
}

export interface SearchResultsPayload {
  query: string;
  tab: SearchTab;
  counts: Record<EntityGroupKey | 'all', number>;
  groups: Record<EntityGroupKey, PaginatedSearchGroup>;
}

export interface SearchSuggestionsPayload {
  query: string;
  items: SearchEntityItem[];
  grouped: Record<EntityGroupKey, SearchEntityItem[]>;
}

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('You need to be authenticated to run search.');
  }
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const headers = await getAuthHeader();
  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `Search request failed (${response.status}).`);
  }

  return (await response.json()) as T;
}

export async function fetchSearchSuggestions(query: string, limit = 8) {
  const safeQuery = query.trim();
  if (!safeQuery) {
    const emptyGrouped: Record<EntityGroupKey, SearchEntityItem[]> = {
      clients: [], jobs: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [],
    };
    return {
      query: '',
      items: [],
      grouped: emptyGrouped,
    } satisfies SearchSuggestionsPayload;
  }

  const params = new URLSearchParams({
    q: safeQuery,
    limit: String(limit),
  });

  return fetchJson<SearchSuggestionsPayload>(`/api/search/suggestions?${params.toString()}`);
}

interface FetchSearchResultsOptions {
  q: string;
  tab: SearchTab;
  pageSize?: number;
  page?: number;
  clientsPage?: number;
  jobsPage?: number;
  leadsPage?: number;
  invoicesPage?: number;
  quotesPage?: number;
  requestsPage?: number;
  teamsPage?: number;
  eventsPage?: number;
}

export async function fetchSearchResults(options: FetchSearchResultsOptions) {
  const params = new URLSearchParams({
    q: options.q.trim(),
    tab: options.tab,
    pageSize: String(options.pageSize ?? 20),
  });

  if (options.tab === 'all') {
    for (const key of ALL_ENTITY_GROUP_KEYS) {
      const pageKey = `${key}Page` as keyof FetchSearchResultsOptions;
      params.set(pageKey, String((options[pageKey] as number) ?? 1));
    }
  } else {
    params.set('page', String(options.page ?? 1));
  }

  return fetchJson<SearchResultsPayload>(`/api/search/results?${params.toString()}`);
}
