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

describe('périodes de revenus (get_revenue_summary)', () => {
  it('« le mois passé » existe, et les bornes sont des jours de l’entreprise', async () => {
    const { bornesPeriodeRevenus } = await import('../server/lib/agent/tools');
    expect(bornesPeriodeRevenus('last_month', undefined, undefined, '2026-09-30')).toEqual({ period: 'last_month', from: '2026-08-01', to: '2026-08-31' });
    expect(bornesPeriodeRevenus('last_month', undefined, undefined, '2026-01-15')).toEqual({ period: 'last_month', from: '2025-12-01', to: '2025-12-31' });
    expect(bornesPeriodeRevenus('this_month', undefined, undefined, '2026-02-10')).toEqual({ period: 'this_month', from: '2026-02-01', to: '2026-02-28' });
    expect(bornesPeriodeRevenus('last_year', undefined, undefined, '2026-09-30')).toEqual({ period: 'last_year', from: '2025-01-01', to: '2025-12-31' });
    expect(bornesPeriodeRevenus('last_30_days', undefined, undefined, '2026-09-30')).toEqual({ period: 'last_30_days', from: '2026-09-01', to: '2026-09-30' });
    // Dates précises (remises dans l'ordre).
    expect(bornesPeriodeRevenus('this_month', '2026-07-31', '2026-07-01')).toEqual({ period: 'custom', from: '2026-07-01', to: '2026-07-31' });
  });
});
