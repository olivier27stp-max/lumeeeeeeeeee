/**
 * Les abonnements qui se figent — détection, sans jamais suspendre.
 *
 * POURQUOI CE MODULE
 * Un abonnement Stripe se renouvelle tout seul : Stripe prélève, puis envoie
 * `customer.subscription.updated`, et le webhook avance `current_period_end`.
 * Ce chemin fonctionne — il est écrit dans `payments.ts`.
 *
 * Mais si l'événement n'arrive JAMAIS — case décochée dans le tableau de bord
 * Stripe, URL de webhook erronée, livraison en échec — la période reste figée
 * à la date de souscription. Or l'accès aux fonctionnalités se décide sur
 * `status = 'active'`, sans jamais regarder la date : le client garde tout,
 * indéfiniment, et personne ne le voit.
 *
 * CONSTAT QUI A MOTIVÉ CE MODULE (2026-09-03, prod)
 * Les 7 abonnements étaient `active` avec une période finie — jusqu'à
 * 109 jours de dépassement. Deux d'entre eux avaient un vrai
 * `stripe_subscription_id`, créés en juillet, échéance en août : Stripe aurait
 * dû envoyer un renouvellement. Le dernier événement d'abonnement reçu datait
 * du 29 mai. Rien, nulle part, ne signalait l'anomalie.
 *
 * CE QUI EST DÉLIBÉRÉ
 * Ce cron n'écrit RIEN sur les abonnements. Il ne suspend pas, ne modifie
 * aucun statut, ne coupe l'accès de personne. Un abonnement figé n'est pas
 * forcément un impayé : ce sont peut-être des comptes d'essai, ou un webhook
 * mal configuré. Décider à leur place fermerait la porte à des clients
 * légitimes. Il se contente de POSER UNE TRACE dans `security_events`, que
 * l'écran Sécurité affiche et sur laquelle une alerte peut se brancher.
 *
 * La suspension pour impayé reste le travail de `dunning-engine`, qui agit
 * sur les abonnements que Stripe a explicitement marqués `past_due`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logSecurityEvent } from './security';

/** Au-delà de ce dépassement, la période n'a manifestement pas été renouvelée. */
const JOURS_AVANT_ALERTE = 2;

const JOUR_MS = 86_400_000;

export interface ResultatAbonnementsFiges {
  examines: number;
  figes: number;
  avecStripe: number;
}

/**
 * Parcourt les abonnements `active` dont la période est dépassée et journalise
 * les cas anormaux. Ne modifie aucune donnée d'abonnement.
 */
export async function detecterAbonnementsFiges(
  admin: SupabaseClient,
): Promise<ResultatAbonnementsFiges> {
  const resultat: ResultatAbonnementsFiges = { examines: 0, figes: 0, avecStripe: 0 };

  const limite = new Date(Date.now() - JOURS_AVANT_ALERTE * JOUR_MS).toISOString();

  const { data: abos, error } = await admin
    .from('subscriptions')
    .select('id, org_id, status, current_period_end, stripe_subscription_id, plan_id')
    .eq('status', 'active')
    .not('current_period_end', 'is', null)
    .lt('current_period_end', limite);

  // supabase-js ne lève jamais : sans ce test, une erreur de lecture passerait
  // pour « aucun abonnement figé » et le cron se tairait pour toujours.
  if (error) throw new Error('[abonnements-figes] lecture impossible: ' + error.message);
  if (!abos?.length) return resultat;

  resultat.examines = abos.length;

  for (const abo of abos as any[]) {
    const fin = new Date(abo.current_period_end).getTime();
    if (!Number.isFinite(fin)) continue;

    const jours = Math.floor((Date.now() - fin) / JOUR_MS);
    resultat.figes++;
    if (abo.stripe_subscription_id) resultat.avecStripe++;

    // Un abonnement porteur d'un id Stripe qui ne se renouvelle pas est le cas
    // le plus parlant : Stripe DEVRAIT nous avoir écrit. On le distingue.
    logSecurityEvent({
      event_type: 'subscription_period_stale',
      severity: abo.stripe_subscription_id ? 'medium' : 'low',
      source: 'system',
      org_id: abo.org_id,
      details: {
        subscription_id: abo.id,
        plan_id: abo.plan_id,
        period_end: abo.current_period_end,
        days_overdue: jours,
        has_stripe_subscription: Boolean(abo.stripe_subscription_id),
        // Ce qu'il faut vérifier en premier, écrit dans la trace pour que le
        // lecteur n'ait pas à retrouver le raisonnement.
        hint: abo.stripe_subscription_id
          ? 'Stripe aurait dû envoyer customer.subscription.updated — vérifier les événements souscrits et les échecs de livraison dans le tableau de bord Stripe.'
          : 'Abonnement sans id Stripe (créé hors Checkout) : aucun renouvellement automatique n’est attendu.',
      },
    });
  }

  return resultat;
}
