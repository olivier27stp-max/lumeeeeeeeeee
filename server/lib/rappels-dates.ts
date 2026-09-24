/* ═══════════════════════════════════════════════════════════════
   Les rappels sur date — « Custom Date Reminder »

   Le déclencheur le plus utile pour une entreprise de services après les
   relances : la fin d'un contrat d'entretien, l'échéance d'une garantie,
   l'anniversaire d'une installation. Une date écrite dans un champ
   personnalisé, et un message qui part X jours avant ou après.

   ── Comment ça marche ──────────────────────────────────────────
   Un balayage QUOTIDIEN (`POST /api/cron/rappels-dates`) compare les
   valeurs de `custom_column_values.value_date` à la date du jour, décalée
   du délai de chaque règle. Chaque correspondance émet `date.reached`,
   que le moteur traite comme n'importe quel événement.

   ── Pourquoi un balayage et pas une planification ──────────────
   On pourrait planifier une tâche au moment où la date est saisie. Mais
   une date se corrige, un client se supprime, une règle se crée APRÈS la
   saisie. Un balayage quotidien voit l'état RÉEL du jour ; une tâche
   planifiée six mois plus tôt parle d'un monde qui n'existe plus.

   ── L'anti-doublon ─────────────────────────────────────────────
   Le balayage peut être rejoué (reprise, double cron, réessai manuel).
   `execution_key` porte la règle, l'entité ET LE JOUR : rejouer le même
   jour ne produit rien, et l'index unique de `automation_scheduled_tasks`
   fait le reste. C'est la même protection que le reste du moteur.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { eventBus } from './eventBus';
import { logger } from './logger';

/** Le fuseau dans lequel « aujourd'hui » se juge — celui de l'entreprise. */
const FUSEAU = 'America/Toronto';

