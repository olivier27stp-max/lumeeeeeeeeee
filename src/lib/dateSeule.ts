/**
 * Une date sans heure se lit à minuit LOCAL — jamais à minuit UTC.
 *
 * LE PIÈGE
 * Les colonnes `date` (échéance de facture, validité de devis, date
 * d'une tâche…) arrivent de Supabase sous la forme « 2026-09-04 ». Or
 * `new Date('2026-09-04')` est défini par la norme comme minuit UTC.
 * Affiché ensuite en heure locale, c'est le 3 septembre à 20 h pour
 * tout le Canada : la facture « due le 4 » s'affiche « due le 3 », sur
 * la liste, sur la fiche, sur le PDF envoyé au client, sur le portail.
 *
 * À l'inverse, `new Date('2026-09-04T01:01:41+00:00')` (un timestamptz)
 * est un instant précis : lui doit rester tel quel.
 *
 * `versDate()` fait la différence : une date seule est construite avec
 * `new Date(année, mois, jour)`, qui est minuit local. Tout le reste
 * passe à `new Date()` inchangé.
 */

const DATE_SEULE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Vrai si la chaîne est une date sans heure (« 2026-09-04 »). */
export function estDateSeule(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && DATE_SEULE.test(valeur);
}

/**
 * Convertit ce que renvoie Supabase en `Date`, sans décalage de fuseau
 * pour les dates seules. Accepte aussi une `Date` (renvoyée telle quelle)
 * et n'importe quelle chaîne d'instant (passée à `new Date`).
 */
export function versDate(valeur: string | Date): Date {
  if (valeur instanceof Date) return valeur;
  const m = DATE_SEULE.exec(valeur);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(valeur);
}

/**
 * Dernier instant du jour, en local. Un devis « valide jusqu'au 4 »
 * l'est jusqu'à 23 h 59 le 4 — pas jusqu'à 20 h la veille.
 */
export function finDeJournee(valeur: string | Date): Date {
  const d = versDate(valeur);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
