import { SupabaseClient } from '@supabase/supabase-js';
import express from 'express';
import { mapboxGeocodingToken } from './config';

// ── Types ──

export type SearchEntityType = 'client' | 'job' | 'lead' | 'invoice' | 'quote' | 'request' | 'team' | 'event';
export type SearchTab = 'all' | 'clients' | 'jobs' | 'leads' | 'invoices' | 'quotes' | 'requests' | 'teams' | 'events';
export type PaymentStatus = 'succeeded' | 'pending' | 'failed' | 'refunded';

export type GeocodeResult = { latitude: number; longitude: number; provider: 'mapbox' | 'nominatim' };

export interface SearchRow {
  entity_type: SearchEntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  extra_status: string | null;
  extra_amount_cents: number | null;
  extra_currency: string | null;
  extra_date: string | null;
  extra_client_id: string | null;
  extra_client_name: string | null;
  created_at: string;
  rank: number;
}

export interface PaymentInsertInput {
  org_id: string;
  client_id?: string | null;
  invoice_id?: string | null;
  job_id?: string | null;
  provider: 'stripe' | 'paypal' | 'manual';
  provider_payment_id?: string | null;
  provider_order_id?: string | null;
  provider_event_id?: string | null;
  status: PaymentStatus;
  method?: string | null;
  amount_cents: number;
  currency: string;
  payment_date?: string;
}

// ── Rate limiter ──

const geocodeRateWindowMs = 60_000;
const geocodeRateMax = 30;
const geocodeRateLimiter = new Map<string, { count: number; windowStart: number }>();

export function consumeGeocodeQuota(key: string) {
  const now = Date.now();
  const current = geocodeRateLimiter.get(key);
  if (!current || now - current.windowStart >= geocodeRateWindowMs) {
    geocodeRateLimiter.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (current.count >= geocodeRateMax) return false;
  current.count += 1;
  geocodeRateLimiter.set(key, current);
  return true;
}

// ── Utility functions ──

export function sanitizeQuery(raw: string) {
  return raw.replace(/[\u0000-\u001f]+/g, ' ').trim();
}

export function clampInt(raw: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  return Math.min(max, Math.max(min, rounded));
}

export function parseTab(raw: unknown): SearchTab {
  const value = String(raw || '').toLowerCase();
  if (value === 'clients' || value === 'jobs' || value === 'leads' || value === 'invoices' || value === 'quotes' || value === 'requests' || value === 'teams' || value === 'events') return value;
  return 'all';
}

export function normalizeAmountToCents(value: unknown) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num * 100));
}

export function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function normalizeAddress(address: string | null | undefined) {
  return String(address || '').trim().replace(/\s+/g, ' ');
}

export function resolvePublicBaseUrl(_req: express.Request) {
  const configured = process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || process.env.APP_URL || '';
  if (!configured) {
    throw new Error('FRONTEND_URL or PUBLIC_BASE_URL must be configured. Never derive from request headers.');
  }
  return configured.replace(/\/$/, '');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseOrgId(input: unknown) {
  const value = String(input || '').trim();
  if (!value) return null;
  if (!UUID_RE.test(value)) return null;
  return value;
}

export function mapSearchRows(rows: SearchRow[] | null | undefined) {
  return (rows || [])
    .filter((row) => row?.entity_id && row?.entity_type && row?.title)
    .map((row) => ({
      type: row.entity_type,
      id: row.entity_id,
      title: row.title,
      subtitle: row.subtitle,
      status: row.extra_status || null,
      amountCents: row.extra_amount_cents ?? null,
      currency: row.extra_currency || null,
      date: row.extra_date || null,
      clientId: row.extra_client_id || null,
      clientName: row.extra_client_name || null,
      createdAt: row.created_at,
      rank: Number(row.rank || 0),
    }));
}

export function parseCountRows(rows: Array<{ entity_type: SearchEntityType; total: number }> | null | undefined) {
  const base = { clients: 0, jobs: 0, leads: 0, invoices: 0, quotes: 0, requests: 0, teams: 0, events: 0 };
  for (const row of rows || []) {
    const total = Number(row.total || 0);
    if (row.entity_type === 'client') base.clients = total;
    if (row.entity_type === 'job') base.jobs = total;
    if (row.entity_type === 'lead') base.leads = total;
    if (row.entity_type === 'invoice') base.invoices = total;
    if (row.entity_type === 'quote') base.quotes = total;
    if (row.entity_type === 'request') base.requests = total;
    if (row.entity_type === 'team') base.teams = total;
    if (row.entity_type === 'event') base.events = total;
  }
  return {
    ...base,
    all: base.clients + base.jobs + base.leads + base.invoices + base.quotes + base.requests + base.teams + base.events,
  };
}

const TAB_TO_ENTITY: Record<Exclude<SearchTab, 'all'>, SearchEntityType> = {
  clients: 'client',
  jobs: 'job',
  leads: 'lead',
  invoices: 'invoice',
  quotes: 'quote',
  requests: 'request',
  teams: 'team',
  events: 'event',
};

export function toEntityType(tab: Exclude<SearchTab, 'all'>): SearchEntityType {
  return TAB_TO_ENTITY[tab] || 'client';
}

export function emptyPage(pageSize: number, total = 0, page = 1) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: [] as Array<{ type: SearchEntityType; id: string; title: string; subtitle: string | null; createdAt: string; rank: number }>,
  };
}

