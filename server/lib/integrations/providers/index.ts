/* ═══════════════════════════════════════════════════════════════
   Provider Registration — Barrel
   Import this once at server startup to register all providers.

   Only providers backing a real, customer-visible behaviour are
   registered. Stripe and Twilio are provisioned natively by Lume
   (Connect account + plan-included SMS number) and are surfaced
   read-only through /integrations/native-status; QuickBooks is the
   one connection a customer performs themselves.
   ═══════════════════════════════════════════════════════════════ */

import { registerStripe } from './stripe';
import { registerQuickBooks } from './quickbooks';
import { registerTwilio } from './twilio';

export function registerAllProviders(): void {
  registerStripe();
  registerQuickBooks();
  registerTwilio();
}
