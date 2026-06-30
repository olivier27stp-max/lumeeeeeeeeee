// In-app card collection via the native Stripe PaymentSheet.
//
// Flow (all client-side; the server route already exists):
//   1. ensure the invoice has a public payment-request token
//   2. ask the server to create the destination-charge PaymentIntent for it
//      (returns client_secret + the platform publishable key)
//   3. initialise Stripe with that publishable key and present the PaymentSheet
//
// The PaymentIntent is a destination charge on the org's connected account with
// our application fee, so when it succeeds the money goes to the company and our
// spread lands on the platform — exactly like the web pay page. The server's
// Stripe webhook marks the invoice/payment-request paid, so we just refresh.
//
// Requires the native module @stripe/stripe-react-native (a dev/Release rebuild,
// not Expo Go). Until the org finishes Stripe Connect onboarding the server
// returns 503 → we surface a clear "finish payment setup" message.

import {
  initStripe,
  initPaymentSheet,
  presentPaymentSheet,
} from '@stripe/stripe-react-native';

import { getOrCreatePaymentToken } from './api/billing';
import { createInvoicePaymentIntent, isPaymentsNotReady } from './api/server';

export type CollectResult =
  | { status: 'paid' }
  | { status: 'canceled' }
  | { status: 'not_ready' } // Stripe Connect onboarding not complete
  | { status: 'error'; message: string };

export async function collectInvoicePayment(params: {
  orgId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  companyName?: string | null;
}): Promise<CollectResult> {
  try {
    if (!params.amountCents || params.amountCents <= 0) {
      return { status: 'error', message: 'This invoice has nothing left to pay.' };
    }

    // 1 + 2 — token, then PaymentIntent from the server.
    const token = await getOrCreatePaymentToken({
      orgId: params.orgId,
      invoiceId: params.invoiceId,
      amountCents: params.amountCents,
      currency: params.currency || 'CAD',
    });
    const intent = await createInvoicePaymentIntent(token);

    if (!intent.publishable_key) {
      return {
        status: 'error',
        message: 'Payments are not configured on the server (missing Stripe publishable key).',
      };
    }

    // 3 — initialise Stripe with the platform key the server handed us, then
    // present the sheet. initStripe is safe to call repeatedly.
    await initStripe({ publishableKey: intent.publishable_key });

    const { error: initErr } = await initPaymentSheet({
      paymentIntentClientSecret: intent.client_secret,
      merchantDisplayName: params.companyName || 'Lume',
      // Let the customer use Apple/Google Pay if the device offers it; harmless
      // when unconfigured (falls back to card entry).
      allowsDelayedPaymentMethods: false,
    });
    if (initErr) {
      return { status: 'error', message: initErr.message };
    }

    const { error: presentErr } = await presentPaymentSheet();
    if (presentErr) {
      // The user dismissing the sheet is not an error to shout about.
      if (presentErr.code === 'Canceled') return { status: 'canceled' };
      return { status: 'error', message: presentErr.message };
    }

    // PaymentSheet only resolves without error once the PaymentIntent succeeded.
    return { status: 'paid' };
  } catch (e) {
    if (isPaymentsNotReady(e)) return { status: 'not_ready' };
    return { status: 'error', message: (e as Error)?.message ?? 'Payment failed.' };
  }
}
