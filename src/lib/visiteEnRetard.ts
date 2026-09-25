/**
 * Une visite est-elle en retard ?
 *
 * La page d'une job affiche « EN RETARD » et il est juste. Les tuiles du
 * calendrier, elles, ne montraient rien : une visite d'hier et une de demain
 * se ressemblaient (QA 2026-09-25). Il fallait ouvrir chaque job pour savoir.
 *
 * La règle est celle de la base, pas une approximation : `derived_status`
 * vaut `late` quand il existe une visite dont l'heure de début est passée et
 * qui n'est ni terminée ni annulée. On la reproduit ici pour éviter un
 * aller-retour au serveur sur chaque tuile — et parce que les données
 * nécessaires (`start_at`, `status`) sont déjà chargées.
 *
 * Voir `supabase/migrations/20260752000000_job_tags.sql` (vue jobs_with_*) :
 *
 *     se.start_at < now()
 *     and lower(coalesce(se.status, '')) not in ('completed', 'cancelled')
 *
 * Si cette définition change en base, elle doit changer ici — le test
 * `visite-en-retard.test.ts` cite la migration pour qu'on le sache.
 */

/** Statuts qui retirent une visite du décompte des retards. */
const STATUTS_CLOS = new Set(['completed', 'cancelled']);

export interface VisitePourRetard {
  start_at?: string | null;
  status?: string | null;
}

/**
 * `true` si la visite est passée sans avoir été ni terminée ni annulée.
 *
 * `maintenant` est injectable : un test qui dépend de l'horloge réelle
 * devient vert ou rouge selon l'heure d'exécution.
 */
export function visiteEnRetard(visite: VisitePourRetard | null | undefined, maintenant: Date = new Date()): boolean {
  if (!visite?.start_at) return false;
  const debut = new Date(visite.start_at);
  if (Number.isNaN(debut.getTime())) return false;
  if (debut.getTime() >= maintenant.getTime()) return false;
  const statut = String(visite.status ?? '').trim().toLowerCase();
  return !STATUTS_CLOS.has(statut);
}
