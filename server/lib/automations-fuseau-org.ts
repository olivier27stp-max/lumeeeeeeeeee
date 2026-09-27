/* ═══════════════════════════════════════════════════════════════
   LE FUSEAU DE L'ENTREPRISE, POUR LES HEURES DE SILENCE.

   La fenêtre d'envoi (8 h-20 h) et les jours ouvrables étaient calculés
   dans `America/Toronto`, figé dans le moteur. Pour une entreprise
   québécoise c'est juste — Toronto et Montréal partagent offset et heure
   avancée. Pour une entreprise ailleurs, c'est faux de l'écart entre les
   deux fuseaux : à Vancouver, la fenêtre « 8 h-20 h » s'ouvrait à 5 h du
   matin et se fermait à 17 h. Un client réveillé par un texto à 5 h, et
   des relances qui ne partent plus en fin d'après-midi.

   ── Pourquoi un module et un cache ──
   Le moteur a besoin du fuseau à chaque événement traité et à chaque
   tâche dépilée. Le lire à chaque fois coûterait une requête par message.
   C'est le même raisonnement que `automations-pause-org.ts`, avec une
   durée bien plus longue : une pause doit mordre en 15 secondes, un
   fuseau ne change pratiquement jamais.

   ── Pourquoi le repli est 'America/Toronto' ──
   C'est le DEFAULT de la colonne en base (`company_settings.timezone`,
   NOT NULL). Une lecture qui échoue redonne donc exactement le
   comportement d'avant ce module, jamais un fuseau surprise.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

/** DEFAULT de company_settings.timezone — le comportement historique. */
export const FUSEAU_DEFAUT = 'America/Toronto';

/** 5 min : un fuseau ne bouge qu'à un changement de réglage, très rare. */
const DUREE_CACHE_MS = 5 * 60_000;

const cache = new Map<string, { fuseau: string; expire: number }>();

/** Vide le cache d'une entreprise — à appeler si le réglage change. */
export function oublierFuseau(orgId: string): void {
  cache.delete(orgId);
}

/** Pour les tests : repartir d'un cache vierge. */
export function viderCacheFuseau(): void {
  cache.clear();
}

/**
 * Fuseau IANA de cette entreprise, pour calculer ses heures d'envoi.
 *
 * @param supabase client service_role (le moteur n'a pas d'utilisateur)
 */
export async function fuseauOrg(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string> {
  const maintenant = Date.now();
  const connu = cache.get(orgId);
  if (connu && connu.expire > maintenant) return connu.fuseau;

  const { data, error } = await supabase
    .from('company_settings')
    .select('timezone')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    /*
     * On journalise et on retombe sur le défaut. Ne PAS mettre l'échec en
     * cache : une panne de lecture de 30 secondes ne doit pas figer le
     * mauvais fuseau pour les 5 minutes suivantes.
     */
    logger.error('[automations-fuseau] lecture impossible, repli sur le défaut', {
      orgId, message: error.message, repli: FUSEAU_DEFAUT,
    });
    return FUSEAU_DEFAUT;
  }

  const brut = (data?.timezone as string | undefined)?.trim();
  /*
   * La base valide déjà le fuseau (CHECK is_valid_timezone), mais ce module
   * peut aussi tourner contre une ligne absente ou un environnement plus
   * vieux. Un fuseau inconnu passé à Intl LÈVE — ce qui ferait tomber le
   * moteur entier, pour tous les clients, à cause du réglage d'un seul.
   */
  let fuseau = FUSEAU_DEFAUT;
  if (brut) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: brut });
      fuseau = brut;
    } catch {
      logger.error('[automations-fuseau] fuseau inconnu, repli sur le défaut', {
        orgId, fuseau: brut, repli: FUSEAU_DEFAUT,
      });
    }
  }

  cache.set(orgId, { fuseau, expire: maintenant + DUREE_CACHE_MS });
  return fuseau;
}
