/**
 * Formatage des cellules de rapport et préréglages de période (côté écran).
 * Le CSV a son propre formatage côté serveur ; les deux suivent le même type
 * de colonne pour que ce qui est exporté corresponde à ce qui est affiché.
 */
import { formatMoneyFromCents } from './invoicesApi';
import { versDate } from './dateSeule';
import type { Lang, PeriodPreset, ReportColumn } from './reportsApi';

/** Date seule locale (YYYY-MM-DD) d'un objet Date. */
export function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function presetRange(preset: PeriodPreset, now: Date = new Date()): { from: string; to: string } | null {
  const today = localYmd(now);
  const shift = (days: number) => { const d = new Date(now); d.setDate(d.getDate() + days); return localYmd(d); };
  switch (preset) {
    case 'thisMonth': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last30': return { from: shift(-29), to: today };
    case 'last90': return { from: shift(-89), to: today };
    case 'last12m': { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 1); return { from: localYmd(d), to: today }; }
    case 'thisYear': return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default: return null;
  }
}

export const PRESET_LABELS: Record<PeriodPreset, { fr: string; en: string }> = {
  thisMonth: { fr: 'Ce mois-ci', en: 'This month' },
  last30: { fr: '30 derniers jours', en: 'Last 30 days' },
  last90: { fr: '90 derniers jours', en: 'Last 90 days' },
  last12m: { fr: '12 derniers mois', en: 'Last 12 months' },
  thisYear: { fr: 'Cette année', en: 'This year' },
  all: { fr: 'Tout', en: 'All time' },
};

export const PRESET_ORDER: PeriodPreset[] = ['thisMonth', 'last30', 'last90', 'last12m', 'thisYear', 'all'];

function localeOf(lang: Lang) { return lang === 'fr' ? 'fr-CA' : 'en-CA'; }

export function formatDateCell(value: unknown, lang: Lang): string {
  if (!value) return '';
  const s = String(value);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? versDate(s) : new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeOf(lang), { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTimeCell(value: unknown, lang: Lang): string {
  if (!value) return '';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(localeOf(lang), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Cellule formatée pour l'écran selon le type de colonne. */
export function formatCell(col: ReportColumn, value: unknown, lang: Lang): string {
  if (value === null || value === undefined || value === '') return '';
  switch (col.type) {
    case 'money': return formatMoneyFromCents(Number(value) || 0);
    case 'date': return formatDateCell(value, lang);
    case 'datetime': return formatDateTimeCell(value, lang);
    case 'integer': return Math.round(Number(value)).toLocaleString(localeOf(lang));
    case 'number': return Number(value).toLocaleString(localeOf(lang));
    case 'hours': return `${(Number(value) || 0).toFixed(2)} h`;
    case 'percent': return `${(Number(value) || 0).toFixed(1)} %`;
    case 'enum': { const l = col.labels?.[String(value)]; return l ? l[lang] : String(value); }
    default: return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

export function isNumericColumn(col: ReportColumn): boolean {
  return ['money', 'integer', 'number', 'hours', 'percent'].includes(col.type);
}

/** Total formaté pour la ligne de totaux (mêmes règles que la cellule). */
export function formatTotal(col: ReportColumn, value: number | undefined, lang: Lang): string {
  if (value === undefined) return '';
  return formatCell(col, value, lang);
}
