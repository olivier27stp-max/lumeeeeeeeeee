/**
 * I-037 — une étape dont le modèle a oublié l'enveloppe `config` ne fait plus
 * refuser tout le parcours.
 *
 * Vu sur la batterie I contre la prod le 2026-10-01 (I-018, vrai modèle) : la
 * 6e étape, « crée une tâche pour appeler le client », est arrivée sans
 * `config`. La validation a refusé le parcours ENTIER (« config : expected
 * object, received undefined ») et la personne aurait lu « Le parcours proposé
 * ne pourrait pas tourner. Reformule ta demande » — pour une demande claire.
 */
import { describe, it, expect } from 'vitest';
import { normaliserEtapes } from '../../../server/lib/lumi/generer-parcours';
import { sequenceEtapes } from '../../../server/lib/validation';

const JOUR = 86_400;
const avant = [
  { id: 'e1', type: 'attendre', delai_secondes: 3 * JOUR, suivant: 'e2' },
  { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], votre facture : [invoice_link]. [company_name]' } }, suivant: 'e3' },
];

describe('I — étape sans enveloppe `config`', () => {
  it('[I-037] champs posés à plat sur l’action (title, body, priorite) → remis dans `config`, le parcours passe la validation', () => {
    const etapes = [...avant, { id: 'e3', type: 'action', action: { type: 'create_task', title: 'Appeler le client', body: 'Facture impayée', priorite: 'high' } }];
    // Sans la remise en forme, c'est le refus vu en prod.
    expect(sequenceEtapes.safeParse(etapes).success).toBe(false);
    const apres = normaliserEtapes(etapes);
    expect(apres[2].action).toEqual({ type: 'create_task', config: { title: 'Appeler le client', body: 'Facture impayée', priorite: 'high' } });
    const verdict = sequenceEtapes.safeParse(apres);
    expect(verdict.success, JSON.stringify(verdict.error?.issues?.slice(0, 2))).toBe(true);
  });

  it('[I-037] les valeurs à plat reçoivent le même traitement que les autres : nombre → texte, choix facultatif invalide retiré', () => {
    const apres = normaliserEtapes([{ id: 'e1', type: 'action', action: { type: 'create_task', title: 'Rappeler', priorite: 'normal', echeance_jours: 2 } }]);
    const config = (apres[0].action as { config: Record<string, unknown> }).config;
    expect(config.title).toBe('Rappeler');
    expect(config.priorite).toBeUndefined();
    if ('echeance_jours' in config) expect(config.echeance_jours).toBe('2');
  });

  it('[I-037] seuls les champs CONNUS de l’action sont repris : une clé étrangère ne passe pas dans `config`', () => {
    const apres = normaliserEtapes([{ id: 'e1', type: 'action', action: { type: 'create_task', title: 'Rappeler', constructor: 'x', rule_id: 'abc' } }]);
    expect(apres[0].action).toEqual({ type: 'create_task', config: { title: 'Rappeler' } });
  });

  it('[I-037] une action qui EXIGE un champ et n’en porte aucun reste refusée — on n’invente pas un message vide', () => {
    for (const type of ['send_sms', 'send_email', 'create_task']) {
      const etapes = [{ id: 'e1', type: 'action', action: { type } }];
      const apres = normaliserEtapes(etapes);
      expect(apres[0].action, type).toEqual({ type });
      expect(sequenceEtapes.safeParse(apres).success, type).toBe(false);
    }
  });

  it('[I-037] une étape bien formée, une attente, une action inconnue : inchangées', () => {
    const inconnue = { id: 'e9', type: 'action', action: { type: 'action_inventee', title: 'x' } };
    const apres = normaliserEtapes([...avant, inconnue]);
    expect(apres[0]).toEqual(avant[0]);
    expect(apres[1]).toEqual(avant[1]);
    expect(apres[2]).toEqual(inconnue);
  });
});
