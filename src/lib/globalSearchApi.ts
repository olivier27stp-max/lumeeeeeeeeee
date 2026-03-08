import { supabase } from './supabase';

export type SearchEntityType = 'client' | 'job' | 'lead';
export type SearchTab = 'all' | 'clients' | 'jobs' | 'leads';

export interface SearchEntityItem {
  type: SearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
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
  counts: {
    clients: number;
    jobs: number;
    leads: number;
    all: number;
  };
  groups: {
    clients: PaginatedSearchGroup;
    jobs: PaginatedSearchGroup;
    leads: PaginatedSearchGroup;
  };
}

export interface SearchSuggestionsPayload {
  query: string;
  items: SearchEntityItem[];
  grouped: {
    clients: SearchEntityItem[];
    jobs: SearchEntityItem[];
    leads: SearchEntityItem[];
  };
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
    return {
      query: '',
      items: [],
      grouped: {
        clients: [],
        jobs: [],
        leads: [],
      },
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
}

export async function fetchSearchResults(options: FetchSearchResultsOptions) {
  const params = new URLSearchParams({
    q: options.q.trim(),
    tab: options.tab,
    pageSize: String(options.pageSize ?? 20),
  });

  if (options.tab === 'all') {
    params.set('clientsPage', String(options.clientsPage ?? 1));
    params.set('jobsPage', String(options.jobsPage ?? 1));
    params.set('leadsPage', String(options.leadsPage ?? 1));
  } else {
    params.set('page', String(options.page ?? 1));
  }

  return fetchJson<SearchResultsPayload>(`/api/search/results?${params.toString()}`);
}
