import { supabase } from './supabase';
import { PaymentMethod, PaymentStatus } from '../types';

export type PaymentsTab = 'overview' | 'payouts';

export type PaymentStatusFilter = 'all' | PaymentStatus;
export type PaymentMethodFilter = 'all' | PaymentMethod;
export type PaymentDateFilter = 'all' | '30d' | 'this_month' | 'custom';

export type EnabledProvider = 'stripe' | 'paypal';
export type DefaultProvider = 'none' | EnabledProvider;

export interface PaymentProviderSettings {
  org_id: string;
  default_provider: DefaultProvider;
  stripe_enabled: boolean;
  paypal_enabled: boolean;
  stripe_keys_present: boolean;
  paypal_keys_present: boolean;
  stripe_publishable_key: string | null;
  paypal_client_id: string | null;
  updated_at: string | null;
}

export interface PaymentSettingsResponse {
  settings: PaymentProviderSettings;
  permissions: {
    can_manage: boolean;
  };
}

export interface PaymentsOverview {
  available_funds_cents: number;
  invoice_payment_time_days_30d: number;
  paid_on_time_global_pct_60d: number;
  paid_on_time_residential_pct_60d: number | null;
  paid_on_time_commercial_pct_60d: number | null;
  has_property_split: boolean;
}

export interface PaymentListRow {
  id: string;
  client_id: string | null;
  client_name: string;
  invoice_id: string | null;
  invoice_number: string | null;
  payment_date: string;
  payout_date: string | null;
  status: PaymentStatus;
  method: PaymentMethod | null;
  amount_cents: number;
  currency: string;
}

export interface ListPaymentsQuery {
  status: PaymentStatusFilter;
  method: PaymentMethodFilter;
  date: PaymentDateFilter;
  q: string;
  page: number;
  pageSize: number;
  fromDate?: string | null;
  toDate?: string | null;
}

export interface ListPaymentsResult {
  rows: PaymentListRow[];
  total: number;
}

export interface StripeIntentResponse {
  payment_intent_id: string;
  client_secret: string;
  amount_cents: number;
  currency: string;
  publishable_key: string | null;
}

export interface PayPalOrderResponse {
  order_id: string;
  approve_url: string | null;
  paypal_client_id: string | null;
  amount_cents: number;
  currency: string;
}

export type PayoutProvider = 'stripe' | 'paypal';

export interface PayoutSummary {
  provider: PayoutProvider;
  currency: string;
  available: number;
  on_the_way: number;
  deposited_week: number;
  deposited_month: number;
  meta?: {
    source: string;
    note?: string;
  };
}

export interface PayoutListItem {
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

export interface PayoutListResponse {
  provider: PayoutProvider;
  currency: string;
  total_estimate: number | null;
  items: PayoutListItem[];
  next_cursor: string | null;
  has_more: boolean;
  meta?: {
    source: string;
    note?: string;
  };
}

export interface PayoutDetailResponse {
  provider: PayoutProvider;
  item: PayoutListItem;
  detail: Record<string, unknown>;
}

function cleanNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

async function getAuthHeaders(extra?: Record<string, string>) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('You need to be authenticated for this action.');
  }

  return {
    Authorization: `Bearer ${token}`,
    ...(extra || {}),
  };
}

