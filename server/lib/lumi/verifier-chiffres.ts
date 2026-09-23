/**
 * Détecteur d'hallucination déterministe (2026-09-22).
 * ────────────────────────────────────────────────────
 * La règle du prompt est claire : « chaque chiffre, nom ou date vient d'un
 * résultat d'outil, jamais de ta tête ». Rien ne le VÉRIFIAIT.
 *
 * Le seul contrôle était manuel : quand Lumi a répondu « Garde-gouttières,
 * 1 910,00 $ », j'ai ouvert la base pour confirmer. C'est exactement ce
 * qu'une machine doit faire à chaque tour, gratuitement.
 *
 * Ici : tout MONTANT cité dans la réponse doit se retrouver dans les
 * résultats d'outils du tour. Sinon on lève un drapeau — on ne bloque pas
 * la réponse (un faux positif ne doit jamais priver l'utilisateur de son
 * texte), on la marque pour qu'elle soit relue.
 *
 * Pourquoi les montants seulement, et pas les noms ni les dates :
 *  - un montant a une forme stricte et se compare sans ambiguïté ;
 *  - les données arrivent en CENTS et s'affichent en dollars, donc la
 *    comparaison doit traverser cette conversion — c'est justement là que
 *    l'erreur serait invisible à l'œil ;
 *  - un nom peut légitimement être reformulé, une date recalculée
 *    (« demain »). Les vérifier produirait du bruit, et un détecteur
 *    bruyant finit ignoré.
 *
 * Tests : tests/lumi-verifier-chiffres.test.ts
 */

/** Un montant cité dans une réponse, ramené en cents pour la comparaison. */
export interface MontantCite {
  /** Le texte exact trouvé, pour le rapport. */
  texte: string;
  /** Valeur en cents : 1 910,00 $ → 191000. */
  cents: number;
}

/**
 * Montants d'une réponse en français ou en anglais : « 1 910,00 $ »,
 * « 1910$ », « $1,910.00 », « 12 500 $ ». On ignore les nombres nus (un
 * compte, une quantité) : sans symbole monétaire, « 3 factures » n'est pas
 * un montant à vérifier.
 */
export function montantsCites(texte: string): MontantCite[] {
  const out: MontantCite[] = [];
  const re = /(?:\$\s*)?(\d[\d   ,.]*\d|\d)\s*(?:\$|dollars?)|(?:\$)\s*(\d[\d   ,.]*\d|\d)/gi;
  for (const m of texte.matchAll(re)) {
    const brut = (m[1] ?? m[2] ?? '').trim();
    if (!brut) continue;
    const cents = enCents(brut);
    if (cents !== null) out.push({ texte: m[0].trim(), cents });
  }
  return out;
}

/**
 * « 1 910,00 » → 191000. Gère les deux conventions : virgule décimale
 * (français) et point décimal (anglais), avec séparateurs de milliers.
 * `null` si la forme est ambiguë — on préfère ignorer que mal compter.
 */
export function enCents(brut: string): number | null {
  const nettoye = brut.replace(/[\s  ]/g, '');
  // Dernier séparateur suivi d'exactement 2 chiffres = décimales.
  const m = nettoye.match(/^(.*?)([.,])(\d{2})$/);
  let entier: string;
  let decimales = '00';
  if (m) { entier = m[1]; decimales = m[3]; } else { entier = nettoye; }
  entier = entier.replace(/[.,]/g, '');
  if (!/^\d+$/.test(entier)) return null;
  return Number(entier) * 100 + Number(decimales);
}

/**
 * Tous les montants présents dans les résultats d'outils — cents bruts ET
 * leur écriture en dollars. Les outils rendent des `*_cents` : un montant
 * affiché « 1 910,00 $ » vient de `191000`, et c'est cette correspondance
 * qu'il faut établir.
 */
export function montantsDisponibles(resultatsOutils: string[]): Set<number> {
  const out = new Set<number>();
  for (const r of resultatsOutils) {
    // Toute suite de chiffres du JSON est un montant POSSIBLE en cents.
    for (const m of r.matchAll(/-?\d+(?:\.\d+)?/g)) {
      const n = Number(m[0]);
      if (!Number.isFinite(n)) continue;
      const abs = Math.abs(n);
      out.add(Math.round(abs));            // la valeur telle quelle (cents)
      out.add(Math.round(abs * 100));      // si l'outil rendait des dollars
    }
  }
  return out;
}

export interface VerdictChiffres {
  /** Montants cités qu'on ne retrouve nulle part dans les résultats d'outils. */
  suspects: MontantCite[];
  /** Nombre total de montants cités (pour situer les suspects). */
  cites: number;
}

/**
 * Vérifie les montants d'une réponse contre les résultats d'outils du tour.
 *
 * Tolérance d'un cent : un total affiché peut venir d'un arrondi
 * d'affichage. Au-delà, le chiffre n'a aucune source — c'est le signal.
 *
 * Sans aucun résultat d'outil, on ne conclut rien : une réponse qui ne lit
 * pas les données (« ton forfait inclut… ») cite des montants légitimes qui
 * viennent du prompt ou de la FAQ.
 */
export function verifierChiffres(reponse: string, resultatsOutils: string[]): VerdictChiffres {
  const cites = montantsCites(reponse);
  if (!cites.length || !resultatsOutils.length) return { suspects: [], cites: cites.length };
  const dispo = montantsDisponibles(resultatsOutils);
  const suspects = cites.filter((c) => !dispo.has(c.cents) && !dispo.has(c.cents - 1) && !dispo.has(c.cents + 1));
  return { suspects, cites: cites.length };
}
