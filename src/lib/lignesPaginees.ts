/**
 * Lecture de TOUTES les lignes d'une requête PostgREST, page par page.
 *
 * PostgREST plafonne chaque réponse à max_rows = 1000 (prod comprise) et ne lève
 * aucune erreur : une somme faite sur une seule réponse est fausse en silence dès
 * la 1001e ligne (audit Statistiques : « Revenu par service » affichait 2,8 % du vrai
 * chiffre sur 3 ans).
 */
export const TAILLE_PAGE = 1000;

type Reponse<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Pagination par CURSEUR sur `id` (pour les tables). Chaque page coûte le même prix :
 * avec un OFFSET, la page n refaisait le parcours — RLS comprise — des n × 1 000 lignes
 * précédentes (12 s pour 35 000 paiements sur le tenant volumineux de l'audit).
 * `page(apresId)` doit appliquer `.gt('id', apresId)` quand il est non nul, puis
 * `.order('id').limit(TAILLE_PAGE)`.
 */
export async function toutesLesLignesParId<T extends { id: string }>(page: (apresId: string | null) => Reponse<T>): Promise<T[]> {
  const lignes: T[] = [];
  let apres: string | null = null;
  for (;;) {
    const { data, error } = await page(apres);
    if (error) throw error;
    const lot = data ?? [];
    lignes.push(...lot);
    if (lot.length < TAILLE_PAGE) return lignes;
    apres = lot[lot.length - 1].id;
  }
}

/**
 * Pagination par plage (pour les RPC, qui n'ont pas de curseur). La requête doit porter
 * un ordre stable (.order(...)) : sans lui, deux pages peuvent se chevaucher.
 */
export async function toutesLesLignes<T>(page: (from: number, to: number) => Reponse<T>): Promise<T[]> {
  const lignes: T[] = [];
  for (let from = 0; ; from += TAILLE_PAGE) {
    const { data, error } = await page(from, from + TAILLE_PAGE - 1);
    if (error) throw error;
    const lot = data ?? [];
    lignes.push(...lot);
    if (lot.length < TAILLE_PAGE) return lignes;
  }
}

/**
 * Même chose, pages demandées EN PARALLÈLE une fois le total connu (1re page avec
 * count: 'exact'). Pour les RPC qui recalculent tout à chaque appel : le temps total
 * est celui d'un appel, pas de n appels à la suite.
 */
export async function toutesLesLignesEnParallele<T>(
  page: (from: number, to: number, compter: boolean) => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>,
): Promise<T[]> {
  const premiere = await page(0, TAILLE_PAGE - 1, true);
  if (premiere.error) throw premiere.error;
  const total = premiere.count ?? (premiere.data ?? []).length;
  const suites = [];
  for (let from = TAILLE_PAGE; from < total; from += TAILLE_PAGE) suites.push(page(from, from + TAILLE_PAGE - 1, false));
  const reponses = await Promise.all(suites);
  const lignes = [...(premiere.data ?? [])];
  for (const r of reponses) {
    if (r.error) throw r.error;
    lignes.push(...(r.data ?? []));
  }
  return lignes;
}
