/* ═══════════════════════════════════════════════════════════════
   PAIEMENT ÉCHOUÉ — déclencheur `payment.failed`
   (drapeau `auto_paiement_echoue`).

   Source : l'événement Stripe `payment_intent.payment_failed` d'un paiement
   d'un CLIENT FINAL d'une entreprise (page /pay, facture, carte au dossier).

   ── Jamais l'abonnement Lume lui-même ──
   L'échec de l'abonnement d'une entreprise à Lume arrive par
   `invoice.payment_failed` (Stripe Billing), traité ailleurs. Son
   PaymentIntent porte un `invoice` Stripe et aucun `invoice_id` Lume : il
   est écarté ici par les deux.

   ── L'entreprise vient de la BASE, pas du paiement ──
   Le webhook déduit l'entreprise des métadonnées du PaymentIntent. Un
   marchand connecté pourrait en fabriquer un dans SON compte avec l'id
   d'une autre entreprise (rapport de phase 0, bug 10). Ici :
     · un événement venu d'un compte connecté (`event.account`) est écarté —
       les paiements Lume sont des « destination charges » créées sur la
       plateforme, leurs événements n'ont pas de compte ;
     · la facture doit exister DANS l'entreprise des métadonnées.

   ── Une seule fois par événement ──
   L'id de l'événement Stripe est réservé dans `paiements_echoues_traites`
   avant d'émettre : un webhook rejoué tombe sur la clé primaire.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { eventBus } from './eventBus';
import { logger } from './logger';
import { drapeauActif, DRAPEAUX_AUTOMATISATIONS } from './automations-drapeaux';

/**
 * Les raisons de refus, en mots de client. Jamais le code brut à l'écran.
 * Les codes « fraude » ne disent pas « fraude » : on ne l'écrit pas à un
 * client dont la banque se trompe peut-être.
 * Source des codes : https://docs.stripe.com/declines/codes
 */
const RAISONS: Record<string, { fr: string; en: string }> = {
  insufficient_funds: { fr: 'fonds insuffisants', en: 'insufficient funds' },
  expired_card: { fr: 'carte expirée', en: 'expired card' },
  incorrect_cvc: { fr: 'code de sécurité (CVC) incorrect', en: 'incorrect security code (CVC)' },
  invalid_cvc: { fr: 'code de sécurité (CVC) incorrect', en: 'incorrect security code (CVC)' },
  incorrect_number: { fr: 'numéro de carte incorrect', en: 'incorrect card number' },
  invalid_number: { fr: 'numéro de carte incorrect', en: 'incorrect card number' },
  invalid_expiry_month: { fr: 'date d’expiration invalide', en: 'invalid expiry date' },
  invalid_expiry_year: { fr: 'date d’expiration invalide', en: 'invalid expiry date' },
  incorrect_zip: { fr: 'code postal refusé par la banque', en: 'postal code declined by the bank' },
  card_velocity_exceeded: { fr: 'limite de la carte atteinte', en: 'card limit reached' },
  withdrawal_count_limit_exceeded: { fr: 'limite de la carte atteinte', en: 'card limit reached' },
  lost_card: { fr: 'carte signalée perdue ou volée', en: 'card reported lost or stolen' },
  stolen_card: { fr: 'carte signalée perdue ou volée', en: 'card reported lost or stolen' },
  authentication_required: { fr: 'la banque exige une vérification (3-D Secure)', en: 'the bank requires verification (3-D Secure)' },
  processing_error: { fr: 'erreur de traitement, réessayez', en: 'processing error, please try again' },
  try_again_later: { fr: 'refus temporaire, réessayez plus tard', en: 'temporary decline, try again later' },
  currency_not_supported: { fr: 'devise non acceptée par la carte', en: 'currency not supported by the card' },
  card_not_supported: { fr: 'carte non acceptée pour ce paiement', en: 'card not supported for this payment' },
  do_not_honor: { fr: 'carte refusée par la banque', en: 'card declined by the bank' },
  generic_decline: { fr: 'carte refusée par la banque', en: 'card declined by the bank' },
  card_declined: { fr: 'carte refusée par la banque', en: 'card declined by the bank' },
  fraudulent: { fr: 'carte refusée par la banque', en: 'card declined by the bank' },
  pickup_card: { fr: 'carte refusée par la banque', en: 'card declined by the bank' },
  restricted_card: { fr: 'carte refusée par la banque', en: 'card declined by the bank' },
  security_violation: { fr: 'carte refusée par la banque', en: 'card declined by the bank' },
  transaction_not_allowed: { fr: 'carte refusée par la banque', en: 'card declined by the bank' },
};
const RAISON_INCONNUE = { fr: 'paiement refusé', en: 'payment declined' };

