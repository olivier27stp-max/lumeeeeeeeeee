/**
 * Les heures de l'horaire, au fuseau de l'ENTREPRISE (audit Agenda, 2026-09-30).
 *
 * Le calendrier affichait tout à l'heure du NAVIGATEUR : une visite à 8 h
 * s'affichait 5 h sur un portable réglé sur Vancouver, et un glisser-déposer
 * y enregistrait une heure décalée. La règle : une job à 8 h est à 8 h
 * partout, dans le fuseau de `company_settings.timezone`, changements d'heure
 * compris.
 *
 * Technique de « l'heure murale » : à la lecture, chaque instant devient une
 * Date dont les champs LOCAUX (getHours, format…) valent l'heure de
 * l'entreprise ; à l'écriture, l'heure murale redevient l'instant réel. Les
 * vues existantes (géométrie, formats, glisser-déposer) restent inchangées ;
 * seules les frontières (lecture, écriture) convertissent.
 */
import { useQuery } from '@tanstack/react-query';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { supabase } from './supabase';

/** Le fuseau par défaut de l'application (celui de toutes les entreprises en prod au 2026-09-30). */
export const FUSEAU_PAR_DEFAUT = 'America/Toronto';

export function fuseauValide(tz: string | null | undefined): string {
  if (!tz) return FUSEAU_PAR_DEFAUT;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return FUSEAU_PAR_DEFAUT;
  }
}

/** Instant réel (ISO) → ISO de l'heure murale de l'entreprise. */
export function versMurale(iso: string, fuseau: string): string;
export function versMurale(iso: string | null | undefined, fuseau: string): string | null;
export function versMurale(iso: string | null | undefined, fuseau: string): string | null {
  if (!iso) return iso ?? null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return toZonedTime(d, fuseau).toISOString();
}

/** Heure murale (Date ou ISO murale) → instant réel (ISO). */
export function versReel(mur: Date | string, fuseau: string): string {
  const d = typeof mur === 'string' ? new Date(mur) : mur;
  return fromZonedTime(d, fuseau).toISOString();
}

/** « Maintenant », en heure murale de l'entreprise. */
export function maintenantMural(fuseau: string): Date {
  return toZonedTime(new Date(), fuseau);
}

/** « 2026-10-05 » + « 08:00 » saisis dans un formulaire → instant réel (ISO). */
export function instantDepuisSaisie(jour: string, heure: string, fuseau: string): string {
  return fromZonedTime(`${jour}T${heure.length === 5 ? `${heure}:00` : heure}`, fuseau).toISOString();
}

/** Le fuseau de l'entreprise courante, lu dans ses réglages. */
export function useFuseauEntreprise(orgId: string | null | undefined): string {
  const q = useQuery({
    queryKey: ['fuseauEntreprise', orgId || '-'],
    enabled: !!orgId,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_settings')
        .select('timezone')
        .eq('org_id', orgId as string)
        .maybeSingle();
      if (error) throw error;
      return fuseauValide((data as { timezone?: string | null } | null)?.timezone);
    },
  });
  return q.data || FUSEAU_PAR_DEFAUT;
}
