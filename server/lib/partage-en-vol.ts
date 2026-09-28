/**
 * Partage d'une vérification EN COURS entre requêtes simultanées.
 *
 * Une page lance ses appels /api en même temps : avec un jeton neuf, les
 * caches de session sont vides pour tous, et chacun refaisait getUser + le
 * bureau + l'abonnement (5-6 allers-retours, ~1 s en prod le 2026-09-28).
 * Le premier appel calcule, les autres attendent sa réponse. Rien n'est
 * gardé après : la durée de vie reste celle du cache de l'appelant.
 */
export function creerPartageEnVol<T>() {
  const enVol = new Map<string, Promise<T>>();
  return (cle: string, calcul: () => Promise<T>): Promise<T> => {
    const courant = enVol.get(cle);
    if (courant) return courant;
    const promesse = calcul().finally(() => enVol.delete(cle));
    enVol.set(cle, promesse);
    return promesse;
  };
}
