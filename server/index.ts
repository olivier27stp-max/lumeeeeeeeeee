
import express from 'express';
import cors from 'cors';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';
import { getSupabaseAdminClient } from '../src/lib/supabaseAdmin';
import { getStripeClient as getStripeClientForOrg } from '../src/lib/stripeClient';
import { paypalFetch as paypalFetchForOrg } from '../src/lib/paypalClient';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
const port = Number(process.env.API_PORT || 3001);

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const mapboxGeocodingToken = process.env.MAPBOX_GEOCODING_TOKEN || '';

const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const paypalWebhookId = process.env.PAYPAL_WEBHOOK_ID || '';
const paypalEnv = String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY for API server.');
}

let adminClientCache: SupabaseClient | null = null;
const stripeWebhookClient = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

type SearchEntityType = 'client' | 'job' | 'lead';
type SearchTab = 'all' | 'clients' | 'jobs' | 'leads';
type PaymentStatus = 'succeeded' | 'pending' | 'failed' | 'refunded';

type GeocodeResult = { latitude: number; longitude: number; provider: 'mapbox' | 'nominatim' };

interface SearchRow {
  entity_type: SearchEntityType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  created_at: string;
  rank: number;
}

interface PaymentInsertInput {
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

const geocodeRateWindowMs = 60_000;
const geocodeRateMax = 30;
const geocodeRateLimiter = new Map<string, { count: number; windowStart: number }>();

function buildSupabaseWithAuth(authorizationHeader: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorizationHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getServiceClient() {
  if (!supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for secure payment secret operations.');
  }
  if (!adminClientCache) {
    adminClientCache = getSupabaseAdminClient(supabaseUrl, supabaseServiceRoleKey);
  }
  return adminClientCache;
}

function getPayPalBaseUrl() {
  return paypalEnv === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

function sanitizeQuery(raw: string) {
  return raw.replace(/[\u0000-\u001f]+/g, ' ').trim();
}

function clampInt(raw: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  return Math.min(max, Math.max(min, rounded));
}

function parseTab(raw: unknown): SearchTab {
  const value = String(raw || '').toLowerCase();
  if (value === 'clients' || value === 'jobs' || value === 'leads') return value;
  return 'all';
}

function normalizeAmountToCents(value: unknown) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num * 100));
}

function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function normalizeAddress(address: string | null | undefined) {
  return String(address || '').trim().replace(/\s+/g, ' ');
}

function consumeGeocodeQuota(key: string) {
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

function resolvePublicBaseUrl(req: express.Request) {
  const configured = process.env.PUBLIC_BASE_URL || process.env.APP_URL || '';
  if (configured) return configured.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
async function resolveOrgId(client: SupabaseClient) {
  const { data, error } = await client.rpc('current_org_id');
  if (!error) return (data as string | null) || null;

  // Fallback when current_org_id() is not installed yet.
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError || !user?.id) return null;

  const { data: membership, error: membershipError } = await client
    .from('memberships')
    .select('org_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();
  if (membershipError) return null;
  return String(membership?.org_id || '') || null;
}

async function requireAuthedClient(req: express.Request, res: express.Response) {
  const authorizationHeader = req.header('authorization');
  if (!authorizationHeader) {
    res.status(401).json({ error: 'Missing authorization header.' });
    return null;
  }

  const client = buildSupabaseWithAuth(authorizationHeader);
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError || !user) {
    res.status(401).json({ error: 'Invalid auth token.' });
    return null;
  }

  const orgId = await resolveOrgId(client);
  if (!orgId) {
    res.status(403).json({ error: 'No organization context found for user.' });
    return null;
  }

  return { client, orgId, user };
}

function parseOrgId(input: unknown) {
  const value = String(input || '').trim();
  if (!value) return null;
  return value;
}

async function isOrgMember(client: SupabaseClient, userId: string, orgId: string) {
  if (!userId || !orgId) return false;
  if (userId === orgId) return true;

  const { data, error } = await client.rpc('has_org_membership', { p_user: userId, p_org: orgId });
  if (!error) return Boolean(data);

  // Fallback when has_org_membership() is not installed yet.
  const { data: row, error: membershipError } = await client
    .from('memberships')
    .select('org_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) return false;
  return Boolean(row?.org_id);
}

async function isOrgAdminOrOwner(client: SupabaseClient, userId: string, orgId: string) {
  if (!userId || !orgId) return false;
  if (userId === orgId) return true;

  const { data: roleRow, error: roleError } = await client
    .from('memberships')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!roleError && roleRow?.role) {
    const role = String(roleRow.role).toLowerCase();
    return role === 'owner' || role === 'admin';
  }

  const { data, error } = await client.rpc('has_org_admin_role', { p_user: userId, p_org: orgId });
  if (error) return false;
  return Boolean(data);
}

function mapSearchRows(rows: SearchRow[] | null | undefined) {
  return (rows || [])
    .filter((row) => row?.entity_id && row?.entity_type && row?.title)
    .map((row) => ({
      type: row.entity_type,
      id: row.entity_id,
      title: row.title,
      subtitle: row.subtitle,
      createdAt: row.created_at,
      rank: Number(row.rank || 0),
    }));
}

function parseCountRows(rows: Array<{ entity_type: SearchEntityType; total: number }> | null | undefined) {
  const base = { clients: 0, jobs: 0, leads: 0 };
  for (const row of rows || []) {
    const total = Number(row.total || 0);
    if (row.entity_type === 'client') base.clients = total;
    if (row.entity_type === 'job') base.jobs = total;
    if (row.entity_type === 'lead') base.leads = total;
  }
  return {
    ...base,
    all: base.clients + base.jobs + base.leads,
  };
}

function toEntityType(tab: Exclude<SearchTab, 'all'>): SearchEntityType {
  if (tab === 'clients') return 'client';
  if (tab === 'jobs') return 'job';
  return 'lead';
}

function emptyPage(pageSize: number, total = 0, page = 1) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: [] as Array<{ type: SearchEntityType; id: string; title: string; subtitle: string | null; createdAt: string; rank: number }>,
  };
}

