import { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import express from 'express';
import { decryptSecret, encryptSecret } from '../../src/lib/crypto';
import { getStripeClient as getStripeClientForOrg } from '../../src/lib/stripeClient';
import { paypalFetch as paypalFetchForOrg } from '../../src/lib/paypalClient';
import { supabaseUrl, supabaseServiceRoleKey, paypalEnv, paypalWebhookId } from './config';
import { getServiceClient } from './supabase';
import { normalizeAmountToCents } from './helpers';
import type { PaymentInsertInput } from './helpers';
import { eventBus } from './eventBus';

// ── Types ──

export type DefaultProvider = 'none' | 'stripe' | 'paypal';

export interface PaymentSettingsRow {
  org_id: string;
  default_provider: DefaultProvider;
  stripe_enabled: boolean;
  paypal_enabled: boolean;
  stripe_keys_present: boolean;
  paypal_keys_present: boolean;
  updated_at: string | null;
}

export interface PaymentProviderSecretsRow {
  org_id: string;
  stripe_publishable_key: string | null;
  stripe_secret_key_enc: string | null;
  paypal_client_id: string | null;
  paypal_secret_enc: string | null;
}

export type PayoutProvider = 'stripe' | 'paypal';

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

// ── Helper functions ──

export function parsePaymentMetadata(raw: unknown) {
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

export function normalizeDefaultProvider(value: unknown): DefaultProvider {
  const raw = String(value || '').toLowerCase().trim();
  if (raw === 'stripe' || raw === 'paypal') return raw;
  return 'none';
}

export function readPgCode(error: any) {
  return String(error?.code || error?.error?.code || '').trim();
}

export function isSchemaNotReadyError(error: any) {
  const code = readPgCode(error);
  return code === '42P01' || code === '42703' || code === '42883' || code === '42P13';
}

export function defaultPaymentSettings(orgId: string): PaymentSettingsRow & {
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

export async function ensurePaymentSettingsRow(client: SupabaseClient, orgId: string) {
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

export async function getPaymentProviderSettings(client: SupabaseClient, orgId: string): Promise<PaymentSettingsRow & {
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

export async function getPaymentProviderSecrets(orgId: string): Promise<{
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

export function isValidDefaultProvider(value: unknown): value is DefaultProvider {
  return value === 'none' || value === 'stripe' || value === 'paypal';
}

export async function saveProviderKeys(params: {
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

// ── Payout helpers ──

export function parsePayoutProvider(raw: unknown): PayoutProvider | null {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'stripe' || value === 'paypal') return value;
  return null;
}

export function parseDateParam(raw: unknown): Date | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function startOfWeek(date: Date) {
  const current = new Date(date);
  const day = current.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  current.setDate(current.getDate() + delta);
  current.setHours(0, 0, 0, 0);
  return current;
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

export function toUnixSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

export function formatIso(date: Date | number | string | null | undefined) {
  if (date == null) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function toCents(value: unknown) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function normalizeCurrency(value: unknown, fallback = 'CAD') {
  const currency = String(value || '').trim().toUpperCase();
  return currency || fallback;
}

export function chooseProviderFromSettings(settings: PaymentSettingsRow) {
  const stripeConnected = settings.stripe_enabled && settings.stripe_keys_present;
  const paypalConnected = settings.paypal_enabled && settings.paypal_keys_present;

  if (settings.default_provider === 'stripe' && stripeConnected) return 'stripe' as const;
  if (settings.default_provider === 'paypal' && paypalConnected) return 'paypal' as const;
  if (stripeConnected) return 'stripe' as const;
  if (paypalConnected) return 'paypal' as const;
  return null;
}

export function serializeCursor(payload: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function deserializeCursor<T>(cursorRaw: unknown): T | null {
  const cursor = String(cursorRaw || '').trim();
  if (!cursor) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

export function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function mapStripePayoutItem(payout: Stripe.Payout): PayoutListItem {
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

export function derivePayPalType(item: any) {
  const code = String(item?.transaction_info?.transaction_event_code || '').trim();
  const name = String(item?.transaction_info?.transaction_initiation_date || '').trim();
  if (code.startsWith('T04')) return 'bank_transfer';
  if (/withdraw|bank|transfer/i.test(name)) return 'bank_transfer';
  return 'other';
}

export function isPayPalPayoutLike(item: any) {
  const code = String(item?.transaction_info?.transaction_event_code || '').trim().toUpperCase();
  const status = String(item?.transaction_info?.transaction_status || '').toUpperCase();
  const gross = Number(item?.transaction_info?.transaction_amount?.value || 0);
  if (code.startsWith('T04')) return true;
  if (status.includes('PENDING') && gross < 0) return true;
  const type = derivePayPalType(item);
  return type === 'bank_transfer';
}

export function mapPayPalTransaction(item: any): PayoutListItem {
  const info = item?.transaction_info || {};
  const amount = Number(info?.transaction_amount?.value || 0);
  const currency = normalizeCurrency(info?.transaction_amount?.currency_code, 'USD');
  const fallbackId = `paypal-${Date.now()}-${require('crypto').randomInt(1_000_000, 9_999_999)}`;
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

export async function resolvePayoutProvider(params: {
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

export async function buildStripePayoutSummary(orgId: string) {
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

export async function listStripePayouts(params: {
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
    currency: items[0]?.currency || 'CAD',
    total_estimate: null as number | null,
    items,
    next_cursor: response.has_more && items.length > 0 ? items[items.length - 1].id : null,
    has_more: Boolean(response.has_more && items.length > 0),
  };
}

export async function getStripePayoutDetail(orgId: string, id: string) {
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

export async function fetchPayPalTransactions(params: {
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

export async function buildPayPalPayoutSummary(orgId: string) {
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

export async function listPayPalPayouts(params: {
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
    currency: items[0]?.currency || 'CAD',
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

export async function getPayPalPayoutDetail(params: { orgId: string; id: string; dateFrom: Date | null; dateTo: Date | null }) {
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
  const raw = details.find((item: any) => String(item?.transaction_info?.transaction_id || '') === params.id);
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

export async function getInvoiceForOrg(client: SupabaseClient, orgId: string, invoiceId: string) {
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

export async function findExistingPaymentByIdentifiers(admin: SupabaseClient, input: PaymentInsertInput) {
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

export async function createInvoicePaidNotification(input: {
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

export async function insertOrUpdatePaymentIdempotent(input: PaymentInsertInput) {
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

    // Emit invoice.paid event
    eventBus.emit('invoice.paid', {
      orgId: input.org_id,
      entityType: 'invoice',
      entityId: input.invoice_id,
      metadata: {
        payment_id: String(data.id),
        amount_cents: input.amount_cents,
        provider: input.provider,
      },
    });
  }

  return { id: String(data.id), inserted: true };
}

// ── PayPal auth & webhook helpers ──

export function getPayPalBaseUrl() {
  return paypalEnv === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

export async function getPayPalAccessToken(credentials?: { clientId: string; secret: string }) {
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

export function parseCustomId(raw: unknown) {
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

export async function fetchPayPalOrder(accessToken: string, orderId: string) {
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

/**
 * Extract org_id from a PayPal webhook body. Custom_id is set by our
 * create-order flow to JSON.stringify({org_id, invoice_id, client_id}).
 */
function extractOrgIdFromPayPalBody(body: any): string | null {
  try {
    const resource = body?.resource || {};
    const purchaseUnit = Array.isArray(resource.purchase_units) ? resource.purchase_units[0] : null;
    const customId =
      (purchaseUnit && purchaseUnit.custom_id) ||
      resource.custom_id ||
      resource?.supplementary_data?.related_ids?.order_id && null;
    if (!customId) return null;
    const parsed = JSON.parse(customId);
    return typeof parsed?.org_id === 'string' ? parsed.org_id : null;
  } catch {
    return null;
  }
}

async function resolvePayPalWebhookId(body: any): Promise<string | null> {
  const orgId = extractOrgIdFromPayPalBody(body);
  if (orgId) {
    try {
      const admin = getServiceClient();
      const { data: provider } = await admin
        .from('payment_providers')
        .select('paypal_webhook_id')
        .eq('org_id', orgId)
        .maybeSingle();
      if (provider?.paypal_webhook_id) return provider.paypal_webhook_id;
    } catch (err: any) {
      console.error('[paypal-webhook] per-org lookup failed:', err?.message);
    }
  }
  return paypalWebhookId || null;
}

export async function verifyPayPalWebhookSignature(req: express.Request, body: any) {
  const webhookId = await resolvePayPalWebhookId(body);
  if (!webhookId) return false;

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
    webhook_id: webhookId,
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

export async function createOrUpdatePayPalPaymentFromCapture(args: { capture: any; eventId?: string | null; orderId?: string | null; orderData?: any }) {
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
