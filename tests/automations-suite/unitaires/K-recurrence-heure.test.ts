/**
 * K — L'heure des visites d'une série de jobs récurrents : fonctions pures.
 *
 *  · `instantLocal` / `heureLocale` (server/lib/dates-locales.ts) ;
 *  · `premiereOccurrence` (server/lib/recurringJobScheduler.ts) : le jour de
 *    début à l'heure LOCALE de la série, sinon l'occurrence suivante sur le
 *    même rythme.
 *
 * Aucune base, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import { instantLocal, heureLocale } from '../../../server/lib/dates-locales';
import { premiereOccurrence, HEURE_VISITE_PAR_DEFAUT } from '../../../server/lib/recurringJobScheduler';

describe('K-042 — heure locale d’une série', () => {
  it('[K-042] instantLocal : 9 h locale, été comme hiver, à Toronto, Vancouver et Paris', () => {
    expect(instantLocal('2026-07-15', '09:00', 'America/Toronto')).toBe('2026-07-15T13:00:00.000Z');
    expect(instantLocal('2026-01-15', '09:00', 'America/Toronto')).toBe('2026-01-15T14:00:00.000Z');
    expect(instantLocal('2026-07-15', '09:00', 'America/Vancouver')).toBe('2026-07-15T16:00:00.000Z');
    expect(instantLocal('2026-07-15', '14:30', 'Europe/Paris')).toBe('2026-07-15T12:30:00.000Z');
  });

  it('[K-042] instantLocal autour du changement d’heure (1er novembre 2026, Toronto) : 9 h reste 9 h', () => {
    // Le 1er novembre à 9 h, l'heure normale est déjà revenue (UTC−5).
    expect(instantLocal('2026-11-01', '09:00', 'America/Toronto')).toBe('2026-11-01T14:00:00.000Z');
    expect(instantLocal('2026-10-31', '09:00', 'America/Toronto')).toBe('2026-10-31T13:00:00.000Z');
    // Le 8 mars 2026 (passage à l'heure avancée), 9 h = UTC−4.
    expect(instantLocal('2026-03-08', '09:00', 'America/Toronto')).toBe('2026-03-08T13:00:00.000Z');
  });

  it('[K-042] heureLocale lit l’heure dans le fuseau demandé', () => {
    expect(heureLocale('2026-10-15T18:30:00Z', 'America/Toronto')).toBe('14:30');
    expect(heureLocale('2026-10-15T05:00:00Z', 'America/Toronto')).toBe('01:00');
    expect(heureLocale('2026-10-15T04:00:00Z', 'America/Toronto')).toBe('00:00');
    expect(HEURE_VISITE_PAR_DEFAUT).toBe('09:00');
  });

  it('[K-042] premiereOccurrence : date de début à venir → ce jour-là, à l’heure de la série', () => {
    const r = premiereOccurrence('2026-10-20', '14:30', 'America/Toronto', 'weekly', 7, new Date('2026-10-01T12:00:00Z'));
    expect(r).toEqual({ jour: '2026-10-20', instant: '2026-10-20T18:30:00.000Z' });
  });

  it('[K-042] premiereOccurrence : date de début passée → l’occurrence suivante sur le MÊME rythme, à la même heure locale (pas « maintenant + 7 jours »)', () => {
    const maintenant = new Date('2026-10-22T02:10:00Z'); // 22 h 10 le 21 à Toronto
    expect(premiereOccurrence('2026-10-06', '09:00', 'America/Toronto', 'weekly', 7, maintenant)).toEqual({ jour: '2026-10-27', instant: '2026-10-27T13:00:00.000Z' });
    expect(premiereOccurrence('2026-10-06', '09:00', 'America/Toronto', 'biweekly', 14, maintenant)).toEqual({ jour: '2026-11-03', instant: '2026-11-03T14:00:00.000Z' });
    expect(premiereOccurrence('2026-10-06', '09:00', 'America/Toronto', 'custom', 10, maintenant)).toEqual({ jour: '2026-10-26', instant: '2026-10-26T13:00:00.000Z' });
    expect(premiereOccurrence('2026-10-21', '09:00', 'America/Toronto', 'daily', 1, maintenant)).toEqual({ jour: '2026-10-22', instant: '2026-10-22T13:00:00.000Z' });
  });

  it('[K-042] premiereOccurrence mensuelle : le 31 janvier donne la fin de février (comme Postgres)', () => {
    const r = premiereOccurrence('2027-01-31', '09:00', 'America/Toronto', 'monthly', 30, new Date('2027-02-05T00:00:00Z'));
    expect(r.jour).toBe('2027-02-28');
  });

  it('[K-042] le jour même, heure pas encore passée → aujourd’hui ; heure passée → la prochaine', () => {
    const matin = new Date('2026-10-20T12:00:00Z'); // 8 h à Toronto
    const apresMidi = new Date('2026-10-20T19:00:00Z'); // 15 h à Toronto
    expect(premiereOccurrence('2026-10-20', '09:00', 'America/Toronto', 'weekly', 7, matin).jour).toBe('2026-10-20');
    expect(premiereOccurrence('2026-10-20', '09:00', 'America/Toronto', 'weekly', 7, apresMidi).jour).toBe('2026-10-27');
  });
});
