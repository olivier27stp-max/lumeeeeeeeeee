/**
 * Compression des résultats d'outils avant de les donner au modèle (audit Lumi B5).
 * ─────────────────────────────────────────────────────────────────────────
 * Mesuré au sondage du 2026-09-16 : une liste de jobs ou de factures pèse
 * 1 400 à 4 500 tokens en JSON complet, écrite au cache 5 min puis relue à
 * chaque échantillonnage — 23 % du coût d'un tour chaud. Le JSON répète le
 * nom de chaque champ à chaque ligne (« "client_name": », « "status": », …).
 *
 * Deux transformations, déterministes (le même résultat donne le même texte,
 * donc le préfixe déjà en cache reste valide) et sans perte d'information :
 *  1. les valeurs null / undefined disparaissent (l'absence dit la même chose) ;
 *     les tableaux vides, 0 et false restent (ils portent un sens) ;
 *  2. une liste d'au moins 5 objets plats devient { columns, rows, count } :
 *     les noms de champs ne sont écrits qu'une fois. Les cellules gardent
 *     leur valeur telle quelle (nombre, chaîne, objet imbriqué).
 * Les champs de tête (total_matching, sum_*_cents…) ne bougent pas.
 */

export const TAILLE_MAX_RESULTAT = 60_000;
export const LIGNES_MIN_TABLE = 5;

function estObjetPlat(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Retire null/undefined en profondeur (objets ET tableaux). */
export function sansVides(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) return v.map((x) => sansVides(x)).filter((x) => x !== undefined);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const c = sansVides(val);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return v;
}

/** Une liste de ≥ 5 objets plats → { columns, rows, count }. Sinon inchangé. */
export function enTable(liste: unknown[]): unknown {
  if (liste.length < LIGNES_MIN_TABLE || !liste.every(estObjetPlat)) return liste;
  const colonnes: string[] = [];
  for (const o of liste as Record<string, unknown>[]) for (const k of Object.keys(o)) if (!colonnes.includes(k)) colonnes.push(k);
  if (colonnes.length === 0 || colonnes.length > 40) return liste;
  const rows = (liste as Record<string, unknown>[]).map((o) => colonnes.map((c) => (c in o ? o[c] : null)));
  return { columns: colonnes, rows, count: liste.length };
}

/** Parcours complet : vides retirés, listes homogènes mises en table (à tout niveau). */
export function compacter(v: unknown): unknown {
  const propre = sansVides(v);
  const parcourir = (x: unknown): unknown => {
    if (Array.isArray(x)) {
      const elems = x.map(parcourir);
      return enTable(elems);
    }
    if (estObjetPlat(x)) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) out[k] = parcourir(val);
      return out;
    }
    return x;
  };
  return parcourir(propre);
}

/** Texte final donné au modèle (tronqué à TAILLE_MAX_RESULTAT caractères). */
export function serialiserResultat(v: unknown, max = TAILLE_MAX_RESULTAT): string {
  const c = compacter(v);
  return JSON.stringify(c === undefined ? null : c).slice(0, max);
}
