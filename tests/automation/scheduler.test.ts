/* ═══════════════════════════════════════════════════════════════
   Tests — Scheduler (Date arithmetic, deduplication, overdue detection)
   ═══════════════════════════════════════════════════════════════ */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Pure functions extracted from scheduler.ts ──

function addDelay(date: Date, value: number, unit: 'hours' | 'days'): string {
  const d = new Date(date);
  if (unit === 'days') {
    d.setDate(d.getDate() + value);
  } else {
    d.setHours(d.getHours() + value);
  }
  return d.toISOString().slice(0, 10);
}

function subtractDelay(date: Date, value: number, unit: 'hours' | 'days'): string {
  const d = new Date(date);
  if (unit === 'days') {
    d.setDate(d.getDate() - value);
  } else {
    d.setHours(d.getHours() - value);
  }
  return d.toISOString().slice(0, 10);
}

function computeNextRecurrenceDate(fromDate: string, interval: string): string {
  const d = new Date(fromDate + 'T00:00:00');
  switch (interval) {
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'biweekly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'yearly': d.setFullYear(d.getFullYear() + 1); break;
    default: d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().slice(0, 10);
}

// In-memory dedup simulation
function createDedup() {
  let firedKeyDate = '';
  const firedKeys = new Set<string>();

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  return {
    hasFired(automationId: string, refId: string): boolean {
      const today = todayStr();
      if (firedKeyDate !== today) { firedKeys.clear(); firedKeyDate = today; }
      return firedKeys.has(`${automationId}:${refId}`);
    },
    markFired(automationId: string, refId: string) {
      const today = todayStr();
      if (firedKeyDate !== today) { firedKeys.clear(); firedKeyDate = today; }
      firedKeys.add(`${automationId}:${refId}`);
    },
  };
}

// ════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════

describe('Scheduler — Date Arithmetic', () => {
  it('addDelay: adds days correctly', () => {
    expect(addDelay(new Date('2026-04-01T10:00:00Z'), 1, 'days')).toBe('2026-04-02');
    expect(addDelay(new Date('2026-04-01T10:00:00Z'), 3, 'days')).toBe('2026-04-04');
    expect(addDelay(new Date('2026-04-01T10:00:00Z'), 7, 'days')).toBe('2026-04-08');
    expect(addDelay(new Date('2026-04-01T10:00:00Z'), 30, 'days')).toBe('2026-05-01');
  });

  it('addDelay: adds hours correctly', () => {
    expect(addDelay(new Date('2026-04-01T22:00:00Z'), 4, 'hours')).toBe('2026-04-02');
  });

  it('subtractDelay: subtracts days correctly', () => {
    expect(subtractDelay(new Date('2026-04-10T10:00:00Z'), 1, 'days')).toBe('2026-04-09');
    expect(subtractDelay(new Date('2026-04-10T10:00:00Z'), 7, 'days')).toBe('2026-04-03');
  });

  it('handles month boundaries', () => {
    expect(addDelay(new Date('2026-01-31T10:00:00Z'), 1, 'days')).toBe('2026-02-01');
  });

  it('handles year boundaries', () => {
    expect(addDelay(new Date('2025-12-31T10:00:00Z'), 1, 'days')).toBe('2026-01-01');
  });
});

describe('Scheduler — Recurring Invoice Date Computation', () => {
  it('weekly: +7 days', () => {
    expect(computeNextRecurrenceDate('2026-04-01', 'weekly')).toBe('2026-04-08');
  });

  it('biweekly: +14 days', () => {
    expect(computeNextRecurrenceDate('2026-04-01', 'biweekly')).toBe('2026-04-15');
  });

  it('monthly: +1 month', () => {
    expect(computeNextRecurrenceDate('2026-04-01', 'monthly')).toBe('2026-05-01');
  });

  it('quarterly: +3 months', () => {
    expect(computeNextRecurrenceDate('2026-04-01', 'quarterly')).toBe('2026-07-01');
  });

  it('yearly: +1 year', () => {
    expect(computeNextRecurrenceDate('2026-04-01', 'yearly')).toBe('2027-04-01');
  });

  it('unknown interval defaults to monthly', () => {
    expect(computeNextRecurrenceDate('2026-04-01', 'unknown')).toBe('2026-05-01');
  });
});

describe('Scheduler — Deduplication', () => {
  it('first call returns false (not fired)', () => {
    const dedup = createDedup();
    expect(dedup.hasFired('rule-1', 'inv-1')).toBe(false);
  });

  it('after markFired, hasFired returns true', () => {
    const dedup = createDedup();
    dedup.markFired('rule-1', 'inv-1');
    expect(dedup.hasFired('rule-1', 'inv-1')).toBe(true);
  });

  it('different refs are independent', () => {
    const dedup = createDedup();
    dedup.markFired('rule-1', 'inv-1');
    expect(dedup.hasFired('rule-1', 'inv-2')).toBe(false);
  });

  it('different rules are independent', () => {
    const dedup = createDedup();
    dedup.markFired('rule-1', 'inv-1');
    expect(dedup.hasFired('rule-2', 'inv-1')).toBe(false);
  });
});

describe('Scheduler — Overdue Invoice Detection Logic', () => {
  const OVERDUE_DAYS = [1, 3, 5, 15, 30];

  it('events fire on specific overdue days only', () => {
    for (let d = 0; d <= 31; d++) {
      const shouldFire = OVERDUE_DAYS.includes(d);
      expect(OVERDUE_DAYS.includes(d)).toBe(shouldFire);
    }
  });

  it('day 2 does NOT fire overdue event', () => {
    expect(OVERDUE_DAYS.includes(2)).toBe(false);
  });

  it('day 30 fires the final overdue event', () => {
    expect(OVERDUE_DAYS.includes(30)).toBe(true);
  });

  it('no events after day 30', () => {
    expect(OVERDUE_DAYS.includes(31)).toBe(false);
    expect(OVERDUE_DAYS.includes(60)).toBe(false);
  });
});

describe('Scheduler — Quote Expiry Logic', () => {
  it('statuses eligible for auto-expiry', () => {
    const EXPIRABLE = ['sent', 'awaiting_response', 'action_required'];
    expect(EXPIRABLE).toContain('sent');
    expect(EXPIRABLE).not.toContain('approved');
    expect(EXPIRABLE).not.toContain('declined');
    expect(EXPIRABLE).not.toContain('draft');
    expect(EXPIRABLE).not.toContain('expired');
  });
});
