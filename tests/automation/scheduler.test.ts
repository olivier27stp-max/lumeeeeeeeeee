/* ═══════════════════════════════════════════════════════════════
   Tests — Scheduler helpers (date arithmetic, recurrence, dedup)

   These tests import directly from server/lib/scheduler-utils so
   that a regression in scheduler.ts is caught by CI, not hidden
   behind re-implemented logic.
   ═══════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest';
import {
  addDelay,
  subtractDelay,
  computeNextRecurrenceDate,
  createFireDedup,
  OVERDUE_DAYS,
} from '../../server/lib/scheduler-utils';

describe('Scheduler — addDelay', () => {
  it('adds days', () => {
    expect(addDelay(new Date('2026-04-01T10:00:00Z'), 1, 'days')).toBe('2026-04-02');
    expect(addDelay(new Date('2026-04-01T10:00:00Z'), 3, 'days')).toBe('2026-04-04');
    expect(addDelay(new Date('2026-04-01T10:00:00Z'), 7, 'days')).toBe('2026-04-08');
    expect(addDelay(new Date('2026-04-01T10:00:00Z'), 30, 'days')).toBe('2026-05-01');
  });

  it('adds hours', () => {
    expect(addDelay(new Date('2026-04-01T22:00:00Z'), 4, 'hours')).toBe('2026-04-02');
  });

  it('handles month boundaries', () => {
    expect(addDelay(new Date('2026-01-31T10:00:00Z'), 1, 'days')).toBe('2026-02-01');
  });

  it('handles year boundaries', () => {
    expect(addDelay(new Date('2025-12-31T10:00:00Z'), 1, 'days')).toBe('2026-01-01');
  });
});

describe('Scheduler — subtractDelay', () => {
  it('subtracts days', () => {
    expect(subtractDelay(new Date('2026-04-10T10:00:00Z'), 1, 'days')).toBe('2026-04-09');
    expect(subtractDelay(new Date('2026-04-10T10:00:00Z'), 7, 'days')).toBe('2026-04-03');
  });

  it('subtracts hours', () => {
    expect(subtractDelay(new Date('2026-04-02T02:00:00Z'), 4, 'hours')).toBe('2026-04-01');
  });
});

describe('Scheduler — computeNextRecurrenceDate', () => {
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

  it('unknown interval falls back to monthly', () => {
    expect(computeNextRecurrenceDate('2026-04-01', 'unknown')).toBe('2026-05-01');
  });
});

describe('Scheduler — createFireDedup (same-day dedup)', () => {
  const FIXED_TODAY = '2026-04-22';
  const today = () => FIXED_TODAY;

  it('first call returns false (not fired)', () => {
    const dedup = createFireDedup(today);
    expect(dedup.hasFired('rule-1', 'inv-1')).toBe(false);
  });

  it('after markFired, hasFired returns true', () => {
    const dedup = createFireDedup(today);
    dedup.markFired('rule-1', 'inv-1');
    expect(dedup.hasFired('rule-1', 'inv-1')).toBe(true);
  });

  it('different refs are independent', () => {
    const dedup = createFireDedup(today);
    dedup.markFired('rule-1', 'inv-1');
    expect(dedup.hasFired('rule-1', 'inv-2')).toBe(false);
  });

  it('different rules are independent', () => {
    const dedup = createFireDedup(today);
    dedup.markFired('rule-1', 'inv-1');
    expect(dedup.hasFired('rule-2', 'inv-1')).toBe(false);
  });

  it('resets when the day rolls over', () => {
    let fakeToday = '2026-04-22';
    const dedup = createFireDedup(() => fakeToday);
    dedup.markFired('rule-1', 'inv-1');
    expect(dedup.hasFired('rule-1', 'inv-1')).toBe(true);
    fakeToday = '2026-04-23';
    expect(dedup.hasFired('rule-1', 'inv-1')).toBe(false);
  });
});

describe('Scheduler — OVERDUE_DAYS constant', () => {
  it('contains the five canonical overdue milestones', () => {
    expect([...OVERDUE_DAYS]).toEqual([1, 3, 5, 15, 30]);
  });

  it('day 2 is NOT an overdue milestone', () => {
    expect(OVERDUE_DAYS.includes(2 as (typeof OVERDUE_DAYS)[number])).toBe(false);
  });

  it('day 30 is the final milestone', () => {
    expect(OVERDUE_DAYS.includes(30)).toBe(true);
  });

  it('no milestones after day 30', () => {
    expect(OVERDUE_DAYS.includes(31 as (typeof OVERDUE_DAYS)[number])).toBe(false);
    expect(OVERDUE_DAYS.includes(60 as (typeof OVERDUE_DAYS)[number])).toBe(false);
  });
});
