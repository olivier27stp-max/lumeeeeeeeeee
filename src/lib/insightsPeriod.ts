/**
 * Insights period selector — the single source of truth for the date ranges
 * behind every Statistiques card. The prototype exposes five windows on each
 * chart; this maps a period key to a real { from, to } ISO range plus the
 * granularity a time-series should bucket by, so all cards stay consistent.
 */
export type InsightsPeriod = '12m' | '2y' | '3y' | '12w' | 'ytd';

export const INSIGHTS_PERIODS: InsightsPeriod[] = ['12m', '2y', '3y', '12w', 'ytd'];

export const DEFAULT_INSIGHTS_PERIOD: InsightsPeriod = '12m';

const LABELS: Record<InsightsPeriod, { fr: string; en: string }> = {
  '12m': { fr: '12 derniers mois', en: 'Last 12 months' },
  '2y': { fr: '2 dernières années', en: 'Last 2 years' },
  '3y': { fr: '3 dernières années', en: 'Last 3 years' },
  '12w': { fr: '12 dernières semaines', en: 'Last 12 weeks' },
  ytd: { fr: 'Cette année à ce jour', en: 'Year to date' },
};

export function periodLabel(p: InsightsPeriod, fr: boolean): string {
  return fr ? LABELS[p].fr : LABELS[p].en;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface InsightsRange {
  from: string;
  to: string;
  /** Sensible bucket size for a time-series over this window. */
  granularity: 'day' | 'week' | 'month';
}

/**
 * Resolve a period to a concrete date range. `now` is injectable so this is
 * pure and testable (no hidden Date.now() at call sites).
 */
export function periodRange(p: InsightsPeriod, now: Date = new Date()): InsightsRange {
  const to = toIso(now);
  const start = new Date(now);

  switch (p) {
    case '12m':
      start.setMonth(start.getMonth() - 12);
      return { from: toIso(start), to, granularity: 'month' };
    case '2y':
      start.setMonth(start.getMonth() - 24);
      return { from: toIso(start), to, granularity: 'month' };
    case '3y':
      start.setMonth(start.getMonth() - 36);
      return { from: toIso(start), to, granularity: 'month' };
    case '12w':
      start.setDate(start.getDate() - 12 * 7);
      return { from: toIso(start), to, granularity: 'week' };
    case 'ytd': {
      const jan1 = new Date(now.getFullYear(), 0, 1);
      return { from: toIso(jan1), to, granularity: 'month' };
    }
  }
}
