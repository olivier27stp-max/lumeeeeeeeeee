/**
 * [J-063] « Date atteinte » : `jours_avant` lu PAREIL par le balayage et par
 * le moteur.
 *
 * Le balayage (server/lib/rappels-dates.ts) bornait et tronquait la valeur
 * (« 3.5 » → 3, « 400 » → 365) puis émettait `date.reached` avec ce nombre ;
 * le moteur comparait ce nombre à la valeur BRUTE de la règle. Jamais égales :
 * la règle était balayée chaque jour et ne partait jamais, sans erreur.
 *
 *  · même normalisation des deux côtés (`normaliserJoursAvant`) ;
 *  · refus à l'enregistrement, avec un message clair (`problemeJoursAvant`,
 *    `verifierCoherence`) ;
 *  · l'événement d'une règle ne fait pas partir les autres règles « date
 *    atteinte » du bureau (`regleViseCetEvenement`).
 *
 * Unitaire pur : aucune base, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import { evaluateConditions, regleViseCetEvenement } from '../../../server/lib/automationEngine';
import { normaliserJoursAvant, problemeJoursAvant, JOURS_AVANT_MAX } from '../../../server/lib/rappels-dates';
import { verifierCoherence } from '../../../server/routes/automation-rules';
import type { CRMEvent, CRMEventType } from '../../../server/lib/eventBus';

const CHAMP = '33333333-3333-4333-8333-333333333333';

function evt(metadata: Record<string, unknown>, type: CRMEventType = 'date.reached'): CRMEvent {
  return {
    type,
    orgId: '11111111-1111-4111-8111-111111111111',
    entityType: 'client',
    entityId: '22222222-2222-4222-8222-222222222222',
    metadata,
  };
}

/** Ce que le balayage émet pour une règle : SON décalage, normalisé. */
const emisPour = (joursAvant: unknown) => evt({ champ_id: CHAMP, jours_avant: normaliserJoursAvant(joursAvant), date: '2026-10-04', jour: '2026-10-01' });

describe('[J-063] normaliserJoursAvant — la lecture commune au balayage et au moteur', () => {
  it.each([
    [7, 7], ['7', 7], [' 7 ', 7], [0, 0], ['0', 0], [-7, -7], ['-7', -7],
    ['3.5', 3], [3.9, 3], [-3.9, -3],
    ['400', 365], [3650, 365], ['-400', -365],
    ['', 0], [null, 0], [undefined, 0], ['abc', 0], [{ eq: 7 }, 0], [Number.NaN, 0], [Infinity, 0],
  ])('%j → %i', (brut, attendu) => {
    expect(normaliserJoursAvant(brut)).toBe(attendu);
  });
});

describe('[J-063] le moteur compare `jours_avant` NORMALISÉ à l’événement du balayage', () => {
  it.each([
    ['3.5', 'tronqué à 3 jours'],
    [3.5, 'tronqué à 3 jours (nombre)'],
    ['400', 'borné à 365 jours'],
    [400, 'borné à 365 jours (nombre)'],
    ['-400', 'borné à 365 jours après'],
    ['7', 'valeur ordinaire, en texte'],
    [7, 'valeur ordinaire'],
    ['abc', 'illisible → le jour même, comme le balayage'],
  ])('règle jours_avant = %j (%s) : l’événement émis pour elle la fait partir', (brut) => {
    expect(evaluateConditions({ champ_id: CHAMP, jours_avant: brut } as Record<string, never>, emisPour(brut))).toBe(true);
  });

  it('une règle « 3 jours avant » ne part pas sur un événement « 7 jours avant » (ni l’inverse)', () => {
    expect(evaluateConditions({ champ_id: CHAMP, jours_avant: 3 } as Record<string, never>, emisPour(7))).toBe(false);
    expect(evaluateConditions({ champ_id: CHAMP, jours_avant: '3.5' } as Record<string, never>, emisPour(7))).toBe(false);
    expect(evaluateConditions({ champ_id: CHAMP, jours_avant: 7 } as Record<string, never>, emisPour('3.5'))).toBe(false);
  });

  it('un autre champ date ne correspond toujours pas', () => {
    expect(evaluateConditions({ champ_id: 'autre', jours_avant: '3.5' } as Record<string, never>, emisPour('3.5'))).toBe(false);
  });

  it('la normalisation ne touche QUE « date atteinte » : ailleurs, « 3.5 » reste 3,5', () => {
    expect(evaluateConditions({ jours_avant: '3.5' } as Record<string, never>, evt({ jours_avant: 3 }, 'note.added'))).toBe(false);
    expect(evaluateConditions({ jours_avant: '3.5' } as Record<string, never>, evt({ jours_avant: 3.5 }, 'note.added'))).toBe(true);
  });
});

