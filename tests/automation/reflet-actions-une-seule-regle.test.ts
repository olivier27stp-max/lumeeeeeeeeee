/**
 * `actions`, reflet du parcours : UNE seule règle, partout.
 *
 * Une ligne `automation_rules` garde, à côté du parcours (`steps`), une copie à plat de ses
 * actions (`actions`). Trois fonctions fabriquaient cette copie — l'éditeur (`actionsDuParcours`),
 * le PATCH du serveur et les outils de Lumi (`actionsDepuisEtapes`), la route des messages
 * (`refletDuParcours`) — et l'une d'elles suivait l'ordre du TABLEAU au lieu de l'ordre du
 * PARCOURS : dès qu'une étape était insérée au milieu, deux écritures de la même règle donnaient
 * deux copies différentes (constat de la carte, mission finale 2026-10-02).
 */
import { describe, it, expect } from 'vitest';
import { actionsDuParcours } from '../../src/lib/publicationAutomatisation';
import { actionsDepuisEtapes } from '../../server/lib/automations-etapes';
import { refletDuParcours } from '../../server/lib/automation-messages';
import { PACK_PARCOURS } from '../../server/lib/automationPack.data';

const sms = (id: string, body: string, suivant: string | null) => ({ id, type: 'action', action: { type: 'send_sms', config: { body } }, suivant });
const attente = (id: string, suivant: string | null) => ({ id, type: 'attendre', delai_secondes: 3600, suivant });

const PARCOURS: Record<string, unknown[]> = {
  'linéaire': [sms('a', 'un', 'w'), attente('w', 'b'), sms('b', 'deux', null)],
  // L'étape « m » a été insérée au MILIEU : elle est à la fin du tableau, mais 2e dans le parcours.
  'étape insérée au milieu': [sms('a', 'un', 'm'), sms('b', 'trois', null), sms('m', 'deux', 'b')],
  'embranchement « si »': [
    sms('a', 'avant', 's'),
    { id: 's', type: 'si', condition: { champ: 'x', op: 'est', valeur: 'y' }, alors: 'o', sinon: 'n' },
    sms('n', 'branche non', null),
    sms('o', 'branche oui', null),
  ],
  'attente de réponse': [
    sms('a', 'question', 'w'),
    { id: 'w', type: 'attendre', mode: 'reponse', delai_secondes: 86400, si_reponse: 'r', si_depasse: 'd', suivant: null },
    sms('d', 'relance', null),
    sms('r', 'merci', null),
  ],
  'étape que rien n’atteint': [sms('a', 'un', null), sms('z', 'orpheline', null)],
  'plus de 20 actions': Array.from({ length: 25 }, (_, i) => sms(`e${i}`, `message ${i}`, i < 24 ? `e${i + 1}` : null)),
};

describe('reflet `actions` d’un parcours', () => {
  it.each(Object.entries(PARCOURS))('%s : les trois écritures donnent la même copie', (_nom, steps) => {
    const reference = actionsDuParcours(steps);
    expect(actionsDepuisEtapes(steps)).toEqual(reference);
    expect(refletDuParcours(steps)).toEqual(reference);
  });

  it('l’ordre est celui du PARCOURS, pas celui du tableau', () => {
    expect(actionsDepuisEtapes(PARCOURS['étape insérée au milieu']).map((a) => a.config.body)).toEqual(['un', 'deux', 'trois']);
  });

  it('20 actions au plus (plafond du champ `actions` côté serveur)', () => {
    expect(actionsDepuisEtapes(PARCOURS['plus de 20 actions'])).toHaveLength(20);
  });

  it('un parcours sans action : liste vide côté serveur, action provisoire côté éditeur', () => {
    const sansAction = [attente('w', null)];
    expect(actionsDepuisEtapes(sansAction)).toEqual([]);
    expect(refletDuParcours(sansAction)).toEqual([]);
    expect(actionsDepuisEtapes([])).toEqual([]);
    expect(actionsDuParcours(sansAction)).toHaveLength(1);
  });

  it('le pack de base : chaque préréglage à parcours porte le reflet ENTIER, pas sa première action', () => {
    expect(PACK_PARCOURS.length).toBeGreaterThan(0);
    for (const p of PACK_PARCOURS) {
      expect(p.actions, p.preset_key).toEqual(actionsDuParcours(p.steps));
      expect(refletDuParcours(p.steps), p.preset_key).toEqual(actionsDuParcours(p.steps));
    }
    // Au moins un parcours du pack envoie plusieurs messages : c'est le cas que l'ancien reflet tronquait.
    expect(PACK_PARCOURS.some((p) => p.actions.length > 1)).toBe(true);
  });
});
