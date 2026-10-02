/**
 * LES RÈGLES PARTAGÉES entre l'éditeur et le serveur — `src/lib/
 * automationCatalogue.ts` et `src/lib/publicationAutomatisation.ts`, copiés
 * dans l'image du serveur. Une seule règle, deux lecteurs : ces tests la
 * fixent là où elle vit.
 */
import { describe, it, expect } from 'vitest';
import { actionsDuParcours } from '../../../src/lib/publicationAutomatisation';
import { estFormatOrigine } from '../../../src/lib/sequenceTypes';

const texto = (id: string, body: string, suivant: string | null = null) => ({ id, type: 'action', action: { type: 'send_sms', config: { body } }, suivant });

// ─── Triage « éditeur », 05b-canevas-outils-origine:303 ─────────

describe('`actions`, reflet du parcours (`actionsDuParcours`)', () => {
  it('les actions du parcours, sans attente ni condition', () => {
    const steps = [
      texto('e1', 'A', 'e2'),
      { id: 'e2', type: 'attendre', delai_secondes: 86400, suivant: 'e3' },
      { id: 'e3', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler' } }, suivant: null },
    ];
    expect(actionsDuParcours(steps)).toEqual([
      { type: 'send_sms', config: { body: 'A' } },
      { type: 'create_task', config: { title: 'Rappeler' } },
    ]);
  });

  it('dans l’ordre où le PARCOURS les rencontre, pas celui du tableau (une étape insérée après coup est rangée à la fin)', () => {
    const steps = [
      texto('e1', 'premier', 'e3'),
      texto('e2', 'troisième', null),
      texto('e3', 'deuxième', 'e2'),
    ];
    expect(actionsDuParcours(steps).map((a) => a.config.body)).toEqual(['premier', 'deuxième', 'troisième']);
  });

  it('une condition : la branche « si oui » puis la branche « si non »', () => {
    const steps = [
      { id: 'e1', type: 'si', conditions: { statut: 'envoye' }, alors: 'e2', sinon: 'e3' },
      texto('e2', 'si oui', 'e4'),
      texto('e3', 'si non', null),
      texto('e4', 'suite du oui', null),
    ];
    expect(actionsDuParcours(steps).map((a) => a.config.body)).toEqual(['si oui', 'suite du oui', 'si non']);
  });

  it('une attente de réponse : la suite, puis ce qui part si le client répond', () => {
    const steps = [
      { id: 'e1', type: 'attendre', delai_secondes: 86400, mode: 'reponse', suivant: 'e2', si_reponse: 'e3' },
      texto('e2', 'sans réponse', null),
      texto('e3', 'il a répondu', null),
    ];
    expect(actionsDuParcours(steps).map((a) => a.config.body)).toEqual(['sans réponse', 'il a répondu']);
  });

  it('deux étapes identiques sont deux actions (un parcours les répartit dans le temps)', () => {
    expect(actionsDuParcours([texto('e1', 'Rappel', 'e2'), texto('e2', 'Rappel', null)])).toHaveLength(2);
  });

  it('une étape que rien n’atteint (brouillon en cours de câblage) est gardée, à la fin', () => {
    expect(actionsDuParcours([texto('e1', 'tête', null), texto('e9', 'orpheline', null)]).map((a) => a.config.body)).toEqual(['tête', 'orpheline']);
  });

  it('un parcours qui boucle (brouillon mal câblé) ne fait pas tourner la dérivation sans fin', () => {
    expect(actionsDuParcours([texto('e1', 'A', 'e2'), texto('e2', 'B', 'e1')]).map((a) => a.config.body)).toEqual(['A', 'B']);
  });

  it('un parcours VIDE donne l’action provisoire — que l’éditeur lit comme « aucune étape », jamais comme un format d’origine', () => {
    for (const vide of [[], null, undefined]) {
      const actions = actionsDuParcours(vide);
      expect(actions).toEqual([{ type: 'send_sms', config: { body: 'À compléter' } }]);
      expect(estFormatOrigine({ steps: [], actions })).toBe(false);
    }
    expect(actionsDuParcours([], false)).toEqual([{ type: 'send_sms', config: { body: 'To complete' } }]);
    // Un parcours fait SEULEMENT d'attentes et de conditions : pareil.
    expect(actionsDuParcours([{ id: 'e1', type: 'attendre', delai_secondes: 60, suivant: null }])).toEqual([{ type: 'send_sms', config: { body: 'À compléter' } }]);
  });

  it('au plus 20 actions (le plafond du champ côté serveur) ; la configuration est copiée, pas partagée', () => {
    const steps = Array.from({ length: 25 }, (_, i) => texto(`e${i + 1}`, `m${i + 1}`, i < 24 ? `e${i + 2}` : null));
    const actions = actionsDuParcours(steps);
    expect(actions).toHaveLength(20);
    actions[0].config.body = 'modifié';
    expect(steps[0].action.config.body).toBe('m1');
  });
});
