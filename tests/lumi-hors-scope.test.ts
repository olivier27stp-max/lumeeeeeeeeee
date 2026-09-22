/**
 * Le verdict `hors_scope` du routeur est enfin utilisé (2026-09-22).
 *
 * Le routeur Haiku classait déjà chaque message et rendait `hors_scope` avec
 * 0,95 de confiance — puis le verdict était JETÉ : la route ne traitait que
 * `decision === 'action'`. Mesuré en prod : 14 tours classés hors_scope
 * descendus au gros modèle pour 0,26 $, alors que le routeur les avait
 * identifiés pour 0,36 ¢ chacun.
 *
 * Le risque de ce raccourci n'est pas le coût, c'est de refuser une question
 * légitime. D'où les garde-fous ci-dessous, tous testés.
 */
import { describe, it, expect } from 'vitest';
import { peutRepondreHorsScope, mentionneLume, reponseHorsScope } from '../server/lib/lumi/hors-scope';

const SEUIL = 0.85;
const base = { decision: 'hors_scope', confiance: 0.95, seuil: SEUIL, premierMessage: true };

describe('court-circuit du vrai hors-sujet', () => {
  const horsSujet = [
    'c est quoi la meteo demain',
    'ecris moi un poeme sur mon camion',
    'qui va gagner le match ce soir',
    'combien ca vaut une tesla usagee',
  ];
  for (const message of horsSujet) {
    it(`« ${message.slice(0, 40)} » → répond sans le gros modèle`, () => {
      expect(peutRepondreHorsScope({ ...base, message })).toBe(true);
    });
  }

  it('la réponse ramène vers ce que Lumi sait faire', () => {
    // Une porte fermée doit toujours en montrer une ouverte.
    const fr = reponseHorsScope('fr');
    expect(fr).toMatch(/CRM/);
    expect(fr).toMatch(/chiffre|retards|journée/i);
    expect(reponseHorsScope('en')).toMatch(/CRM/);
  });
});

describe('garde-fous : ne JAMAIS refuser une question légitime', () => {
  it('une question sur Lume n\'est pas du hors-sujet', () => {
    // Le routeur classe souvent ces questions hors_scope ; la FAQ y répond.
    for (const message of [
      'quels sont les forfaits lume et leurs prix',
      'comment j annule mon abonnement',
      'c est quoi lume en deux phrases',
      'je veux parler a un humain de l equipe',
    ]) {
      expect(mentionneLume(message), message).toBe(true);
      expect(peutRepondreHorsScope({ ...base, message }), message).toBe(false);
    }
  });

  it('confiance insuffisante → le modèle répond', () => {
    expect(peutRepondreHorsScope({ ...base, confiance: 0.8, message: 'c est quoi la meteo' })).toBe(false);
    expect(peutRepondreHorsScope({ ...base, confiance: undefined, message: 'c est quoi la meteo' })).toBe(false);
  });

  it('en cours de conversation → le modèle répond (il a le contexte)', () => {
    // « et ça ? » peut porter sur le sujet précédent : nous ne le voyons pas.
    expect(peutRepondreHorsScope({ ...base, premierMessage: false, message: 'et ca' })).toBe(false);
  });

  it('une autre décision du routeur ne déclenche rien', () => {
    for (const decision of ['modele', 'action', undefined]) {
      expect(peutRepondreHorsScope({ ...base, decision, message: 'c est quoi la meteo' })).toBe(false);
    }
  });

  it('une question CRM normale n\'est jamais coupée', () => {
    // Elle ne serait pas classée hors_scope, mais la double sécurité compte.
    expect(peutRepondreHorsScope({ ...base, decision: 'modele', message: 'quelles factures sont en retard' })).toBe(false);
  });
});
