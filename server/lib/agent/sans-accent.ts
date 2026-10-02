/**
 * Chercher un nom sans dépendre des accents (2026-10-01, éval en prod).
 * ─────────────────────────────────────────────────────────────────────────
 * « texte à nathalie coté » : la fiche s'appelle « Nathalie Côté », la recherche (ILIKE)
 * ne la trouvait pas et Lumi demandait l'orthographe. Dicté ou tapé vite, un nom arrive
 * sans ses accents, ou avec d'autres.
 *
 * La base n'a pas de colonne de recherche sans accent, et on n'ajoute pas de migration
 * pour ça : on demande à la base un motif LARGE (chaque lettre qui peut porter un accent
 * devient « _ », un caractère quelconque), puis on garde en mémoire les seules lignes dont
 * le texte, accents retirés, contient vraiment le mot. Le motif large ne sert qu'à ramener
 * les candidats ; c'est le second filtre qui décide.
 */

/** Minuscules, sans accents ni cédille. */
export function sansAccent(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const PORTE_ACCENT = /[aeiouycnàâäáãåèéêëìíîïòóôöõùúûüýÿçñœæ]/i;

/** Le mot en motif ILIKE où chaque lettre accentuable est un caractère quelconque. Les jokers d'origine sont neutralisés. */
export function motifSansAccent(mot: string): string {
  return [...String(mot)].map((c) => (c === '%' || c === '_' || c === '\\' ? ' ' : PORTE_ACCENT.test(c) ? '_' : c)).join('');
}

/** Vrai si l'un des champs, accents retirés, contient le mot, accents retirés. */
export function contientSansAccent(champs: unknown[], mot: string): boolean {
  const m = sansAccent(mot).trim();
  return !!m && champs.some((c) => sansAccent(c).includes(m));
}

/**
 * Deux mots « proches » : le même mot à UNE lettre près (changée, ajoutée ou retirée), accents
 * retirés et « y » lu comme « i ». C'est ce que fait la dictée : « Roi » pour « Roy », « Trembley »
 * pour « Tremblay », « Gagnion » pour « Gagnon ». Jamais pour un mot de moins de 3 lettres : à cette
 * taille, une lettre d'écart est un autre mot.
 */
export function motProche(a: string, b: string): boolean {
  const norme = (s: string) => sansAccent(s).replace(/y/g, 'i').replace(/[^a-z0-9]/g, '');
  const x = norme(a); const y = norme(b);
  if (x === y) return x.length > 0;
  if (x.length < 3 || y.length < 3 || Math.abs(x.length - y.length) > 1) return false;
  // Une seule différence : on avance tant que ça concorde, on saute UNE lettre, le reste doit concorder.
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i += 1;
  const reste = (s: string, n: number) => s.slice(n);
  return reste(x, i + 1) === reste(y, i + 1)   // une lettre changée
    || reste(x, i + 1) === reste(y, i)         // une lettre en trop dans a
    || reste(x, i) === reste(y, i + 1);        // une lettre en trop dans b
}

/** Vrai si le champ et le mot sont le même texte, aux accents et à la casse près. */
export function egalSansAccent(champ: unknown, mot: string): boolean {
  return sansAccent(champ).trim() === sansAccent(mot).trim();
}
