/**
 * Moteur de filtres partagé (src/lib/champs/filtres.ts).
 *
 * Les dates se jugent en HEURE LOCALE de l'entreprise (America/Toronto par
 * défaut), jamais en UTC : c'est ce que ces tests prouvent, y compris autour
 * de minuit et aux changements d'heure (8 mars et 1er novembre 2026).
 * Même sémantique que cf_condition_sql — les cas SQL équivalents sont dans
 * scripts/qa/champs-perso-invariants.sql.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluerCondition, heureMurale, jourLocal, retirerDuree, normaliserTelephone, OPERATEURS_PAR_FAMILLE,
  type Condition,
} from '../src/lib/champs/filtres';

const TZ = 'America/Toronto';
const c = (op: Condition['op'], extra: Partial<Condition> = {}): Condition => ({ field_id: 'f', op, ...extra });
const date = (valeur: string, cond: Condition, maintenant: string, avecHeure?: boolean) =>
  evaluerCondition('date', valeur, cond, { fuseau: TZ, maintenant: new Date(maintenant), avecHeure });

describe('heure murale', () => {
  it('23 h 30 à Montréal est encore aujourd’hui, même s’il est demain en UTC', () => {
    expect(jourLocal(new Date('2026-09-25T03:30:00Z'), TZ)).toBe('2026-09-24');
  });
  it('fin de mois bornée comme Postgres', () => {
    expect(retirerDuree('2026-03-31T10:00:00', 1, 'months')).toBe('2026-02-28T10:00:00');
    expect(retirerDuree('2024-03-31T10:00:00', 1, 'months')).toBe('2024-02-29T10:00:00');
    expect(retirerDuree('2026-01-15T00:00:00', 2, 'months')).toBe('2025-11-15T00:00:00');
    expect(retirerDuree('2026-03-02T00:00:00', 1, 'weeks')).toBe('2026-02-23T00:00:00');
  });
  it('changement d’heure : l’heure murale ne saute pas', () => {
    // 8 mars 2026, 2 h → 3 h. 12 h UTC = 8 h EDT.
    expect(heureMurale(new Date('2026-03-08T12:00:00Z'), TZ)).toBe('2026-03-08T08:00:00');
    // 1er novembre 2026, 2 h → 1 h. 12 h UTC = 7 h EST.
    expect(heureMurale(new Date('2026-11-01T12:00:00Z'), TZ)).toBe('2026-11-01T07:00:00');
  });
});

describe('dates seules', () => {
  const MAINTENANT = '2026-09-25T03:30:00Z'; // 24 sept., 23 h 30 à Montréal
  it('aujourd’hui / hier en heure locale', () => {
    expect(date('2026-09-24', c('today'), MAINTENANT)).toBe(true);
    expect(date('2026-09-25', c('today'), MAINTENANT)).toBe(false);
    expect(date('2026-09-23', c('yesterday'), MAINTENANT)).toBe(true);
  });
  it('dans les N derniers jours : bornes incluses', () => {
    expect(date('2026-09-17', c('in_last', { n: 7, unit: 'days' }), MAINTENANT)).toBe(true);
    expect(date('2026-09-16', c('in_last', { n: 7, unit: 'days' }), MAINTENANT)).toBe(false);
    expect(date('2026-09-26', c('in_last', { n: 7, unit: 'days' }), MAINTENANT)).toBe(false); // futur exclu
  });
  it('il y a plus / moins de N', () => {
    expect(date('2026-09-16', c('more_than_ago', { n: 7, unit: 'days' }), MAINTENANT)).toBe(true);
    expect(date('2026-09-17', c('more_than_ago', { n: 7, unit: 'days' }), MAINTENANT)).toBe(false);
    expect(date('2026-09-17', c('less_than_ago', { n: 7, unit: 'days' }), MAINTENANT)).toBe(true);
    expect(date('2026-10-30', c('less_than_ago', { n: 7, unit: 'days' }), MAINTENANT)).toBe(true); // futur inclus
    expect(date('2026-08-24', c('in_last', { n: 1, unit: 'months' }), MAINTENANT)).toBe(true);
    expect(date('2026-08-23', c('in_last', { n: 1, unit: 'months' }), MAINTENANT)).toBe(false);
  });
  it('avant / après / entre', () => {
    expect(date('2026-09-01', c('before', { value: '2026-09-02' }), MAINTENANT)).toBe(true);
    expect(date('2026-09-02', c('before', { value: '2026-09-02' }), MAINTENANT)).toBe(false);
    expect(date('2026-09-03', c('after', { value: '2026-09-02' }), MAINTENANT)).toBe(true);
    expect(date('2026-09-05', c('between', { value: '2026-09-10', value2: '2026-09-01' }), MAINTENANT)).toBe(true); // bornes inversées tolérées
    expect(date('2026-09-10', c('between', { value: '2026-09-01', value2: '2026-09-10' }), MAINTENANT)).toBe(true);
  });
  it('une date manquante est une erreur, pas un « faux » silencieux', () => {
    expect(() => date('2026-09-01', c('before'), MAINTENANT)).toThrow(/Date manquante/);
  });
});

describe('dates avec heure', () => {
  it('un rendez-vous à 23 h 30 (Montréal) est « aujourd’hui » même s’il est le lendemain en UTC', () => {
    expect(date('2026-09-25T03:30:00Z', c('today'), '2026-09-24T16:00:00Z', true)).toBe(true);
  });
  it('dans les dernières 24 h autour du changement d’heure (1er nov.)', () => {
    // Maintenant : 1er nov. 12 h locale (EST). Il y a « 1 jour » en heure murale = 31 oct. 12 h (EDT).
    const maintenant = '2026-11-01T17:00:00Z';
    expect(date('2026-10-31T16:30:00Z', c('in_last', { n: 1, unit: 'days' }), maintenant, true)).toBe(true);  // 31 oct. 12 h 30 EDT
    expect(date('2026-10-31T15:30:00Z', c('in_last', { n: 1, unit: 'days' }), maintenant, true)).toBe(false); // 31 oct. 11 h 30 EDT
  });
  it('au passage à l’heure d’été (8 mars)', () => {
    const maintenant = '2026-03-08T16:00:00Z'; // 12 h EDT
    expect(date('2026-03-07T17:30:00Z', c('in_last', { n: 1, unit: 'days' }), maintenant, true)).toBe(true);  // 7 mars 12 h 30 EST
    expect(date('2026-03-07T16:30:00Z', c('in_last', { n: 1, unit: 'days' }), maintenant, true)).toBe(false); // 7 mars 11 h 30 EST
  });
});

describe('texte, nombre, liste', () => {
  it('texte normalisé (casse, espaces)', () => {
    expect(evaluerCondition('single_line', '  Asphalte  Neuf ', c('is', { value: 'asphalte neuf' }))).toBe(true);
    expect(evaluerCondition('single_line', 'Pavé uni', c('contains', { value: 'UNI' }))).toBe(true);
    expect(evaluerCondition('single_line', null, c('not_contains', { value: 'x' }))).toBe(true);
    expect(evaluerCondition('single_line', null, c('is_empty'))).toBe(true);
  });
  it('téléphone comparé en E.164', () => {
    expect(evaluerCondition('phone', '+18195551234', c('is', { value: '(819) 555-1234' }))).toBe(true);
    expect(normaliserTelephone('819.555.1234')).toBe('+18195551234');
    expect(normaliserTelephone('1 819 555 1234')).toBe('+18195551234');
    expect(normaliserTelephone('555-1234')).toBeNull();
  });
  it('nombre et montant (cents)', () => {
    expect(evaluerCondition('number', 12, c('gt', { value: 10 }))).toBe(true);
    expect(evaluerCondition('monetary', 125000, c('between', { value: 100000, value2: 200000 }))).toBe(true);
    expect(evaluerCondition('number', null, c('neq', { value: 3 }))).toBe(true);
    expect(evaluerCondition('number', null, c('gt', { value: 3 }))).toBe(false);
  });
  it('listes : est l’un de / n’est aucun de', () => {
    expect(evaluerCondition('dropdown_single', 'o1', c('any_of', { value: ['o1', 'o2'] }))).toBe(true);
    expect(evaluerCondition('dropdown_multi', ['o3'], c('none_of', { value: ['o1'] }))).toBe(true);
    expect(evaluerCondition('dropdown_multi', null, c('none_of', { value: ['o1'] }))).toBe(true);
  });
  it('un opérateur étranger au type est refusé', () => {
    expect(() => evaluerCondition('date', '2026-01-01', c('eq', { value: 1 }))).toThrow(/invalide/);
    expect(() => evaluerCondition('single_line', 'x', c('gt', { value: 1 }))).toThrow(/invalide/);
    expect(OPERATEURS_PAR_FAMILLE.date).not.toContain('contains');
  });
});
