/* ═══════════════════════════════════════════════════════════════
   Encaissement d'un dépôt sur une page publique (devis, contrat).

   Le client n'est pas authentifié : il arrive par un jeton de vue. On
   ne peut donc jamais lui faire confiance sur le montant — l'appelant
   le recalcule côté serveur et le passe ici.

   Deux chemins de paiement, dans cet ordre :
     1. Stripe Connect (destination charge) — le cas normal;
     2. les clés Stripe de l'org (charge directe) — migration/legacy.
   S'il n'y a ni l'un ni l'autre, on REFUSE. Router vers le compte de
   la plateforme encaisserait l'argent au mauvais endroit.
   ═══════════════════════════════════════════════════════════════ */

import { getServiceClient } from './supabase';
import { getConnectedAccount, createDestinationPaymentIntent } from './stripe-connect';
import { decryptSecret } from '../../src/lib/crypto';

export interface DepositIntent {
  client_secret: string | null;
  payment_intent_id: string;
  amount_cents: number;
  currency: string;
  publishable_key: string;
}

/** Erreur porteuse d'un code HTTP, pour que la route réponde juste. */
export class DepositPaymentError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'DepositPaymentError';
  }
}

/** Les clés Stripe propres à l'org, déchiffrées. Null si absentes. */
async function orgStripeKeys(orgId: string, contexte: string) {
  const admin = getServiceClient();
  const { data } = await admin
    .from('payment_provider_secrets')
    .select('stripe_publishable_key, stripe_secret_key_enc')
    .eq('org_id', orgId)
    .maybeSingle();
  if (!data?.stripe_secret_key_enc || !data?.stripe_publishable_key) return null;

  let secret: string | null = null;
  try {
    secret = decryptSecret(data.stripe_secret_key_enc);
  } catch (err: any) {
    console.error(`${contexte} failed to decrypt org Stripe secret`, { org_id: orgId, error: err?.message });
    throw new DepositPaymentError(500, 'Payment provider is misconfigured. Please contact support.');
  }
  // Contrôle sur la valeur DÉCHIFFRÉE — une vraie clé Stripe commence par sk_.
  if (!secret.startsWith('sk_')) {
    console.error(`${contexte} decrypted Stripe secret does not look valid`, { org_id: orgId });
    throw new DepositPaymentError(500, 'Payment provider is misconfigured. Please contact support.');
  }
  return { secret, publishableKey: data.stripe_publishable_key };
}

/**
 * Crée l'intention de paiement du dépôt.
 *
 * @param amountCents Recalculé par l'appelant à partir de la base, jamais
 *   repris du corps de la requête.
 * @param idempotencyKey Doit inclure une fenêtre temporelle, sinon un
 *   client qui réessaie une heure plus tard récupère l'intention périmée.
 */
export async function createDepositIntent(params: {
  orgId: string;
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
  contexte: string;
}): Promise<DepositIntent> {
  const { orgId, amountCents, metadata, idempotencyKey, contexte } = params;
  const currency = (params.currency || 'CAD').toLowerCase();
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new DepositPaymentError(400, 'Invalid deposit amount.');
  }

  // ── 1. Stripe Connect ──
  let connected: Awaited<ReturnType<typeof getConnectedAccount>> = null;
  try {
    connected = await getConnectedAccount(orgId);
  } catch {
    connected = null;
  }
  if (connected && connected.charges_enabled) {
    const result = await createDestinationPaymentIntent({
      amountCents,
      currency,
      connectedAccountId: connected.stripe_account_id,
      metadata,
    });
    return {
      client_secret: result.clientSecret,
      payment_intent_id: result.paymentIntentId,
      amount_cents: amountCents,
      currency: currency.toUpperCase(),
      publishable_key: process.env.STRIPE_PUBLISHABLE_KEY || '',
    };
  }

  // ── 2. Les clés de l'org ──
  const keys = await orgStripeKeys(orgId, contexte);
  if (keys) {
    const Stripe = (await import('stripe')).default;
    const orgStripe = new Stripe(keys.secret);
    const intent = await orgStripe.paymentIntents.create(
      { amount: amountCents, currency, payment_method_types: ['card'], metadata },
      { idempotencyKey },
    );
    return {
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
      amount_cents: amountCents,
      currency: currency.toUpperCase(),
      publishable_key: keys.publishableKey,
    };
  }

  throw new DepositPaymentError(
    503,
    'This business has not finished connecting a payment provider. Deposit cannot be collected yet.',
  );
}

/**
 * Relit l'intention chez Stripe pour confirmer que l'argent est bien passé.
 * On ne croit jamais le client sur parole : il pourrait appeler /confirm
 * sans avoir payé.
 */
export async function verifyDepositIntent(params: {
  orgId: string;
  paymentIntentId: string;
  contexte: string;
}): Promise<{ id: string; metadata: Record<string, string> }> {
  const { orgId, paymentIntentId, contexte } = params;
  const Stripe = (await import('stripe')).default;

  let intent: any = null;
  const platformKey = process.env.STRIPE_SECRET_KEY;
  if (platformKey) {
    try {
      intent = await new Stripe(platformKey).paymentIntents.retrieve(paymentIntentId);
    } catch {
      intent = null; // L'intention appartient peut-être au compte de l'org.
    }
  }
  if (!intent) {
    const keys = await orgStripeKeys(orgId, contexte);
    if (keys) {
      try {
        intent = await new Stripe(keys.secret).paymentIntents.retrieve(paymentIntentId);
      } catch {
        intent = null;
      }
    }
  }

  if (!intent) throw new DepositPaymentError(400, 'Payment not found.');
  if (intent.status !== 'succeeded') {
    if (intent.status === 'requires_action' || intent.status === 'requires_payment_method') {
      throw new DepositPaymentError(402, 'Payment requires additional action.');
    }
    throw new DepositPaymentError(400, `Payment not confirmed. Status: ${intent.status}`);
  }
  return { id: intent.id, metadata: (intent.metadata || {}) as Record<string, string> };
}
