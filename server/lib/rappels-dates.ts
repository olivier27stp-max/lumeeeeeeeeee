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
   Le balayage est rejoué : par le cron quotidien ET par le tick du
   planificateur (une fois par heure, en journée), plus les reprises. Une
   date n'est émise qu'UNE fois par (règle, fiche, date) : avant d'émettre,
   le balayage relit `activity_log`, où le bus écrit chaque `date.reached`
   AVANT de le diffuser (voir eventBus.ts). Lecture impossible = on n'émet
   pas (le passage suivant réessaie) : un rappel en retard d'une heure vaut
   mieux qu'un rappel envoyé deux fois.

   ── Le rattrapage (B-18) ───────────────────────────────────────
   Le balayage ne lisait que la date du jour visé : un jour sans passage
   (déploiement à la minute du cron, base saturée, serveur arrêté) et les
   rappels de ce jour-là ne partaient JAMAIS — le lendemain, on cherchait
   les dates du lendemain. Chaque passage relit maintenant aussi les
   JOURS_DE_RATTRAPAGE jours précédents, pour les seuls jours où la règle
   était déjà active (une règle activée aujourd'hui ne rattrape rien :
   point 10 de la mission, voir automations-activation.ts).
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { eventBus } from './eventBus';
import { logger } from './logger';
import { fuseauOrg } from './automations-fuseau-org';
import { dateActivation, ignoreLesCasExistants, type RegleDatee } from './automations-activation';
import { orgEnPause } from './automations-pause-org';

/** Fuseau de repli, quand celui de l'entreprise est illisible. */
const FUSEAU = 'America/Toronto';

/**
 * AAAA-MM-JJ dans le fuseau de l'entreprise, pas celui du serveur. Le
 * balayage passe le fuseau de CHAQUE entreprise (company_settings.timezone) :
 * figé sur Toronto, une entreprise de Vancouver voyait « aujourd'hui » changer
 * à 21 h, heure de chez elle, et ses rappels partaient la veille.
 */
