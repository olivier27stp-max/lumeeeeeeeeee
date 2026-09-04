/**
 * Une date sans heure (« 2026-09-04 ») se compare à la date du jour DANS
 * LE FUSEAU DE L'ENTREPRISE — jamais à un instant UTC.
 *
 * LE PIÈGE
 * `new Date('2026-09-04') < new Date()` est vrai dès minuit UTC le 4,
 * soit 20 h le 3 à Montréal. Un devis « valide jusqu'au 4 » était donc
 * refusé à l'approbation pendant TOUTE sa dernière journée de validité.
 *
 * Ici, on ne fabrique aucun instant : on compare deux dates civiles.
 * « Aujourd'hui » est calculé par Intl dans le fuseau demandé, ce qui
 * absorbe l'heure d'été sans arithmétique.
 */

/** Repli documenté du projet quand le tenant n'a rien configuré. */
export const FUSEAU_PAR_DEFAUT = 'America/Toronto';

/** La date du jour (« 2026-09-04 ») dans le fuseau donné. */
export function dateDuJour(timeZone: string = FUSEAU_PAR_DEFAUT, maintenant: Date = new Date()): string {
  // en-CA formate en AAAA-MM-JJ, exactement la forme que renvoie Postgres.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(maintenant);
}

/**
 * Vrai si la date seule est STRICTEMENT passée : le jour même compte
 * encore comme valide. `null`/`undefined` ne sont jamais échus.
 */
export function estEchue(dateSeule: string | null | undefined, timeZone?: string, maintenant?: Date): boolean {
  if (!dateSeule) return false;
  return dateSeule.slice(0, 10) < dateDuJour(timeZone, maintenant);
}
