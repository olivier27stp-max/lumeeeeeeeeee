import Stripe from 'stripe';
import { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from './supabase';

// ── Platform Stripe client (uses STRIPE_SECRET_KEY — the platform's key) ──

let _platformStripe: Stripe | null = null;

export function getPlatformStripe(): Stripe {
  if (_platformStripe) return _platformStripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured on the server.');
  _platformStripe = new Stripe(key);
  return _platformStripe;
}

// ── Connected Account helpers ──

export async function getConnectedAccount(orgId: string) {
  const admin = getServiceClient();
  const { data, error } = await admin
    .from('connected_accounts')
    .select('*')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createConnectedAccount(orgId: string, country = 'CA') {
  const stripe = getPlatformStripe();

  // Check if account already exists
  const existing = await getConnectedAccount(orgId);
  if (existing) return existing;

  const account = await stripe.accounts.create({
    type: 'express',
    country,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: {
      org_id: orgId,
      platform: 'lume_crm',
    },
  });

  const admin = getServiceClient();
  const { data, error } = await admin
    .from('connected_accounts')
    .insert({
      org_id: orgId,
      stripe_account_id: account.id,
      account_type: 'express',
      country,
      default_currency: (account.default_currency || 'cad').toUpperCase(),
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function createOnboardingLink(orgId: string, returnUrl: string, refreshUrl: string) {
  const stripe = getPlatformStripe();
  const account = await getConnectedAccount(orgId);
  if (!account) throw new Error('No connected account found. Create one first.');

  const link = await stripe.accountLinks.create({
    account: account.stripe_account_id,
    type: 'account_onboarding',
    return_url: returnUrl,
    refresh_url: refreshUrl,
  });

  return { url: link.url, expires_at: link.expires_at };
}

export async function refreshAccountStatus(orgId: string) {
  const stripe = getPlatformStripe();
  const admin = getServiceClient();

  const account = await getConnectedAccount(orgId);
  if (!account) return null;

  const stripeAccount = await stripe.accounts.retrieve(account.stripe_account_id);

  const patch = {
    charges_enabled: Boolean(stripeAccount.charges_enabled),
    payouts_enabled: Boolean(stripeAccount.payouts_enabled),
    details_submitted: Boolean(stripeAccount.details_submitted),
    onboarding_complete: Boolean(
      stripeAccount.charges_enabled && stripeAccount.details_submitted
    ),
    country: stripeAccount.country || account.country,
    default_currency: (stripeAccount.default_currency || account.default_currency || 'cad').toUpperCase(),
  };

  const { data, error } = await admin
    .from('connected_accounts')
    .update(patch)
    .eq('id', account.id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// ── Destination Charge helpers ──

const APPLICATION_FEE_PERCENT = 2.9; // Platform fee: 2.9% of the charge amount

export function calculateApplicationFee(amountCents: number): number {
  return Math.round(amountCents * APPLICATION_FEE_PERCENT / 100);
}

export async function createDestinationPaymentIntent(params: {
  amountCents: number;
  currency: string;
  connectedAccountId: string;
  metadata: Record<string, string>;
  idempotencyKey?: string;
}) {
  const stripe = getPlatformStripe();
  const applicationFee = calculateApplicationFee(params.amountCents);

  // Fallback idempotency key derives from stable metadata if caller didn't pass one.
  // Bucketed per minute — retry within 60s dedupes, distinct user attempts succeed.
  const idemKey =
    params.idempotencyKey ||
    `dest-${params.connectedAccountId}-${params.metadata.entity_type || 'charge'}-${params.metadata.quote_id || params.metadata.invoice_id || 'x'}-${params.amountCents}-${Math.floor(Date.now() / 60_000)}`;

  const intent = await stripe.paymentIntents.create({
    amount: params.amountCents,
    currency: params.currency.toLowerCase(),
    payment_method_types: ['card'],
    application_fee_amount: applicationFee,
    transfer_data: {
      destination: params.connectedAccountId,
    },
    metadata: params.metadata,
  }, {
    idempotencyKey: idemKey,
  });

  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret!,
    applicationFee,
  };
}

// ── Webhook event logging ──

export async function logWebhookEvent(params: {
  provider: 'stripe' | 'paypal';
  stripeEventId: string | null;
  stripeAccountId?: string | null;
  eventType: string;
  payload: unknown;
  status?: 'pending' | 'processed' | 'failed' | 'skipped';
  errorMessage?: string | null;
}) {
  const admin = getServiceClient();

  // Idempotency check — skip if already processed
  if (params.stripeEventId) {
    const { data: existing } = await admin
      .from('webhook_events')
      .select('id, status')
      .eq('stripe_event_id', params.stripeEventId)
      .maybeSingle();

    if (existing) {
      return { id: existing.id, alreadyProcessed: true };
    }
  }

  const { data, error } = await admin
    .from('webhook_events')
    .insert({
      provider: params.provider,
      stripe_event_id: params.stripeEventId,
      stripe_account_id: params.stripeAccountId || null,
      event_type: params.eventType,
      payload: params.payload,
      status: params.status || 'pending',
      processed_at: params.status === 'processed' ? new Date().toISOString() : null,
      error_message: params.errorMessage || null,
    })
    .select('id')
    .single();

  if (error) {
    // Unique constraint violation — already exists
    if (error.code === '23505' && params.stripeEventId) {
      return { id: null, alreadyProcessed: true };
    }
    throw error;
  }

  return { id: data.id, alreadyProcessed: false };
}

export async function markWebhookEventProcessed(eventId: string, status: 'processed' | 'failed', errorMessage?: string) {
  const admin = getServiceClient();
  await admin
    .from('webhook_events')
    .update({
      status,
      processed_at: new Date().toISOString(),
      error_message: errorMessage || null,
    })
    .eq('id', eventId);
}

// ── Payment Request helpers ──

export async function getPaymentRequestByToken(publicToken: string) {
  const admin = getServiceClient();
  const { data, error } = await admin
    .from('payment_requests')
    .select('*')
    .eq('public_token', publicToken)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getPaymentRequestsByInvoice(orgId: string, invoiceId: string) {
  const admin = getServiceClient();
  const { data, error } = await admin
    .from('payment_requests')
    .select('*')
    .eq('org_id', orgId)
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createPaymentRequest(params: {
  orgId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  expiresAt?: string | null;
}) {
  const admin = getServiceClient();

  // Check for existing pending request for this invoice
  const { data: existing } = await admin
    .from('payment_requests')
    .select('id, public_token, status')
    .eq('org_id', params.orgId)
    .eq('invoice_id', params.invoiceId)
    .in('status', ['pending', 'sent'])
    .maybeSingle();

  if (existing) {
    // Return existing active request
    return existing;
  }

  const { data, error } = await admin
    .from('payment_requests')
    .insert({
      org_id: params.orgId,
      invoice_id: params.invoiceId,
      amount_cents: params.amountCents,
      currency: params.currency,
      expires_at: params.expiresAt || null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updatePaymentRequestStatus(
  id: string,
  status: 'pending' | 'sent' | 'paid' | 'expired' | 'cancelled',
  extra?: Record<string, unknown>,
) {
  const admin = getServiceClient();
  const { error } = await admin
    .from('payment_requests')
    .update({ status, ...extra })
    .eq('id', id);
  if (error) throw error;
}
