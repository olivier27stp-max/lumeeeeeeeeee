/**
 * Escalade humaine (item 12, AGENTFORCE_GAP.md B7).
 * ─────────────────────────────────────────────────
 * Quand Lumi ne peut pas finir proprement, quelqu'un doit le savoir — pas
 * seulement le modèle, qui dit « ça n'a pas marché » et passe à autre chose.
 * Motifs :
 *   - effet_partiel : une écriture s'est arrêtée à mi-chemin (job créé sans
 *     ses articles, envoi « peut-être parti ») — l'empreinte est gardée, il
 *     faut un humain pour compléter ou vérifier ;
 *   - refus_modele   : le modèle a refusé (stop_reason refusal) ;
 *   - trop_d_etapes  : la boucle d'outils a atteint son plafond sans réponse ;
 *   - plafond_ecritures : la conversation a atteint le maximum d'écritures.
 * Transmission : une notification au(x) propriétaire(s) de l'org (type
 * lumi_escalade, lien vers la conversation) — le pattern du briefing du
 * matin. Une seule par (conversation, motif) : le second incident du même
 * genre dans la même conversation n'en crée pas une deuxième.
 * Aucun modèle impliqué. org_id et user_id viennent du contexte serveur.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';

export type MotifEscalade = 'effet_partiel' | 'refus_modele' | 'trop_d_etapes' | 'plafond_ecritures';

const TITRES: Record<MotifEscalade, { fr: string; en: string }> = {
  effet_partiel: { fr: 'Lumi : une action à vérifier', en: 'Lumi: an action to check' },
  refus_modele: { fr: 'Lumi a refusé une demande', en: 'Lumi declined a request' },
  trop_d_etapes: { fr: 'Lumi n’a pas pu finir', en: 'Lumi could not finish' },
  plafond_ecritures: { fr: 'Lumi : maximum d’actions atteint', en: 'Lumi: action limit reached' },
};

/** Le contenu d'un tool_result d'écriture révèle-t-il un effet partiel ? (incomplet / incertain, posés par executerIdempotent). */
export function motifDansResultat(contenu: string): MotifEscalade | null {
  try {
    const j = JSON.parse(contenu);
    const r = j?.result ?? j;
    if (r && typeof r === 'object' && (r.incomplet === true || r.incertain === true)) return 'effet_partiel';
  } catch { /* pas du JSON : rien à escalader */ }
  return null;
}

export async function escalader(admin: SupabaseClient, e: {
  orgId: string;
  userId: string;
  conversationId: string | null;
  motif: MotifEscalade;
  /** Une phrase lisible (ce qui s'est passé), jamais un message d'erreur brut. */
  detail: string;
  fr: boolean;
}): Promise<void> {
  const lien = e.conversationId ? `/lumi?c=${e.conversationId}` : '/lumi';
  try {
    const { data: proprietaires, error } = await admin
      .from('memberships').select('user_id')
      .eq('org_id', e.orgId).eq('status', 'active').in('role', ['owner', 'admin']);
    if (error) throw error;
    const cibles = new Set<string>((proprietaires ?? []).map((m: any) => String(m.user_id)));
    cibles.add(e.userId); // la personne qui parlait à Lumi est toujours prévenue
    // Une seule notification par (conversation, motif) : on regarde ce qui existe déjà.
    const { data: deja } = await admin
      .from('notifications').select('user_id')
      .eq('org_id', e.orgId).eq('type', 'lumi_escalade').eq('link', lien).eq('icon', e.motif);
    const dejaPrevenus = new Set<string>((deja ?? []).map((n: any) => String(n.user_id)));
    const lignes = [...cibles].filter((u) => !dejaPrevenus.has(u)).map((user_id) => ({
      org_id: e.orgId, user_id, type: 'lumi_escalade', category: 'lumi',
      title: TITRES[e.motif][e.fr ? 'fr' : 'en'],
      body: e.detail.length > 180 ? `${e.detail.slice(0, 177)}…` : e.detail,
      link: lien,
      // Le motif voyage dans `icon` (colonne texte existante, non affichée pour ce type) : c'est la clé de dédoublonnage.
      icon: e.motif,
    }));
    if (!lignes.length) return;
    const { error: eIns } = await admin.from('notifications').insert(lignes);
    if (eIns) throw eIns;
    logger.info('[lumi/escalade] notification envoyée', { orgId: e.orgId, motif: e.motif, destinataires: lignes.length });
  } catch (err: any) {
    logger.error('[lumi/escalade] escalade non envoyée', { error: err?.message || String(err), orgId: e.orgId, motif: e.motif });
  }
}
