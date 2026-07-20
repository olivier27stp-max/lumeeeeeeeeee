/**
 * Préférences de la vue Jour du calendrier Dispatch — champs affichés dans la
 * colonne de gauche (ressources) et numéros de véhicule par équipe.
 * Persisté par organisation dans localStorage (aucune donnée fictive en base).
 */

export type DailyResourceField = 'vehicle' | 'teamName' | 'description' | 'none';

export interface DispatchDailyPrefs {
  /** Champ principal de chaque ligne (défaut : « Véhicule : numéro »). */
  primary: Exclude<DailyResourceField, 'none'>;
  /** Champ secondaire affiché sous le principal. */
  secondary: DailyResourceField;
  /** Numéros de véhicule saisis par l'utilisateur, par id d'équipe. */
  vehicleNumbers: Record<string, string>;
}

const FIELD_VALUES: DailyResourceField[] = ['vehicle', 'teamName', 'description', 'none'];

function isField(v: unknown): v is DailyResourceField {
  return typeof v === 'string' && (FIELD_VALUES as string[]).includes(v);
}

function defaults(): DispatchDailyPrefs {
  return { primary: 'vehicle', secondary: 'teamName', vehicleNumbers: {} };
}

const storageKey = (orgId: string) => `lume-dispatch-daily-prefs-${orgId}`;

export function loadDispatchDailyPrefs(orgId: string | null | undefined): DispatchDailyPrefs {
  const base = defaults();
  if (!orgId) return base;
  try {
    const raw = localStorage.getItem(storageKey(orgId));
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      primary: isField(parsed.primary) && parsed.primary !== 'none' ? parsed.primary : base.primary,
      secondary: isField(parsed.secondary) ? parsed.secondary : base.secondary,
      vehicleNumbers:
        parsed.vehicleNumbers && typeof parsed.vehicleNumbers === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.vehicleNumbers).filter(([, v]) => typeof v === 'string'),
            )
          : {},
    };
  } catch {
    return base;
  }
}

export function saveDispatchDailyPrefs(orgId: string | null | undefined, prefs: DispatchDailyPrefs): void {
  if (!orgId) return;
  try {
    localStorage.setItem(storageKey(orgId), JSON.stringify(prefs));
  } catch {
    /* stockage indisponible (mode privé) — préférence de session seulement */
  }
}

/**
 * Numéro de véhicule d'une ligne : valeur saisie par l'utilisateur, sinon
 * numéro dérivé de la position stable de l'équipe (01, 02, …) — purement
 * présentationnel, jamais écrit en base.
 */
export function vehicleNumberForTeam(prefs: DispatchDailyPrefs, teamId: string, index: number): string {
  const manual = (prefs.vehicleNumbers[teamId] || '').trim();
  if (manual) return manual;
  return String(index + 1).padStart(2, '0');
}
