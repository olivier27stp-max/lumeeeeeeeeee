/**
 * Bornes de période pour les rapports.
 *
 * Les filtres arrivent en dates seules (YYYY-MM-DD). Pour une colonne
 * timestamptz, « du 1er au 15 » doit couvrir du 1er 00:00 au 15 23:59:59 dans
 * le fuseau de l'org — pas en UTC, sinon les paiements du soir glissent au
 * lendemain. Pour une colonne `date`, on compare les chaînes directement.
 */
import { FUSEAU_PAR_DEFAUT } from '../date-seule';

export const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Décalage (minutes) du fuseau `tz` à l'instant `at`. */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Instant UTC (ISO) du début de journée `dateStr` dans le fuseau `tz`. */
export function startOfDayIso(dateStr: string, tz: string = FUSEAU_PAR_DEFAUT): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const off = offsetMinutes(guess, tz);
  const real = new Date(guess.getTime() - off * 60_000);
  // Second passage : le décalage peut changer si minuit tombe sur un changement d'heure.
  const off2 = offsetMinutes(real, tz);
  return new Date(guess.getTime() - off2 * 60_000).toISOString();
}

/** Instant UTC (ISO) du début du jour SUIVANT `dateStr` — borne exclusive. */
export function endOfDayExclusiveIso(dateStr: string, tz: string = FUSEAU_PAR_DEFAUT): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return startOfDayIso(next.toISOString().slice(0, 10), tz);
}

/** Ajoute `n` jours à une date seule. */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Nombre de jours entre deux dates seules (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Date seule (YYYY-MM-DD) d'un timestamp, dans le fuseau de l'org. */
export function toLocalDate(value: unknown, tz: string = FUSEAU_PAR_DEFAUT): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** « YYYY-MM-DD HH:mm » local à l'org, pour le CSV. */
export function toLocalDateTime(value: unknown, tz: string = FUSEAU_PAR_DEFAUT): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

/**
 * Applique une période à un builder PostgREST.
 *  - colonne timestamptz : [début du jour `from`, début du jour après `to`)
 *  - colonne date        : [from, to] en chaînes
 */
export function applyPeriod(builder: any, column: string, kind: 'timestamp' | 'date', from?: string, to?: string) {
  let b = builder;
  if (from && DATE_ONLY_RE.test(from)) b = kind === 'date' ? b.gte(column, from) : b.gte(column, startOfDayIso(from));
  if (to && DATE_ONLY_RE.test(to)) b = kind === 'date' ? b.lte(column, to) : b.lt(column, endOfDayExclusiveIso(to));
  return b;
}

/** Filtre en mémoire équivalent à applyPeriod. */
export function inPeriod(value: unknown, kind: 'timestamp' | 'date', from?: string, to?: string): boolean {
  if (!value) return !from && !to;
  const day = kind === 'date' ? String(value).slice(0, 10) : toLocalDate(value);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}
