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

/**
 * Lien de connexion au dashboard Stripe Express du marchand (payouts, solde,
 * compte bancaire, litiges). Valide quelques minutes, usage unique — à
 * générer à la demande, jamais à stocker.
 */
export async function createDashboardLoginLink(orgId: string) {
  const stripe = getPlatformStripe();
  const account = await getConnectedAccount(orgId);
  if (!account) throw new Error('No connected account found. Create one first.');

  const link = await stripe.accounts.createLoginLink(account.stripe_account_id);
  return { url: link.url };
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

// ── Platform pricing (Lume's revenue) ──
// What we charge the merchant on every payment, taken as the Stripe application
// fee: a percentage PLUS a fixed amount. The fixed part (default 30¢) covers
// Stripe's own fixed fee so WE never pay it out of pocket.
//
// How the margin works, fully automatic — no manual payouts, ever:
//   • We charge the merchant this fee (e.g. 2.9% + 30¢) → lands in our platform balance.
//   • Stripe deducts OUR OWN negotiated wholesale rate from that same balance.
//   • The leftover (our fee − Stripe's wholesale) is our margin. Stripe pays it
//     out to our bank on its automatic schedule, same as any balance.
// So once you negotiate a lower rate with Stripe (2.2%, 1.8%…), the spread to us
// GROWS with ZERO code change — Stripe just deducts less. Tune the merchant-facing
// rate any time via PLATFORM_FEE_PERCENT / PLATFORM_FEE_FIXED_CENTS (no redeploy).
const PLATFORM_FEE_PERCENT = Number(process.env.PLATFORM_FEE_PERCENT ?? '2.9');
const PLATFORM_FEE_FIXED_CENTS = Number(process.env.PLATFORM_FEE_FIXED_CENTS ?? '30');

export function calculateApplicationFee(amountCents: number): number {
  const fee = Math.round((amountCents * PLATFORM_FEE_PERCENT) / 100) + PLATFORM_FEE_FIXED_CENTS;
  // Never exceed the charge itself (guards tiny amounts); Stripe rejects fee ≥ amount.
  return Math.min(fee, Math.max(0, amountCents - 1));
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

// ── Carte au dossier (payment on file) ──
// Les charges étant des destination charges sur le compte plateforme, le
// customer Stripe d'un client de CRM vit côté plateforme. Le customer n'est
// créé QUE lorsque le client consent à sauvegarder sa carte (Loi 25 —
// minimisation : pas de données chez Stripe sans consentement).

export async function getClientPaymentProfile(orgId: string, clientId: string) {
  const admin = getServiceClient();
  const { data, error } = await admin
    .from('client_payment_profiles')
    .select('*')
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    // Table absente tant que la migration 20260802400000 n'est pas appliquée.
    if (error.code === '42P01' || error.code === 'PGRST205') return null;
    throw error;
  }
  return data;
}

export async function getOrCreatePlatformCustomerForClient(orgId: string, clientId: string) {
  const admin = getServiceClient();
  const existing = await getClientPaymentProfile(orgId, clientId);
  if (existing?.stripe_customer_id) return existing.stripe_customer_id as string;

  const { data: client } = await admin
    .from('clients')
    .select('id, first_name, last_name, email, phone')
    .eq('id', clientId)
    .maybeSingle();

  const stripe = getPlatformStripe();
  const customer = await stripe.customers.create({
    name: [client?.first_name, client?.last_name].filter(Boolean).join(' ') || undefined,
    email: client?.email || undefined,
    metadata: { org_id: orgId, client_id: clientId, platform: 'lume_crm' },
  });

  const { error } = await admin
    .from('client_payment_profiles')
    .insert({ org_id: orgId, client_id: clientId, stripe_customer_id: customer.id });
  if (error && error.code !== '23505') {
    // 42P01/PGRST205 = migration pending : le customer existe chez Stripe mais
    // ne sera pas retrouvé — le webhook re-tentera l'upsert à la sauvegarde.
    if (error.code !== '42P01' && error.code !== 'PGRST205') throw error;
  }
  return customer.id;
}

/**
 * Sauvegarde la carte d'un paiement réussi comme carte au dossier du client.
 * Appelé par le webhook payment_intent.succeeded quand le payeur a coché
 * l'option (metadata.save_card = '1'), et par le flux « payment method on
 * file » de la page publique de contrat (SetupIntent, consent_source
 * 'public_contract'). consented_at = preuve Loi 25.
 */
export async function saveCardOnFileFromIntent(params: {
  orgId: string;
  clientId: string;
  stripeCustomerId: string;
  paymentMethodId: string;
  consentedAtIso?: string | null;
  consentSource?: string;
}) {
  const admin = getServiceClient();
  const stripe = getPlatformStripe();

  let brand: string | null = null;
  let last4: string | null = null;
  let expMonth: number | null = null;
  let expYear: number | null = null;
  try {
    const pm = await stripe.paymentMethods.retrieve(params.paymentMethodId);
    brand = pm.card?.brand || null;
    last4 = pm.card?.last4 || null;
    expMonth = pm.card?.exp_month || null;
    expYear = pm.card?.exp_year || null;
  } catch (err: any) {
    console.error('[card-on-file] payment method retrieve failed:', err?.message);
  }

  const fields = {
    stripe_customer_id: params.stripeCustomerId,
    payment_method_id: params.paymentMethodId,
    card_brand: brand,
    card_last4: last4,
    card_exp_month: expMonth,
    card_exp_year: expYear,
    consented_at: params.consentedAtIso || new Date().toISOString(),
    consent_source: params.consentSource || 'public_pay',
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  const { data: existing } = await admin
    .from('client_payment_profiles')
    .select('id')
    .eq('org_id', params.orgId)
    .eq('client_id', params.clientId)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin.from('client_payment_profiles').update(fields).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await admin
      .from('client_payment_profiles')
      .insert({ org_id: params.orgId, client_id: params.clientId, ...fields });
    if (error) throw error;
  }

  return { brand, last4, expMonth, expYear };
}

/**
 * Charge hors-session la carte au dossier d'un client pour une facture
 * (destination charge identique au flux public : mêmes frais de plateforme,
 * même webhook payment_intent.succeeded qui applique le paiement).
 */
export async function chargeInvoiceOnFile(params: {
  orgId: string;
  invoiceId: string;
}): Promise<{ ok: boolean; status: string; paymentIntentId?: string; reason?: string }> {
  const admin = getServiceClient();

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, org_id, client_id, job_id, balance_cents, currency, status, deleted_at')
    .eq('id', params.invoiceId)
    .eq('org_id', params.orgId)
    .maybeSingle();
  if (!invoice || invoice.deleted_at) return { ok: false, status: 'not_found', reason: 'Invoice not found.' };
  const balance = Number(invoice.balance_cents || 0);
  if (balance <= 0) return { ok: false, status: 'nothing_due', reason: 'Invoice has no remaining balance.' };
  if (!invoice.client_id) return { ok: false, status: 'no_client', reason: 'Invoice has no client.' };

  const profile = await getClientPaymentProfile(params.orgId, invoice.client_id);
  if (!profile?.payment_method_id || !profile?.stripe_customer_id) {
    return { ok: false, status: 'no_card_on_file', reason: 'No card on file for this client.' };
  }

  const connectedAccount = await getConnectedAccount(params.orgId);
  if (!connectedAccount || !connectedAccount.charges_enabled) {
    return { ok: false, status: 'not_ready', reason: 'Connected account cannot accept charges.' };
  }

  const stripe = getPlatformStripe();
  const applicationFee = calculateApplicationFee(balance);
  try {
    const intent = await stripe.paymentIntents.create({
      amount: balance,
      currency: String(invoice.currency || 'CAD').toLowerCase(),
      customer: profile.stripe_customer_id,
      payment_method: profile.payment_method_id,
      off_session: true,
      confirm: true,
      payment_method_types: ['card'],
      application_fee_amount: applicationFee,
      transfer_data: { destination: connectedAccount.stripe_account_id },
      metadata: {
        org_id: params.orgId,
        invoice_id: params.invoiceId,
        client_id: invoice.client_id,
        job_id: invoice.job_id || '',
        charged_from: 'card_on_file',
      },
    }, {
      // Une tentative par facture+solde par heure — évite les doubles charges.
      idempotencyKey: `cof-${params.invoiceId}-${balance}-${Math.floor(Date.now() / 3_600_000)}`,
    });
    return { ok: intent.status === 'succeeded', status: intent.status, paymentIntentId: intent.id };
  } catch (err: any) {
    // authentication_required / carte refusée : le paiement au dossier échoue
    // proprement — la facture reste payable par le lien public.
    const code = err?.code || err?.raw?.code || 'charge_failed';
    console.error('[card-on-file] off-session charge failed:', code, err?.message);
    return { ok: false, status: String(code), reason: err?.message || 'Charge failed.' };
  }
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
