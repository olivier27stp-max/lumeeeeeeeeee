/**
 * Rejeu des événements orphelins de l'outbox (`domain_events`).
 * ==============================================================
 *
 * `eventBus.emit()` consigne chaque événement AVANT de l'émettre en mémoire,
 * et coche la ligne quand tous les écouteurs ont fini. Une ligne restée non
 * cochée veut dire que le processus est mort pendant le traitement —
 * déploiement Railway, plantage — et que l'événement a été perdu en mémoire.
 * Ce module, appelé à chaque tick du planificateur, les rejoue.
 *
 * POURQUOI UN DÉLAI DE GRÂCE. Pendant un déploiement, l'ancienne instance
 * finit ses traitements pendant que la nouvelle démarre son premier tick. Une
 * ligne de quelques secondes est presque toujours EN COURS ailleurs : la
 * rejouer tout de suite doublerait le traitement. Au-delà de `DELAI_GRACE_MS`,
 * aucun traitement normal n'est encore en vol (une action est coupée à 5 s).
 *
 * POURQUOI LE REJEU NE DOUBLE PAS LES ENVOIS. Le traitement coupé a pu passer
 * une partie des règles. Le moteur coche chaque règle traitée dans
 * `regles_traitees` (voir `noterRegleTraitee`) : le rejeu ne reprend que les
 * règles qui n'y sont pas. Seule fenêtre restante : une règle coupée ENTRE
 * son envoi et son cochage — quelques millisecondes — repassera.
 *
 * GARANTIES. Chaque rejeu est réclamé par une mise à jour conditionnelle
 * (verrou optimiste sur `attempts`) : deux instances ne rejouent jamais la
 * même ligne. Un événement qui a déjà coûté `MAX_TENTATIVES` rejeux — il fait
 * peut-être tomber le processus — est abandonné, et on le dit fort. Un
 * événement de plus de `AGE_MAX_MS` n'est plus rejoué : une confirmation qui
 * arrive deux jours plus tard fait plus de tort que de bien.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { eventBus, type CRMEvent, type CRMEventType } from './eventBus';
import { logger } from './logger';

/** En deçà, la ligne est probablement en cours de traitement ailleurs. */
export const DELAI_GRACE_MS = 3 * 60 * 1000;

/** Au-delà, l'événement n'est plus pertinent : on l'abandonne. */
export const AGE_MAX_MS = 24 * 60 * 60 * 1000;

/** Rejeux au-delà desquels l'événement est tenu pour empoisonné. */
export const MAX_TENTATIVES = 3;

/** Conservation des lignes traitées, pour le diagnostic. */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

const TAILLE_LOT = 100;

interface LigneOutbox {
  id: number;
  org_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  attempts: number;
  regles_traitees: string[] | null;
}

async function abandonner(supabase: SupabaseClient, ligne: LigneOutbox, motif: string): Promise<void> {
  const { error } = await supabase
    .from('domain_events')
    .update({ processed_at: new Date().toISOString(), last_error: `ABANDONNÉ : ${motif}` })
    .eq('id', ligne.id)
    .is('processed_at', null);
  // Une action attendue par une entreprise ne partira jamais : ce n'est pas
  // une information, c'est une alerte.
  logger.error('[outbox] événement ABANDONNÉ', {
    id: ligne.id, orgId: ligne.org_id, type: ligne.type, motif,
    ...(error ? { cochageImpossible: error.message } : {}),
  });
}

/**
 * Rejoue les événements consignés mais jamais cochés.
 *
 * Ne lève jamais : une outbox en panne ne doit pas empêcher le reste du tick.
 *
 * @returns le nombre d'événements rejoués.
 */
