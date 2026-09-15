/**
 * Garde-fous de coût du support (ce que Rafba craint : « les tokens »).
 *
 *  - PLAFOND_MODELE_PAR_JOUR : au-delà de N réponses du modèle pour une même
 *    entreprise dans les 24 dernières heures, Lumi ne rappelle plus le modèle :
 *    il renvoie vers les questions classiques (réponses fixes, 0 ¢) et offre
 *    l'équipe. Personne ne peut faire tourner le compteur.
 *  - PORTEE_CACHE_SUPPORT : le cache sémantique est partagé par ENTREPRISE
 *    (tous ses utilisateurs), pas par personne : une question déjà répondue
 *    dans l'org, même reformulée, ne coûte plus rien.
 * Les chiffres se lisent dans lumi_traces (canal 'support') :
 * scripts/qa/rapport-couts-support.mts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Portee } from '../lumi/cache-semantique';

export const PLAFOND_MODELE_PAR_JOUR = 60;

export const PORTEE_CACHE_SUPPORT = (orgId: string): Portee => ({ genre: 'tenant', orgId, userId: 'support' });

/** Réponses du modèle (étage 6, canal support) pour cette entreprise dans les 24 dernières heures. Ne lève jamais (0 en cas d'erreur). */
export async function reponsesModeleAujourdhui(admin: SupabaseClient, orgId: string): Promise<number> {
  try {
    const depuis = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error } = await admin.from('lumi_traces').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('canal', 'support').eq('etage', 6).gte('created_at', depuis);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export function texteAuPlafond(langue: 'fr' | 'en'): string {
  return langue === 'fr'
    ? "J'ai beaucoup répondu pour votre entreprise aujourd'hui, alors je passe en mode économe jusqu'à demain. Les questions classiques ci-dessous ont une réponse immédiate ; si la vôtre n'y est pas, dites-moi « je veux parler à quelqu'un » et l'équipe prend le relais."
    : "I have answered a lot for your company today, so I am in economy mode until tomorrow. The common questions below have an instant answer; if yours is not there, tell me “I want to talk to someone” and the team takes over.";
}
