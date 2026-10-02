/* ═══════════════════════════════════════════════════════════════
   Le contexte de page de Lumi : d'OÙ l'on vient quand on lui parle.

   La page Lumi est une page à part. Quand on y arrive depuis l'éditeur
   d'une automatisation (`/lumi?automatisation=<id>`), elle envoie ce
   repère avec chaque message : Lumi sait alors de quelle automatisation
   on parle sans qu'on la nomme (mission finale, P1-3).
   ═══════════════════════════════════════════════════════════════ */

/**
 * La page d'où l'on parle à Lumi — aujourd'hui, l'éditeur d'une automatisation.
 * Un simple REPÈRE : le serveur relit l'automatisation lui-même (avec le jeton de
 * la personne) et en donne le résumé à Lumi, qui sait alors de laquelle on parle
 * sans qu'on la nomme. `non_enregistre` : l'éditeur a des modifications que
 * l'enregistrement automatique n'a pas encore écrites.
 */
export interface ContextePageLumi { type: 'automatisation'; rule_id: string; non_enregistre?: boolean }

/**
 * L'adresse qui ouvre Lumi SUR une automatisation : `/lumi?automatisation=<id>`.
 * C'est le lien que l'éditeur d'automatisations offre (« Demander à Lumi »).
 */
export function lienLumiSurAutomatisation(ruleId: string, o: { nom?: string | null; nonEnregistre?: boolean } = {}): string {
  const q = new URLSearchParams({ automatisation: ruleId });
  if (o.nom) q.set('nom', o.nom.slice(0, 120));
  if (o.nonEnregistre) q.set('brouillon', '1');
  return `/lumi?${q.toString()}`;
}

/** Lit le contexte de page dans l'adresse de la page Lumi (null si absent ou invalide). */
export function contextePageDepuisAdresse(params: URLSearchParams): (ContextePageLumi & { nom: string | null }) | null {
  const id = params.get('automatisation');
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { type: 'automatisation', rule_id: id, non_enregistre: params.get('brouillon') === '1', nom: params.get('nom')?.slice(0, 120) || null };
}
