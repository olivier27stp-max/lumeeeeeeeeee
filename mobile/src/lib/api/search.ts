// Full-app search — the SAME source as the desktop, deliberately.
//
// The web does not query Supabase for search: it calls the Express route
// `GET /api/search/suggestions`, which runs the `search_global` RPC
// (SECURITY DEFINER, service_role only) with the org taken from the caller's
// JWT — never from the request. That route also expands client relationships
// (a client match pulls in their jobs, quotes, invoices…) and applies RBAC
// server-side: invoices and payments are dropped entirely for roles without
// financial access, and amounts are nulled for financially restricted ones.
//
// Mobile already holds the same Supabase JWT, so it can call the same route.
// Reimplementing the search client-side would fork the logic and let the two
// drift — which is exactly how the desktop and mobile ended up disagreeing
// before. There is one implementation, on the server, and both eat from it.

import { serverConfigured, serverGet } from './server';

export type SearchEntityType =
  | 'client' | 'property' | 'job' | 'agreement' | 'payment' | 'lead'
  | 'invoice' | 'quote' | 'request' | 'team' | 'event';

export const ALL_ENTITY_GROUP_KEYS = [
  'clients', 'properties', 'jobs', 'agreements', 'payments', 'leads',
  'invoices', 'quotes', 'requests', 'teams', 'events',
] as const;
export type EntityGroupKey = (typeof ALL_ENTITY_GROUP_KEYS)[number];

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
  /** property → owner client id, agreement → job id, payment → invoice id */
  refId?: string | null;
  createdAt: string;
  rank: number;
}

export interface SearchSuggestionsPayload {
  query: string;
  items: SearchEntityItem[];
  grouped: Record<EntityGroupKey, SearchEntityItem[]>;
}

export function emptyGrouped(): Record<EntityGroupKey, SearchEntityItem[]> {
  return {
    clients: [], properties: [], jobs: [], agreements: [], payments: [],
    leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [],
  };
}

/** False when EXPO_PUBLIC_WEB_URL is unset — the caller must fall back. */
export function fullSearchAvailable(): boolean {
  return serverConfigured();
}

export async function fetchSearchSuggestions(
  query: string,
  limit = 8,
): Promise<SearchSuggestionsPayload> {
  const q = query.trim();
  if (!q) return { query: '', items: [], grouped: emptyGrouped() };

  const path = `/search/suggestions?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`;
  const payload = await serverGet<SearchSuggestionsPayload>(path);

  // The server always sends every group, but a version skew shouldn't crash
  // the screen over a missing key.
  return { ...payload, grouped: { ...emptyGrouped(), ...(payload.grouped ?? {}) } };
}

/**
 * Where a result opens on mobile. Mirrors the web's getSearchItemHref, but
 * mobile has no hub screen for invoices, quotes, payments or requests — those
 * fall back to the client, whose detail screen already lists their quotes and
 * invoices. Returns null when there is nowhere sensible to go; the row is then
 * shown but not tappable, rather than sending the user to a dead end.
 */
export function searchItemRoute(item: SearchEntityItem): string | null {
  switch (item.type) {
    // A lead IS a client row with status='lead' — same hub.
    case 'client':
    case 'lead':
      return `/(app)/clients/${item.id}`;
    case 'property': {
      const owner = item.clientId || item.refId;
      return owner ? `/(app)/clients/${owner}` : null;
    }
    case 'job':
      return `/(app)/jobs/${item.id}`;
    // An agreement lives on its job.
    case 'agreement':
      return item.refId ? `/(app)/jobs/${item.refId}` : null;
    case 'invoice':
    case 'quote':
    case 'payment':
    case 'request':
      return item.clientId ? `/(app)/clients/${item.clientId}` : null;
    case 'team':
      return '/(app)/manage-team';
    case 'event':
      return '/(app)/schedule';
    default:
      return null;
  }
}

/** Group key → the entity type the server tags its rows with. */
export const GROUP_TO_TYPE: Record<EntityGroupKey, SearchEntityType> = {
  clients: 'client', properties: 'property', jobs: 'job', agreements: 'agreement',
  payments: 'payment', leads: 'lead', invoices: 'invoice', quotes: 'quote',
  requests: 'request', teams: 'team', events: 'event',
};
