/**
 * stripe-sdk.ts — UNE seule façon de construire un client Stripe.
 *
 * Audit 2026-09-09 (I5) : 15 `new Stripe(clé)` éparpillés, sans `apiVersion`.
 * stripe-node envoie bien sa version embarquée par défaut (un réglage dans
 * le dashboard Stripe ne change donc rien), mais une montée de version du
 * paquet `stripe` changeait la version d'API en silence, sans qu'une ligne
 * de code ne bouge. Ici la version est écrite noir sur blanc : si le paquet
 * en embarque une autre, le typecheck refuse (`LatestApiVersion`) et la
 * montée devient un geste conscient, relu.
 */
import Stripe from 'stripe';

export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-02-25.clover';

export function creerClientStripe(cleSecrete: string): Stripe {
  return new Stripe(cleSecrete, { apiVersion: STRIPE_API_VERSION });
}