/** AAAA-MM-JJ dans le fuseau de l'entreprise, pas celui du serveur. */
export function jourLocal(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Le jour visé, décalé de `jours` (négatif = avant). */
export function jourDecale(jours: number, base: Date = new Date()): string {
  return jourLocal(new Date(base.getTime() + jours * 86_400_000));
}

export interface ResumeRappels {
  regles: number;
  emis: number;
  erreurs: number;
}

/**
 * Le décalage d'une règle, en jours.
 *
 * Stocké dans `conditions.jours_avant` (positif = X jours AVANT la date).
 * `0` = le jour même. Un décalage négatif signifie « après ».
 */
function decalageDeLaRegle(conditions: Record<string, unknown> | null): number {
  const brut = conditions?.jours_avant;
  const n = Number(brut);
  if (!Number.isFinite(n)) return 0;
  // Borné : au-delà d'un an, la date visée n'a plus de sens, et une faute
  // de frappe (« 3650 ») ferait balayer dix ans de dates.
  return Math.max(-365, Math.min(365, Math.trunc(n)));
}

/**
 * Balaie les dates et émet `date.reached` pour chaque correspondance.
 *
 * Appelé une fois par jour. Ne lève jamais : une org en erreur ne doit pas
 * empêcher les autres d'être traitées — c'est le genre de panne qui passe
 * inaperçue parce qu'elle n'affecte qu'un client.
 */
export async function balayerRappelsDates(
  supabase: SupabaseClient,
  maintenant: Date = new Date(),
): Promise<ResumeRappels> {
  const resume: ResumeRappels = { regles: 0, emis: 0, erreurs: 0 };

  // Les règles qui écoutent ce déclencheur, actives seulement : une règle
  // en brouillon ne doit rien envoyer.
  const { data: regles, error } = await supabase
    .from('automation_rules')
    .select('id, org_id, conditions')
    .eq('trigger_event', 'date.reached')
    .eq('is_active', true);

  if (error) {
    logger.error('[rappels-dates] lecture des règles échouée', { message: error.message });
    return { ...resume, erreurs: 1 };
  }
  if (!regles || regles.length === 0) return resume;
  resume.regles = regles.length;

  for (const regle of regles) {
    try {
      const conditions = (regle.conditions ?? {}) as Record<string, unknown>;
      const champId = conditions.champ_id ? String(conditions.champ_id) : null;
      if (!champId) {
        // Une règle sans champ date visé ne peut rien faire. On le dit une
        // fois par balayage plutôt que d'échouer en silence.
        logger.warn('[rappels-dates] règle sans champ date — ignorée', { rule_id: regle.id });
        continue;
      }

      /*
       * La colonne doit porter sur les CLIENTS.
       *
       * `custom_columns.entity` vaut 'clients', 'jobs' ou 'invoices'
       * (CHECK en base, au PLURIEL — vérifié le 2026-09-24). Le balayage
       * traite `record_id` comme une fiche client : sur une colonne de
       * `jobs`, il chercherait un client avec un identifiant de job et ne
       * trouverait jamais rien. Silencieusement.
       */
      const { data: colonne } = await supabase
        .from('custom_columns')
        .select('entity')
        .eq('id', champId)
        .eq('org_id', regle.org_id)
        .maybeSingle();
      if (!colonne) {
        logger.warn('[rappels-dates] champ date introuvable — règle ignorée', { rule_id: regle.id });
        continue;
      }
      if (colonne.entity !== 'clients') {
        logger.warn('[rappels-dates] champ date hors des fiches clients — règle ignorée', {
          rule_id: regle.id, entity: colonne.entity,
        });
        continue;
      }

      /*
       * LE SENS DU DÉCALAGE — la faute d'inattention la plus coûteuse ici.
       *
       * « 7 jours AVANT la date » veut dire : aujourd'hui, on cherche les
       * dates qui tombent dans 7 jours. On avance donc dans le FUTUR.
       *
       * Le signe inverse (`-7`) chercherait les dates d'il y a une semaine :
       * le balayage ne trouverait jamais rien, sans la moindre erreur. Mesuré
       * contre la vraie base avant correction — 0 émis sur une donnée
       * pourtant présente.
       */
      const jourVise = jourDecale(decalageDeLaRegle(conditions), maintenant);

      /*
       * Les valeurs qui tombent sur le jour visé.
       *
       * `org_id` est filtré EN PLUS de la colonne : la RLS ne s'applique pas
       * au client service_role, et une règle d'une organisation ne doit
       * jamais lire les dates d'une autre.
       */
      const { data: valeurs, error: errVal } = await supabase
        .from('custom_column_values')
        .select('record_id, value_date')
        .eq('org_id', regle.org_id)
        .eq('column_id', champId)
        .eq('value_date', jourVise)
        .limit(500);

      if (errVal) {
        logger.error('[rappels-dates] lecture des dates échouée', {
          rule_id: regle.id, message: errVal.message,
        });
        resume.erreurs += 1;
        continue;
      }
      if (!valeurs || valeurs.length === 0) continue;

      for (const v of valeurs) {
        /*
         * L'entité est le CLIENT : `custom_column_values.record_id` pointe
         * la fiche, et c'est elle que les messages décrivent.
         *
         * On vérifie qu'elle existe ENCORE et qu'elle n'est pas supprimée :
         * une date peut survivre à son client, et écrire à quelqu'un qui a
         * demandé son effacement serait une faute.
         */
        const { data: client } = await supabase
          .from('clients')
          .select('id, deleted_at')
          .eq('id', v.record_id)
          .eq('org_id', regle.org_id)
          .maybeSingle();
        if (!client || client.deleted_at) continue;

        await eventBus.emit('date.reached', {
          orgId: regle.org_id,
          entityType: 'client',
          entityId: v.record_id,
          metadata: {
            champ_id: champId,
            date: v.value_date,
            // Le jour du balayage entre dans l'anti-doublon du moteur :
            // rejouer le cron le même jour ne renvoie rien.
            jour: jourLocal(maintenant),
          },
        });
        resume.emis += 1;
      }
    } catch (e: unknown) {
      logger.error('[rappels-dates] règle en erreur — les autres continuent', {
        rule_id: regle.id, message: e instanceof Error ? e.message : String(e),
      });
      resume.erreurs += 1;
    }
  }

  return resume;
}