async function searchByType(
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

async function ensureLeadInPipeline(params: {
  client: SupabaseClient;
  orgId: string;
  leadId: string;
  title: string | null;
  value: number;
  notes: string | null;
}) {
  const { client, orgId, leadId, title, value, notes } = params;
  if (!leadId) return null;

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

  const { data: rpcDealId, error: rpcDealError } = await client.rpc('create_pipeline_deal', {
    p_lead_id: leadId,
    p_title: title || 'New deal',
    p_value: Number.isFinite(value) ? value : 0,
    p_stage: 'Qualified',
    p_notes: notes || null,
    p_pipeline_id: null,
  });

  if (rpcDealError) throw rpcDealError;
  return String(rpcDealId || '');
}

async function geocodeWithMapbox(address: string): Promise<GeocodeResult | null> {
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

async function geocodeWithNominatim(address: string): Promise<GeocodeResult | null> {
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

async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  const mapboxResult = await geocodeWithMapbox(normalized);
  if (mapboxResult) return mapboxResult;
  return geocodeWithNominatim(normalized);
}
function parsePaymentMetadata(raw: unknown) {
  if (!raw) {
    return { orgId: null, invoiceId: null, clientId: null, jobId: null };
  }
  const meta = raw as Record<string, unknown>;
  return {
    orgId: String(meta.org_id || '').trim() || null,
    invoiceId: String(meta.invoice_id || '').trim() || null,
    clientId: String(meta.client_id || '').trim() || null,
    jobId: String(meta.job_id || '').trim() || null,
  };
}

type DefaultProvider = 'none' | 'stripe' | 'paypal';

interface PaymentSettingsRow {
  org_id: string;
  default_provider: DefaultProvider;
  stripe_enabled: boolean;
  paypal_enabled: boolean;
  stripe_keys_present: boolean;
  paypal_keys_present: boolean;
  updated_at: string | null;
}

interface PaymentProviderSecretsRow {
  org_id: string;
  stripe_publishable_key: string | null;
  stripe_secret_key_enc: string | null;
  paypal_client_id: string | null;
  paypal_secret_enc: string | null;
}

function normalizeDefaultProvider(value: unknown): DefaultProvider {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'stripe' || raw === 'paypal') return raw;
  return 'none';
}

function readPgCode(error: any) {
  return String(error?.code || error?.error?.code || '').trim();
}

function isSchemaNotReadyError(error: any) {
  const code = readPgCode(error);
  return code === '42P01' || code === '42703' || code === '42883' || code === '42P13';
}

function defaultPaymentSettings(orgId: string): PaymentSettingsRow & {
  stripe_publishable_key: string | null;
  paypal_client_id: string | null;
} {
  return {
    org_id: orgId,
    default_provider: 'none',
    stripe_enabled: false,
    paypal_enabled: false,
    stripe_keys_present: false,
    paypal_keys_present: false,
    updated_at: null,
    stripe_publishable_key: null,
    paypal_client_id: null,
  };
}

async function ensurePaymentSettingsRow(client: SupabaseClient, orgId: string) {
  const { error } = await client.rpc('ensure_payment_settings_row', { p_org: orgId });
  if (!error) return;
  if (isSchemaNotReadyError(error)) return;

  // Fallback for environments where ensure_payment_settings_row() is missing.
  const { error: upsertError } = await client.from('payment_provider_settings').upsert(
    {
      org_id: orgId,
      default_provider: 'none',
      stripe_enabled: false,
      paypal_enabled: false,
      stripe_keys_present: false,
      paypal_keys_present: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id' }
  );
  if (isSchemaNotReadyError(upsertError)) return;
  if (upsertError) throw upsertError;
}

async function getPaymentProviderSettings(client: SupabaseClient, orgId: string): Promise<PaymentSettingsRow & {
  stripe_publishable_key: string | null;
  paypal_client_id: string | null;
}> {
  await ensurePaymentSettingsRow(client, orgId);

  const { data, error } = await client
    .from('payment_provider_settings')
    .select('org_id,default_provider,stripe_enabled,paypal_enabled,stripe_keys_present,paypal_keys_present,updated_at')
    .eq('org_id', orgId)
    .single();

  if (isSchemaNotReadyError(error)) {
    return defaultPaymentSettings(orgId);
  }
  if (error) throw error;

  let secretRow: { stripe_publishable_key: string | null; paypal_client_id: string | null } | null = null;
  if (supabaseServiceRoleKey) {
    const admin = getServiceClient();
    const { data: providerSecretRow, error: secretsError } = await admin
      .from('payment_provider_secrets')
      .select('org_id,stripe_publishable_key,paypal_client_id')
      .eq('org_id', orgId)
      .maybeSingle();
    if (isSchemaNotReadyError(secretsError)) {
      return {
        ...defaultPaymentSettings(orgId),
        default_provider: normalizeDefaultProvider(data?.default_provider),
        stripe_enabled: Boolean(data?.stripe_enabled),
        paypal_enabled: Boolean(data?.paypal_enabled),
        stripe_keys_present: Boolean(data?.stripe_keys_present),
        paypal_keys_present: Boolean(data?.paypal_keys_present),
        updated_at: data?.updated_at || null,
      };
    }
    if (secretsError) throw secretsError;
    secretRow = providerSecretRow
      ? {
          stripe_publishable_key: providerSecretRow.stripe_publishable_key || null,
          paypal_client_id: providerSecretRow.paypal_client_id || null,
        }
      : null;
  }

  return {
    org_id: orgId,
    default_provider: normalizeDefaultProvider(data?.default_provider),
    stripe_enabled: Boolean(data?.stripe_enabled),
    paypal_enabled: Boolean(data?.paypal_enabled),
    stripe_keys_present: Boolean(data?.stripe_keys_present),
    paypal_keys_present: Boolean(data?.paypal_keys_present),
    updated_at: data?.updated_at || null,
    stripe_publishable_key: secretRow?.stripe_publishable_key || null,
    paypal_client_id: secretRow?.paypal_client_id || null,
  };
}

async function getPaymentProviderSecrets(orgId: string): Promise<{
  stripe_publishable_key: string | null;
  stripe_secret_key: string | null;
  paypal_client_id: string | null;
  paypal_secret: string | null;
}> {
  if (!supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing on server.');
  }
  const admin = getServiceClient();
  const { data, error } = await admin
    .from('payment_provider_secrets')
    .select('org_id,stripe_publishable_key,stripe_secret_key_enc,paypal_client_id,paypal_secret_enc')
    .eq('org_id', orgId)
    .maybeSingle<PaymentProviderSecretsRow>();
  if (error) throw error;

  return {
    stripe_publishable_key: data?.stripe_publishable_key || null,
    stripe_secret_key: data?.stripe_secret_key_enc ? decryptSecret(data.stripe_secret_key_enc) : null,
    paypal_client_id: data?.paypal_client_id || null,
    paypal_secret: data?.paypal_secret_enc ? decryptSecret(data.paypal_secret_enc) : null,
  };
}

function isValidDefaultProvider(value: unknown): value is DefaultProvider {
  return value === 'none' || value === 'stripe' || value === 'paypal';
}

async function saveProviderKeys(params: {
  client: SupabaseClient;
  orgId: string;
  provider: string;
  body: any;
}) {
  if (!supabaseServiceRoleKey) {
    throw new Error(
      'Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local and restart API before saving provider keys.'
    );
  }

  const { client, orgId, provider, body } = params;
  const admin = getServiceClient();
  const now = new Date().toISOString();

  if (provider === 'stripe') {
    const stripePublishableKey = String(body?.stripePublishableKey || body?.keys?.publishableKey || '').trim();
    const stripeSecretKey = String(body?.stripeSecretKey || body?.keys?.secretKey || '').trim();
    if (!stripePublishableKey || !stripeSecretKey) {
      throw new Error('Stripe publishable and secret keys are required.');
    }

    const { error: secretsError } = await admin.from('payment_provider_secrets').upsert(
      {
        org_id: orgId,
        stripe_publishable_key: stripePublishableKey,
        stripe_secret_key_enc: encryptSecret(stripeSecretKey),
        updated_at: now,
      },
      { onConflict: 'org_id' }
    );
    if (secretsError) throw secretsError;

    const { error: settingsError } = await client
      .from('payment_provider_settings')
      .update({
        stripe_keys_present: true,
        updated_at: now,
      })
      .eq('org_id', orgId);
    if (settingsError) throw settingsError;

    return { provider: 'stripe', keysPresent: true as const };
  }

  if (provider === 'paypal') {
    const paypalClientId = String(body?.paypalClientId || body?.keys?.clientId || '').trim();
    const paypalSecret = String(body?.paypalSecret || body?.keys?.secret || '').trim();
    if (!paypalClientId || !paypalSecret) {
      throw new Error('PayPal client id and secret are required.');
    }

    const { error: secretsError } = await admin.from('payment_provider_secrets').upsert(
      {
        org_id: orgId,
        paypal_client_id: paypalClientId,
        paypal_secret_enc: encryptSecret(paypalSecret),
        updated_at: now,
      },
      { onConflict: 'org_id' }
    );
    if (secretsError) throw secretsError;

    const { error: settingsError } = await client
      .from('payment_provider_settings')
      .update({
        paypal_keys_present: true,
        updated_at: now,
      })
      .eq('org_id', orgId);
    if (settingsError) throw settingsError;

    return { provider: 'paypal', keysPresent: true as const };
  }

  throw new Error('Invalid provider. Expected stripe or paypal.');
}

type PayoutProvider = 'stripe' | 'paypal';

interface PayoutListItem {
  id: string;
  date: string;
  type: string;
  status: string;
  net: number;
  currency: string;
  arrival_date?: string | null;
  method?: string | null;
  raw_ref?: string | null;
}

function parsePayoutProvider(raw: unknown): PayoutProvider | null {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'stripe' || value === 'paypal') return value;
  return null;
}

function parseDateParam(raw: unknown): Date | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function startOfWeek(date: Date) {
  const current = new Date(date);
  const day = current.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  current.setDate(current.getDate() + delta);
  current.setHours(0, 0, 0, 0);
  return current;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function toUnixSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function formatIso(date: Date | number | string | null | undefined) {
  if (date == null) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function toCents(value: unknown) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

function normalizeCurrency(value: unknown, fallback = 'CAD') {
  const currency = String(value || '').trim().toUpperCase();
  return currency || fallback;
}

function chooseProviderFromSettings(settings: PaymentSettingsRow) {
  const stripeConnected = settings.stripe_enabled && settings.stripe_keys_present;
  const paypalConnected = settings.paypal_enabled && settings.paypal_keys_present;

  if (settings.default_provider === 'stripe' && stripeConnected) return 'stripe' as const;
  if (settings.default_provider === 'paypal' && paypalConnected) return 'paypal' as const;
  if (stripeConnected) return 'stripe' as const;
  if (paypalConnected) return 'paypal' as const;
  return null;
}

function serializeCursor(payload: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function deserializeCursor<T>(cursorRaw: unknown): T | null {
  const cursor = String(cursorRaw || '').trim();
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function mapStripePayoutItem(payout: Stripe.Payout): PayoutListItem {
  return {
    id: payout.id,
    date: formatIso((payout.created || 0) * 1000) || new Date().toISOString(),
    type: payout.type || payout.method || 'payout',
    status: payout.status || 'unknown',
    net: Number(payout.amount || 0),
    currency: normalizeCurrency(payout.currency, 'USD'),
    arrival_date: formatIso((payout.arrival_date || 0) * 1000),
    method: payout.method || null,
    raw_ref: payout.balance_transaction ? String(payout.balance_transaction) : null,
  };
}

function derivePayPalType(item: any) {
  const code = String(item?.transaction_info?.transaction_event_code || '').trim();
  const name = String(item?.transaction_info?.transaction_initiation_date || '').trim();
  if (code.startsWith('T04')) return 'bank_transfer';
  if (/withdraw|bank|transfer/i.test(name)) return 'bank_transfer';
  return 'other';
}

function isPayPalPayoutLike(item: any) {
  const code = String(item?.transaction_info?.transaction_event_code || '').trim().toUpperCase();
  const status = String(item?.transaction_info?.transaction_status || '').toUpperCase();
  const gross = Number(item?.transaction_info?.transaction_amount?.value || 0);
  if (code.startsWith('T04')) return true;
  if (status.includes('PENDING') && gross < 0) return true;
  const type = derivePayPalType(item);
  return type === 'bank_transfer';
}

function mapPayPalTransaction(item: any): PayoutListItem {
  const info = item?.transaction_info || {};
  const amount = Number(info?.transaction_amount?.value || 0);
  const currency = normalizeCurrency(info?.transaction_amount?.currency_code, 'USD');
  const fallbackId = `paypal-${Date.now()}-${Math.trunc(Math.random() * 10_000)}`;
  return {
    id: String(info?.transaction_id || info?.transaction_event_code || fallbackId),
    date: formatIso(info?.transaction_initiation_date) || new Date().toISOString(),
    type: derivePayPalType(item),
    status: String(info?.transaction_status || 'unknown').toLowerCase(),
    net: toCents(amount),
    currency,
    arrival_date: formatIso(info?.transaction_updated_date),
    method: derivePayPalType(item),
    raw_ref: String(info?.paypal_reference_id || '') || null,
  };
}

async function resolvePayoutProvider(params: {
  client: SupabaseClient;
  orgId: string;
  requestedProvider: PayoutProvider | null;
}) {
  const settings = await getPaymentProviderSettings(params.client, params.orgId);
  const fallback = chooseProviderFromSettings(settings);
  const provider = params.requestedProvider || fallback;

  if (!provider) {
    const error = new Error('Connect Stripe or PayPal first in Payment settings.');
    (error as any).status = 409;
    throw error;
  }

  if (provider === 'stripe' && !(settings.stripe_enabled && settings.stripe_keys_present)) {
    const error = new Error('Connect Stripe first in Payment settings.');
    (error as any).status = 409;
    throw error;
  }

  if (provider === 'paypal' && !(settings.paypal_enabled && settings.paypal_keys_present)) {
    const error = new Error('Connect PayPal first in Payment settings.');
    (error as any).status = 409;
    throw error;
  }

  return { provider, settings };
}

async function buildStripePayoutSummary(orgId: string) {
  if (!supabaseServiceRoleKey) {
    const error = new Error('Server is missing SUPABASE_SERVICE_ROLE_KEY.');
    (error as any).status = 503;
    throw error;
  }

  const { stripe } = await getStripeClientForOrg({
    orgId,
    supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
  });

  const balance = await stripe.balance.retrieve();
  const currency = normalizeCurrency(balance?.available?.[0]?.currency || balance?.pending?.[0]?.currency || 'usd');
  const available = (balance.available || [])
    .filter((entry) => normalizeCurrency(entry.currency) === currency)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const pending = (balance.pending || [])
    .filter((entry) => normalizeCurrency(entry.currency) === currency)
    .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  const now = new Date();
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);
  const paidPayouts = await stripe.payouts.list({
    limit: 100,
    status: 'paid',
    arrival_date: { gte: toUnixSeconds(monthStart), lte: toUnixSeconds(now) },
  });

  let depositedWeek = 0;
  let depositedMonth = 0;
  for (const payout of paidPayouts.data || []) {
    if (normalizeCurrency(payout.currency) !== currency) continue;
    const amount = Number(payout.amount || 0);
    depositedMonth += amount;
    const arrival = new Date((payout.arrival_date || payout.created || 0) * 1000);
    if (arrival >= weekStart) depositedWeek += amount;
  }

  return {
    provider: 'stripe' as const,
    currency,
    available,
    on_the_way: pending,
    deposited_week: depositedWeek,
    deposited_month: depositedMonth,
    meta: { source: 'stripe.balance' },
  };
}

async function listStripePayouts(params: {
  orgId: string;
  limit: number;
  cursor: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  method: string | null;
}) {
  if (!supabaseServiceRoleKey) {
    const error = new Error('Server is missing SUPABASE_SERVICE_ROLE_KEY.');
    (error as any).status = 503;
    throw error;
  }

  const { stripe } = await getStripeClientForOrg({
    orgId: params.orgId,
    supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
  });

  const createdFilter =
    params.dateFrom || params.dateTo
      ? {
          gte: params.dateFrom ? toUnixSeconds(params.dateFrom) : undefined,
          lte: params.dateTo ? toUnixSeconds(params.dateTo) : undefined,
        }
      : undefined;

  const response = await stripe.payouts.list({
    limit: params.limit,
    starting_after: params.cursor || undefined,
    created: createdFilter,
  });

  let items = (response.data || []).map(mapStripePayoutItem);
  if (params.method && params.method !== 'all') {
    items = items.filter((item) => String(item.method || '').toLowerCase() === String(params.method).toLowerCase());
  }

  return {
    provider: 'stripe' as const,
    currency: items[0]?.currency || 'USD',
    total_estimate: null as number | null,
    items,
    next_cursor: response.has_more && items.length > 0 ? items[items.length - 1].id : null,
    has_more: Boolean(response.has_more && items.length > 0),
  };
}

async function getStripePayoutDetail(orgId: string, id: string) {
  if (!supabaseServiceRoleKey) {
    const error = new Error('Server is missing SUPABASE_SERVICE_ROLE_KEY.');
    (error as any).status = 503;
    throw error;
  }

  const { stripe } = await getStripeClientForOrg({
    orgId,
    supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
  });

  const payout = await stripe.payouts.retrieve(id);
  const fees = await stripe.balanceTransactions
    .list({ payout: id, limit: 100 })
    .catch(() => ({ data: [] as Stripe.BalanceTransaction[] }));
  const feeTotal = (fees.data || []).reduce((sum, row) => sum + Number(row.fee || 0), 0);

  return {
    provider: 'stripe',
    item: mapStripePayoutItem(payout),
    detail: {
      id: payout.id,
      created: formatIso((payout.created || 0) * 1000),
      arrival_date: formatIso((payout.arrival_date || 0) * 1000),
      status: payout.status || 'unknown',
      type: payout.type || payout.method || 'payout',
      amount: Number(payout.amount || 0),
      currency: normalizeCurrency(payout.currency, 'USD'),
      method: payout.method || null,
      fee_total: feeTotal,
      statement_descriptor: payout.statement_descriptor || null,
      destination: payout.destination || null,
    },
  };
}

async function fetchPayPalTransactions(params: {
  orgId: string;
  page: number;
  limit: number;
  dateFrom: Date;
  dateTo: Date;
}) {
  if (!supabaseServiceRoleKey) {
    const error = new Error('Server is missing SUPABASE_SERVICE_ROLE_KEY.');
    (error as any).status = 503;
    throw error;
  }

  const startDate = params.dateFrom.toISOString();
  const endDate = params.dateTo.toISOString();
  const query = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    fields: 'all',
    page_size: String(params.limit),
    page: String(params.page),
  });

  const response = await paypalFetchForOrg(
    {
      orgId: params.orgId,
      supabaseUrl,
      serviceRoleKey: supabaseServiceRoleKey,
      env: paypalEnv,
    },
    `/v1/reporting/transactions?${query.toString()}`
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PayPal transactions failed (${response.status}): ${text}`);
  }

  return (await response.json()) as any;
}

async function buildPayPalPayoutSummary(orgId: string) {
  const now = new Date();
  const monthStart = startOfMonth(now);
  const weekStart = startOfWeek(now);
  const currency = 'USD';

  let available = 0;
  let metaSource = 'paypal.transactions';
  let metaNote: string | undefined;
  try {
    const balancesRes = await paypalFetchForOrg(
      {
        orgId,
        supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        env: paypalEnv,
      },
      '/v1/reporting/balances'
    );
    if (balancesRes.ok) {
      const payload = (await balancesRes.json()) as any;
      const balanceRow = Array.isArray(payload?.balances) ? payload.balances[0] : null;
      if (balanceRow) {
        available = toCents(balanceRow?.available_balance?.value || 0);
        metaSource = 'paypal.reporting';
      }
    }
  } catch {
    metaNote = 'PayPal balances endpoint unavailable; using transaction reporting fallback.';
  }

  const transactionsPayload = await fetchPayPalTransactions({
    orgId,
    page: 1,
    limit: 200,
    dateFrom: monthStart,
    dateTo: now,
  });

  const details = Array.isArray(transactionsPayload?.transaction_details) ? transactionsPayload.transaction_details : [];
  const payoutLike = details.filter(isPayPalPayoutLike).map(mapPayPalTransaction);
  const sourceItems = payoutLike.length > 0 ? payoutLike : details.map(mapPayPalTransaction);
  if (payoutLike.length === 0) {
    metaNote =
      (metaNote ? `${metaNote} ` : '') +
      'PayPal does not expose a universal bank-payout object for all accounts; showing closest transaction equivalents.';
  }

  let depositedWeek = 0;
  let depositedMonth = 0;
  for (const item of sourceItems) {
    const amount = Number(item.net || 0);
    if (amount <= 0) continue;
    const date = new Date(item.arrival_date || item.date);
    if (date >= monthStart) depositedMonth += amount;
    if (date >= weekStart) depositedWeek += amount;
  }

  const onTheWay = sourceItems
    .filter((item) => item.status.includes('pending'))
    .reduce((sum, item) => sum + Number(item.net || 0), 0);

  return {
    provider: 'paypal' as const,
    currency,
    available,
    on_the_way: onTheWay,
    deposited_week: depositedWeek,
    deposited_month: depositedMonth,
    meta: {
      source: metaSource,
      note: metaNote,
    },
  };
}

async function listPayPalPayouts(params: {
  orgId: string;
  limit: number;
  cursor: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  method: string | null;
}) {
  const cursorPayload = deserializeCursor<{ page?: number }>(params.cursor);
  const page = Math.max(1, Number(cursorPayload?.page || 1));
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 180);

  const payload = await fetchPayPalTransactions({
    orgId: params.orgId,
    page,
    limit: params.limit,
    dateFrom: params.dateFrom || defaultFrom,
    dateTo: params.dateTo || now,
  });

  const details = Array.isArray(payload?.transaction_details) ? payload.transaction_details : [];
  const payoutLike = details.filter(isPayPalPayoutLike).map(mapPayPalTransaction);
  let items = payoutLike.length > 0 ? payoutLike : details.map(mapPayPalTransaction);
  if (params.method && params.method !== 'all') {
    items = items.filter((item) => String(item.method || '').toLowerCase() === String(params.method).toLowerCase());
  }

  const totalPages = Number(payload?.total_pages || 1);
  const hasMore = page < totalPages;
  return {
    provider: 'paypal' as const,
    currency: items[0]?.currency || 'USD',
    total_estimate: payload?.total_items ? Number(payload.total_items) : null,
    items,
    next_cursor: hasMore ? serializeCursor({ page: page + 1 }) : null,
    has_more: hasMore,
    meta:
      payoutLike.length > 0
        ? { source: 'paypal.transactions' }
        : {
            source: 'paypal.transactions',
            note: 'Showing closest PayPal transaction equivalents to bank payouts.',
          },
  };
}

async function getPayPalPayoutDetail(params: { orgId: string; id: string; dateFrom: Date | null; dateTo: Date | null }) {
  const now = new Date();
  const from = params.dateFrom || new Date(now.getTime() - 180 * 86400000);
  const to = params.dateTo || now;

  const payload = await fetchPayPalTransactions({
    orgId: params.orgId,
    page: 1,
    limit: 200,
    dateFrom: from,
    dateTo: to,
  });

  const details = Array.isArray(payload?.transaction_details) ? payload.transaction_details : [];
  const raw = details.find((item) => String(item?.transaction_info?.transaction_id || '') === params.id);
  if (!raw) {
    const error = new Error('PayPal payout/transaction not found.');
    (error as any).status = 404;
    throw error;
  }

  const mapped = mapPayPalTransaction(raw);
  const feeCents = toCents(raw?.transaction_info?.fee_amount?.value || 0);
  return {
    provider: 'paypal',
    item: mapped,
    detail: {
      id: mapped.id,
      created: mapped.date,
      arrival_date: mapped.arrival_date,
      status: mapped.status,
      type: mapped.type,
      amount: mapped.net,
      currency: mapped.currency,
      method: mapped.method,
      fee_total: feeCents,
      payer_email: raw?.payer_info?.email_address || null,
      raw_ref: mapped.raw_ref,
    },
  };
}

async function getInvoiceForOrg(client: SupabaseClient, orgId: string, invoiceId: string) {
  const { data, error } = await client
    .from('invoices')
    .select('id,org_id,client_id,total_cents,paid_cents,balance_cents,status,currency,invoice_number,deleted_at')
    .eq('id', invoiceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function findExistingPaymentByIdentifiers(admin: SupabaseClient, input: PaymentInsertInput) {
  if (input.provider_event_id) {
    const { data, error } = await admin
      .from('payments')
      .select('id,status,provider_payment_id')
      .eq('org_id', input.org_id)
      .eq('provider', input.provider)
      .eq('provider_event_id', input.provider_event_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  if (input.provider_payment_id) {
    const { data, error } = await admin
      .from('payments')
      .select('id,status,provider_payment_id')
      .eq('org_id', input.org_id)
      .eq('provider', input.provider)
      .eq('provider_payment_id', input.provider_payment_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  return null;
}

async function createInvoicePaidNotification(input: {
  orgId: string;
  invoiceId?: string | null;
  paymentId?: string | null;
  title?: string | null;
}) {
  if (!input.orgId || !input.invoiceId) return;
  const admin = getServiceClient();
  const payload = {
    org_id: input.orgId,
    type: 'invoice_paid',
    ref_id: input.invoiceId,
    title: input.title || 'Invoice paid',
    body: `Invoice ${input.invoiceId} was paid.`,
    metadata: {
      invoice_id: input.invoiceId,
      payment_id: input.paymentId || null,
    },
  };

  const { error } = await admin.from('notifications').insert(payload);
  if (error) {
    // eslint-disable-next-line no-console
    console.error('notification_insert_failed', { code: error.code, message: error.message });
  }
}

async function insertOrUpdatePaymentIdempotent(input: PaymentInsertInput) {
  const admin = getServiceClient();
  const existing = await findExistingPaymentByIdentifiers(admin, input);

  if (existing) {
    if (existing.status !== input.status) {
      const { error: updateError } = await admin
        .from('payments')
        .update({
          status: input.status,
          method: input.method || null,
          provider_order_id: input.provider_order_id || null,
          payment_date: input.payment_date || new Date().toISOString(),
          amount_cents: input.amount_cents,
          currency: input.currency || 'CAD',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      if (updateError) throw updateError;
      if (input.status === 'succeeded' && input.invoice_id) {
        await createInvoicePaidNotification({
          orgId: input.org_id,
          invoiceId: input.invoice_id,
          paymentId: existing.id,
        });
      }
    }
    return { id: existing.id, inserted: false };
  }

  const insertPayload = {
    org_id: input.org_id,
    client_id: input.client_id || null,
    invoice_id: input.invoice_id || null,
    job_id: input.job_id || null,
    provider: input.provider,
    provider_payment_id: input.provider_payment_id || null,
    provider_order_id: input.provider_order_id || null,
    provider_event_id: input.provider_event_id || null,
    status: input.status,
    method: input.method || null,
    amount_cents: Math.max(0, Math.round(input.amount_cents || 0)),
    currency: (input.currency || 'CAD').toUpperCase(),
    payment_date: input.payment_date || new Date().toISOString(),
  };

  const { data, error } = await admin.from('payments').insert(insertPayload).select('id').single();

  if (error) {
    if (error.code === '23505') {
      const retry = await findExistingPaymentByIdentifiers(admin, input);
      if (retry) return { id: retry.id, inserted: false };
    }
    throw error;
  }

  if (input.status === 'succeeded' && input.invoice_id) {
    await createInvoicePaidNotification({
      orgId: input.org_id,
      invoiceId: input.invoice_id,
      paymentId: String(data.id),
    });
  }

  return { id: String(data.id), inserted: true };
}

async function getPayPalAccessToken(credentials?: { clientId: string; secret: string }) {
  const clientId = credentials?.clientId || process.env.PAYPAL_CLIENT_ID || '';
  const secret = credentials?.secret || process.env.PAYPAL_SECRET || '';

  if (!clientId || !secret) {
    throw new Error('Missing PayPal credentials');
  }

  const basicAuth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`PayPal auth failed (${response.status}): ${errorBody}`);
  }

  const payload = (await response.json()) as { access_token: string };
  return payload.access_token;
}
function parseCustomId(raw: unknown) {
  if (!raw) return { orgId: null, invoiceId: null, clientId: null, jobId: null };
  const str = String(raw);
  try {
    const parsed = JSON.parse(str) as Record<string, unknown>;
    return {
      orgId: String(parsed.org_id || '').trim() || null,
      invoiceId: String(parsed.invoice_id || '').trim() || null,
      clientId: String(parsed.client_id || '').trim() || null,
      jobId: String(parsed.job_id || '').trim() || null,
    };
  } catch {
    return { orgId: null, invoiceId: null, clientId: null, jobId: null };
  }
}

async function fetchPayPalOrder(accessToken: string, orderId: string) {
  const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch PayPal order (${response.status}): ${text}`);
  }

  return (await response.json()) as any;
}

async function verifyPayPalWebhookSignature(req: express.Request, body: any) {
  if (!paypalWebhookId) return false;

  const transmissionId = req.header('paypal-transmission-id') || '';
  const transmissionTime = req.header('paypal-transmission-time') || '';
  const certUrl = req.header('paypal-cert-url') || '';
  const authAlgo = req.header('paypal-auth-algo') || '';
  const transmissionSig = req.header('paypal-transmission-sig') || '';

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return false;
  }

  const accessToken = await getPayPalAccessToken();
  const verifyPayload = {
    auth_algo: authAlgo,
    cert_url: certUrl,
    transmission_id: transmissionId,
    transmission_sig: transmissionSig,
    transmission_time: transmissionTime,
    webhook_id: paypalWebhookId,
    webhook_event: body,
  };

  const response = await fetch(`${getPayPalBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(verifyPayload),
  });

  if (!response.ok) return false;

  const payload = (await response.json()) as { verification_status?: string };
  return payload.verification_status === 'SUCCESS';
}

async function createOrUpdatePayPalPaymentFromCapture(args: { capture: any; eventId?: string | null; orderId?: string | null; orderData?: any }) {
  const capture = args.capture || {};
  const captureId = String(capture.id || '').trim();
  const amount = capture.amount || {};
  const currency = String(amount.currency_code || 'CAD').toUpperCase();
  const amountCents = normalizeAmountToCents(amount.value);

  let orderData = args.orderData || null;
  if (!orderData && args.orderId) {
    const token = await getPayPalAccessToken();
    orderData = await fetchPayPalOrder(token, args.orderId);
  }

  const purchaseUnit = Array.isArray(orderData?.purchase_units) ? orderData.purchase_units[0] : null;
  const customId = parseCustomId(purchaseUnit?.custom_id || capture.custom_id);

  if (!customId.orgId || !customId.invoiceId) {
    throw new Error('PayPal capture is missing org_id or invoice_id in custom_id metadata.');
  }

  return insertOrUpdatePaymentIdempotent({
    org_id: customId.orgId,
    invoice_id: customId.invoiceId,
    client_id: customId.clientId,
    job_id: customId.jobId,
    provider: 'paypal',
    provider_payment_id: captureId || null,
    provider_order_id: args.orderId || String(orderData?.id || '') || null,
    provider_event_id: args.eventId || null,
    status: capture.status === 'COMPLETED' ? 'succeeded' : 'pending',
    method: capture.status === 'COMPLETED' ? 'card' : null,
    amount_cents: amountCents,
    currency,
    payment_date: capture.create_time || new Date().toISOString(),
  });
}

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  try {
    if (!stripeWebhookClient || !stripeWebhookSecret) {
      return res.status(503).json({ error: 'Stripe webhook is not configured.' });
    }

    const signature = req.header('stripe-signature');
    if (!signature) {
      return res.status(400).json({ error: 'Missing Stripe signature header.' });
    }

    const rawBody = req.body instanceof Buffer ? req.body : Buffer.from('');
    const event = stripeWebhookClient.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as Stripe.PaymentIntent;
      const metadata = parsePaymentMetadata(intent.metadata);
      if (metadata.orgId && metadata.invoiceId) {
        await insertOrUpdatePaymentIdempotent({
          org_id: metadata.orgId,
          invoice_id: metadata.invoiceId,
          client_id: metadata.clientId,
          job_id: metadata.jobId,
          provider: 'stripe',
          provider_payment_id: intent.id,
          provider_event_id: event.id,
          status: 'succeeded',
          method: intent.payment_method_types?.[0] === 'card' ? 'card' : null,
          amount_cents: Math.max(0, Math.round(intent.amount_received || intent.amount || 0)),
          currency: String(intent.currency || 'CAD').toUpperCase(),
          payment_date: new Date((intent.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        });
      }
    }

    return res.json({ received: true });
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || 'Stripe webhook handling failed.' });
  }
});

app.use(express.json({ limit: '512kb' }));
async function handleSuggestions(req: express.Request, res: express.Response) {
  const q = sanitizeQuery(String(req.query.q || ''));
  const limit = clampInt(req.query.limit, 8, 1, 8);

  if (!q) {
    return res.json({ query: q, items: [], grouped: { clients: [], jobs: [], leads: [] } });
  }

  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const { data, error } = await client.rpc('search_global', {
      p_org: orgId,
      p_q: q,
      p_limit: Math.max(24, limit),
      p_offset: 0,
    });

    if (error) throw error;

    const mapped = mapSearchRows((data || []) as SearchRow[]);
    const grouped = {
      clients: mapped.filter((item) => item.type === 'client').slice(0, limit),
      jobs: mapped.filter((item) => item.type === 'job').slice(0, limit),
      leads: mapped.filter((item) => item.type === 'lead').slice(0, limit),
    };

    const items = [...grouped.clients, ...grouped.jobs, ...grouped.leads]
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit);

    return res.json({ query: q, items, grouped });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Search suggestion request failed.' });
  }
}

app.get('/api/search', handleSuggestions);
app.get('/api/search/suggestions', handleSuggestions);

app.get('/api/search/results', async (req, res) => {
  const q = sanitizeQuery(String(req.query.q || ''));
  const tab = parseTab(req.query.tab);
  const pageSize = clampInt(req.query.pageSize, 20, 1, 20);

  if (!q) {
    return res.json({
      query: q,
      tab,
      counts: { clients: 0, jobs: 0, leads: 0, all: 0 },
      groups: {
        clients: emptyPage(pageSize),
        jobs: emptyPage(pageSize),
        leads: emptyPage(pageSize),
      },
    });
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
      const clientsPage = clampInt(req.query.clientsPage, 1, 1, 10_000);
      const jobsPage = clampInt(req.query.jobsPage, 1, 1, 10_000);
      const leadsPage = clampInt(req.query.leadsPage, 1, 1, 10_000);

      const [clients, jobs, leads] = await Promise.all([
        searchByType(client, orgId, q, 'client', pageSize, clientsPage, counts.clients),
        searchByType(client, orgId, q, 'job', pageSize, jobsPage, counts.jobs),
        searchByType(client, orgId, q, 'lead', pageSize, leadsPage, counts.leads),
      ]);

      return res.json({
        query: q,
        tab,
        counts,
        groups: { clients, jobs, leads },
      });
    }

    const page = clampInt(req.query.page, 1, 1, 10_000);
    const targetType = toEntityType(tab);
    const selectedTotal = tab === 'clients' ? counts.clients : tab === 'jobs' ? counts.jobs : counts.leads;
    const selectedGroup = await searchByType(client, orgId, q, targetType, pageSize, page, selectedTotal);

    return res.json({
      query: q,
      tab,
      counts,
      groups: {
        clients: tab === 'clients' ? selectedGroup : emptyPage(pageSize, counts.clients),
        jobs: tab === 'jobs' ? selectedGroup : emptyPage(pageSize, counts.jobs),
        leads: tab === 'leads' ? selectedGroup : emptyPage(pageSize, counts.leads),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Search results request failed.' });
  }
});

app.post('/api/geocode-job', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId, user } = auth;
    const jobId = String(req.body?.jobId || '').trim();
    if (!jobId) {
      return res.status(400).json({ error: 'Missing jobId' });
    }

    const limiterKey = `${orgId}:${user.id}`;
    if (!consumeGeocodeQuota(limiterKey)) {
      return res.status(429).json({ error: 'Too many geocode requests, please retry later.' });
    }

    const { data: jobRow, error: jobError } = await client
      .from('jobs')
      .select('id,org_id,property_address,address')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();

    if (jobError) throw jobError;
    if (!jobRow) return res.status(404).json({ error: 'Job not found' });

    const address = normalizeAddress((jobRow as any).property_address || (jobRow as any).address || '');
    if (!address) {
      const { error: updateError } = await client
        .from('jobs')
        .update({ geocode_status: 'failed', geocoded_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('org_id', orgId);
      if (updateError) throw updateError;
      return res.status(200).json({ ok: false, reason: 'missing_address' });
    }

    const geocoded = await geocodeAddress(address);
    if (!geocoded) {
      const { error: updateError } = await client
        .from('jobs')
        .update({ geocode_status: 'failed', geocoded_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('org_id', orgId);
      if (updateError) throw updateError;
      return res.status(200).json({ ok: false, reason: 'geocode_not_found' });
    }

    const { error: updateError } = await client
      .from('jobs')
      .update({
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
        geocode_status: 'ok',
        geocoded_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('org_id', orgId);

    if (updateError) throw updateError;

    return res.status(200).json({
      ok: true,
      provider: geocoded.provider,
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Geocoding failed' });
  }
});

app.post('/api/leads/create', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const fullName = String(req.body?.full_name || '').trim();
    const email = String(req.body?.email || '').trim() || null;
    const phone = String(req.body?.phone || '').trim() || null;
    const title = String(req.body?.title || '').trim() || null;
    const notes = String(req.body?.notes || '').trim() || null;
    const value = Number(req.body?.value || 0);
    const address = String(req.body?.address || '').trim() || null;
    // eslint-disable-next-line no-console
    console.info('lead_create_request', {
      orgId: requestedOrgId,
      userId: auth.user.id,
      stage: 'new',
      hasEmail: Boolean(email),
      nameLen: fullName.length,
    });

    if (!fullName) return res.status(400).json({ error: 'full_name is required.' });

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can create leads.' });

    const { data, error } = await auth.client.rpc('create_lead_and_deal', {
      p_full_name: fullName,
      p_email: email,
      p_address: address,
      p_phone: phone,
      p_title: title,
      p_value: Number.isFinite(value) ? value : 0,
      p_notes: notes,
      p_org_id: requestedOrgId,
    });
    if (error) throw error;

    const leadId = String((data as any)?.lead_id || '').trim();
    if (!leadId) throw new Error('Lead created but lead_id is missing.');
    const rpcDealId = String((data as any)?.deal_id || '').trim() || null;

    let ensuredDealId = rpcDealId;
    try {
      const ensured = await ensureLeadInPipeline({
        client: auth.client,
        orgId: requestedOrgId,
        leadId,
        title,
        value: Number.isFinite(value) ? value : 0,
        notes,
      });
      ensuredDealId = ensured || ensuredDealId;
    } catch (dealError: any) {
      // eslint-disable-next-line no-console
      console.error('lead_pipeline_ensure_failed', {
        orgId: requestedOrgId,
        leadId,
        code: String(dealError?.code || ''),
        message: String(dealError?.message || 'unknown'),
      });
    }

    if (address) {
      const { error: addressError } = await auth.client
        .from('leads')
        .update({ address })
        .eq('id', leadId)
        .eq('org_id', requestedOrgId);
      if (addressError) {
        // eslint-disable-next-line no-console
        console.error('lead_address_update_failed', { orgId: requestedOrgId, userId: auth.user.id, leadId, code: addressError.code });
      }
    }

    const { data: leadRow, error: leadError } = await auth.client
      .from('leads_active')
      .select('*')
      .eq('id', leadId)
      .maybeSingle();
    if (leadError) throw leadError;

    // eslint-disable-next-line no-console
    console.info('lead_create_result', {
      orgId: requestedOrgId,
      userId: auth.user.id,
      leadId,
      dealId: ensuredDealId,
      rowFound: Boolean(leadRow?.id),
    });

    return res.status(200).json({
      lead: leadRow,
      deal_id: ensuredDealId,
      lead_id: leadId,
      job_id: (data as any)?.job_id || null,
    });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('lead_create_failed', {
      code: String(error?.code || ''),
      message: String(error?.message || 'unknown'),
    });
    const code = String(error?.code || '');
    if (code === '42501') return res.status(403).json({ error: error?.message || 'Forbidden.' });
    if (code === '23514' || code === '23505' || code === '22023') return res.status(400).json({ error: error?.message || 'Invalid lead payload.' });
    return res.status(500).json({ error: error?.message || 'Unable to create lead.' });
  }
});

app.post('/api/leads/soft-delete', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const leadId = String(req.body?.leadId || '').trim();
    if (!leadId) return res.status(400).json({ error: 'leadId is required.' });

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can delete leads.' });

    const { data, error } = await auth.client.rpc('soft_delete_lead', {
      p_org_id: requestedOrgId,
      p_lead_id: leadId,
    });
    if (error) throw error;

    return res.status(200).json({ ok: true, result: data });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('lead_soft_delete_failed', {
      code: String(error?.code || ''),
      message: String(error?.message || 'unknown'),
    });
    const code = String(error?.code || '');
    if (code === '42501') return res.status(403).json({ error: error?.message || 'Forbidden.' });
    if (code === 'P0002') return res.status(404).json({ error: error?.message || 'Lead not found.' });
    if (code === '23514') return res.status(409).json({ error: error?.message || 'Lead state is invalid for delete.' });
    return res.status(500).json({ error: error?.message || 'Unable to delete lead.' });
  }
});

app.post('/api/invoices/from-job', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const jobId = String(req.body?.jobId || '').trim();
    const sendNow = Boolean(req.body?.sendNow);

    if (!jobId) {
      return res.status(400).json({ error: 'Missing jobId.' });
    }

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) {
      return res.status(403).json({ error: 'Only owner/admin can create an invoice from a job.' });
    }

    const { data, error } = await auth.client.rpc('create_invoice_from_job', {
      p_org_id: requestedOrgId,
      p_job_id: jobId,
      p_send_now: sendNow,
    });
    if (error) throw error;

    const payload = Array.isArray(data) ? data[0] : data;
    const invoiceId = String((payload as any)?.invoice_id || '').trim();
    const alreadyExists = Boolean((payload as any)?.already_exists);
    const status = String((payload as any)?.status || '').trim() || (sendNow ? 'sent' : 'draft');

    if (!invoiceId) {
      return res.status(500).json({ error: 'Invoice creation succeeded but invoice_id is missing.' });
    }

    const { data: invoiceRow, error: invoiceError } = await auth.client
      .from('invoices')
      .select('id,invoice_number,status,client_id,job_id,total_cents,balance_cents,currency,updated_at')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceError) throw invoiceError;

    return res.json({
      invoice: invoiceRow || { id: invoiceId, status },
      invoice_id: invoiceId,
      already_exists: alreadyExists,
      status,
    });
  } catch (error: any) {
    const code = String(error?.code || '');
    if (code === '42501') return res.status(403).json({ error: error?.message || 'Forbidden.' });
    if (code === 'P0002') return res.status(404).json({ error: error?.message || 'Job not found.' });
    if (code === '23514') return res.status(400).json({ error: error?.message || 'Job must be linked to a client.' });
    if (code === '23505') return res.status(409).json({ error: 'An active invoice already exists for this job.' });
    return res.status(500).json({ error: error?.message || 'Unable to create invoice from job.' });
  }
});

app.get('/api/payments/settings', async (req, res) => {
  let fallbackOrgId = parseOrgId(req.query.orgId) || null;
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    fallbackOrgId = requestedOrgId;
    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) {
      return res.status(403).json({ error: 'You are not a member of this organization.' });
    }

    await ensurePaymentSettingsRow(auth.client, requestedOrgId);
    const settings = await getPaymentProviderSettings(auth.client, requestedOrgId);
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);

    return res.json({
      settings,
      permissions: { can_manage: canManage },
    });
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    const shouldFallback =
      isSchemaNotReadyError(error) ||
      message.includes('payment_provider_settings') ||
      message.includes('payment_provider_secrets') ||
      message.includes('ensure_payment_settings_row');

    if (shouldFallback && fallbackOrgId) {
      return res.json({
        settings: defaultPaymentSettings(fallbackOrgId),
        permissions: { can_manage: false },
        warning: 'Payments settings schema is not fully applied yet.',
      });
    }
    return res.status(500).json({ error: error?.message || 'Unable to load payment settings.' });
  }
});

app.post('/api/payments/keys', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const provider = String(req.body?.provider || '').trim().toLowerCase();
    if (provider !== 'stripe' && provider !== 'paypal') {
      return res.status(400).json({ error: 'provider must be stripe or paypal.' });
    }

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'You are not a member of this organization.' });

    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can save payment keys.' });

    await ensurePaymentSettingsRow(auth.client, requestedOrgId);
    const result = await saveProviderKeys({
      client: auth.client,
      orgId: requestedOrgId,
      provider,
      body: req.body,
    });

    return res.json({ ok: true, provider: result.provider, keysPresent: result.keysPresent });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unable to save payment keys.' });
  }
});

app.post('/api/payments/settings', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const action = String(req.body?.action || '').trim();
    const provider = String(req.body?.provider || '').trim().toLowerCase();
    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;

    if (!action) return res.status(400).json({ error: 'Missing action.' });

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'You are not a member of this organization.' });

    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can update payment settings.' });

    await ensurePaymentSettingsRow(auth.client, requestedOrgId);

    if (action === 'save_keys') {
      try {
        await saveProviderKeys({
          client: auth.client,
          orgId: requestedOrgId,
          provider,
          body: req.body,
        });
      } catch (error: any) {
        return res.status(400).json({ error: error?.message || 'Unable to save provider keys.' });
      }
    } else if (action === 'toggle_enabled') {
      if (provider !== 'stripe' && provider !== 'paypal') {
        return res.status(400).json({ error: 'Provider must be stripe or paypal.' });
      }

      if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean.' });
      }

      const enabled = Boolean(req.body.enabled);
      const current = await getPaymentProviderSettings(auth.client, requestedOrgId);

      if (provider === 'stripe' && enabled && !current.stripe_keys_present) {
        return res.status(400).json({ error: 'Stripe keys are missing. Save keys before enabling.' });
      }
      if (provider === 'paypal' && enabled && !current.paypal_keys_present) {
        return res.status(400).json({ error: 'PayPal keys are missing. Save keys before enabling.' });
      }

      const nextDefault =
        !enabled && current.default_provider === provider
          ? 'none'
          : current.default_provider;

      const patch =
        provider === 'stripe'
          ? { stripe_enabled: enabled, default_provider: nextDefault, updated_at: new Date().toISOString() }
          : { paypal_enabled: enabled, default_provider: nextDefault, updated_at: new Date().toISOString() };

      const { error: settingsError } = await auth.client
        .from('payment_provider_settings')
        .update(patch)
        .eq('org_id', requestedOrgId);
      if (settingsError) throw settingsError;
    } else if (action === 'set_default') {
      const defaultProvider = normalizeDefaultProvider(req.body?.defaultProvider ?? req.body?.default_provider);
      if (!isValidDefaultProvider(defaultProvider)) {
        return res.status(400).json({ error: 'Invalid default provider value.' });
      }

      const current = await getPaymentProviderSettings(auth.client, requestedOrgId);

      if (defaultProvider === 'stripe') {
        if (!current.stripe_enabled || !current.stripe_keys_present) {
          return res.status(400).json({ error: 'Stripe must be enabled and configured before setting as default.' });
        }
      }

      if (defaultProvider === 'paypal') {
        if (!current.paypal_enabled || !current.paypal_keys_present) {
          return res.status(400).json({ error: 'PayPal must be enabled and configured before setting as default.' });
        }
      }

      const { error: settingsError } = await auth.client
        .from('payment_provider_settings')
        .update({ default_provider: defaultProvider, updated_at: new Date().toISOString() })
        .eq('org_id', requestedOrgId);
      if (settingsError) throw settingsError;
    } else {
      return res.status(400).json({ error: 'Unsupported action.' });
    }

    const settings = await getPaymentProviderSettings(auth.client, requestedOrgId);
    return res.json({ settings });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unable to update payment settings.' });
  }
});

app.get('/api/payments/payouts/summary', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    const requestedProvider = parsePayoutProvider(req.query.provider);
    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const { provider } = await resolvePayoutProvider({
      client: auth.client,
      orgId: requestedOrgId,
      requestedProvider,
    });

    if (provider === 'stripe') {
      const summary = await buildStripePayoutSummary(requestedOrgId);
      return res.json(summary);
    }

    const summary = await buildPayPalPayoutSummary(requestedOrgId);
    return res.json(summary);
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Unable to load payout summary.' });
  }
});

app.get('/api/payments/payouts/list', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    const requestedProvider = parsePayoutProvider(req.query.provider);
    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const { provider } = await resolvePayoutProvider({
      client: auth.client,
      orgId: requestedOrgId,
      requestedProvider,
    });

    const limit = clampInt(req.query.limit, 25, 1, 100);
    const cursor = String(req.query.cursor || '').trim() || null;
    const method = String(req.query.method || '').trim().toLowerCase() || null;
    const dateFrom = parseDateParam(req.query.date_from);
    const dateTo = parseDateParam(req.query.date_to);

    if (provider === 'stripe') {
      const list = await listStripePayouts({
        orgId: requestedOrgId,
        limit,
        cursor,
        dateFrom,
        dateTo,
        method,
      });
      return res.json(list);
    }

    const list = await listPayPalPayouts({
      orgId: requestedOrgId,
      limit,
      cursor,
      dateFrom,
      dateTo,
      method,
    });
    return res.json(list);
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Unable to load payouts list.' });
  }
});

app.get('/api/payments/payouts/detail', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    const requestedProvider = parsePayoutProvider(req.query.provider);
    const payoutId = String(req.query.id || '').trim();
    if (!payoutId) return res.status(400).json({ error: 'Missing payout id.' });

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const { provider } = await resolvePayoutProvider({
      client: auth.client,
      orgId: requestedOrgId,
      requestedProvider,
    });

    if (provider === 'stripe') {
      const detail = await getStripePayoutDetail(requestedOrgId, payoutId);
      return res.json(detail);
    }

    const detail = await getPayPalPayoutDetail({
      orgId: requestedOrgId,
      id: payoutId,
      dateFrom: parseDateParam(req.query.date_from),
      dateTo: parseDateParam(req.query.date_to),
    });
    return res.json(detail);
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Unable to load payout detail.' });
  }
});

app.post('/api/payments/payouts/email-csv', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const requestedProvider = parsePayoutProvider(req.body?.provider);
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can export payouts CSV.' });

    const { provider } = await resolvePayoutProvider({
      client: auth.client,
      orgId: requestedOrgId,
      requestedProvider,
    });

    const filters = req.body?.filters || {};
    const limit = 100;
    const method = String(filters?.method || 'all').toLowerCase();
    const dateFrom = parseDateParam(filters?.date_from);
    const dateTo = parseDateParam(filters?.date_to);

    let items: PayoutListItem[] = [];
    if (provider === 'stripe') {
      let cursor: string | null = null;
      for (let i = 0; i < 10; i += 1) {
        const page = await listStripePayouts({
          orgId: requestedOrgId,
          limit,
          cursor,
          dateFrom,
          dateTo,
          method,
        });
        items = items.concat(page.items);
        if (!page.has_more || !page.next_cursor) break;
        cursor = page.next_cursor;
      }
    } else {
      let cursor: string | null = serializeCursor({ page: 1 });
      for (let i = 0; i < 10; i += 1) {
        const page = await listPayPalPayouts({
          orgId: requestedOrgId,
          limit,
          cursor,
          dateFrom,
          dateTo,
          method,
        });
        items = items.concat(page.items);
        if (!page.has_more || !page.next_cursor) break;
        cursor = page.next_cursor;
      }
    }

    const header = ['Date', 'Type', 'Status', 'Net', 'Currency', 'Id'];
    const lines = items.map((item) =>
      [
        csvEscape(item.date),
        csvEscape(item.type),
        csvEscape(item.status),
        csvEscape((Number(item.net || 0) / 100).toFixed(2)),
        csvEscape(item.currency),
        csvEscape(item.id),
      ].join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payouts-${provider}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(csv);
  } catch (error: any) {
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error?.message || 'Unable to export payouts CSV.' });
  }
});

// Compatibility for existing callers.
app.get('/api/payments/providers/status', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const requestedOrgId = parseOrgId(req.query.orgId) || auth.orgId;
    const settings = await getPaymentProviderSettings(auth.client, requestedOrgId);
    const baseUrl = resolvePublicBaseUrl(req);

    return res.json({
      settings,
      environment: {
        stripe_configured: settings.stripe_keys_present,
        stripe_webhook_configured: Boolean(stripeWebhookSecret),
        paypal_configured: settings.paypal_keys_present,
        paypal_webhook_configured: Boolean(paypalWebhookId),
        paypal_env: paypalEnv,
      },
      public_keys: {
        stripe_publishable_key: settings.stripe_publishable_key,
        paypal_client_id: settings.paypal_client_id,
      },
      webhook_urls: {
        stripe: `${baseUrl}/api/webhooks/stripe`,
        paypal: `${baseUrl}/api/webhooks/paypal`,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unable to load provider status.' });
  }
});

app.post('/api/payments/providers/settings', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can update payment settings.' });

    await ensurePaymentSettingsRow(auth.client, requestedOrgId);
    const current = await getPaymentProviderSettings(auth.client, requestedOrgId);

    const stripeEnabled = req.body?.stripe_enabled == null ? current.stripe_enabled : Boolean(req.body.stripe_enabled);
    const paypalEnabled = req.body?.paypal_enabled == null ? current.paypal_enabled : Boolean(req.body.paypal_enabled);
    const nextDefault = normalizeDefaultProvider(req.body?.default_provider ?? current.default_provider);

    if (stripeEnabled && !current.stripe_keys_present) {
      return res.status(400).json({ error: 'Stripe keys are missing. Save keys before enabling.' });
    }
    if (paypalEnabled && !current.paypal_keys_present) {
      return res.status(400).json({ error: 'PayPal keys are missing. Save keys before enabling.' });
    }
    if (nextDefault === 'stripe' && !stripeEnabled) {
      return res.status(400).json({ error: 'Stripe must be enabled before setting default.' });
    }
    if (nextDefault === 'paypal' && !paypalEnabled) {
      return res.status(400).json({ error: 'PayPal must be enabled before setting default.' });
    }

    const { error } = await auth.client
      .from('payment_provider_settings')
      .update({
        stripe_enabled: stripeEnabled,
        paypal_enabled: paypalEnabled,
        default_provider: nextDefault,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', requestedOrgId);
    if (error) throw error;

    const updated = await getPaymentProviderSettings(auth.client, requestedOrgId);
    return res.json({ settings: updated });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unable to update provider settings.' });
  }
});

app.post('/api/payments/stripe/create-intent', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId.' });

    const settings = await getPaymentProviderSettings(client, orgId);
    if (!settings.stripe_enabled || !settings.stripe_keys_present) {
      return res.status(400).json({ error: 'Stripe provider is disabled or not configured for this organization.' });
    }

    if (!supabaseServiceRoleKey) {
      return res.status(503).json({
        error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. Stripe payment is temporarily unavailable.',
      });
    }

    const secrets = await getPaymentProviderSecrets(orgId);
    if (!secrets.stripe_secret_key || !secrets.stripe_publishable_key) {
      return res.status(400).json({ error: 'Stripe keys are not configured.' });
    }

    const invoice = await getInvoiceForOrg(client, orgId, invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const balanceCents = Number(invoice.balance_cents || 0);
    if (balanceCents <= 0) return res.status(400).json({ error: 'Invoice has no balance to pay.' });

    const stripeClient = new Stripe(secrets.stripe_secret_key);
    const currency = String(invoice.currency || 'CAD').toLowerCase();
    const intent = await stripeClient.paymentIntents.create({
      amount: balanceCents,
      currency,
      payment_method_types: ['card'],
      metadata: {
        org_id: orgId,
        invoice_id: invoiceId,
        client_id: invoice.client_id || '',
      },
    });

    return res.json({
      payment_intent_id: intent.id,
      client_secret: intent.client_secret,
      amount_cents: balanceCents,
      currency: currency.toUpperCase(),
      publishable_key: secrets.stripe_publishable_key,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unable to create Stripe payment intent.' });
  }
});

app.post('/api/payments/paypal/create-order', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const invoiceId = String(req.body?.invoiceId || '').trim();
    if (!invoiceId) return res.status(400).json({ error: 'Missing invoiceId.' });

    const settings = await getPaymentProviderSettings(client, orgId);
    if (!settings.paypal_enabled || !settings.paypal_keys_present) {
      return res.status(400).json({ error: 'PayPal provider is disabled or not configured for this organization.' });
    }

    if (!supabaseServiceRoleKey) {
      return res.status(503).json({
        error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. PayPal payment is temporarily unavailable.',
      });
    }

    const secrets = await getPaymentProviderSecrets(orgId);
    if (!secrets.paypal_client_id || !secrets.paypal_secret) {
      return res.status(400).json({ error: 'PayPal keys are not configured.' });
    }

    const invoice = await getInvoiceForOrg(client, orgId, invoiceId);
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const balanceCents = Number(invoice.balance_cents || 0);
    if (balanceCents <= 0) return res.status(400).json({ error: 'Invoice has no balance to pay.' });

    const token = await getPayPalAccessToken({ clientId: secrets.paypal_client_id, secret: secrets.paypal_secret });
    const currency = String(invoice.currency || 'CAD').toUpperCase();
    const amountValue = (balanceCents / 100).toFixed(2);
    const customId = JSON.stringify({ org_id: orgId, invoice_id: invoiceId, client_id: invoice.client_id || null });

    const createResponse = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ reference_id: invoiceId, custom_id: customId, amount: { currency_code: currency, value: amountValue } }],
      }),
    });

    if (!createResponse.ok) {
      const text = await createResponse.text();
      throw new Error(`PayPal create order failed (${createResponse.status}): ${text}`);
    }

    const order = (await createResponse.json()) as any;
    const approveUrl = Array.isArray(order.links) ? order.links.find((link: any) => link.rel === 'approve')?.href || null : null;

    return res.json({
      order_id: order.id,
      approve_url: approveUrl,
      paypal_client_id: secrets.paypal_client_id,
      amount_cents: balanceCents,
      currency,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unable to create PayPal order.' });
  }
});

app.post('/api/payments/paypal/capture-order', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { client, orgId } = auth;
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'Missing orderId.' });

    const settings = await getPaymentProviderSettings(client, orgId);
    if (!settings.paypal_enabled || !settings.paypal_keys_present) {
      return res.status(400).json({ error: 'PayPal provider is disabled or not configured for this organization.' });
    }

    if (!supabaseServiceRoleKey) {
      return res.status(503).json({
        error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY. PayPal capture is temporarily unavailable.',
      });
    }

    const secrets = await getPaymentProviderSecrets(orgId);
    if (!secrets.paypal_client_id || !secrets.paypal_secret) {
      return res.status(400).json({ error: 'PayPal keys are not configured.' });
    }

    const token = await getPayPalAccessToken({ clientId: secrets.paypal_client_id, secret: secrets.paypal_secret });
    const captureResponse = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const captureBody = (await captureResponse.json()) as any;
    if (!captureResponse.ok) {
      throw new Error(`PayPal capture failed (${captureResponse.status}): ${JSON.stringify(captureBody)}`);
    }

    const purchaseUnit = Array.isArray(captureBody?.purchase_units) ? captureBody.purchase_units[0] : null;
    const capture = purchaseUnit?.payments?.captures?.[0] || null;
    if (!capture) throw new Error('PayPal capture response missing capture details.');

    const custom = parseCustomId(purchaseUnit?.custom_id);
    if (custom.orgId && custom.orgId !== orgId) {
      return res.status(403).json({ error: 'Order does not belong to your organization.' });
    }

    const result = await createOrUpdatePayPalPaymentFromCapture({ capture, orderId, orderData: captureBody, eventId: null });
    return res.json({ ok: true, payment_id: result.id });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unable to capture PayPal order.' });
  }
});

app.post('/api/webhooks/paypal', async (req, res) => {
  try {
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_SECRET || !paypalWebhookId) {
      return res.status(503).json({ error: 'PayPal webhook is not configured.' });
    }

    const isVerified = await verifyPayPalWebhookSignature(req, req.body);
    if (!isVerified) return res.status(400).json({ error: 'Invalid PayPal webhook signature.' });

    const event = req.body || {};
    const eventType = String(event.event_type || '');
    const eventId = String(event.id || '').trim() || null;

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const capture = event.resource || {};
      const orderId = String(capture?.supplementary_data?.related_ids?.order_id || '').trim() || null;
      await createOrUpdatePayPalPaymentFromCapture({ capture, eventId, orderId });
    }

    return res.json({ received: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'PayPal webhook handling failed.' });
  }
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
