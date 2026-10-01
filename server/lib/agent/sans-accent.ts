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

/** Vrai si le champ et le mot sont le même texte, aux accents et à la casse près. */
export function egalSansAccent(champ: unknown, mot: string): boolean {
  return sansAccent(champ).trim() === sansAccent(mot).trim();
}
