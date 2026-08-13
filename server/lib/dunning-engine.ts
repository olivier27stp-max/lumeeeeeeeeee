/**
 * Relance des abonnements impayés, et suspension au bout de la grâce.
 *
 * POURQUOI CE MODULE
 * Le webhook Stripe sait réagir à un échec de paiement — mais une seule fois,
 * au moment où il arrive. Personne ne repasse ensuite. Un client dont la carte
 * a expiré recevait donc un courriel le jour J, puis plus rien : ni rappel
 * avant la fermeture, ni message le jour où son accès se coupait.
 *
 * Ce cron est la partie « dans le temps » du dispositif :
 *   · J+3 — une relance qui annonce la date de fermeture ;
 *   · J+7 — la suspension effective, et le courriel qui l'explique.
 *
 * CE QUI EST DÉLIBÉRÉ
 * On ne remet JAMAIS un abonnement en `active` ici. Seul Stripe sait si un
 * paiement a abouti, et il nous le dit par `invoice.paid`. Un cron qui
 * réactiverait de lui-même rouvrirait l'accès à un impayé réel.
 *
 * La suspension écrit `status = 'canceled'`, ce qui referme le gate de
 * src/App.tsx. Les données restent intactes : rien n'est supprimé, et un
 * paiement ultérieur remet tout en marche par le webhook.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  JOURS_DE_GRACE,
  sendDunningReminderEmail,
  sendAccessSuspendedEmail,
} from './subscription-email';

/** Jour de grâce auquel part la relance intermédiaire. */
const JOUR_RELANCE = 3;

const JOUR_MS = 86_400_000;

export interface ResultatDunning {
  examines: number;
  relances: number;
  suspendus: number;
}

/**
 * Passe en revue les abonnements en impayé et agit selon l'ancienneté.
 *
 * Ne lève pas sur un échec isolé : un client dont le courriel part mal ne doit
 * pas empêcher les suivants d'être traités.
 */
export async function runDunningScan(admin: SupabaseClient): Promise<ResultatDunning> {
  const resultat: ResultatDunning = { examines: 0, relances: 0, suspendus: 0 };

  const { data: subs, error } = await admin
    .from('subscriptions')
    .select('id, org_id, past_due_since, plan_id')
    .eq('status', 'past_due')
    .not('past_due_since', 'is', null);

  // supabase-js ne lève jamais : sans ce test, une erreur de lecture passerait
  // pour « aucun impayé » et le cron se tairait pour toujours.
  if (error) throw new Error('[dunning] lecture des impayés impossible: ' + error.message);
  if (!subs?.length) return resultat;

  const maintenant = Date.now();

  for (const sub of subs as any[]) {
    resultat.examines++;
    try {
      const debut = new Date(sub.past_due_since).getTime();
      if (!Number.isFinite(debut)) continue;

      const jours = Math.floor((maintenant - debut) / JOUR_MS);

      let planName: string | null = null;
      if (sub.plan_id) {
        const { data: plan } = await admin
          .from('plans').select('name, name_fr').eq('id', sub.plan_id).maybeSingle();
        planName = (plan as any)?.name_fr || (plan as any)?.name || null;
      }

      // ── Suspension : la grâce est écoulée ──
      if (jours >= JOURS_DE_GRACE) {
        const { error: majErr } = await admin
          .from('subscriptions')
          // `canceled_at` accompagne toujours ce statut ailleurs dans le
          // produit (routes payments et billing) : sans lui, la suspension
          // n'aurait aucune date d'effet.
          .update({ status: 'canceled', canceled_at: new Date().toISOString() })
          // Garde contre la course : si un paiement est arrivé entre la lecture
          // et maintenant, l'abonnement n'est plus past_due et on ne le touche
          // pas. Suspendre un client qui vient de payer serait le pire échec
          // possible de ce cron.
          .eq('id', sub.id)
          .eq('status', 'past_due');
        if (majErr) throw new Error('suspension impossible: ' + majErr.message);

        // Le courriel part APRÈS la mise à jour : mieux vaut une suspension
        // silencieuse qu'un courriel annonçant une coupure qui n'a pas eu lieu.
        await sendAccessSuspendedEmail({
          orgId: sub.org_id,
          // Un seul envoi par épisode d'impayé, quel que soit le nombre de
          // passages du cron.
          eventId: `${sub.id}:suspended:${sub.past_due_since}`,
          planName,
        });
        resultat.suspendus++;
        continue;
      }

      // ── Relance intermédiaire ──
      if (jours >= JOUR_RELANCE) {
        const fin = new Date(debut + JOURS_DE_GRACE * JOUR_MS);
        await sendDunningReminderEmail({
          orgId: sub.org_id,
          // La clé porte le jour : le cron tourne plusieurs fois par jour, mais
          // le client ne reçoit qu'une relance quotidienne.
          eventId: `${sub.id}:relance:${new Date(maintenant).toISOString().slice(0, 10)}`,
          joursRestants: JOURS_DE_GRACE - jours,
          suspensionLe: fin.toISOString(),
          planName,
        });
        resultat.relances++;
      }
    } catch (err: any) {
      // Un abonnement en échec ne doit pas priver les autres de leur relance.
      console.error('[dunning] abonnement ignoré', { id: sub.id, erreur: err?.message });
    }
  }

  if (resultat.relances || resultat.suspendus) {
    console.log('[dunning]', resultat);
  }
  return resultat;
}
