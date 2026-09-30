/* ═══════════════════════════════════════════════════════════════
   Les rappels sur date — « Custom Date Reminder »

   Le déclencheur le plus utile pour une entreprise de services après les
   relances : la fin d'un contrat d'entretien, l'échéance d'une garantie,
   l'anniversaire d'une installation. Une date écrite dans un champ
   personnalisé, et un message qui part X jours avant ou après.

   ── Comment ça marche ──────────────────────────────────────────
   Un balayage QUOTIDIEN (`POST /api/cron/rappels-dates`) compare les
   valeurs de `custom_field_values.value_date` à la date du jour, décalée
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
  // En jours CIVILS : près de minuit, le jour du changement d'heure, « + 24 h »
  // retombait sur la veille (25 h) ou sautait un jour (23 h).
  const [a, m, j] = jourLocal(base).split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + jours));
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`;
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
  // `options.orgId` : une seule entreprise (suite d'intégration, bureau de test).
  options: { orgId?: string } = {},
): Promise<ResumeRappels> {
  const resume: ResumeRappels = { regles: 0, emis: 0, erreurs: 0 };

  // Les règles qui écoutent ce déclencheur, actives seulement : une règle
  // en brouillon ne doit rien envoyer.
  let requete = supabase
    .from('automation_rules')
    .select('id, org_id, conditions')
    .eq('trigger_event', 'date.reached')
    .eq('is_active', true)
    // Une règle à la corbeille ne balaie plus rien.
    .is('deleted_at', null);
  if (options.orgId) requete = requete.eq('org_id', options.orgId);
  const { data: regles, error } = await requete;

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
       * Le champ doit porter sur les CLIENTS, et contenir une DATE.
       *
       * Schéma réel, relevé dans le catalogue de staging le 2026-09-24 :
       * `custom_fields` (pas `custom_columns`), avec `object_type` de type
       * `cf_object_type` — au SINGULIER : client, deal, job, quote, invoice.
       * Le balayage lit `custom_field_values.client_id` : sur un champ de
       * `job`, cette colonne est nulle et on ne trouverait jamais rien.
       *
       * `archived_at` : un champ archivé ne doit plus déclencher d'envoi.
       */
      const { data: champ } = await supabase
        .from('custom_fields')
        .select('object_type, field_type, archived_at')
        .eq('id', champId)
        .eq('org_id', regle.org_id)
        .maybeSingle();
      if (!champ) {
        logger.warn('[rappels-dates] champ date introuvable — règle ignorée', { rule_id: regle.id });
        continue;
      }
      if (champ.archived_at) {
        logger.warn('[rappels-dates] champ archivé — règle ignorée', { rule_id: regle.id });
        continue;
      }
      /*
       * Client OU deal. Un deal porte ses propres dates (« Date de
       * fermeture prévue ») : 3 jours avant → tâche de relance au rep.
       * Les autres objets (job, devis, facture) ne sont pas balayés.
       */
      if (champ.object_type !== 'client' && champ.object_type !== 'deal') {
        logger.warn('[rappels-dates] champ date hors des fiches clients et deals — règle ignorée', {
          rule_id: regle.id, object_type: champ.object_type,
        });
        continue;
      }
      const surDeal = champ.object_type === 'deal';
      if (champ.field_type !== 'date') {
        // Un champ texte n'alimente pas `value_date` : la règle ne trouverait
        // jamais rien, sans erreur. On le dit plutôt que de balayer pour rien.
        logger.warn('[rappels-dates] le champ visé n’est pas une date — règle ignorée', {
          rule_id: regle.id, field_type: champ.field_type,
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
      const decalage = decalageDeLaRegle(conditions);
      const jourVise = jourDecale(decalage, maintenant);

      /*
       * Les valeurs qui tombent sur le jour visé.
       *
       * `org_id` est filtré EN PLUS de la colonne : la RLS ne s'applique pas
       * au client service_role, et une règle d'une organisation ne doit
       * jamais lire les dates d'une autre.
       */
      const { data: valeurs, error: errVal } = await supabase
        .from('custom_field_values')
        .select('client_id, deal_id, value_date')
        .eq('org_id', regle.org_id)
        .eq('field_id', champId)
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
         * Sur un champ du DEAL, l'entité est le deal (ses actions et ses
         * variables {{deal.cle}} marchent) — seulement s'il est encore
         * OUVERT : un deal gagné, perdu ou supprimé n'a plus de relance à
         * faire. Le client du message se résout depuis le deal (moteur).
         */
        if (surDeal) {
          if (!v.deal_id) continue;
          const { data: deal } = await supabase
            .from('deals')
            .select('id, deleted_at, pipeline_stages!deals_stage_same_org(kind)')
            .eq('id', v.deal_id)
            .eq('org_id', regle.org_id)
            .maybeSingle();
          const etape = (deal as { pipeline_stages?: { kind?: string } | Array<{ kind?: string }> | null } | null)?.pipeline_stages;
          const kind = Array.isArray(etape) ? etape[0]?.kind : etape?.kind;
          if (!deal || deal.deleted_at || kind !== 'open') continue;

          await eventBus.emit('date.reached', {
            orgId: regle.org_id,
            entityType: 'deal',
            entityId: v.deal_id,
            metadata: {
              champ_id: champId,
              // Le moteur compare TOUTES les conditions de la règle aux
              // métadonnées (`evaluateConditions`) : sans `jours_avant` ici,
              // une règle « 3 jours avant » ne partait jamais.
              jours_avant: decalage,
              date: v.value_date,
              // Même anti-doublon que pour un client : le jour du balayage.
              jour: jourLocal(maintenant),
            },
          });
          resume.emis += 1;
          continue;
        }

        /*
         * L'entité est le CLIENT : `custom_field_values.client_id` pointe la
         * fiche, et c'est elle que les messages décrivent.
         *
         * On vérifie qu'elle existe ENCORE et qu'elle n'est pas supprimée :
         * une date peut survivre à son client, et écrire à quelqu'un qui a
         * demandé son effacement serait une faute.
         */
        if (!v.client_id) continue;
        const { data: client } = await supabase
          .from('clients')
          .select('id, deleted_at')
          .eq('id', v.client_id)
          .eq('org_id', regle.org_id)
          .maybeSingle();
        if (!client || client.deleted_at) continue;

        await eventBus.emit('date.reached', {
          orgId: regle.org_id,
          entityType: 'client',
          entityId: v.client_id,
          metadata: {
            champ_id: champId,
            // Voir plus haut : la règle porte `jours_avant`, l'événement aussi.
            jours_avant: decalage,
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