describe('[J-063] l’événement du balayage vise SA règle', () => {
  const regle = (id: string) => ({ id, org_id: 'o', name: id, trigger_event: 'date.reached', conditions: {}, delay_seconds: 0, actions: [], is_active: true });

  it('rule_id d’une autre règle → ignoré ; la sienne → retenu', () => {
    expect(regleViseCetEvenement(regle('r1') as never, evt({ rule_id: 'r1', champ_id: CHAMP, jours_avant: 7 }))).toBe(true);
    expect(regleViseCetEvenement(regle('r2') as never, evt({ rule_id: 'r1', champ_id: CHAMP, jours_avant: 7 }))).toBe(false);
  });

  it('événement sans rule_id (action « Démarrer une automatisation », ancien événement rejoué) → retenu', () => {
    expect(regleViseCetEvenement(regle('r2') as never, evt({ champ_id: CHAMP, jours_avant: 7 }))).toBe(true);
  });

  it('une règle SANS jours_avant (= le jour même) ne part plus sur l’événement « 7 jours avant » d’une autre règle du même champ', () => {
    const autre = evt({ rule_id: 'r1', champ_id: CHAMP, jours_avant: 7 });
    // Ses conditions seules l'auraient laissée passer : c'est la portée qui l'écarte.
    expect(evaluateConditions({ champ_id: CHAMP } as Record<string, never>, autre)).toBe(true);
    expect(regleViseCetEvenement(regle('r2') as never, autre)).toBe(false);
  });
});

describe('[J-063] l’enregistrement refuse un `jours_avant` que le balayage ne sait pas viser', () => {
  it.each([
    ['3.5'], [3.5], ['400'], [400], [-366], ['-366'], ['abc'], ['7 jours'], ['1e2'], [{ eq: 7 }],
  ])('%j → refusé, message clair en français et en anglais', (brut) => {
    const fr = problemeJoursAvant(brut);
    expect(fr).toMatch(/nombre entier de jours/);
    expect(fr).toContain(`-${JOURS_AVANT_MAX} et ${JOURS_AVANT_MAX}`);
    const en = problemeJoursAvant(brut, false);
    expect(en).toMatch(/whole number of days/);
    expect(en).not.toMatch(/[éèà]/);
  });

  it.each([[7], ['7'], [' 7 '], [0], ['0'], [-7], ['-7'], [365], ['-365'], [''], [null], [undefined]])('%j → accepté', (brut) => {
    expect(problemeJoursAvant(brut)).toBeNull();
  });

  it('la route (verifierCoherence) le refuse pour « Date atteinte », à la création comme à la modification des conditions', () => {
    const corps = (jours: unknown) => ({ trigger_event: 'date.reached', delay_seconds: 0, conditions: { champ_id: CHAMP, jours_avant: jours } });
    expect(verifierCoherence(corps('3.5'))).toMatch(/nombre entier de jours/);
    expect(verifierCoherence(corps(400))).toMatch(/nombre entier de jours/);
    expect(verifierCoherence(corps(400), false)).toMatch(/whole number of days/);
    expect(verifierCoherence(corps(7))).toBeNull();
    expect(verifierCoherence(corps(''))).toBeNull();
  });

  it('un PATCH qui ne touche pas aux conditions n’est pas refusé (règle existante hors bornes : renommable, dépubliable)', () => {
    expect(verifierCoherence({ trigger_event: 'date.reached', delay_seconds: 0 })).toBeNull();
  });

  it('les autres déclencheurs ne sont pas concernés', () => {
    expect(verifierCoherence({ trigger_event: 'note.added', delay_seconds: 0, conditions: { jours_avant: '3.5' } })).toBeNull();
  });
});
