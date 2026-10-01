/**
 * A — Évaluateur de conditions du moteur (`evaluateConditions`,
 * `regleViseCetEvenement`, server/lib/automationEngine.ts).
 *
 * C'est ici que se joue QUI reçoit le message : chaque cas ci-dessous est
 * une règle réelle posée sur des métadonnées réelles d'événement. La règle
 * d'or du fichier testé : ce qu'on ne sait pas juger est REFUSÉ, jamais
 * laissé passer (un filtre qui laisse tout passer envoie à tout le monde).
 *
 * Unitaire pur : aucune base, aucun réseau.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { evaluateConditions, regleViseCetEvenement } from '../../../server/lib/automationEngine';
import type { CRMEvent, CRMEventType } from '../../../server/lib/eventBus';

// Le moteur signale une condition incomparable par console.warn : on la
// capte pour garder la sortie lisible (et on vérifie qu'elle est émise).
let avertissements: ReturnType<typeof vi.spyOn>;
beforeAll(() => { avertissements = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { avertissements.mockRestore(); });

function evt(metadata: Record<string, unknown>, type: CRMEventType = 'quote.viewed'): CRMEvent {
  return {
    type,
    orgId: '11111111-1111-4111-8111-111111111111',
    entityType: 'quote',
    entityId: '22222222-2222-4222-8222-222222222222',
    metadata,
  };
}

const juge = (conditions: Record<string, unknown>, metadata: Record<string, unknown>) =>
  evaluateConditions(conditions as Record<string, never>, evt(metadata));

// ─────────────────────────────────────────────────────────────
describe('A-001…A-006 — absence de condition', () => {
  it.each([
    ['A-001', 'conditions vides {}', {}],
    ['A-001', 'conditions null', null],
    ['A-001', 'conditions undefined', undefined],
  ])('[%s] %s → la règle part', (_id, _l, conditions) => {
    expect(evaluateConditions(conditions as never, evt({ statut: 'sent' }))).toBe(true);
  });

  it.each([
    ['A-002', 'chaîne vide', ''],
    ['A-002', 'null', null],
    ['A-002', 'undefined', undefined],
  ])('[%s] réglage de déclencheur laissé vide (%s) = pas de filtre', (_id, _l, v) => {
    expect(juge({ montant__gte: v }, {})).toBe(true);
    expect(juge({ canal: v }, { canal: 'sms' })).toBe(true);
  });

  it('[A-003] champs_perso est jugé ailleurs (valeurs en base) : ignoré ici', () => {
    expect(juge({ champs_perso: [{ field_id: 'x', op: 'is_empty' }] }, {})).toBe(true);
  });

  it.each(['client_a_etiquette', 'client_sans_etiquette'])(
    '[A-004] %s est jugé ailleurs (étiquettes réelles) : ignoré ici',
    (cle) => { expect(juge({ [cle]: 'VIP' }, {})).toBe(true); },
  );

  it('[A-005] 0 et false ne sont PAS des réglages vides : ce sont des valeurs à comparer', () => {
    expect(juge({ view_count: 0 }, { view_count: 0 })).toBe(true);
    expect(juge({ view_count: 0 }, { view_count: 3 })).toBe(false);
    expect(juge({ view_count: 0 }, {})).toBe(false);
    expect(juge({ is_first_view: false }, { is_first_view: false })).toBe(true);
    expect(juge({ is_first_view: false }, { is_first_view: true })).toBe(false);
    expect(juge({ is_first_view: false }, {})).toBe(false);
  });

  it('[A-006] plusieurs clés = ET logique (toutes doivent passer)', () => {
    const c = { canal: 'sms', statut: 'sent' };
    expect(juge(c, { canal: 'sms', statut: 'sent' })).toBe(true);
    expect(juge(c, { canal: 'sms', statut: 'draft' })).toBe(false);
    expect(juge(c, { canal: 'email', statut: 'sent' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-010…A-019 — égalité directe (valeur scalaire)', () => {
  it.each([
    // [id, attendu (condition), réel (métadonnée), verdict]
    ['A-010', 'texte identique', 'sent', 'sent', true],
    ['A-010', 'texte différent', 'sent', 'draft', false],
    ['A-011', 'casse différente (les statuts sont des clés techniques exactes)', 'sent', 'Sent', false],
    ['A-011', 'espace en trop dans la métadonnée', 'sent', 'sent ', false],
    ['A-012', 'accents identiques', 'Évaluation', 'Évaluation', true],
    ['A-012', 'accent manquant', 'Évaluation', 'Evaluation', false],
    ['A-012', 'emoji multi-codepoint identique', '👩‍🔧', '👩‍🔧', true],
    ['A-013', 'nombre = nombre', 3, 3, true],
    ['A-013', 'condition texte « 3 », métadonnée nombre 3', '3', 3, true],
    ['A-013', 'condition nombre 3, métadonnée texte « 3 »', 3, '3', true],
    ['A-013', 'nombre différent', 3, 4, false],
    ['A-014', 'booléen true = true', true, true, true],
    ['A-014', 'condition « true » (texte), métadonnée true', 'true', true, true],
    ['A-014', 'condition true, métadonnée « false »', true, 'false', false],
    ['A-015', 'métadonnée null ≠ texte « null »', 'null', null, false],
    ['A-015', 'métadonnée absente ≠ texte « undefined »', 'undefined', undefined, false],
    ['A-015', 'métadonnée objet ≠ texte « [object Object] »', '[object Object]', { a: 1 }, false],
    ['A-016', 'liste en métadonnée qui CONTIENT la valeur', 'premiere', ['premiere', 'chaque'], true],
    ['A-016', 'liste en métadonnée qui ne la contient pas', 'premiere', ['chaque'], false],
    ['A-016', 'liste vide en métadonnée', 'premiere', [], false],
    ['A-016', 'liste de nombres, condition texte', '7', [3, 7], true],
    ['A-017', 'texte très long identique (10 000 car.)', 'x'.repeat(10_000), 'x'.repeat(10_000), true],
    ['A-017', 'caractères spéciaux identiques', `& < > " ' $ \\ { }`, `& < > " ' $ \\ { }`, true],
  ])('[%s] %s → %s', (_id, _l, attendu, reel, verdict) => {
    expect(juge({ champ: attendu }, { champ: reel })).toBe(verdict);
  });

  it('[A-018] la métadonnée est lue au niveau 1 seulement (pas de chemin pointé)', () => {
    expect(juge({ 'client.nom': 'Marie' }, { client: { nom: 'Marie' } })).toBe(false);
    expect(juge({ 'client.nom': 'Marie' }, { 'client.nom': 'Marie' })).toBe(true);
  });

  it('[A-019] une LISTE en valeur de condition (hors opérateur) ne correspond jamais', () => {
    // Zod l'interdit hors champs_perso ; le moteur ne doit pas l'interpréter comme « l'un de ».
    expect(juge({ statut: ['sent', 'draft'] }, { statut: 'sent' })).toBe(false);
  });

  it('[A-013] un montant écrit « 1250.50 » reconnaît le nombre 1250.5 de la métadonnée', () => {
    // `montant` des métadonnées = total_cents / 100 : un NOMBRE, sans zéro final.
    expect(juge({ montant: { eq: '1250.50' } }, { montant: 1250.5 })).toBe(true);
    expect(juge({ montant: '100.0' }, { montant: 100 })).toBe(true);
    expect(juge({ montant: { neq: '1250.50' } }, { montant: 1250.5 })).toBe(false);
    // Deux TEXTES restent comparés comme des textes : un code « 007 » n'est pas 7.
    expect(juge({ code: '7' }, { code: '007' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-020…A-029 — opérateurs eq / neq', () => {
  it.each([
    ['A-020', 'eq texte', { eq: 'sms' }, 'sms', true],
    ['A-020', 'eq texte différent', { eq: 'sms' }, 'email', false],
    ['A-020', 'eq métadonnée absente', { eq: 'sms' }, undefined, false],
    ['A-020', 'eq nombre ↔ texte', { eq: 5 }, '5', true],
    ['A-020', 'eq booléen', { eq: false }, false, true],
    ['A-020', 'eq liste en métadonnée (contient)', { eq: 'VIP' }, ['VIP', 'Nord'], true],
    ['A-021', 'neq texte différent', { neq: 'sms' }, 'email', true],
    ['A-021', 'neq texte identique', { neq: 'sms' }, 'sms', false],
    ['A-021', 'neq métadonnée absente (rien ne vaut « sms »)', { neq: 'sms' }, undefined, true],
    ['A-021', 'neq métadonnée null', { neq: 'sms' }, null, true],
    ['A-021', 'neq liste qui contient la valeur', { neq: 'VIP' }, ['VIP', 'Nord'], false],
    ['A-022', 'eq ET neq combinés cohérents', { eq: 'sms', neq: 'email' }, 'sms', true],
    ['A-022', 'eq ET neq contradictoires', { eq: 'sms', neq: 'sms' }, 'sms', false],
  ])('[%s] %s → %s', (_id, _l, op, reel, verdict) => {
    expect(juge({ canal: op }, { canal: reel })).toBe(verdict);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-030…A-039 — opérateurs in / not_in', () => {
  it.each([
    ['A-030', 'in : valeur dans la liste', { in: ['sms', 'email'] }, 'sms', true],
    ['A-030', 'in : valeur hors liste', { in: ['sms', 'email'] }, 'appel', false],
    ['A-030', 'in : métadonnée absente', { in: ['sms'] }, undefined, false],
    ['A-030', 'in : nombres ↔ textes', { in: ['1', '3', '5'] }, 3, true],
    ['A-030', 'in : liste vide = rien ne correspond', { in: [] }, 'sms', false],
    ['A-030', 'in : métadonnée liste qui touche la liste', { in: ['VIP'] }, ['Nord', 'VIP'], true],
    ['A-031', 'not_in : valeur hors liste', { not_in: ['sms'] }, 'email', true],
    ['A-031', 'not_in : valeur dans la liste', { not_in: ['sms'] }, 'sms', false],
    ['A-031', 'not_in : métadonnée absente', { not_in: ['sms'] }, undefined, true],
    ['A-031', 'not_in : liste vide = tout passe', { not_in: [] }, 'sms', true],
    ['A-031', 'not_in : métadonnée liste qui touche', { not_in: ['VIP'] }, ['Nord', 'VIP'], false],
  ])('[%s] %s → %s', (_id, _l, op, reel, verdict) => {
    expect(juge({ canal: op }, { canal: reel })).toBe(verdict);
  });

  it.each([
    ['A-032', 'in écrit comme un texte', { in: 'sms' }],
    ['A-032', 'in écrit comme un nombre', { in: 5 }],
    ['A-032', 'in null', { in: null }],
    ['A-032', 'not_in écrit comme un texte', { not_in: 'sms' }],
    ['A-032', 'not_in objet', { not_in: { a: 'sms' } }],
  ])('[%s] %s : la liste est illisible → la règle est REFUSÉE, pas laissée passer', (_id, _l, op) => {
    // Une règle écrite hors de l'éditeur (Lumi, préréglage, SQL) n'est pas
    // passée par Zod : le moteur doit refuser ce qu'il ne sait pas lire.
    expect(juge({ canal: op }, { canal: 'appel' })).toBe(false);
    expect(juge({ canal: op }, { canal: 'sms' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-040…A-059 — comparaisons de NOMBRES (gt, gte, lt, lte)', () => {
  it.each([
    ['A-040', 'gt', 500, 501, true], ['A-040', 'gt', 500, 500, false], ['A-040', 'gt', 500, 499, false],
    ['A-041', 'gte', 500, 500, true], ['A-041', 'gte', 500, 499.99, false], ['A-041', 'gte', 500, 10_000, true],
    ['A-042', 'lt', 500, 499, true], ['A-042', 'lt', 500, 500, false], ['A-042', 'lt', 500, 501, false],
    ['A-043', 'lte', 500, 500, true], ['A-043', 'lte', 500, 500.01, false], ['A-043', 'lte', 500, -3, true],
    ['A-044', 'gte', '500', 500, true], ['A-044', 'gte', 500, '500', true], ['A-044', 'gte', '500', '1200', true],
    ['A-044', 'gt', '1250.5', '1250.50', false], ['A-044', 'lt', '-10', -11, true],
    ['A-044', 'gte', 0, 0, true], ['A-044', 'lte', 0, 0, true], ['A-044', 'gt', 0, -0.01, false],
    ['A-044', 'gte', ' 500 ', 500, true],
  ])('[%s] montant %s %s, réel %s → %s', (_id, op, borne, reel, verdict) => {
    expect(juge({ montant: { [op]: borne } }, { montant: reel })).toBe(verdict);
  });

  it.each([
    ['A-045', '__gte', 500, 500, true], ['A-045', '__gte', 500, 499, false],
    ['A-045', '__gt', 500, 500, false], ['A-045', '__gt', 500, 501, true],
    ['A-045', '__lte', 500, 500, true], ['A-045', '__lte', 500, 501, false],
    ['A-045', '__lt', 500, 499, true], ['A-045', '__lt', 500, 500, false],
    ['A-045', '__gte', '500', 750, true],
  ])('[%s] suffixe montant%s = %s, réel %s → %s', (_id, suffixe, borne, reel, verdict) => {
    expect(juge({ [`montant${suffixe}`]: borne }, { montant: reel })).toBe(verdict);
  });

  it('[A-046] intervalle : deux conditions sur le même champ (suffixes minimum + maximum)', () => {
    const c = { montant__gte: '500', montant__lte: '1000' };
    expect(juge(c, { montant: 499 })).toBe(false);
    expect(juge(c, { montant: 500 })).toBe(true);
    expect(juge(c, { montant: 750 })).toBe(true);
    expect(juge(c, { montant: 1000 })).toBe(true);
    expect(juge(c, { montant: 1000.01 })).toBe(false);
  });

  it('[A-046] intervalle : deux opérateurs dans le même objet', () => {
    const c = { montant: { gt: 500, lt: 1000 } };
    expect(juge(c, { montant: 500 })).toBe(false);
    expect(juge(c, { montant: 501 })).toBe(true);
    expect(juge(c, { montant: 1000 })).toBe(false);
  });

  it('[A-046] intervalle impossible (min > max) : rien ne passe', () => {
    const c = { montant__gte: 1000, montant__lte: 500 };
    for (const m of [0, 499, 500, 750, 1000, 5000]) expect(juge(c, { montant: m })).toBe(false);
  });

  it('[A-047] suffixe ET objet d\'opérateurs sur le même champ : les deux s\'appliquent', () => {
    const c = { montant__gte: 500, montant: { lt: 1000 } };
    expect(juge(c, { montant: 700 })).toBe(true);
    expect(juge(c, { montant: 400 })).toBe(false);
    expect(juge(c, { montant: 1200 })).toBe(false);
  });

  it('[A-048] une clé contenant « __ » sans opérateur connu reste une clé ordinaire', () => {
    expect(juge({ source__web: 'oui' }, { source__web: 'oui' })).toBe(true);
    expect(juge({ montant__between: 5 }, { montant: 5 })).toBe(false);
    expect(juge({ montant__between: 5 }, { montant__between: 5 })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-050…A-059 — comparaisons IMPOSSIBLES : toujours refusées', () => {
  // Chaque ligne : une borne ou une valeur qu'aucun humain ne lirait comme un
  // nombre ou une date. Répondre « vrai » enverrait le message à tout le monde.
  const incomparables: Array<[string, string, unknown]> = [
    ['A-050', 'métadonnée absente', undefined],
    ['A-050', 'métadonnée null', null],
    ['A-050', 'métadonnée chaîne vide', ''],
    ['A-050', 'métadonnée espaces', '   '],
    ['A-051', 'texte libre', 'beaucoup'],
    ['A-051', 'objet', { montant: 5 }],
    ['A-051', 'liste', [600, 700]],
    ['A-051', 'booléen', true],
    ['A-051', 'NaN', Number.NaN],
    ['A-051', 'Infinity', Number.POSITIVE_INFINITY],
    ['A-052', 'montant avec symbole « 1500$ » (Date.parse y voit l\'an 1500)', '1500$'],
    ['A-052', 'montant « 100 $ » (Date.parse y voit l\'an 100)', '100 $'],
    ['A-052', 'montant « $100 »', '$100'],
    ['A-052', 'phrase « Montant 5 » (Date.parse y voit mai 2001)', 'Montant 5'],
    ['A-052', 'phrase « le 5 »', 'le 5'],
    ['A-052', 'phrase « 5 janvier » (sans année)', '5 janvier'],
    ['A-052', '« +5 »', '+5'],
    ['A-052', '« 1 500 » (séparateur de milliers)', '1 500'],
    ['A-052', '« 500,50 » (virgule décimale)', '500,50'],
    ['A-053', 'date ISO suivie de texte « 2026-09-30junk »', '2026-09-30junk'],
    ['A-053', 'date impossible « 2026-02-30 »', '2026-02-30'],
    ['A-053', 'date impossible « 2026-13-45 »', '2026-13-45'],
  ];

  it.each(incomparables.flatMap(([id, l, v]) => (['gt', 'gte', 'lt', 'lte'] as const).map((op) => [id, l, op, v] as const)))(
    '[%s] métadonnée = %s, opérateur %s → refusé',
    (_id, _l, op, v) => {
      expect(juge({ montant: { [op]: 500 } }, { montant: v })).toBe(false);
    },
  );

  it.each(incomparables.filter(([, , v]) => typeof v === 'string' && v.trim() !== '')
    .flatMap(([id, l, v]) => (['gt', 'gte', 'lt', 'lte'] as const).map((op) => [id, l, op, v] as const)))(
    '[%s] BORNE de la condition = %s, opérateur %s → refusé',
    (_id, _l, op, borne) => {
      for (const reel of [0, 1, 500, 100_000, -100_000]) {
        expect(juge({ montant: { [op]: borne } }, { montant: reel })).toBe(false);
      }
    },
  );

  it.each(['gt', 'gte', 'lt', 'lte'] as const)(
    '[A-054] nombre comparé à une DATE (%s) : types différents → refusé',
    (op) => {
      expect(juge({ montant: { [op]: '2026-01-01' } }, { montant: 5000 })).toBe(false);
      expect(juge({ cree_le: { [op]: 5000 } }, { cree_le: '2026-01-01T10:00:00Z' })).toBe(false);
    },
  );

  it('[A-053] une date de calendrier impossible n\'est pas « roulée » au mois suivant', () => {
    // Date.parse('2026-02-30') donne le 2 mars : « avant le 5 mars » passerait.
    expect(juge({ date: { lt: '2026-03-05' } }, { date: '2026-02-30' })).toBe(false);
    expect(juge({ date: { gt: '2026-01-01' } }, { date: '2026-09-30junk' })).toBe(false);
    expect(juge({ date: { gt: '2026-02-30' } }, { date: '2026-09-30' })).toBe(false);
  });

  it('[A-055] un avertissement est journalisé quand la comparaison est impossible', () => {
    avertissements.mockClear();
    juge({ montant: { gte: 500 } }, { montant: 'beaucoup' });
    expect(avertissements).toHaveBeenCalledWith(expect.stringContaining('n\'est pas comparable'));
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-060…A-069 — comparaisons de DATES ISO', () => {
  it.each([
    ['A-060', 'gt', '2026-06-01T00:00:00Z', '2026-06-01T00:00:01Z', true],
    ['A-060', 'gt', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', false],
    ['A-061', 'gte', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z', true],
    ['A-061', 'gte', '2026-06-01', '2026-05-31T23:59:59Z', false],
    ['A-062', 'lt', '2026-06-01', '2026-05-31', true],
    ['A-062', 'lt', '2026-06-01', '2026-06-01', false],
    ['A-063', 'lte', '2026-06-01', '2026-06-01', true],
    ['A-063', 'lte', '2026-06-01', '2026-06-02', false],
    // Décalages : 2026-06-01T00:00:00-04:00 = 04:00 UTC.
    ['A-064', 'gt', '2026-06-01T03:59:59Z', '2026-06-01T00:00:00-04:00', true],
    ['A-064', 'lt', '2026-06-01T04:00:01Z', '2026-06-01T00:00:00-04:00', true],
    // Format Postgres (espace, décalage court, microsecondes).
    ['A-065', 'gte', '2026-09-30T10:00:00Z', '2026-09-30 10:00:00+00', true],
    ['A-065', 'lt', '2026-09-30T10:00:01Z', '2026-09-30 10:00:00.123456+00', true],
    // Février bissextile 2028.
    ['A-066', 'gt', '2028-02-28', '2028-02-29', true],
    ['A-066', 'lt', '2028-03-01', '2028-02-29', true],
  ])('[%s] date %s %s, réel %s → %s', (_id, op, borne, reel, verdict) => {
    expect(juge({ date: { [op]: borne } }, { date: reel })).toBe(verdict);
  });

  it('[A-067] un objet Date en métadonnée se compare comme la date ISO', () => {
    expect(juge({ date: { gte: '2026-06-01' } }, { date: new Date('2026-06-02T00:00:00Z') })).toBe(true);
    expect(juge({ date: { gte: '2026-06-01' } }, { date: new Date('invalid') })).toBe(false);
  });

  it('[A-068] intervalle de dates « en juin » (deux bornes)', () => {
    const c = { cree_le: { gte: '2026-06-01T00:00:00Z', lt: '2026-07-01T00:00:00Z' } };
    expect(juge(c, { cree_le: '2026-05-31T23:59:59Z' })).toBe(false);
    expect(juge(c, { cree_le: '2026-06-15T12:00:00Z' })).toBe(true);
    expect(juge(c, { cree_le: '2026-07-01T00:00:00Z' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-070…A-079 — opérateurs inconnus : la règle est refusée', () => {
  it.each([
    ['A-070', 'contains', { contains: 'abc' }],
    ['A-070', 'between', { between: [1, 5] }],
    ['A-070', 'is_empty', { is_empty: true }],
    ['A-070', 'EQ (majuscules)', { EQ: 'sms' }],
    ['A-070', 'faute de frappe « gtee »', { gtee: 5 }],
    ['A-071', 'opérateur connu + inconnu', { eq: 'sms', like: 's%' }],
    ['A-071', '__proto__ en opérateur', JSON.parse('{"__proto__": {"eq": "sms"}, "zz": 1}')],
  ])('[%s] opérateur %s → refusé (même si la valeur « correspondrait »)', (_id, _l, op) => {
    expect(juge({ canal: op }, { canal: 'sms' })).toBe(false);
    expect(juge({ canal: op }, { canal: 'abc' })).toBe(false);
  });

  it('[A-072] objet d\'opérateurs vide {} : aucun filtre (Zod le refuse à l\'enregistrement)', () => {
    // Documenté : `{}` n'est pas un opérateur inconnu. Il n'arrive pas par
    // l'éditeur (refine « Empty condition »).
    expect(juge({ canal: {} }, { canal: 'sms' })).toBe(true);
  });

  it('[A-073] une clé de prototype en nom de condition ne lit pas Object.prototype', () => {
    expect(juge({ constructor: 'x' }, {})).toBe(false);
    expect(juge({ toString: { eq: 'x' } }, {})).toBe(false);
    expect(juge({ hasOwnProperty: { neq: 'x' } }, {})).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-080…A-089 — portée pipeline (regleViseCetEvenement)', () => {
  const regle = (pipeline_id: string | null, stage_id: string | null) =>
    ({ id: 'r', org_id: 'o', name: 'R', trigger_event: 'deal.stage_entered', conditions: {}, delay_seconds: 0, actions: [], is_active: true, pipeline_id, stage_id }) as Parameters<typeof regleViseCetEvenement>[0];
  const deal = (metadata: Record<string, unknown>, type: CRMEventType = 'deal.stage_entered') => ({ ...evt(metadata, type), entityType: 'deal' });

  it.each([
    ['A-080', 'règle sans portée, n\'importe quelle étape', null, null, { pipeline_id: 'p1', stage_id: 's1' }, true],
    ['A-081', 'même étape', 'p1', 's1', { pipeline_id: 'p1', stage_id: 's1' }, true],
    ['A-081', 'autre étape', 'p1', 's1', { pipeline_id: 'p1', stage_id: 's2' }, false],
    ['A-082', 'autre pipeline', 'p1', null, { pipeline_id: 'p2', stage_id: 's1' }, false],
    ['A-082', 'même pipeline, toutes étapes', 'p1', null, { pipeline_id: 'p1', stage_id: 's9' }, true],
    ['A-083', 'étape visée, métadonnée sans étape (passe, voulu)', 'p1', 's1', { pipeline_id: 'p1' }, true],
    ['A-083', 'pipeline visé, métadonnée sans pipeline (passe, voulu)', 'p1', null, { stage_id: 's1' }, true],
  ])('[%s] %s → %s', (_id, _l, p, s, meta, verdict) => {
    expect(regleViseCetEvenement(regle(p, s), deal(meta))).toBe(verdict);
  });

  it('[A-084] hors deal.* la portée ne filtre rien (autres déclencheurs)', () => {
    expect(regleViseCetEvenement(regle('p1', 's1'), evt({ pipeline_id: 'p2', stage_id: 's2' }, 'quote.viewed'))).toBe(true);
  });

  it('[A-084] deal.stage_idle suit la même portée', () => {
    expect(regleViseCetEvenement(regle('p1', 's1'), deal({ pipeline_id: 'p1', stage_id: 's2' }, 'deal.stage_idle'))).toBe(false);
  });
});