export function jourLocal(d: Date = new Date(), fuseau: string = FUSEAU): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Le jour visé, décalé de `jours` (négatif = avant). */
export function jourDecale(jours: number, base: Date = new Date(), fuseau: string = FUSEAU): string {
  // En jours CIVILS : près de minuit, le jour du changement d'heure, « + 24 h »
  // retombait sur la veille (25 h) ou sautait un jour (23 h).
  const [a, m, j] = jourLocal(base, fuseau).split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + jours));
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${deux(d.getUTCMonth() + 1)}-${deux(d.getUTCDate())}`;
}

export interface ResumeRappels {
  regles: number;
  emis: number;
  erreurs: number;
  /** Parmi `emis` : les dates d'un balayage manqué, rattrapées à ce passage. */
  rattrapes?: number;
}

/**
 * Jusqu'à combien de jours de retard un rappel sur date est encore envoyé.
 * Deux jours couvrent une fin de semaine de panne sans envoyer « votre
 * contrat se termine dans 7 jours » une semaine trop tard.
 */
export const JOURS_DE_RATTRAPAGE = 2;

/** Plage où le TICK balaie (heure de l'entreprise) : aucun rappel créé la nuit. */
export const HEURE_DEBUT_BALAYAGE = 8;
export const HEURE_FIN_BALAYAGE = 20;

function heureLocale(d: Date, fuseau: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: fuseau, hour: '2-digit', hour12: false }).format(d)) % 24;
}

/**
 * Les jours à balayer pour une règle, en jours de RETARD : 0 (aujourd'hui),
 * puis les balayages manqués des jours précédents — seulement ceux où la
 * règle était déjà active. Date d'activation inconnue : aujourd'hui seulement.
 */
export function retardsABalayer(regle: RegleDatee, maintenant: Date, fuseau: string = FUSEAU): number[] {
  const retards = [0];
  const activation = dateActivation(regle);
  const filtrer = ignoreLesCasExistants(regle);
  if (filtrer && activation === null) return retards;
  const jourActivation = activation === null ? '' : jourLocal(new Date(activation), fuseau);
  for (let k = 1; k <= JOURS_DE_RATTRAPAGE; k++) {
    if (!filtrer || jourDecale(-k, maintenant, fuseau) >= jourActivation) retards.push(k);
  }
  return retards;
}

/** Borne de `jours_avant`, des deux côtés (avant / après la date). */
export const JOURS_AVANT_MAX = 365;

/**
 * `jours_avant` tel que le balayage ET le moteur le lisent : un entier borné.
 *
 * UNE seule fonction pour les deux : le balayage bornait et tronquait
 * (« 3.5 » → 3, « 400 » → 365) puis émettait cette valeur, que le moteur
 * comparait à la valeur BRUTE de la règle — jamais égales, la règle ne
 * partait jamais, sans erreur (J-063). L'enregistrement refuse désormais
 * ces valeurs (`problemeJoursAvant`) ; une règle déjà écrite ainsi part au
 * décalage normalisé au lieu de rester muette.
 */
export function normaliserJoursAvant(brut: unknown): number {
  const n = Number(brut);
  if (!Number.isFinite(n)) return 0;
  // Borné : au-delà d'un an, la date visée n'a plus de sens, et une faute
  // de frappe (« 3650 ») ferait balayer dix ans de dates.
  // (Les mêmes bornes que JOURS_AVANT_MAX, écrites en clair.)
  return Math.max(-365, Math.min(365, Math.trunc(n)));
}

/**
 * Ce qui cloche dans un `jours_avant` qu'on s'apprête à ENREGISTRER, ou null.
 * Vide = le jour même (champ facultatif). Tout le reste doit être un nombre
 * entier de jours entre −365 et 365 : ce que le balayage sait viser.
 */
export function problemeJoursAvant(brut: unknown, fr = true): string | null {
  if (brut === undefined || brut === null || brut === '') return null;
  const texte = typeof brut === 'string' ? brut.trim() : brut;
  const n = typeof texte === 'number' ? texte : (typeof texte === 'string' && /^-?\d+$/.test(texte) ? Number(texte) : Number.NaN);
  if (Number.isInteger(n) && Math.abs(n) <= JOURS_AVANT_MAX) return null;
  return fr
    ? `« Combien de jours avant » doit être un nombre entier de jours, entre -${JOURS_AVANT_MAX} et ${JOURS_AVANT_MAX} (0 = le jour même, -7 = une semaine après).`
    : `“How many days before” must be a whole number of days, between -${JOURS_AVANT_MAX} and ${JOURS_AVANT_MAX} (0 = on the day, -7 = one week after).`;
}

/**
 * Le décalage d'une règle, en jours.
 *
 * Stocké dans `conditions.jours_avant` (positif = X jours AVANT la date).
 * `0` = le jour même. Un décalage négatif signifie « après ».
 */
function decalageDeLaRegle(conditions: Record<string, unknown> | null): number {
  return normaliserJoursAvant(conditions?.jours_avant);
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
  // `options.enJournee` : le passage du TICK — ne balaie que les entreprises
  // pour qui il est entre 8 h et 20 h (le cron quotidien, lui, balaie tout).
  options: { orgId?: string; enJournee?: boolean } = {},
): Promise<ResumeRappels> {
  const resume: ResumeRappels = { regles: 0, emis: 0, erreurs: 0 };

  // Les règles qui écoutent ce déclencheur, actives seulement : une règle
  // en brouillon ne doit rien envoyer.
  let requete = supabase
    .from('automation_rules')
    // `*` : la date d'activation (`activee_le`) n'existe qu'une fois sa
    // migration appliquée ; la nommer ferait échouer TOUTE la lecture avant.
    .select('*')
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
      // Bureau en pause (« Tout arrêter ») : le moteur ignorerait l'événement
      // et la date serait marquée « déjà émise ». On n'émet rien ; à la
      // reprise, le rattrapage reprend les dates des derniers jours.
      if (await orgEnPause(supabase, regle.org_id)) continue;
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
      const fuseau = await fuseauOrg(supabase, regle.org_id);
      if (options.enJournee) {
        const h = heureLocale(maintenant, fuseau);
        if (h < HEURE_DEBUT_BALAYAGE || h >= HEURE_FIN_BALAYAGE) continue;
      }

      // Aujourd'hui (retard 0), puis les balayages manqués — rattrapage, B-18.
      for (const retard of retardsABalayer(regle as RegleDatee, maintenant, fuseau)) {
      const jourVise = jourDecale(decalage - retard, maintenant, fuseau);

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

      // Ce que CETTE règle a déjà émis pour CETTE date (passage précédent du
      // jour, cron + tick, rattrapage déjà fait). Illisible = on n'émet rien :
      // le passage suivant réessaiera.
      const { data: dejaEmis, error: errDeja } = await supabase
        .from('activity_log')
        .select('entity_id')
        .eq('org_id', regle.org_id)
        .eq('event_type', 'date_reached')
        .eq('metadata->>rule_id', regle.id)
        .eq('metadata->>date', jourVise)
        .limit(1000);
      if (errDeja) {
        logger.error('[rappels-dates] anti-doublon illisible — rien n’est émis à ce passage', {
          rule_id: regle.id, message: errDeja.message,
        });
        resume.erreurs += 1;
        continue;
      }
      const dejaFait = new Set(((dejaEmis ?? []) as Array<{ entity_id: string }>).map((l) => l.entity_id));
      const aEmettre = (id: string | null | undefined): id is string => {
        if (!id || dejaFait.has(id)) return false;
        dejaFait.add(id);
        return true;
      };
      const compter = () => {
        resume.emis += 1;
        if (retard > 0) resume.rattrapes = (resume.rattrapes ?? 0) + 1;
      };
      // Dit dans l'événement : cette date vient d'un balayage manqué.
      const rattrapage = retard > 0 ? { rattrapage_jours: retard } : {};

      for (const v of valeurs) {
        /*
         * Sur un champ du DEAL, l'entité est le deal (ses actions et ses
         * variables {{deal.cle}} marchent) — seulement s'il est encore
         * OUVERT : un deal gagné, perdu ou supprimé n'a plus de relance à
         * faire. Le client du message se résout depuis le deal (moteur).
         */
        if (surDeal) {
          if (!aEmettre(v.deal_id)) continue;
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
              // L'événement est celui de CETTE règle : les autres règles
              // « date atteinte » du bureau ne le reprennent pas
              // (`regleViseCetEvenement`, comme pour `deal.stage_idle`).
              rule_id: regle.id,
              champ_id: champId,
              // Le moteur compare TOUTES les conditions de la règle aux
              // métadonnées (`evaluateConditions`) : sans `jours_avant` ici,
              // une règle « 3 jours avant » ne partait jamais.
              jours_avant: decalage,
              date: v.value_date,
              // (rule_id, date) : la clé de l'anti-doublon relu plus haut.
              jour: jourLocal(maintenant, fuseau),
              ...rattrapage,
            },
          });
          compter();
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
        if (!aEmettre(v.client_id)) continue;
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
            rule_id: regle.id,
            champ_id: champId,
            // Voir plus haut : la règle porte `jours_avant`, l'événement aussi.
            jours_avant: decalage,
            date: v.value_date,
            // (rule_id, date) : la clé de l'anti-doublon relu plus haut —
            // rejouer le balayage le même jour ne renvoie rien.
            jour: jourLocal(maintenant, fuseau),
            ...rattrapage,
          },
        });
        compter();
      }
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