async function fetchApiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status}).`);
  }

  return payload as T;
}

export function formatMoneyFromCents(cents: number, currency = 'CAD', locale?: string) {
  const resolvedLocale = locale ?? (currency === 'CAD' ? 'en-CA' : 'en-US');
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((Number(cents || 0)) / 100);
}

export function paymentStatusLabel(status: string) {
  if (status === 'succeeded') return 'Succeeded';
  if (status === 'pending') return 'Pending';
  if (status === 'failed') return 'Failed';
  if (status === 'refunded') return 'Refunded';
  return status;
}

export function paymentMethodLabel(method: string | null) {
  if (!method) return 'Unknown';
  if (method === 'card') return 'Card';
  if (method === 'e-transfer') return 'e-Transfer';
  if (method === 'cash') return 'Cash';
  if (method === 'check') return 'Check';
  return method;
}

export async function fetchPaymentsOverview(): Promise<PaymentsOverview> {
  const { data, error } = await supabase.rpc('rpc_payments_overview_kpis', {
    p_org: null,
    p_now: new Date().toISOString(),
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    available_funds_cents: cleanNumber(row?.available_funds_cents, 0),
    invoice_payment_time_days_30d: cleanNumber(row?.invoice_payment_time_days_30d, 0),
    paid_on_time_global_pct_60d: cleanNumber(row?.paid_on_time_global_pct_60d, 0),
    paid_on_time_residential_pct_60d:
      row?.paid_on_time_residential_pct_60d == null ? null : cleanNumber(row.paid_on_time_residential_pct_60d, 0),
    paid_on_time_commercial_pct_60d:
      row?.paid_on_time_commercial_pct_60d == null ? null : cleanNumber(row.paid_on_time_commercial_pct_60d, 0),
    has_property_split: Boolean(row?.has_segment_split),
  };
}

export async function listPayments(query: ListPaymentsQuery): Promise<ListPaymentsResult> {
  const { data, error } = await supabase.rpc('rpc_list_payments', {
    p_status: query.status,
    p_method: query.method,
    p_date: query.date,
    p_q: query.q.trim() || null,
    p_from: query.date === 'custom' ? query.fromDate || null : null,
    p_to: query.date === 'custom' ? query.toDate || null : null,
    p_limit: query.pageSize,
    p_offset: (query.page - 1) * query.pageSize,
    p_org: null,
  });

  if (error) throw error;

  const rows = (data || []) as Array<PaymentListRow & { total_count: number }>;
  return {
    rows: rows.map((row) => ({
      id: row.id,
      client_id: row.client_id || null,
      client_name: row.client_name || 'Unknown client',
      invoice_id: row.invoice_id || null,
      invoice_number: row.invoice_number || null,
      payment_date: row.payment_date,
      payout_date: row.payout_date || null,
      status: (row.status || 'pending') as PaymentStatus,
      method: (row.method || null) as PaymentMethod | null,
      amount_cents: cleanNumber(row.amount_cents, 0),
      currency: row.currency || 'CAD',
    })),
    total: rows.length > 0 ? cleanNumber(rows[0].total_count, 0) : 0,
  };
}

export async function fetchPaymentSettings(orgId?: string): Promise<PaymentSettingsResponse> {
  const params = new URLSearchParams();
  if (orgId) params.set('orgId', orgId);
  const suffix = params.toString() ? `?${params.toString()}` : '';

  try {
    return await fetchApiJson<PaymentSettingsResponse>(`/api/payments/settings${suffix}`, {
      method: 'GET',
    });
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('request failed (500)') || message.includes('payment_provider_')) {
      const fallbackOrgId = orgId || 'unknown-org';
      return {
        settings: {
          org_id: fallbackOrgId,
          default_provider: 'none',
          stripe_enabled: false,
          paypal_enabled: false,
          stripe_keys_present: false,
          paypal_keys_present: false,
          stripe_publishable_key: null,
          paypal_client_id: null,
          updated_at: null,
        },
        permissions: {
          can_manage: false,
        },
      };
    }
    throw error;
  }
}

async function postPaymentSettingsAction(payload: Record<string, unknown>) {
  return fetchApiJson<{ settings: PaymentProviderSettings }>('/api/payments/settings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function postPaymentKeys(payload: Record<string, unknown>) {
  return fetchApiJson<{ ok: boolean; provider: 'stripe' | 'paypal'; keysPresent: boolean }>('/api/payments/keys', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function saveStripeKeys(input: {
  orgId?: string;
  stripePublishableKey: string;
  stripeSecretKey: string;
}) {
  return postPaymentKeys({
    orgId: input.orgId,
    provider: 'stripe',
    keys: {
      publishableKey: input.stripePublishableKey,
      secretKey: input.stripeSecretKey,
    },
  });
}

export async function savePayPalKeys(input: {
  orgId?: string;
  paypalClientId: string;
  paypalSecret: string;
}) {
  return postPaymentKeys({
    orgId: input.orgId,
    provider: 'paypal',
    keys: {
      clientId: input.paypalClientId,
      secret: input.paypalSecret,
    },
  });
}

export async function toggleProviderEnabled(input: {
  orgId?: string;
  provider: EnabledProvider;
  enabled: boolean;
}) {
  return postPaymentSettingsAction({
    orgId: input.orgId,
    provider: input.provider,
    action: 'toggle_enabled',
    enabled: input.enabled,
  });
}

export async function setDefaultProvider(input: {
  orgId?: string;
  defaultProvider: DefaultProvider;
}) {
  return postPaymentSettingsAction({
    orgId: input.orgId,
    action: 'set_default',
    defaultProvider: input.defaultProvider,
  });
}

export async function createStripeIntent(invoiceId: string) {
  return fetchApiJson<StripeIntentResponse>('/api/payments/stripe/create-intent', {
    method: 'POST',
    body: JSON.stringify({ invoiceId }),
  });
}

export async function createPayPalOrder(invoiceId: string) {
  return fetchApiJson<PayPalOrderResponse>('/api/payments/paypal/create-order', {
    method: 'POST',
    body: JSON.stringify({ invoiceId }),
  });
}

export async function capturePayPalOrder(orderId: string) {
  return fetchApiJson<{ ok: boolean; payment_id: string }>('/api/payments/paypal/capture-order', {
    method: 'POST',
    body: JSON.stringify({ orderId }),
  });
}

export async function fetchPayoutSummary(input: { orgId: string; provider?: PayoutProvider | null }) {
  const params = new URLSearchParams();
  params.set('orgId', input.orgId);
  if (input.provider) params.set('provider', input.provider);
  return fetchApiJson<PayoutSummary>(`/api/payments/payouts/summary?${params.toString()}`, {
    method: 'GET',
  });
}

export async function fetchPayoutList(input: {
  orgId: string;
  provider?: PayoutProvider | null;
  limit?: number;
  cursor?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  method?: string | null;
}) {
  const params = new URLSearchParams();
  params.set('orgId', input.orgId);
  if (input.provider) params.set('provider', input.provider);
  if (input.limit) params.set('limit', String(input.limit));
  if (input.cursor) params.set('cursor', input.cursor);
  if (input.dateFrom) params.set('date_from', input.dateFrom);
  if (input.dateTo) params.set('date_to', input.dateTo);
  if (input.method) params.set('method', input.method);

  return fetchApiJson<PayoutListResponse>(`/api/payments/payouts/list?${params.toString()}`, {
    method: 'GET',
  });
}

export async function fetchPayoutDetail(input: {
  orgId: string;
  provider?: PayoutProvider | null;
  id: string;
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  const params = new URLSearchParams();
  params.set('orgId', input.orgId);
  if (input.provider) params.set('provider', input.provider);
  params.set('id', input.id);
  if (input.dateFrom) params.set('date_from', input.dateFrom);
  if (input.dateTo) params.set('date_to', input.dateTo);

  return fetchApiJson<PayoutDetailResponse>(`/api/payments/payouts/detail?${params.toString()}`, {
    method: 'GET',
  });
}

export async function downloadPayoutCsv(input: {
  orgId: string;
  provider?: PayoutProvider | null;
  filters?: {
    method?: string | null;
    date_from?: string | null;
    date_to?: string | null;
  };
}) {
  const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch('/api/payments/payouts/email-csv', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `Request failed (${response.status}).`);
  }

  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const fileNameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
  const fileName = fileNameMatch?.[1] || `payouts-${new Date().toISOString().slice(0, 10)}.csv`;
  return { blob, fileName };
}

// Stripe transactions types and fetchers
export interface StripeTransaction {
  id: string;
  amount_cents: number;
  currency: string;
  status: string;
  customer_email: string | null;
  customer_name: string | null;
  description: string | null;
  payment_method: string | null;
  created_at: string;
  receipt_url: string | null;
}

export interface StripeTransactionsResponse {
  transactions: StripeTransaction[];
  has_more: boolean;
  total_count: number;
}

export interface StripeBalanceResponse {
  available: Array<{ amount: number; currency: string }>;
  pending: Array<{ amount: number; currency: string }>;
}

export async function fetchStripeTransactions(limit = 25, startingAfter?: string): Promise<StripeTransactionsResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (startingAfter) params.set('starting_after', startingAfter);
  return fetchApiJson<StripeTransactionsResponse>(`/api/payments/stripe/transactions?${params.toString()}`);
}

export async function fetchStripeBalance(): Promise<StripeBalanceResponse> {
  return fetchApiJson<StripeBalanceResponse>('/api/payments/stripe/balance');
}
