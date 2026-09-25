/* ═══════════════════════════════════════════════════════════════
   METTRE SES AUTOMATISATIONS EN PAUSE — par entreprise.

   L'interrupteur global (`AUTOMATIONS_ENABLED`, #470) coupe TOUTE la
   plateforme et n'est pilotable que par une variable d'environnement :
   seul l'éditeur peut l'actionner, et couper punirait tous les clients à
   la fois.

   Celui-ci appartient au CLIENT. Le jour où il voit partir des messages
   qu'il ne veut pas — import massif qui déclenche tout, gabarit qui part
   de travers, campagne lancée trop tôt — il arrête en un clic, sans nous
   appeler. Ce qui est parti est parti : chaque texto est facturé, et lu
   par un vrai client.

   LA FILE EST CONSERVÉE, comme pour l'interrupteur global : rien n'est
   réclamé, marqué en échec ni supprimé. Reprendre repart où on en était.
   Un interrupteur qui ferait perdre la file est un interrupteur qu'on
   n'ose pas utiliser — donc inutile le jour où il faut s'en servir.

   ── Pourquoi un cache ──
   Le moteur appelle ceci à CHAQUE événement et à chaque tâche dépilée.
   Sans cache, une entreprise active paierait une requête par événement.
   15 secondes : assez court pour qu'un arrêt d'urgence soit ressenti tout
   de suite (c'est le point de la fonctionnalité), assez long pour que
   l'écrasante majorité des appels ne touchent pas la base.

   ── Pourquoi « en cas de doute, on laisse passer » ──
   Si la lecture échoue (réseau, base indisponible), on considère
   l'entreprise NON en pause. Le contraire transformerait une panne de
   lecture en arrêt silencieux de toutes les automatisations de tous les
   clients — une panne muette bien pire que le risque qu'elle éviterait.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

/** 15 s : un arrêt d'urgence doit mordre vite. */
const DUREE_CACHE_MS = 15_000;

const cache = new Map<string, { enPause: boolean; expire: number }>();

/** Vide le cache d'une entreprise — appelé quand l'utilisateur bascule. */
export function oublierPause(orgId: string): void {
  cache.delete(orgId);
}

/** Pour les tests : repartir d'un cache vierge. */
export function viderCachePause(): void {
  cache.clear();
}

/**
 * Cette entreprise a-t-elle mis ses automatisations en pause ?
 *
 * @param supabase client service_role (le moteur n'a pas d'utilisateur)
 */
export async function orgEnPause(
  supabase: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  const maintenant = Date.now();
  const connu = cache.get(orgId);
  if (connu && connu.expire > maintenant) return connu.enPause;

  const { data, error } = await supabase
    .from('company_settings')
    .select('automations_paused')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    /*
     * On laisse passer — voir l'en-tête. On journalise quand même : une
     * lecture qui échoue en boucle doit se voir, sans quoi on croirait
     * l'interrupteur fonctionnel alors qu'il ne répond plus.
     */
    logger.error('[automations-pause] lecture impossible, on laisse passer', {
      orgId, message: error.message,
    });
    return false;
  }

  const enPause = data?.automations_paused === true;
  cache.set(orgId, { enPause, expire: maintenant + DUREE_CACHE_MS });
  return enPause;
}
