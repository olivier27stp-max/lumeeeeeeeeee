/**
 * Le temps de l'entreprise (audit des outils de Lumi, 2026-09-30) : « aujourd'hui »
 * au fuseau de l'entreprise, heure sans décalage = heure locale, changement d'heure.
 */
import { describe, it, expect } from 'vitest';
import { decalage, jourDans, maintenantPourLumi, dateHeureLocaleVersUtc, normaliserDatesHeures } from '../server/lib/lumi/temps';

const QC = 'America/Toronto';

describe('temps de l’entreprise', () => {
  it('le soir à Québec, on est encore aujourd’hui (avant : la date UTC du lendemain)', () => {
    const soir = new Date('2026-09-30T23:30:00Z'); // 19 h 30 à Québec
    expect(jourDans(QC, soir)).toBe('2026-09-30');
    expect(maintenantPourLumi(QC, 'fr', soir)).toMatch(/^2026-09-30 \(.*UTC-04:00\)/);
  });

  it('décalage heure avancée / heure normale', () => {
    expect(decalage(QC, new Date('2026-07-01T12:00:00Z'))).toBe('-04:00');
    expect(decalage(QC, new Date('2026-12-01T12:00:00Z'))).toBe('-05:00');
  });

  it('« 9 h » sans décalage = 9 h à Québec (été 13 h UTC, hiver 14 h UTC)', () => {
    expect(dateHeureLocaleVersUtc('2026-10-01T09:00', QC)).toBe('2026-10-01T13:00:00.000Z');
    expect(dateHeureLocaleVersUtc('2026-12-01T09:00:00', QC)).toBe('2026-12-01T14:00:00.000Z');
    // Lendemain du passage à l'heure normale (1er novembre 2026)
    expect(dateHeureLocaleVersUtc('2026-11-02T09:00', QC)).toBe('2026-11-02T14:00:00.000Z');
  });

  it('une valeur avec décalage, une date seule ou un texte restent intacts', () => {
    expect(dateHeureLocaleVersUtc('2026-10-01T09:00:00-04:00', QC)).toBe('2026-10-01T09:00:00-04:00');
    expect(dateHeureLocaleVersUtc('2026-10-01T13:00:00Z', QC)).toBe('2026-10-01T13:00:00Z');
    expect(dateHeureLocaleVersUtc('2026-10-01', QC)).toBe('2026-10-01');
    expect(dateHeureLocaleVersUtc('Rappeler Marie à 9 h', QC)).toBe('Rappeler Marie à 9 h');
  });

  it('normalise tous les arguments, listes comprises', () => {
    expect(normaliserDatesHeures({ start_at: '2026-10-01T09:00', notes: 'x', visites: [{ start_at: '2026-10-02T08:30' }] }, QC))
      .toEqual({ start_at: '2026-10-01T13:00:00.000Z', notes: 'x', visites: [{ start_at: '2026-10-02T12:30:00.000Z' }] });
  });
});