export async function rejouerEvenementsOrphelins(
  supabase: SupabaseClient,
  maintenant: number = Date.now(),
): Promise<number> {
  const limite = new Date(maintenant - DELAI_GRACE_MS).toISOString();
  const { data, error } = await supabase
    .from('domain_events')
    .select('id, org_id, type, entity_type, entity_id, actor_id, related_entity_type, related_entity_id, metadata, created_at, attempts, regles_traitees')
    .is('processed_at', null)
    .lt('created_at', limite)
    .order('created_at')
    .limit(TAILLE_LOT);

  if (error) {
    logger.error('[outbox] lecture impossible', { message: error.message });
    return 0;
  }

  let rejoues = 0;
  for (const ligne of (data ?? []) as LigneOutbox[]) {
    try {
      if (maintenant - Date.parse(ligne.created_at) > AGE_MAX_MS) {
        await abandonner(supabase, ligne, 'trop ancien pour être rejoué');
        continue;
      }
      if (ligne.attempts >= MAX_TENTATIVES) {
        await abandonner(supabase, ligne, `${ligne.attempts} rejeux sans aboutir`);
        continue;
      }

      // Réclamation : seule l'instance qui fait passer `attempts` de n à n+1
      // rejoue. Les autres voient 0 ligne et passent leur chemin.
      const { data: reclamee, error: errReclame } = await supabase
        .from('domain_events')
        .update({ attempts: ligne.attempts + 1 })
        .eq('id', ligne.id)
        .eq('attempts', ligne.attempts)
        .is('processed_at', null)
        .select('id');
      if (errReclame) {
        logger.error('[outbox] réclamation impossible', { id: ligne.id, message: errReclame.message });
        continue;
      }
      if (!reclamee || reclamee.length === 0) continue;

      const evenement: CRMEvent = {
        type: ligne.type as CRMEventType,
        orgId: ligne.org_id,
        entityType: ligne.entity_type,
        entityId: ligne.entity_id,
        actorId: ligne.actor_id ?? undefined,
        relatedEntityType: ligne.related_entity_type ?? undefined,
        relatedEntityId: ligne.related_entity_id ?? undefined,
        metadata: ligne.metadata ?? {},
        outboxId: ligne.id,
        reglesTraitees: [...(ligne.regles_traitees ?? [])],
      };
      logger.warn('[outbox] rejeu d\'un événement orphelin', {
        id: ligne.id, orgId: ligne.org_id, type: ligne.type, tentative: ligne.attempts + 1,
      });
      await eventBus.rejouer(ligne.id, evenement);
      rejoues++;
    } catch (e) {
      logger.error('[outbox] rejeu échoué', {
        id: ligne.id, orgId: ligne.org_id, type: ligne.type,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (rejoues > 0) logger.info('[outbox] événements rejoués', { n: rejoues });
  return rejoues;
}

/**
 * Coche une règle comme traitée pour cet événement, pour qu'un rejeu la saute.
 *
 * Appelée par le moteur après chaque règle qui a agi. Sans outbox (événement
 * non consigné, ou deal.* qui a sa propre file), ne fait rien. La liste est
 * réécrite en entier : un seul processus traite un événement à la fois (le
 * rejeu est réclamé, et n'arrive qu'après le délai de grâce).
 *
 * Ne lève jamais : un cochage manqué ne coûte, au pire, qu'une règle rejouée.
 */
export async function noterRegleTraitee(
  supabase: SupabaseClient,
  evenement: CRMEvent,
  ruleId: string,
): Promise<void> {
  if (evenement.outboxId === undefined) return;
  const liste = evenement.reglesTraitees ?? (evenement.reglesTraitees = []);
  if (!liste.includes(ruleId)) liste.push(ruleId);
  const { error } = await supabase
    .from('domain_events')
    .update({ regles_traitees: liste })
    .eq('id', evenement.outboxId);
  if (error) {
    logger.error('[outbox] règle traitée non notée — elle repasserait au rejeu', {
      id: evenement.outboxId, ruleId, message: error.message,
    });
  }
}

let dernierMenage = 0;

/**
 * Supprime les lignes traitées depuis plus de 14 jours. Au plus une fois par
 * heure : la table grossit au rythme d'`activity_log`.
 */
export async function menageOutbox(supabase: SupabaseClient, maintenant: number = Date.now()): Promise<void> {
  if (maintenant - dernierMenage < 60 * 60 * 1000) return;
  dernierMenage = maintenant;
  const { error } = await supabase
    .from('domain_events')
    .delete()
    .lt('processed_at', new Date(maintenant - RETENTION_MS).toISOString());
  if (error) logger.error('[outbox] ménage impossible', { message: error.message });
}
