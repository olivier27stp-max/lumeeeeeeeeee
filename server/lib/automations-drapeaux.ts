/* ═══════════════════════════════════════════════════════════════
   DRAPEAUX DES CAPACITÉS D'AUTOMATISATION — un par entreprise.

   Chaque capacité ajoutée au moteur (désabonnement par canal, sortie
   automatique du parcours, soumission/facture consultée, paiement échoué,
   client inactif) vit derrière SON drapeau, dans `org_features` — la même
   table que les modules (`/api/features`, Creator Space).

   Drapeau absent ou `enabled = false` = le moteur se comporte EXACTEMENT
   comme avant ; c'est ce que vérifie le filet de régression
   (tests/automation/filet-regression.test.ts). Retour arrière = remettre le
   drapeau à OFF, rien à défaire en base.

   ── En cas de doute, OFF ──
   Une lecture qui échoue rend « OFF » : l'ancien comportement est le seul
   qu'on sait sûr. L'inverse activerait une capacité en rodage chez une
   entreprise qui ne l'a jamais demandée, sur un simple hoquet réseau.

   ── Cache ──
   Le moteur interroge ceci à chaque événement et à chaque tâche dépilée.
   30 s : activer ou couper est ressenti presque tout de suite, et
   l'écrasante majorité des appels ne touchent pas la base.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

/** Les cinq capacités, dans l'ordre de livraison. */
export const DRAPEAUX_AUTOMATISATIONS = {
  desabonnementCanal: 'auto_desabonnement_canal',
  sortieParcours: 'auto_sortie_parcours',
  consultationDocuments: 'auto_consultation_documents',
  paiementEchoue: 'auto_paiement_echoue',
  clientInactif: 'auto_client_inactif',
} as const;

export type CleDrapeauAutomatisation = (typeof DRAPEAUX_AUTOMATISATIONS)[keyof typeof DRAPEAUX_AUTOMATISATIONS];

const DUREE_CACHE_MS = 30_000;
const cache = new Map<string, { actifs: Set<string>; expire: number }>();

/** Pour les tests, et quand une entreprise bascule un drapeau. */
export function oublierDrapeaux(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

/**
 * Ce drapeau est-il actif pour cette entreprise ?
 *
 * Lit TOUTES les lignes de l'entreprise puis cherche la clé : une seule
 * requête sert les cinq drapeaux, et le cache les garde ensemble.
 */
export async function drapeauActif(
  supabase: SupabaseClient,
  orgId: string | null | undefined,
  cle: CleDrapeauAutomatisation,
): Promise<boolean> {
  if (!orgId) return false;
  const enCache = cache.get(orgId);
  if (enCache && enCache.expire > Date.now()) return enCache.actifs.has(cle);
  try {
    const { data, error } = await supabase
      .from('org_features')
      .select('feature, enabled')
      .eq('org_id', orgId);
    if (error) throw new Error(error.message);
    const actifs = new Set<string>();
    for (const ligne of (Array.isArray(data) ? data : []) as Array<{ feature?: string; enabled?: boolean }>) {
      if (ligne?.enabled === true && typeof ligne.feature === 'string') actifs.add(ligne.feature);
    }
    cache.set(orgId, { actifs, expire: Date.now() + DUREE_CACHE_MS });
    return actifs.has(cle);
  } catch (err: any) {
    logger.error('[automations-drapeaux] lecture impossible — capacité considérée OFF', { orgId, cle, error: err?.message || String(err) });
    return false;
  }
}
