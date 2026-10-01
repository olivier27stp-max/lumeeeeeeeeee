/**
 * Reste de l'ancienne API de la page Statistiques. Les données de /insights passent désormais par
 * statistiquesApi.ts (calculs en base, filtres, détail) ; ne reste ici que l'aide aux bornes locales.
 */

/** Bornes d'une période de dates LOCALES : minuit du premier jour, minuit du lendemain du dernier (exclusif). */
export function toIsoRange(from: string, to: string) {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  const endExclusive = new Date(toDate);
  endExclusive.setDate(endExclusive.getDate() + 1);
  return { fromIso: fromDate.toISOString(), toIsoExclusive: endExclusive.toISOString() };
}
