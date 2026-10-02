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

/** `t` décalé de `mois` mois CIVILS (négatif = en arrière), comme `make_interval(months => n)` en base. */
export function decalerMois(t: number, mois: number): number {
  const d = new Date(t);
  const jour = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + mois);
  // Le 31 d'un mois de 30 jours : dernier jour du mois, pas le 1er du suivant.
  const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(jour, dernier));
  return d.getTime();
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

/** Ce que le moteur lit d'une règle pour juger un événement de balayage. */
interface RegleDeBalayage extends RegleDatee {
  conditions?: Record<string, unknown> | null;
}

/** Lecture minimale de la base (le client service_role du moteur). */
interface LecteurMinimal {
  from: (table: string) => any;
}

const UN_JOUR_MS = 86_400_000;

/**
 * Pour un événement de BALAYAGE reçu par le moteur : ce cas existait-il déjà
 * avant l'activation de CETTE règle ? Rend la phrase du journal, ou `null`
 * quand la règle doit réagir (ou quand on ne sait pas : une lecture en échec
 * ne fait jamais taire une règle).
 *
 *   · « Opportunité qui dort » : le seuil (dernière activité + N jours) était
 *     franchi avant l'activation → les 20 opportunités déjà dormantes ne
 *     reçoivent pas toutes le courriel cinq minutes après la publication ;
 *   · « Client inactif » : idem (dernier job terminé + N mois). Le balayage
 *     écarte déjà ces clients avant d'émettre ; ce contrôle tranche pour une
 *     SECONDE règle du même seuil, activée plus tard.
 *
 * Les autres déclencheurs n'entrent jamais ici : aucun coût sur leur chemin.
 */
export async function casAnterieurALActivation(
  supabase: LecteurMinimal,
  regle: RegleDeBalayage,
  evenement: { type: string; orgId: string; entityId: string; metadata?: Record<string, unknown> | null },
): Promise<string | null> {
  if (evenement.type !== 'deal.stage_idle' && evenement.type !== 'client.inactive') return null;
  if (dateActivation(regle) === null) return null;
  const meta = evenement.metadata ?? {};

  if (evenement.type === 'client.inactive') {
    const fin = Date.parse(String(meta.dernier_job_termine_at ?? ''));
    if (!Number.isFinite(fin)) return null;
    // Même lecture du seuil que le balayage (`reglagesInactivite`) : 6 mois par défaut, borné à 60.
    const brut = Math.round(Number(regle.conditions?.mois));
    const mois = Number.isFinite(brut) && brut >= 1 ? Math.min(brut, 60) : 6;
    return anterieurALActivation(regle, decalerMois(fin, mois))
      ? 'Le client était déjà inactif avant l’activation de l’automatisation'
      : null;
  }

  const jours = Number(regle.conditions?.idle_days ?? meta.idle_days ?? 7);
  if (!Number.isFinite(jours)) return null;
  try {
    const { data, error } = await supabase
      .from('deals').select('last_activity_at').eq('id', evenement.entityId).eq('org_id', evenement.orgId).maybeSingle();
    if (error) return null;
    const activite = Date.parse(String((data as { last_activity_at?: string | null } | null)?.last_activity_at ?? ''));
    if (!Number.isFinite(activite)) return null;
    return anterieurALActivation(regle, activite + jours * UN_JOUR_MS)
      ? 'L’opportunité était déjà sans mouvement avant l’activation de l’automatisation'
      : null;
  } catch {
    return null;
  }
}