/** Le code Stripe → une phrase lisible, jamais le code brut. */
export function raisonLisible(code: string | null | undefined, langue: 'fr' | 'en' = 'fr'): string {
  const r = (code && RAISONS[code]) || RAISON_INCONNUE;
  return langue === 'en' ? r.en : r.fr;
}

/** Les codes connus — pour les tests (« chaque raison est traduite »). */
export const CODES_TRADUITS = Object.keys(RAISONS);

type Issue =
  | 'emis'
  | 'hors_facture'
  | 'compte_connecte'
  | 'abonnement_lume'
  | 'drapeau_off'
  | 'facture_inconnue'
  | 'deja_traite'
  | 'erreur';

interface EvenementStripe {
  id: string;
  type: string;
  account?: string | null;
  data: { object: any };
}

/**
 * Transforme un `payment_intent.payment_failed` en déclencheur. Ne lève
 * JAMAIS : le webhook de paiement doit répondre 200 à Stripe quoi qu'il
 * arrive ici. Rend l'issue, pour les journaux et les tests.
 */
export async function traiterPaiementEchoue(admin: SupabaseClient, event: EvenementStripe): Promise<Issue> {
  try {
    if (event.type !== 'payment_intent.payment_failed') return 'hors_facture';
    const intent = event.data.object ?? {};
    const md = (intent.metadata ?? {}) as Record<string, unknown>;
    const orgId = typeof md.org_id === 'string' ? md.org_id.trim() : '';
    const invoiceId = typeof md.invoice_id === 'string' ? md.invoice_id.trim() : '';
    if (!orgId || !invoiceId) return 'hors_facture';
    if (event.account) return 'compte_connecte';
    if (intent.invoice) return 'abonnement_lume';
    if (!(await drapeauActif(admin, orgId, DRAPEAUX_AUTOMATISATIONS.paiementEchoue))) return 'drapeau_off';

    const { data: facture, error } = await admin
      .from('invoices')
      .select('id, org_id, invoice_number, client_id')
      .eq('id', invoiceId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!facture) return 'facture_inconnue';

    const erreurStripe = (intent.last_payment_error ?? {}) as { decline_code?: string; code?: string };
    const code = erreurStripe.decline_code || erreurStripe.code || null;

    // La raison sur la ligne de paiement (jusqu'ici jamais remplie) : c'est
    // ce que les variables du message liront, même pour un envoi différé.
    if (code) {
      const { error: majErr } = await admin
        .from('payments')
        .update({ failure_reason: code })
        .eq('org_id', orgId)
        .eq('provider', 'stripe')
        .eq('provider_payment_id', String(intent.id ?? ''))
        .eq('status', 'failed');
      if (majErr) logger.error('[paiement-echoue] raison non écrite', { orgId, message: majErr.message });
    }

    const { error: resErr } = await admin.from('paiements_echoues_traites').insert({
      stripe_event_id: event.id,
      org_id: orgId,
      invoice_id: invoiceId,
      payment_intent_id: intent.id ?? null,
    });
    if (resErr) {
      if ((resErr as { code?: string }).code === '23505') return 'deja_traite';
      throw new Error(resErr.message);
    }

    const montantCents = Math.max(0, Math.round(Number(intent.amount ?? 0)));
    await eventBus.emit('payment.failed', {
      orgId,
      entityType: 'invoice',
      entityId: invoiceId,
      relatedEntityType: (facture as any).client_id ? 'client' : undefined,
      relatedEntityId: (facture as any).client_id ?? undefined,
      metadata: {
        invoice_id: invoiceId,
        invoice_number: (facture as any).invoice_number ?? null,
        client_id: (facture as any).client_id ?? null,
        montant_cents: montantCents,
        montant: montantCents / 100,
        raison_code: code,
        // « carte au dossier » (prélèvement automatique) ou paiement en ligne.
        origine: md.charged_from === 'card_on_file' ? 'carte_au_dossier' : 'paiement_en_ligne',
        payment_intent_id: intent.id ?? null,
        stripe_event_id: event.id,
      },
    });
    return 'emis';
  } catch (e: unknown) {
    logger.error('[paiement-echoue] non traité', { eventId: event?.id, message: e instanceof Error ? e.message : String(e) });
    return 'erreur';
  }
}