export async function searchByType(
  client: SupabaseClient,
  orgId: string,
  query: string,
  entityType: SearchEntityType,
  pageSize: number,
  page: number,
  total: number
) {
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * pageSize;
  const { data, error } = await client.rpc('search_global_by_type', {
    p_org: orgId,
    p_q: query,
    p_entity_type: entityType,
    p_limit: pageSize,
    p_offset: offset,
  });

  if (error) throw error;

  return {
    page: safePage,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: mapSearchRows((data || []) as SearchRow[]),
  };
}

export async function ensureLeadInPipeline(params: {
  client: SupabaseClient;
  orgId: string;
  leadId: string;
  createdBy: string;
  title: string | null;
  value: number;
  notes: string | null;
}) {
  const { client, orgId, leadId, createdBy, title, value, notes } = params;
  if (!leadId) return null;

  // Idempotency: return existing deal id if one already exists.
  const { data: existingDeal, error: existingDealError } = await client
    .from('pipeline_deals')
    .select('id')
    .eq('org_id', orgId)
    .eq('lead_id', leadId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (existingDealError) throw existingDealError;
  if (existingDeal?.id) return String(existingDeal.id);

  // Direct insert with pipeline stages: new_prospect, no_response, quote_sent, closed_won, closed_lost.
  const { data: dealInsert, error: dealError } = await client
    .from('pipeline_deals')
    .insert({
      org_id: orgId,
      created_by: createdBy,
      lead_id: leadId,
      stage: 'new_prospect',
      title: title || 'New deal',
      value: Number.isFinite(value) ? value : 0,
      notes: notes || null,
    })
    .select('id')
    .single();

  if (dealError) throw dealError;
  return dealInsert?.id ? String(dealInsert.id) : null;
}

// ── Geocoding ──

export async function geocodeWithMapbox(address: string): Promise<GeocodeResult | null> {
  if (!mapboxGeocodingToken) return null;
  const endpoint = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`;
  const response = await fetch(
    `${endpoint}?limit=1&types=address,place,postcode,locality,neighborhood&access_token=${encodeURIComponent(mapboxGeocodingToken)}`
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as any;
  const center = payload?.features?.[0]?.center;
  if (!Array.isArray(center) || center.length < 2) return null;
  const longitude = Number(center[0]);
  const latitude = Number(center[1]);
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;
  return { latitude, longitude, provider: 'mapbox' };
}

export async function geocodeWithNominatim(address: string): Promise<GeocodeResult | null> {
  const endpoint = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'LUME-CRM-Geocoder/1.0',
      Accept: 'application/json',
    },
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as Array<{ lat?: string; lon?: string }>;
  const top = payload?.[0];
  const latitude = Number(top?.lat || '');
  const longitude = Number(top?.lon || '');
  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return null;
  return { latitude, longitude, provider: 'nominatim' };
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  const mapboxResult = await geocodeWithMapbox(normalized);
  if (mapboxResult) return mapboxResult;
  return geocodeWithNominatim(normalized);
}

// ── Misc helpers ──

export function normalizeE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}

export function phoneVariants(normalized: string): string[] {
  const digits = normalized.replace(/\D/g, '');
  const variants = [normalized];
  if (digits.startsWith('1') && digits.length === 11) {
    variants.push(digits.slice(1)); // 10 digits without country code
  }
  variants.push(digits);
  return [...new Set(variants)];
}

export async function findOrCreateConversation(
  serviceClient: SupabaseClient,
  orgId: string,
  phoneNumber: string,
  clientId?: string | null,
  clientName?: string | null,
) {
  const variants = phoneVariants(phoneNumber);

  // Try to find existing conversation (match any phone variant)
  const { data: existing } = await serviceClient
    .from('conversations')
    .select('*')
    .in('phone_number', variants)
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  // If no client info provided, try to find client by phone
  if (!clientId) {
    const phoneFilter = variants.map((p) => `phone.eq.${p}`).join(',');
    const { data: client } = await serviceClient
      .from('clients')
      .select('id, first_name, last_name')
      .or(phoneFilter)
      .limit(1)
      .maybeSingle();

    if (client) {
      clientId = client.id;
      clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim();
    }
  }

  const { data: created, error } = await serviceClient
    .from('conversations')
    .insert({
      org_id: orgId,
      client_id: clientId || null,
      phone_number: phoneNumber,
      client_name: clientName || null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return created;
}
