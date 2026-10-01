/**
 * Corriger un pointage à l'écran corrige aussi ce que la paie additionne.
 *
 * Avant : la page Feuilles de temps n'écrivait que `punch_in` / `punch_out`. La paie
 * (server/lib/payroll.ts) lit `punch_in_at` / `punch_out_at` : l'écran montrait le quart
 * corrigé, la paie payait l'ancien. Et un pointage fermé de force laissait la pause ouverte,
 * donc jamais déduite.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { horodatagesCorriges, pausesFermees } from '../src/lib/correctionPointage';
import { computeEntryHours } from '../server/lib/payroll';

const heures = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const jour = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('horodatagesCorriges', () => {
  const origine = new Date(2026, 8, 30, 9, 4, 12).toISOString(); // 30 septembre, 9 h 04 locale

  it('la paie compte le quart corrigé, pas l’ancien', () => {
    const h = horodatagesCorriges({ date: '2026-09-30', punch_in_at: origine }, '08:00', '16:30')!;
    expect(heures(h.punch_in_at)).toBe('08:00');
    expect(heures(h.punch_out_at!)).toBe('16:30');
    expect(computeEntryHours({ ...h, breaks: [] })).toBeCloseTo(8.5, 5);
  });

  it('le jour reste celui du pointage, même si la colonne date (UTC) dit le lendemain', () => {
    const soir = new Date(2026, 8, 30, 21, 30).toISOString();
    const h = horodatagesCorriges({ date: '2026-10-01', punch_in_at: soir }, '21:00', '23:00')!;
    expect(jour(h.punch_in_at)).toBe('2026-09-30');
    expect(jour(h.punch_out_at!)).toBe('2026-09-30');
  });

  it('un départ avant l’arrivée est un quart de nuit : il finit le lendemain', () => {
    const h = horodatagesCorriges({ date: '2026-09-30', punch_in_at: origine }, '22:00', '06:00')!;
    expect(jour(h.punch_out_at!)).toBe('2026-10-01');
    expect(computeEntryHours({ ...h, breaks: [] })).toBeCloseTo(8, 5);
  });

  it('sans départ, le pointage reste ouvert ; sans horodatage d’origine, le jour vient de la date', () => {
    expect(horodatagesCorriges({ date: '2026-09-30', punch_in_at: origine }, '08:00', null)!.punch_out_at).toBeNull();
    const h = horodatagesCorriges({ date: '2026-09-30', punch_in_at: null }, '08:00', '12:00')!;
    expect(jour(h.punch_in_at)).toBe('2026-09-30');
  });

  it('une heure illisible n’écrit rien', () => {
    expect(horodatagesCorriges({ date: '2026-09-30', punch_in_at: origine }, '', '16:00')).toBeNull();
    expect(horodatagesCorriges({ date: '2026-09-30', punch_in_at: origine }, '25:00', null)).toBeNull();
    expect(horodatagesCorriges({ date: '2026-09-30', punch_in_at: origine }, '08:00', 'tard')).toBeNull();
  });
});

describe('pausesFermees', () => {
  it('la pause restée ouverte se ferme au départ, et la paie la déduit', () => {
    const pauses = pausesFermees([{ start: '10:00:00', end: '10:15:00' }, { start: '12:00:00' }], '12:30:00');
    expect(pauses).toEqual([{ start: '10:00:00', end: '10:15:00' }, { start: '12:00:00', end: '12:30:00' }]);
    const debut = new Date(2026, 8, 30, 8, 0).toISOString();
    const fin = new Date(2026, 8, 30, 12, 30).toISOString();
    expect(computeEntryHours({ punch_in_at: debut, punch_out_at: fin, breaks: pauses })).toBeCloseTo(3.75, 5);
    // La même journée avec la pause laissée ouverte : 4,25 h payées, la pause de midi comprise.
    expect(computeEntryHours({ punch_in_at: debut, punch_out_at: fin, breaks: [{ start: '10:00:00', end: '10:15:00' }, { start: '12:00:00' }] })).toBeCloseTo(4.25, 5);
  });

  it('des pauses déjà fermées, ou aucune pause, restent telles quelles', () => {
    expect(pausesFermees([{ start: '10:00:00', end: '10:15:00' }], '17:00:00')).toEqual([{ start: '10:00:00', end: '10:15:00' }]);
    expect(pausesFermees(null, '17:00:00')).toEqual([]);
  });
});

describe('la page Feuilles de temps s’en sert', () => {
  const page = readFileSync(resolve(__dirname, '../src/pages/Timesheets.tsx'), 'utf8');

  it('corriger les heures écrit aussi les horodatages de la paie', () => {
    const sauvegarde = page.slice(page.indexOf('const saveEdit'), page.indexOf('const saveNote'));
    expect(sauvegarde).toContain('horodatagesCorriges(');
    expect(sauvegarde).toContain('...horodatages');
  });

  it('fermer un pointage de force ferme la pause ouverte', () => {
    const force = page.slice(page.indexOf('const forceClockOut'), page.indexOf('const deleteEntry'));
    expect(force).toContain('pausesFermees(');
  });
});
