/**
 * Le pipeline de ventes déclenche enfin des actions.
 * ==================================================
 *
 * CE QUI MANQUAIT. Les triggers de `deals` écrivaient fidèlement dans
 * `pipeline_events` à chaque changement d'étape — entrée, sortie — et la
 * fonction `pipeline_detecter_stagnation()` savait repérer les deals qui
 * dorment. Mais AUCUNE ligne de serveur ne lisait cette table, et aucun
 * planificateur n'appelait cette fonction. Les événements s'accumulaient dans
 * le vide : le pipeline ne déclenchait rien.
 *
 * Ce module est le consommateur qui manquait.
 *
 * POURQUOI UNE FILE EN BASE plutôt que le bus en mémoire. Le bus
 * (`eventBus.ts`) ne survit pas à un redémarrage et n'entend que ce que le
 * serveur lui-même a émis. Or un deal change d'étape depuis l'écran, depuis
 * Lumi, depuis un import, ou depuis une requête SQL d'urgence — et un
 * déploiement Railway au mauvais moment ferait perdre l'événement. La file
 * `pipeline_events`, alimentée par trigger, attrape TOUS les cas et survit au
 * redémarrage. Le bus reste utilisé en bout de chaîne, pour que les règles du
 * moteur existant s'appliquent sans être réécrites.
 *
 * GARANTIES. Chaque événement porte une clé d'unicité (qui inclut
 * l'horodatage d'entrée en étape) : le même mouvement ne se rejoue jamais
 * deux fois, mais un deal qui RESSORT puis RENTRE dans une étape redéclenche
 * bien ses actions. Un événement en échec est marqué et réessayé, puis
 * abandonné après MAX_TENTATIVES — un événement empoisonné ne doit pas bloquer
 * la file derrière lui.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { eventBus, type CRMEventType } from './eventBus';
import { logger } from './logger';

/** Au-delà, l'événement est abandonné : il bloquerait la file indéfiniment. */
const MAX_TENTATIVES = 4;

/** Taille d'un lot. Assez pour rattraper un retard, assez petit pour un tick. */
const TAILLE_LOT = 200;

interface EvenementPipeline {
  id: number;
  org_id: string;
  deal_id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Traite les événements du pipeline en attente.
 *
 * Appelée à chaque tick du planificateur. Ne lève jamais : une file en échec
 * ne doit pas empêcher le reste du tick (factures en retard, devis expirés)
 * de tourner.
 *
 * @returns le nombre d'événements traités avec succès.
 */
export async function traiterEvenementsPipeline(supabase: SupabaseClient): Promise<number> {
  let traites = 0;

  const { data, error } = await supabase
    .from('pipeline_events')
    .select('id, org_id, deal_id, type, payload, attempts')
    .is('processed_at', null)
    .lt('attempts', MAX_TENTATIVES)
    .order('created_at')
    .limit(TAILLE_LOT);

  if (error) {
    logger.error('[pipeline/evenements] lecture de la file impossible', { message: error.message });
    return 0;
  }

  const evenements = (data ?? []) as EvenementPipeline[];
  if (evenements.length === 0) return 0;

  for (const ev of evenements) {
    try {
      // Le bus applique les règles de `automation_rules` : on ne réécrit pas
      // la correspondance des conditions ni la planification des délais, qui
      // sont déjà éprouvées.
      await eventBus.emit(ev.type as CRMEventType, {
        orgId: ev.org_id,
        // `deal` est l'entité : c'est ce que résout `resolveEntityVariables`
        // pour remplir {client_name}, {deal_stage}, {deal_jours_dans_etape}.
        entityType: 'deal',
        entityId: ev.deal_id,
        metadata: ev.payload ?? {},
      });

      const { error: majErr } = await supabase
        .from('pipeline_events')
        .update({ processed_at: new Date().toISOString(), last_error: null })
        .eq('id', ev.id);

      if (majErr) {
        // L'événement a bien été émis mais on n'a pas pu le marquer : il
        // repassera. C'est le bon compromis — au pire une action se répète,
        // au pire elle ne part jamais. On préfère le premier, et on le dit.
        logger.error('[pipeline/evenements] marquage impossible après émission', {
          id: ev.id, orgId: ev.org_id, message: majErr.message,
        });
      } else {
        traites++;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const tentatives = ev.attempts + 1;
      await supabase
        .from('pipeline_events')
        .update({ attempts: tentatives, last_error: message.slice(0, 500) })
        .eq('id', ev.id);

      // Au dernier échec, on le dit fort : l'événement ne sera plus retenté,
      // et une action attendue par l'utilisateur ne partira jamais.
      const grave = tentatives >= MAX_TENTATIVES;
      logger.error(
        grave
          ? '[pipeline/evenements] ABANDONNÉ après tentatives répétées'
          : '[pipeline/evenements] échec, sera réessayé',
        { id: ev.id, orgId: ev.org_id, type: ev.type, tentatives, message },
      );
    }
  }

  if (traites > 0) {
    logger.info('[pipeline/evenements] traités', { n: traites });
  }
  return traites;
}

/**
 * Repère les deals qui dorment et pose un événement « stage_idle ».
 *
 * La fonction SQL fait tout le travail : elle ne regarde que les étapes
 * ouvertes (un deal gagné n'est pas « sans activité », il est fini) et lit le
 * seuil dans les conditions de chaque règle (`idle_days`, 7 par défaut).
 * Elle est idempotente par jour : un deal qui dort depuis trois semaines ne
 * produit pas vingt et une relances.
 *
 * Elle n'était appelée par AUCUN planificateur — c'est ce qui rendait le
 * déclencheur « sans activité » inopérant malgré son existence en base.
 */
export async function detecterStagnation(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc('pipeline_detecter_stagnation');
  if (error) {
    logger.error('[pipeline/stagnation] détection impossible', { message: error.message });
    return 0;
  }
  const n = typeof data === 'number' ? data : 0;
  if (n > 0) logger.info('[pipeline/stagnation] deals signalés', { n });
  return n;
}
