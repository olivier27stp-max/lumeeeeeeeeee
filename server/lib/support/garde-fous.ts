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
 *  - PORTEE_CACHE_SUPPORT_GLOBALE (2026-09-17) : un « comment faire » a la
 *    même réponse pour tout le monde. Une réponse fondée sur la doc
 *    (search_help) et qui ne parle pas de CE compte (reponseGenerique) est
 *    mémorisée pour TOUTES les entreprises, par langue, 24 h : la première
 *    entreprise paie, les suivantes ont la réponse à 0 ¢.
 * Les chiffres se lisent dans lumi_traces (canal 'support') :
 * scripts/qa/rapport-couts-support.mts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Portee } from '../lumi/cache-semantique';

export const PLAFOND_MODELE_PAR_JOUR = 60;

export const PORTEE_CACHE_SUPPORT = (orgId: string): Portee => ({ genre: 'tenant', orgId, userId: 'support' });
export const PORTEE_CACHE_SUPPORT_GLOBALE = (langue: 'fr' | 'en'): Portee => ({ genre: 'global', espace: `support-${langue}` });

/** Outils d'un tour qui font une réponse « comment faire » : aucun, ou la doc seulement. */
export function outilsDeDoc(outils: string[]): boolean {
  return outils.every((o) => o === 'search_help');
}

/**
 * Cette réponse vaut-elle pour n'importe quelle entreprise ? Oui seulement si
 * elle vient de la doc (search_help appelé, rien d'autre) et ne parle pas de
 * ce compte : ni la personne, ni l'entreprise, ni le forfait, ni un chiffre
 * (les chiffres viennent du dossier), ni une phrase d'état (« déjà activé »,
 * « dans votre cas », « vous avez »). Conservateur : en cas de doute, la
 * réponse reste mémorisée pour l'entreprise seulement.
 */
export function reponseGenerique(texte: string, outils: string[], c: { userName?: string | null; companyName?: string | null; planLabel?: string | null }): boolean {
  if (!outils.includes('search_help') || !outilsDeDoc(outils)) return false;
  const t = texte.toLowerCase();
  if (!t.trim() || /\d/.test(t)) return false;
  if (/\b(déjà|already|dans votre cas|in your case|votre compte|your account|vous avez|vous êtes|you have|you are|chez vous|actuellement|currently|est activ|is enabled|is set up|n'est pas activ|isn't enabled|is not enabled)\b/i.test(t)) return false;
  for (const mot of [c.userName, c.companyName, c.planLabel]) {
    for (const p of String(mot || '').toLowerCase().split(/[\s\-']+/)) if (p.length >= 3 && t.includes(p)) return false;
  }
  return true;
}

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

/** Réponses du modèle sur le chat PUBLIC du site (toutes IP) dans les 24 dernières heures. Ne lève jamais (0 en cas d'erreur). */
export async function reponsesPubliquesAujourdhui(admin: SupabaseClient): Promise<number> {
  try {
    const depuis = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error } = await admin.from('lumi_traces').select('id', { count: 'exact', head: true }).eq('canal', 'public').eq('etage', 6).gte('created_at', depuis);
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
