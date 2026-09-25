/**
 * Jobber exporte l'heure d'une visite dans UNE colonne « Times » (« 1:00PM - 2:30PM »).
 * Sans découpage, chaque visite tombait à minuit (convention « pas d'heure précise »)
 * et durait toute la journée dans le calendrier (Vision Lavage, 2026-09-24).
 */
import { describe, it, expect } from 'vitest';
import { decouperPlageHoraire, normalizeRow } from '../../server/lib/migration/normalize';

describe('decouperPlageHoraire', () => {
  it('découpe une plage Jobber en début et fin', () => {
    expect(decouperPlageHoraire('1:00PM - 2:30PM')).toEqual(['1:00PM', '2:30PM']);
    expect(decouperPlageHoraire('9:00 AM – 11:00 AM')).toEqual(['9:00 AM', '11:00 AM']);
    expect(decouperPlageHoraire('13:00-14:30')).toEqual(['13:00', '14:30']);
  });
  it('laisse passer une heure seule et le vide', () => {
    expect(decouperPlageHoraire('9:00')).toEqual(['9:00', '']);
    expect(decouperPlageHoraire('')).toEqual(['', '']);
  });
});

describe('normalizeRow — visite avec plage horaire', () => {
  const mappings: Record<string, string> = { Date: 'date', Times: 'start_time', 'Job #': 'job_ref' };
  it('pose start_at et end_at à partir de « Times »', () => {
    const { normalized, relations } = normalizeRow('visit', { Date: 'Sep 08, 2025', Times: '1:00PM - 2:30PM', 'Job #': '681' }, mappings);
    expect(normalized.start_at).toBe('2025-09-08T13:00:00');
    expect(normalized.end_at).toBe('2025-09-08T14:30:00');
    expect(relations.job_ref).toBe('681');
  });
  it('sans heure : minuit, convention « pas d’heure précise »', () => {
    const { normalized } = normalizeRow('visit', { Date: 'Sep 08, 2025', Times: '', 'Job #': '681' }, mappings);
    expect(normalized.start_at).toBe('2025-09-08T00:00:00');
    expect(normalized.end_at).toBeUndefined();
  });
});
