/* ═══════════════════════════════════════════════════════════════
   ACTIVATION SANS EFFET RÉTROACTIF (mission finale, point 10).

   Décision : une automatisation qu'on active ne réagit qu'à ce qui arrive
   APRÈS son activation. Elle n'écrit pas d'un coup à tout ce qui était déjà
   en retard, dormant ou inactif ce jour-là.

   Les déclencheurs « sur événement » (devis envoyé, job terminé…) respectent
   cette règle par construction : l'événement arrive, ou il n'arrive pas. Ce
   module sert aux déclencheurs de BALAYAGE, qui constatent un ÉTAT :
     · « Opportunité qui dort »  → le seuil doit être franchi après l'activation ;
     · « Client inactif »        → idem (dernier job + N mois) ;
     · « Date atteinte »         → un balayage manqué n'est rattrapé que pour
                                   les jours où la règle était déjà active.
   (« Facture en retard » émet par JALON — J+1, 3, 5, 15, 30 — et ne voit
   donc jamais que les factures qui franchissent un jalon ce jour-là.)

   ── D'où vient la date d'activation ──
   `automation_rules.activee_le` : écrite par la base quand `is_active` passe
   à vrai (migration proposée, notes/M-migrations-proposees). Tant que la
   colonne n'existe pas, on retombe sur `updated_at` : toute publication le
   réécrit, donc il n'est JAMAIS antérieur à l'activation — le repli ne peut
   pas produire d'effet rétroactif, il peut seulement ignorer un cas franchi
   entre l'activation et une modification ultérieure de la règle.

   ── Où se brancherait « inclure les cas existants » ──
   Dans `ignoreLesCasExistants` ci-dessous, et nulle part ailleurs : une
   option de la règle (avec le nombre exact de clients touchés et une
   confirmation, comme le veut la mission) y rendrait `false`. Elle n'est PAS
   bâtie : aujourd'hui la réponse est toujours « oui, on les ignore ».
   ═══════════════════════════════════════════════════════════════ */

export interface RegleDatee {
  activee_le?: string | null;
  updated_at?: string | null;
}

/** L'instant (ms) depuis lequel la règle est active, ou null si on ne le sait pas. */
export function dateActivation(regle: RegleDatee | null | undefined): number | null {
  for (const brut of [regle?.activee_le, regle?.updated_at]) {
    if (!brut) continue;
    const t = Date.parse(String(brut));
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Point d'extension de l'option « inclure les cas existants » (non bâtie).
 * Toujours vrai : le défaut de la mission.
 */
export function ignoreLesCasExistants(_regle: RegleDatee | null | undefined): boolean {
  return true;
}

/**
 * Ce cas était-il DÉJÀ dans l'état visé avant que la règle soit activée ?
 *
 * `franchiLe` : l'instant où l'entité est entrée dans l'état (le seuil
 * d'inactivité franchi, par exemple). Date d'activation inconnue : on ne
 * conclut pas (false) — la règle se comporte comme avant ce module.
 */
export function anterieurALActivation(regle: RegleDatee | null | undefined, franchiLe: number | null | undefined): boolean {
  if (!ignoreLesCasExistants(regle)) return false;
  const activation = dateActivation(regle);
  if (activation === null || franchiLe === null || franchiLe === undefined || !Number.isFinite(franchiLe)) return false;
  return franchiLe < activation;
}
