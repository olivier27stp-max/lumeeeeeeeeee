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

/**
 * Plafonds de TAILLE des résultats d'outils (2026-09-30).
 * ───────────────────────────────────────────────────────
 * Mesuré en production : un tour sur « quel est mon chiffre du mois » a envoyé
 * 61 776 tokens d'entrée NON cachés en un seul appel — 16,88 ¢ pour une
 * question de 28 caractères. Ce n'était pas le prompt (en cache, 19 046 lus) :
 * c'était ce que les outils avaient rendu. Un résultat d'outil arrive APRÈS le
 * point de cache, donc il est facturé plein tarif d'entrée, à chaque étape.
 *
 * Deux bornes, parce qu'une seule ne suffit pas : un résultat démesuré, et huit
 * résultats raisonnables qui s'empilent sur les 8 étapes d'un tour.
 *  - 20 000 caractères par résultat ≈ 5 700 tokens ≈ 1,1 ¢ (environ 250 jobs
 *    en table, largement au-delà de ce qu'une réponse utile cite) ;
 *  - 60 000 caractères pour tout le tour ≈ 17 000 tokens ≈ 3,4 ¢, contre
 *    216 000 caractères observés.
 * Réglables par variable d'env, bornées (jamais 0, jamais l'infini), comme les
 * plafonds de regles-cout.ts.
 */
function tailleEnv(cle: string, defaut: number, min: number, max: number): number {
  const brut = process.env[cle];
  if (brut === undefined || brut === '') return defaut;
  const v = Number(brut);
  if (!Number.isFinite(v)) return defaut;
  return Math.round(Math.min(max, Math.max(min, v)));
}

/** Par résultat d'outil. `LUMI_TAILLE_MAX_RESULTAT`. */
export const TAILLE_MAX_RESULTAT = tailleEnv('LUMI_TAILLE_MAX_RESULTAT', 20_000, 2_000, 200_000);
/** Somme des résultats d'outils d'un même tour. `LUMI_TAILLE_MAX_TOUR`. */
export const TAILLE_MAX_TOUR = tailleEnv('LUMI_TAILLE_MAX_TOUR', 60_000, 4_000, 600_000);
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

interface Table { columns: string[]; rows: unknown[][]; count: number; rows_omitted?: number }

function estTable(v: unknown): v is Table {
  if (!estObjetPlat(v)) return false;
  return Array.isArray(v.columns) && Array.isArray(v.rows);
}

/** Toutes les tables de la structure, à tout niveau, dans l'ordre de parcours. */
function tables(v: unknown, trouvees: Table[] = []): Table[] {
  if (estTable(v)) trouvees.push(v);
  if (Array.isArray(v)) for (const x of v) tables(x, trouvees);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) tables(x, trouvees);
  return trouvees;
}

/** Raccourcit les chaînes de plus de `max` caractères, en profondeur. Déterministe. */
function couperChaines(v: unknown, max: number): unknown {
  if (typeof v === 'string') return v.length <= max ? v : `${v.slice(0, max)}…[coupé]`;
  if (Array.isArray(v)) return v.map((x) => couperChaines(x, max));
  if (estObjetPlat(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = couperChaines(val, max);
    return out;
  }
  return v;
}

/**
 * Texte final donné au modèle, borné à `max` caractères.
 *
 * On ne coupe JAMAIS le JSON au caractère (ce que faisait la version
 * précédente) : le modèle reçoit alors un objet illisible, repart en
 * exploration et paie un deuxième tour — l'inverse du but. On retire des
 * LIGNES, en gardant un JSON valide et en disant combien manquent
 * (`rows_omitted`), pour que Lumi sache que sa liste est partielle. Les champs
 * de tête (`total_matching`, `sum_*_cents`) ne bougent pas : ils sont frères de
 * la liste, donc le vrai total reste annonçable.
 *
 * Déterministe : à entrée égale, même texte — le préfixe en cache reste valide.
 */
export function serialiserResultat(v: unknown, max = TAILLE_MAX_RESULTAT): string {
  const c = compacter(v);
  let texte = JSON.stringify(c === undefined ? null : c);
  if (texte.length <= max) return texte;

  // 1. Les lignes, en commençant par la plus grosse table.
  for (const t of tables(c).sort((a, b) => b.rows.length - a.rows.length)) {
    while (t.rows.length > 0 && texte.length > max) {
      const aRetirer = Math.max(1, Math.ceil(t.rows.length * 0.2));
      t.rows.splice(t.rows.length - aRetirer, aRetirer);
      t.rows_omitted = (t.rows_omitted ?? 0) + aRetirer;
      texte = JSON.stringify(c);
    }
    if (texte.length <= max) return texte;
  }

  // 2. Pas de table, ou des champs texte démesurés (une note, un corps de courriel).
  for (const borne of [2_000, 500, 120]) {
    texte = JSON.stringify(couperChaines(c, borne));
    if (texte.length <= max) return texte;
  }

  // 3. Rien n'a suffi : un objet valide qui le DIT, plutôt qu'un JSON cassé.
  // Volontairement minimal (28 caractères) — c'est le plancher de la borne, et
  // le modèle n'a besoin de savoir que ça ; le détail va dans le journal.
  return JSON.stringify({ error: 'result_too_large' });
}
