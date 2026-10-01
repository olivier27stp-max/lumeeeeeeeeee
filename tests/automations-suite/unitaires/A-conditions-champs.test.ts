/**
 * A — Conditions sur les CHAMPS PERSONNALISÉS (`evaluerCondition`,
 * src/lib/champs/filtres.ts), telles que les juge `conditionsChampsOk` pour
 * une automatisation : chaque type de champ × chaque opérateur, valeurs
 * vides, casse, accents, fuseau, changements d'heure.
 *
 * Contrat : un opérateur hors famille, ou une valeur de condition manquante
 * ou illisible, LÈVE — `conditionsChampsOk` l'attrape, le journalise et ne
 * déclenche PAS la règle. Jamais « vrai » par défaut.
 *
 * Unitaire pur : aucune base, aucun réseau. « Maintenant » est injecté.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluerCondition, evaluerConditions, familleDuType, OPERATEURS_PAR_FAMILLE, LIBELLES_OPERATEUR,
  normaliserTelephone, normaliserTexte, retirerDuree, type Condition, type Operateur, type ContexteEvaluation,
} from '../../../src/lib/champs/filtres';
import { TYPES_CHAMP, type TypeChamp } from '../../../src/lib/champs/types';
import { conditionChampSchema } from '../../../server/lib/validation';

// Mercredi 30 septembre 2026, 12 h 00 à Toronto (16 h UTC).
const MIDI = new Date('2026-09-30T16:00:00Z');
const ctx = (maintenant: Date = MIDI, avecHeure?: boolean): ContexteEvaluation => ({ maintenant, fuseau: 'America/Toronto', avecHeure });
const c = (op: Operateur, extra: Partial<Condition> = {}): Condition => ({ field_id: '00000000-0000-4000-8000-000000000001', op, ...extra });
const ev = (type: TypeChamp, valeur: unknown, cond: Condition, contexte: ContexteEvaluation = ctx()) => evaluerCondition(type, valeur, cond, contexte);

const TOUS_OPERATEURS = Object.keys(LIBELLES_OPERATEUR) as Operateur[];
const VIDES: Array<[string, unknown]> = [['null', null], ['undefined', undefined], ['chaîne vide', ''], ['liste vide', []]];

// ─────────────────────────────────────────────────────────────
describe('A-100…A-104 — les familles et leurs opérateurs', () => {
  it('[A-100] les 12 types de champ existants ont une famille', () => {
    expect([...TYPES_CHAMP].sort()).toEqual(['checkbox', 'date', 'dropdown_multi', 'dropdown_single', 'email', 'file',
      'monetary', 'multi_line', 'number', 'phone', 'single_line', 'url']);
    expect(Object.fromEntries(TYPES_CHAMP.map((t) => [t, familleDuType(t)]))).toEqual({
      single_line: 'texte', multi_line: 'texte', email: 'texte', url: 'texte', phone: 'texte',
      number: 'nombre', monetary: 'nombre', date: 'date', dropdown_single: 'liste', dropdown_multi: 'liste',
      checkbox: 'case', file: 'fichier',
    });
  });

  it('[A-101] les 20 opérateurs du vocabulaire sont ceux que Zod accepte', () => {
    const zod = conditionChampSchema.shape.op.options as readonly string[];
    expect([...zod].sort()).toEqual([...TOUS_OPERATEURS].sort());
    expect(TOUS_OPERATEURS).toHaveLength(20);
  });

  // Chaque couple (type, opérateur hors famille) doit LEVER : c'est ce qui
  // empêche une règle « montant contient 5 » de partir au hasard.
  const horsFamille = TYPES_CHAMP.flatMap((t) => TOUS_OPERATEURS
    .filter((op) => !OPERATEURS_PAR_FAMILLE[familleDuType(t)].includes(op))
    .map((op) => [t, op] as const));
  it.each(horsFamille)('[A-102] %s × %s (hors famille) → lève', (type, op) => {
    expect(() => ev(type, 'x', c(op, { value: 'x', value2: 'y', n: 1 }))).toThrow(/invalide pour un champ/);
  });

  const toutesFamilles = TYPES_CHAMP.flatMap((t) => (['is_empty', 'is_not_empty'] as const)
    .filter((op) => OPERATEURS_PAR_FAMILLE[familleDuType(t)].includes(op)).map((op) => [t, op] as const));
  it.each(toutesFamilles.flatMap(([t, op]) => VIDES.map(([l, v]) => [t, op, l, v] as const)))(
    '[A-103] %s %s sur une valeur %s', (type, op, _l, v) => {
      expect(ev(type, v, c(op))).toBe(op === 'is_empty');
    },
  );

  it.each(toutesFamilles)('[A-104] %s %s sur une valeur remplie', (type, op) => {
    const rempli: Record<TypeChamp, unknown> = {
      single_line: 'a', multi_line: 'a', email: 'a@b.c', url: 'https://a.b', phone: '5145550142', number: 0,
      monetary: 0, date: '2026-09-30', dropdown_single: 'opt', dropdown_multi: ['opt'], checkbox: true, file: 'org/u/f.pdf',
    };
    expect(ev(type, rempli[type], c(op))).toBe(op === 'is_not_empty');
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-110…A-114 — case à cocher (checkbox, opérateur « est »)', () => {
  it.each([
    ['A-110', true, true, true], ['A-110', 'true', true, true], ['A-110', false, true, false],
    ['A-110', 'false', true, false], ['A-110', null, true, false], ['A-110', undefined, true, false],
    ['A-111', true, false, false], ['A-111', false, false, true], ['A-111', null, false, true],
    ['A-111', undefined, false, true], ['A-111', '', false, true],
    ['A-111', 'false', 'false', true], ['A-110', 'true', 'true', true],
  ])('[%s] valeur %s, « est %s » → %s', (_id, valeur, cible, verdict) => {
    expect(ev('checkbox', valeur, c('is', { value: cible as boolean }))).toBe(verdict);
  });

  it.each([['absente', undefined], ['null', null], ['« oui »', 'oui'], ['1', 1], ['« TRUE »', 'TRUE']])(
    '[A-112] cible %s → lève (oui ou non obligatoire)', (_l, cible) => {
      expect(() => ev('checkbox', true, c('is', { value: cible as never }))).toThrow(/oui ou non/);
    },
  );

  it('[A-113] une valeur « 1 » ou « oui » en base n\'est PAS cochée', () => {
    expect(ev('checkbox', 1, c('is', { value: true }))).toBe(false);
    expect(ev('checkbox', 'oui', c('is', { value: true }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-115…A-129 — texte (single_line, multi_line, email, url)', () => {
  const TEXTES: TypeChamp[] = ['single_line', 'multi_line', 'email', 'url'];
  const cas: Array<[string, Operateur, unknown, string, boolean]> = [
    ['A-115', 'is', 'Toiture', 'toiture', true],
    ['A-115', 'is', '  Toiture   plate ', 'toiture plate', true],
    ['A-115', 'is', 'Toiture', 'Toit', false],
    ['A-116', 'is_not', 'Toiture', 'toiture', false],
    ['A-116', 'is_not', 'Toiture', 'Gouttières', true],
    ['A-117', 'contains', 'Lavage de vitres', 'VITRES', true],
    ['A-117', 'contains', 'Lavage de vitres', 'toit', false],
    ['A-118', 'not_contains', 'Lavage de vitres', 'toit', true],
    ['A-118', 'not_contains', 'Lavage de vitres', 'lavage', false],
    // Accents : SENSIBLES, comme la colonne value_normalized en SQL (lower(btrim(…)), sans unaccent).
    ['A-119', 'is', 'Élise', 'élise', true],
    ['A-119', 'is', 'Élise', 'elise', false],
    ['A-119', 'contains', 'Façade « Côté œuvre »', 'CÔTÉ ŒUVRE', true],
    ['A-119', 'contains', 'Rendez-vous 🧽🪣 matin', '🪣', true],
    ['A-119', 'contains', 'Équipe 👩‍🔧 nord', '👩‍🔧', true],
    ['A-120', 'contains', `a & b < c > "d" 'e' $ \\ { }`, `< C > "D"`, true],
    ['A-120', 'is', 'x'.repeat(10_000), 'X'.repeat(10_000), true],
  ];
  it.each(TEXTES.flatMap((t) => cas.map(([id, op, v, cible, verdict]) => [id, t, op, v, cible, verdict] as const)))(
    '[%s] %s : « %s » sur %j / cible %j → %s', (_id, type, op, valeur, cible, verdict) => {
      expect(ev(type, valeur, c(op, { value: cible }))).toBe(verdict);
    },
  );

  // Valeur du champ VIDE : « est X » et « contient X » sont faux ; leurs
  // négations sont vraies (un champ vide ne contient pas « toit »).
  it.each(TEXTES.flatMap((t) => VIDES.flatMap(([l, v]) => ([
    ['is', false], ['is_not', true], ['contains', false], ['not_contains', true],
  ] as const).map(([op, verdict]) => ['A-121', t, l, op, v, verdict] as const))))(
    '[%s] %s vide (%s) : « %s toit » → %s', (_id, type, _l, op, valeur, verdict) => {
      expect(ev(type, valeur, c(op, { value: 'toit' }))).toBe(verdict);
    },
  );

  // La CIBLE manquante : « contient (rien) » était vrai pour tout champ
  // rempli — une condition laissée vide envoyait à tout le monde.
  it.each(TEXTES.flatMap((t) => (['is', 'is_not', 'contains', 'not_contains'] as const)
    .flatMap((op) => ([['absente', undefined], ['null', null], ['vide', ''], ['espaces', '   ']] as const)
      .map(([l, cible]) => ['A-122', t, op, l, cible] as const))))(
    '[%s] %s « %s » avec une cible %s → lève (valeur manquante)', (_id, type, op, _l, cible) => {
      expect(() => ev(type, 'Lavage de vitres', c(op, { value: cible as never }))).toThrow(/Valeur manquante/);
    },
  );
});

// ─────────────────────────────────────────────────────────────
describe('A-125…A-129 — téléphone (comparé en E.164)', () => {
  it.each([
    ['A-125', 'is', '(514) 555-0142', '514-555-0142', true],
    ['A-125', 'is', '+1 514 555 0142', '5145550142', true],
    ['A-125', 'is', '1-514-555-0142', '+15145550142', true],
    ['A-125', 'is', '(514) 555-0142', '(514) 555-0143', false],
    ['A-126', 'contains', '(514) 555-0142', '514', true],
    ['A-126', 'not_contains', '(514) 555-0142', '819', true],
    ['A-127', 'is_not', '(514) 555-0142', '+15145550142', false],
    ['A-127', 'is', 'poste 12', 'Poste 12', true],
  ])('[%s] téléphone « %s » %j vs %j → %s', (_id, op, valeur, cible, verdict) => {
    expect(ev('phone', valeur, c(op as Operateur, { value: cible }))).toBe(verdict);
  });

  it.each([
    ['5145550142', '+15145550142'], ['15145550142', '+15145550142'], ['+33 1 23 45 67 89', '+33123456789'],
    ['555-0142', null], ['', null], ['+1234567', null], ['abc', null],
  ])('[A-128] normaliserTelephone(%j) = %j', (brut, attendu) => {
    expect(normaliserTelephone(brut)).toBe(attendu);
  });

  it('[A-129] normaliserTexte : espaces multiples, tabulations, retours de ligne, casse', () => {
    expect(normaliserTexte('  Ligne 1\n\tLigne   2  ')).toBe('ligne 1 ligne 2');
    expect(normaliserTexte(null)).toBe('');
    expect(normaliserTexte(12)).toBe('12');
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-130…A-139 — nombre et montant (cents)', () => {
  const NOMBRES: TypeChamp[] = ['number', 'monetary'];
  const cas: Array<[string, Operateur, unknown, Partial<Condition>, boolean]> = [
    ['A-130', 'eq', 5, { value: 5 }, true], ['A-130', 'eq', 5, { value: '5' }, true], ['A-130', 'eq', '5', { value: 5 }, true],
    ['A-130', 'eq', 5, { value: 6 }, false], ['A-130', 'eq', 0, { value: 0 }, true], ['A-130', 'eq', 1250.5, { value: '1250.50' }, true],
    ['A-131', 'neq', 5, { value: 6 }, true], ['A-131', 'neq', 5, { value: 5 }, false],
    ['A-132', 'gt', 125000, { value: 100000 }, true], ['A-132', 'gt', 100000, { value: 100000 }, false], ['A-132', 'gt', -1, { value: 0 }, false],
    ['A-133', 'lt', 99, { value: 100 }, true], ['A-133', 'lt', 100, { value: 100 }, false],
    ['A-134', 'between', 100, { value: 100, value2: 200 }, true], ['A-134', 'between', 200, { value: 100, value2: 200 }, true],
    ['A-134', 'between', 150, { value: 200, value2: 100 }, true], ['A-134', 'between', 201, { value: 100, value2: 200 }, false],
    ['A-134', 'between', 99.99, { value: 100, value2: 200 }, false],
  ];
  it.each(NOMBRES.flatMap((t) => cas.map(([id, op, v, cond, verdict]) => [id, t, op, v, cond, verdict] as const)))(
    '[%s] %s : %s sur %j avec %j → %s', (_id, type, op, valeur, cond, verdict) => {
      expect(ev(type, valeur, c(op, cond))).toBe(verdict);
    },
  );

  it.each(NOMBRES.flatMap((t) => VIDES.flatMap(([l, v]) => ([
    ['eq', false], ['neq', true], ['gt', false], ['lt', false], ['between', false],
  ] as const).map(([op, verdict]) => ['A-135', t, l, op, v, verdict] as const))))(
    '[%s] %s vide (%s) : %s → %s', (_id, type, _l, op, valeur, verdict) => {
      expect(ev(type, valeur, c(op, { value: 0, value2: 10 }))).toBe(verdict);
    },
  );

  it.each(NOMBRES.flatMap((t) => (['eq', 'neq', 'gt', 'lt', 'between'] as const)
    .flatMap((op) => ([['absente', undefined], ['null', null], ['vide', ''], ['texte', 'beaucoup'], ['1500$', '1500$']] as const)
      .map(([l, v]) => ['A-136', t, op, l, v] as const))))(
    '[%s] %s « %s » avec une valeur de condition %s → lève', (_id, type, op, _l, v) => {
      expect(() => ev(type, 5, c(op, { value: v as never, value2: 10 }))).toThrow(/Valeur manquante/);
    },
  );

  it.each(NOMBRES)('[A-137] %s « entre » sans 2e borne → lève', (type) => {
    expect(() => ev(type, 5, c('between', { value: 1 }))).toThrow(/between/);
    expect(() => ev(type, 5, c('between', { value: 1, value2: 'dix' }))).toThrow(/between/);
  });

  it.each(NOMBRES)('[A-138] %s : une valeur en base illisible ne passe ni « = » ni « > » ni « < »', (type) => {
    for (const op of ['eq', 'gt', 'lt', 'between'] as const) {
      expect(ev(type, 'beaucoup', c(op, { value: 0, value2: 1e12 }))).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-140…A-146 — listes (dropdown_single, dropdown_multi)', () => {
  it.each([
    ['A-140', 'dropdown_single', 'any_of', 'o1', ['o1', 'o2'], true],
    ['A-140', 'dropdown_single', 'any_of', 'o3', ['o1', 'o2'], false],
    ['A-140', 'dropdown_single', 'any_of', 'o1', 'o1', true],
    ['A-141', 'dropdown_single', 'none_of', 'o3', ['o1', 'o2'], true],
    ['A-141', 'dropdown_single', 'none_of', 'o1', ['o1'], false],
    ['A-142', 'dropdown_multi', 'any_of', ['o2', 'o9'], ['o1', 'o2'], true],
    ['A-142', 'dropdown_multi', 'any_of', ['o9'], ['o1', 'o2'], false],
    ['A-143', 'dropdown_multi', 'none_of', ['o9'], ['o1', 'o2'], true],
    ['A-143', 'dropdown_multi', 'none_of', ['o1', 'o9'], ['o1', 'o2'], false],
  ])('[%s] %s %s : %j parmi %j → %s', (_id, type, op, valeur, cibles, verdict) => {
    expect(ev(type as TypeChamp, valeur, c(op as Operateur, { value: cibles }))).toBe(verdict);
  });

  it.each((['dropdown_single', 'dropdown_multi'] as const).flatMap((t) => VIDES.flatMap(([l, v]) =>
    ([['any_of', false], ['none_of', true]] as const).map(([op, verdict]) => ['A-144', t, l, op, v, verdict] as const))))(
    '[%s] %s vide (%s) : %s → %s', (_id, type, _l, op, valeur, verdict) => {
      expect(ev(type, valeur, c(op, { value: ['o1'] }))).toBe(verdict);
    },
  );

  it.each((['dropdown_single', 'dropdown_multi'] as const).flatMap((t) => (['any_of', 'none_of'] as const)
    .flatMap((op) => ([['absente', undefined], ['null', null], ['liste vide', []], ['liste de null', [null]]] as const)
      .map(([l, v]) => ['A-145', t, op, l, v] as const))))(
    '[%s] %s %s sans option choisie (%s) → lève', (_id, type, op, _l, v) => {
      expect(() => ev(type, 'o1', c(op, { value: v as never }))).toThrow(/Aucune option/);
    },
  );

  it('[A-146] les options se comparent par identifiant exact (pas par libellé ni casse)', () => {
    expect(ev('dropdown_single', 'O1', c('any_of', { value: ['o1'] }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-150…A-169 — dates (fuseau de l\'entreprise, heure murale)', () => {
  // Date seule (AAAA-MM-JJ) — « maintenant » = mercredi 30 sept. 2026, midi.
  it.each([
    ['A-150', 'today', '2026-09-30', {}, true], ['A-150', 'today', '2026-09-29', {}, false],
    ['A-151', 'yesterday', '2026-09-29', {}, true], ['A-151', 'yesterday', '2026-09-30', {}, false],
    ['A-152', 'in_last', '2026-09-24', { n: 7 }, true], ['A-152', 'in_last', '2026-09-23', { n: 7 }, true],
    ['A-152', 'in_last', '2026-09-22', { n: 7 }, false], ['A-152', 'in_last', '2026-10-01', { n: 7 }, false],
    ['A-152', 'in_last', '2026-09-30', { n: 0 }, true],
    ['A-153', 'more_than_ago', '2026-09-22', { n: 7 }, true], ['A-153', 'more_than_ago', '2026-09-23', { n: 7 }, false],
    ['A-154', 'less_than_ago', '2026-09-23', { n: 7 }, true], ['A-154', 'less_than_ago', '2026-09-22', { n: 7 }, false],
    ['A-155', 'in_last', '2026-09-16', { n: 2, unit: 'weeks' }, true], ['A-155', 'in_last', '2026-09-15', { n: 2, unit: 'weeks' }, false],
    ['A-156', 'in_last', '2026-06-30', { n: 3, unit: 'months' }, true], ['A-156', 'in_last', '2026-06-29', { n: 3, unit: 'months' }, false],
    ['A-157', 'before', '2026-09-29', { value: '2026-09-30' }, true], ['A-157', 'before', '2026-09-30', { value: '2026-09-30' }, false],
    ['A-158', 'after', '2026-10-01', { value: '2026-09-30' }, true], ['A-158', 'after', '2026-09-30', { value: '2026-09-30' }, false],
    ['A-159', 'between', '2026-09-30', { value: '2026-09-01', value2: '2026-09-30' }, true],
    ['A-159', 'between', '2026-09-15', { value: '2026-09-30', value2: '2026-09-01' }, true],
    ['A-159', 'between', '2026-10-01', { value: '2026-09-01', value2: '2026-09-30' }, false],
    ['A-159', 'after', '2026-09-30', { value: '2026-09-29T23:00:00Z' }, true],
  ])('[%s] date %s sur %s avec %j → %s', (_id, op, valeur, cond, verdict) => {
    expect(ev('date', valeur, c(op as Operateur, cond as Partial<Condition>))).toBe(verdict);
  });

  it('[A-160] « aujourd\'hui » suit l\'heure de Toronto, pas l\'UTC (23 h 30 le 30 = 3 h 30 UTC le 1er)', () => {
    const soir = new Date('2026-10-01T03:30:00Z');
    expect(ev('date', '2026-09-30', c('today'), ctx(soir))).toBe(true);
    expect(ev('date', '2026-10-01', c('today'), ctx(soir))).toBe(false);
    // Date + heure : un rendez-vous à 23 h 15 heure de Toronto est « aujourd'hui ».
    expect(ev('date', '2026-10-01T03:15:00Z', c('today'), ctx(soir, true))).toBe(true);
  });

  it('[A-161] un autre fuseau d\'entreprise change le jour', () => {
    const soir = new Date('2026-10-01T03:30:00Z'); // 20 h 30 à Vancouver le 30
    expect(ev('date', '2026-09-30', c('today'), { maintenant: soir, fuseau: 'America/Vancouver' })).toBe(true);
    expect(ev('date', '2026-10-01', c('today'), { maintenant: soir, fuseau: 'Europe/Paris' })).toBe(true);
  });

  it('[A-162] passage à l\'heure normale (1er nov. 2026, 2 h EDT → 1 h EST) : « hier » et « depuis 1 jour » restent justes', () => {
    const lendemain = new Date('2026-11-02T05:30:00Z'); // 0 h 30 EST le 2 nov.
    expect(ev('date', '2026-11-01', c('yesterday'), ctx(lendemain))).toBe(true);
    expect(ev('date', '2026-11-02', c('today'), ctx(lendemain))).toBe(true);
    // Date + heure : la 1 h 30 « répétée » existe deux fois ; les deux sont le 1er novembre.
    const premiere = '2026-11-01T05:30:00Z'; // 1 h 30 EDT
    const seconde = '2026-11-01T06:30:00Z'; // 1 h 30 EST
    const soir = new Date('2026-11-01T23:00:00Z'); // 18 h EST
    expect(ev('date', premiere, c('today'), ctx(soir, true))).toBe(true);
    expect(ev('date', seconde, c('today'), ctx(soir, true))).toBe(true);
    // « dans les dernières 24 h » (1 jour) en heure murale.
    expect(ev('date', '2026-10-31T23:30:00Z', c('in_last', { n: 1 }), ctx(soir, true))).toBe(true);
    expect(ev('date', '2026-10-31T21:59:00Z', c('in_last', { n: 1 }), ctx(soir, true))).toBe(false);
  });

  it('[A-163] passage à l\'heure d\'été (8 mars 2026 et 14 mars 2027) : les jours ne glissent pas', () => {
    expect(ev('date', '2026-03-07', c('yesterday'), ctx(new Date('2026-03-08T12:00:00Z')))).toBe(true);
    expect(ev('date', '2026-03-08', c('today'), ctx(new Date('2026-03-09T03:59:00Z')))).toBe(true); // 23 h 59 EDT
    expect(ev('date', '2027-03-13', c('yesterday'), ctx(new Date('2027-03-14T12:00:00Z')))).toBe(true);
  });

  it('[A-164] fins de mois : un mois avant le 31 mars = 28 fév. (29 en 2028)', () => {
    expect(retirerDuree('2026-03-31T00:00:00', 1, 'months')).toBe('2026-02-28T00:00:00');
    expect(retirerDuree('2028-03-31T00:00:00', 1, 'months')).toBe('2028-02-29T00:00:00');
    expect(retirerDuree('2026-10-31T10:00:00', 1, 'months')).toBe('2026-09-30T10:00:00');
    expect(retirerDuree('2026-01-15T00:00:00', 1, 'months')).toBe('2025-12-15T00:00:00');
    expect(retirerDuree('2028-03-01T00:00:00', 1, 'days')).toBe('2028-02-29T00:00:00');
    const finMars = ctx(new Date('2028-03-31T16:00:00Z'));
    expect(ev('date', '2028-02-29', c('in_last', { n: 1, unit: 'months' }), finMars)).toBe(true);
    expect(ev('date', '2028-02-28', c('in_last', { n: 1, unit: 'months' }), finMars)).toBe(false);
  });

  it.each(['today', 'yesterday', 'in_last', 'more_than_ago', 'less_than_ago', 'before', 'after', 'between'] as const)(
    '[A-165] date vide : « %s » est toujours faux', (op) => {
      for (const [, v] of VIDES) {
        expect(ev('date', v, c(op, { n: 3, value: '2026-01-01', value2: '2026-12-31' }))).toBe(false);
      }
    },
  );

  it.each([
    ['absente', undefined], ['texte', 'demain'], ['format JJ/MM', '30/09/2026'], ['nombre', 20260930],
  ])('[A-166] « avant / après / entre » avec une date de condition %s → lève', (_l, v) => {
    expect(() => ev('date', '2026-09-30', c('before', { value: v as never }))).toThrow(/Date manquante/);
    expect(() => ev('date', '2026-09-30', c('after', { value: v as never }))).toThrow(/Date manquante/);
    expect(() => ev('date', '2026-09-30', c('between', { value: '2026-01-01', value2: v as never }))).toThrow(/Date manquante/);
  });

  // Une valeur EN BASE qui n'est pas une date ne doit rien satisfaire :
  // « n/a » > « 2026-… » en comparaison de texte, et « après le 1er janvier »
  // passait.
  it.each(['n/a', 'demain', 'abc', '2026-13-45', '30/09/2026'])(
    '[A-167] valeur en base « %s » (pas une date) : aucune comparaison ne passe', (v) => {
      for (const op of ['today', 'yesterday', 'in_last', 'more_than_ago', 'less_than_ago', 'before', 'after', 'between'] as const) {
        let verdict: boolean;
        try { verdict = ev('date', v, c(op, { n: 3, value: '2026-01-01', value2: '2099-12-31' })); } catch { verdict = false; }
        expect(verdict, `${op}`).toBe(false);
      }
    },
  );

  it.each([['texte', 'trois'], ['NaN', Number.NaN], ['négatif', -5]])(
    '[A-168] durée n illisible (%s) : « il y a plus de n jours » ne laisse pas tout passer', (_l, n) => {
      let verdict: boolean;
      try { verdict = ev('date', '2026-09-29', c('more_than_ago', { n: n as number })); } catch { verdict = false; }
      // n négatif est ramené à 0 (hier est bien « il y a plus de 0 jour ») ;
      // un n illisible ne doit jamais valoir « vrai pour toute date ».
      if (_l === 'négatif') expect(verdict).toBe(true);
      else {
        expect(verdict).toBe(false);
        let recent: boolean;
        try { recent = ev('date', '2026-09-30', c('less_than_ago', { n: n as number })); } catch { recent = false; }
        expect(recent).toBe(false);
      }
    },
  );
});

// ─────────────────────────────────────────────────────────────
describe('A-170…A-172 — plusieurs conditions (evaluerConditions)', () => {
  const champs: Record<string, { type: TypeChamp; valeur: unknown }> = {
    toit: { type: 'single_line', valeur: 'Bardeau' },
    surface: { type: 'number', valeur: 1800 },
  };
  const lire = (id: string) => champs[id] ?? null;

  it('[A-170] ET logique : toutes doivent tenir', () => {
    const cs: Condition[] = [{ field_id: 'toit', op: 'is', value: 'bardeau' }, { field_id: 'surface', op: 'gt', value: 1000 }];
    expect(evaluerConditions(cs, lire, ctx())).toBe(true);
    expect(evaluerConditions([...cs, { field_id: 'surface', op: 'lt', value: 1500 }], lire, ctx())).toBe(false);
  });

  it('[A-171] intervalle par deux conditions sur le même champ', () => {
    const cs: Condition[] = [{ field_id: 'surface', op: 'gt', value: 1000 }, { field_id: 'surface', op: 'lt', value: 2000 }];
    expect(evaluerConditions(cs, lire, ctx())).toBe(true);
    champs.surface.valeur = 2500;
    expect(evaluerConditions(cs, lire, ctx())).toBe(false);
    champs.surface.valeur = 1800;
  });

  it('[A-172] champ disparu → faux (on ne déclenche pas sur ce qu\'on ne peut pas vérifier)', () => {
    expect(evaluerConditions([{ field_id: 'inconnu', op: 'is_empty' }], lire, ctx())).toBe(false);
    expect(evaluerConditions([], lire, ctx())).toBe(true);
  });
});
