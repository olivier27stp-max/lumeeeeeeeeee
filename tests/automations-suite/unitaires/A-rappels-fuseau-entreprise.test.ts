/**
 * A-305 — « Date atteinte » se juge dans le fuseau de CHAQUE entreprise.
 * Le balayage lisait « aujourd'hui » à Toronto pour tout le monde : à 22 h à
 * Vancouver, il était déjà demain, et le rappel partait la veille.
 */
import { describe, it, expect } from 'vitest';
import { jourLocal, jourDecale } from '../../../server/lib/rappels-dates';

describe('rappels sur date — fuseau de l’entreprise', () => {
  // 2 octobre 2026, 05:00 UTC = 1 h à Toronto, 22 h la VEILLE à Vancouver.
  const instant = new Date('2026-10-02T05:00:00Z');

  it('[A-305] « aujourd’hui » suit le fuseau passé, pas Toronto', () => {
    expect(jourLocal(instant, 'America/Toronto')).toBe('2026-10-02');
    expect(jourLocal(instant, 'America/Vancouver')).toBe('2026-10-01');
    expect(jourLocal(instant, 'America/Halifax')).toBe('2026-10-02');
  });

  it('[A-305] « dans 7 jours » part du jour local de l’entreprise', () => {
    expect(jourDecale(7, instant, 'America/Toronto')).toBe('2026-10-09');
    expect(jourDecale(7, instant, 'America/Vancouver')).toBe('2026-10-08');
  });

  it('[A-305] sans fuseau, repli sur America/Toronto (comportement historique)', () => {
    expect(jourLocal(instant)).toBe('2026-10-02');
    expect(jourDecale(-1, instant)).toBe('2026-10-01');
  });
});
