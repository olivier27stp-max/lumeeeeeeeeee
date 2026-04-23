/**
 * Pure date helpers used by the scheduler.
 *
 * Kept in a standalone module (no Supabase / side effects) so they can be
 * unit-tested without touching the database or any external client.
 */

export type TimeUnit = 'hours' | 'days';

export function addDelay(date: Date, value: number, unit: TimeUnit): string {
  const d = new Date(date);
  if (unit === 'days') {
    d.setDate(d.getDate() + value);
  } else {
    d.setHours(d.getHours() + value);
  }
  return d.toISOString().slice(0, 10);
}

export function subtractDelay(date: Date, value: number, unit: TimeUnit): string {
  const d = new Date(date);
  if (unit === 'days') {
    d.setDate(d.getDate() - value);
  } else {
    d.setHours(d.getHours() - value);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Advance a YYYY-MM-DD date by the recurrence interval.
 * Unknown intervals fall back to monthly (matches scheduler.ts behavior).
 */
export function computeNextRecurrenceDate(fromDate: string, interval: string): string {
  const d = new Date(fromDate + 'T00:00:00');
  switch (interval) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Days past due at which the recurring "invoice overdue" rule fires.
 * Duplicated list here to keep scheduler-utils independent from the main
 * scheduler module; scheduler.ts should import from here, not the reverse.
 */
export const OVERDUE_DAYS = [1, 3, 5, 15, 30] as const;

/**
 * In-memory same-day dedup for automation fires.
 * Used to avoid spamming the same automation for the same reference more
 * than once per calendar day. Callers share a single instance via the
 * scheduler module; tests create their own instance for isolation.
 */
export function createFireDedup(today: () => string = defaultToday) {
  let firedKeyDate = '';
  const firedKeys = new Set<string>();

  function rollOverIfNewDay(): void {
    const t = today();
    if (firedKeyDate !== t) {
      firedKeys.clear();
      firedKeyDate = t;
    }
  }

  return {
    hasFired(automationId: string, refId: string): boolean {
      rollOverIfNewDay();
      return firedKeys.has(`${automationId}:${refId}`);
    },
    markFired(automationId: string, refId: string): void {
      rollOverIfNewDay();
      firedKeys.add(`${automationId}:${refId}`);
    },
  };
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10);
}
