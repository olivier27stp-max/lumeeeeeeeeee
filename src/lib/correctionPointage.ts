/**
 * Corriger un pointage à la main, sans fausser la paie.
 * ─────────────────────────────────────────────────────────────────────────
 * Un pointage porte deux jeux de colonnes : `punch_in` / `punch_out` (l'heure
 * affichée à l'écran) et `punch_in_at` / `punch_out_at` (les horodatages que la
 * paie additionne, server/lib/payroll.ts). La page Feuilles de temps ne
 * corrigeait que les premières : l'écran montrait 8 h → 16 h, la paie comptait
 * toujours l'ancien quart. Ici, les deux jeux se recalculent ensemble.
 */

const HEURE = /^(\d{1,2}):(\d{2})/;

function aLHeure(jour: Date, heure: string): Date | null {
  const m = HEURE.exec(heure);
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 23 || min > 59) return null;
  const d = new Date(jour);
  d.setHours(h, min, 0, 0);
  return d;
}

/**
 * Les horodatages d'un pointage dont on vient de saisir l'arrivée et le départ (« HH:MM »,
 * heure locale de celui qui corrige — la même convention que le pointage forcé).
 * Le jour est celui du pointage d'origine ; un départ avant l'arrivée est un quart de nuit
 * (il finit le lendemain). `null` si l'arrivée est illisible : on n'écrit rien.
 */
export function horodatagesCorriges(
  entree: { date: string; punch_in_at?: string | null },
  arrivee: string,
  depart: string | null,
): { punch_in_at: string; punch_out_at: string | null } | null {
  const origine = entree.punch_in_at ? new Date(entree.punch_in_at) : new Date(`${entree.date}T12:00:00`);
  if (Number.isNaN(origine.getTime())) return null;
  const debut = aLHeure(origine, arrivee);
  if (!debut) return null;
  let fin = depart ? aLHeure(origine, depart) : null;
  if (depart && !fin) return null;
  if (fin && fin.getTime() <= debut.getTime()) fin = new Date(fin.getTime() + 86_400_000);
  return { punch_in_at: debut.toISOString(), punch_out_at: fin ? fin.toISOString() : null };
}

/**
 * Les pauses d'un pointage qu'on ferme : une pause restée ouverte se termine à l'heure du
 * départ. Sans ça elle n'a pas de fin, la paie ne la déduit pas, et la pause est payée.
 */
export function pausesFermees<P extends { start?: string; end?: string }>(pauses: P[] | null | undefined, heureDepart: string): P[] {
  const liste = Array.isArray(pauses) ? pauses : [];
  return liste.map((p, i) => (i === liste.length - 1 && p?.start && !p.end ? { ...p, end: heureDepart } : p));
}
