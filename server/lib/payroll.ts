// Pay-period math + worked-hours aggregation for the payroll feature.
//
// All period math operates on calendar dates as `YYYY-MM-DD` strings in UTC.
// Boundaries are inclusive of `start`, inclusive of `end` (a full day each).
// The server hands ISO datetime ranges to the commission engine and to the
// time_entries query by widening `start` to 00:00:00 and `end` to 23:59:59.999.

export type PayPeriodType = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export interface PayrollSettings {
  org_id: string;
  pay_period_type: PayPeriodType;
  anchor_date: string;      // YYYY-MM-DD
  pay_day_offset: number;   // days after period end
  timezone: string;
}

export interface PayPeriod {
  start: string;   // YYYY-MM-DD inclusive
  end: string;     // YYYY-MM-DD inclusive
  payDate: string; // YYYY-MM-DD when wages are disbursed
}

export const DEFAULT_PAYROLL_SETTINGS: Omit<PayrollSettings, 'org_id'> = {
  pay_period_type: 'biweekly',
  anchor_date: '2026-01-05', // a Monday — stable default cycle origin
  pay_day_offset: 5,
  timezone: 'America/Toronto',
};

// ── date helpers (UTC, date-only) ──
function toUTC(dateStr: string): Date {
  // dateStr is YYYY-MM-DD; build a UTC midnight date deterministically.
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function fmt(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = toUTC(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fmt(d);
}

function diffDays(a: string, b: string): number {
  // whole days from a → b (b - a)
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

function lastDayOfMonth(year: number, monthIdx0: number): number {
  return new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();
}

/**
 * Compute the pay period that contains `refDate` (default: today, UTC).
 * Returns inclusive start/end dates plus the disbursement date.
 */
export function computePayPeriod(
  settings: Pick<PayrollSettings, 'pay_period_type' | 'anchor_date' | 'pay_day_offset'>,
  refDate?: string,
): PayPeriod {
  const ref = refDate || new Date().toISOString().slice(0, 10);
  const offset = Number(settings.pay_day_offset) || 0;

  let start: string;
  let end: string;

  switch (settings.pay_period_type) {
    case 'weekly':
    case 'biweekly': {
      const len = settings.pay_period_type === 'weekly' ? 7 : 14;
      const anchor = settings.anchor_date || DEFAULT_PAYROLL_SETTINGS.anchor_date;
      const delta = diffDays(anchor, ref);
      // floor division so it works for refs before the anchor too
      const periodIndex = Math.floor(delta / len);
      start = addDays(anchor, periodIndex * len);
      end = addDays(start, len - 1);
      break;
    }
    case 'semimonthly': {
      const d = toUTC(ref);
      const y = d.getUTCFullYear();
      const mIdx = d.getUTCMonth();
      const day = d.getUTCDate();
      if (day <= 15) {
        start = fmt(new Date(Date.UTC(y, mIdx, 1)));
        end = fmt(new Date(Date.UTC(y, mIdx, 15)));
      } else {
        start = fmt(new Date(Date.UTC(y, mIdx, 16)));
        end = fmt(new Date(Date.UTC(y, mIdx, lastDayOfMonth(y, mIdx))));
      }
      break;
    }
    case 'monthly':
    default: {
      const d = toUTC(ref);
      const y = d.getUTCFullYear();
      const mIdx = d.getUTCMonth();
      start = fmt(new Date(Date.UTC(y, mIdx, 1)));
      end = fmt(new Date(Date.UTC(y, mIdx, lastDayOfMonth(y, mIdx))));
      break;
    }
  }

  return { start, end, payDate: addDays(end, offset) };
}

/** ISO datetime bounds covering the full inclusive date range. */
export function periodToIsoRange(period: PayPeriod): { fromIso: string; toIso: string } {
  return {
    fromIso: `${period.start}T00:00:00.000Z`,
    toIso: `${period.end}T23:59:59.999Z`,
  };
}

// ── worked-hours aggregation ──
interface BreakSpan { start?: string; end?: string }
interface TimeEntryLike {
  punch_in_at: string | null;
  punch_out_at: string | null;
  breaks: BreakSpan[] | null;
}

/** Net worked hours for a single completed entry (gross minus closed breaks). */
export function computeEntryHours(entry: TimeEntryLike): number {
  if (!entry.punch_in_at || !entry.punch_out_at) return 0;
  const inMs = Date.parse(entry.punch_in_at);
  const outMs = Date.parse(entry.punch_out_at);
  if (Number.isNaN(inMs) || Number.isNaN(outMs) || outMs <= inMs) return 0;

  let breakMs = 0;
  for (const b of entry.breaks || []) {
    if (!b?.start || !b?.end) continue;
    const bs = Date.parse(b.start);
    const be = Date.parse(b.end);
    if (!Number.isNaN(bs) && !Number.isNaN(be) && be > bs) breakMs += be - bs;
  }

  const net = outMs - inMs - breakMs;
  return net > 0 ? net / 3_600_000 : 0;
}

/** Sum net hours across entries, rounded to 2 decimals. */
export function sumEntryHours(entries: TimeEntryLike[]): number {
  const total = entries.reduce((sum, e) => sum + computeEntryHours(e), 0);
  return Math.round(total * 100) / 100;
}
