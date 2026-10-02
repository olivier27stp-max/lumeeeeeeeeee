/**
 * LES RÈGLES PARTAGÉES entre l'éditeur et le serveur — `src/lib/
 * automationCatalogue.ts` et `src/lib/publicationAutomatisation.ts`, copiés
 * dans l'image du serveur. Une seule règle, deux lecteurs : ces tests la
 * fixent là où elle vit.
 */
import { describe, it, expect } from 'vitest';
import { actionsDuParcours } from '../../../src/lib/publicationAutomatisation';
import { estFormatOrigine } from '../../../src/lib/sequenceTypes';
import { ACTIONS, actionCompatible, champQuiFixeLEntite, entiteDuChamp, problemesAvantPublication } from '../../../src/lib/automationCatalogue';
import { objetDeLaRegle } from '../../../src/components/champs/automatisations';
import type { ChampPerso } from '../../../src/lib/champs/types';

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

// ─── Triage « actions », lignes 5 et 7 (= déclencheurs 06:149 et 06:181) ───

describe('l’entité que fixe le champ surveillé — une seule règle pour le tiroir, le canevas et le serveur', () => {
  const CHAMP = 'cccccccc-0000-4000-8000-000000000001';
  const assigner = (trigger: string, conditions: Record<string, unknown>, entite?: string | null) => problemesAvantPublication({
    trigger_event: trigger, conditions, entite,
    steps: [
      { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'assigner_deal', config: {} }, suivant: null },
    ],
  }).filter((p) => p.gravite === 'bloquant').map((p) => p.message);

  it('`champQuiFixeLEntite` : où lire le champ, selon le déclencheur', () => {
    expect(champQuiFixeLEntite('date.reached', { champ_id: CHAMP, jours_avant: 7 })).toBe(CHAMP);
    expect(champQuiFixeLEntite('custom_field.changed', { field_id: { eq: CHAMP } })).toBe(CHAMP);
    // Une règle plus ancienne porte l'identifiant à plat.
    expect(champQuiFixeLEntite('custom_field.changed', { field_id: CHAMP })).toBe(CHAMP);
    // Aucun champ choisi, ou un déclencheur dont l'entité ne dépend d'aucun champ.
    expect(champQuiFixeLEntite('date.reached', {})).toBe('');
    expect(champQuiFixeLEntite('custom_field.changed', null)).toBe('');
    expect(champQuiFixeLEntite('quote.sent', { champ_id: CHAMP, field_id: CHAMP })).toBe('');
    expect(champQuiFixeLEntite(null, { champ_id: CHAMP })).toBe('');
  });

  it('`entiteDuChamp` : l’objet du champ, jamais une propriété', () => {
    expect(entiteDuChamp('deal')).toBe('deal');
    expect(entiteDuChamp('client')).toBe('client');
    expect(entiteDuChamp('property')).toBeNull();
    expect(entiteDuChamp(null)).toBeNull();
    expect(entiteDuChamp(undefined)).toBeNull();
  });

  it('l’éditeur lit le champ par la MÊME règle (`objetDeLaRegle`) : pas de seconde liste à tenir', () => {
    const champs = [
      { id: CHAMP, object_type: 'deal', field_type: 'date' },
      { id: 'cccccccc-0000-4000-8000-000000000002', object_type: 'client', field_type: 'text' },
    ] as unknown as ChampPerso[];
    expect(objetDeLaRegle('date.reached', { champ_id: CHAMP }, champs)).toBe('deal');
    expect(objetDeLaRegle('custom_field.changed', { field_id: { eq: 'cccccccc-0000-4000-8000-000000000002' } }, champs)).toBe('client');
    // Champ inconnu (archivé, supprimé) : l'entité du déclencheur seul.
    expect(objetDeLaRegle('date.reached', { champ_id: 'cccccccc-0000-4000-8000-000000000009' }, champs)).toBe('client');
    expect(objetDeLaRegle('custom_field.changed', { field_id: { eq: 'cccccccc-0000-4000-8000-000000000009' } }, champs)).toBeNull();
  });

  it('« Date atteinte » sur un champ du PIPELINE : « Assigner l’opportunité » se publie', () => {
    expect(assigner('date.reached', { champ_id: CHAMP }, 'deal')).toEqual([]);
  });

  it('… sur un champ du CLIENT (ou sans connaître le champ) : elle reste refusée', () => {
    const refus = ['« Assigner l’opportunité » ne peut pas suivre ce déclencheur.'];
    expect(assigner('date.reached', { champ_id: CHAMP }, 'client')).toEqual(refus);
    expect(assigner('date.reached', { champ_id: CHAMP })).toEqual(refus);
    expect(assigner('date.reached', { champ_id: CHAMP }, null)).toEqual(refus);
  });

  it('« Champ personnalisé modifié » sur un champ du CLIENT : les six actions liées à une autre fiche sont refusées', () => {
    const six = ['modifier_statut_rendezvous', 'move_deal_stage', 'modifier_deal', 'assigner_deal', 'envoyer_facture', 'envoyer_soumission'];
    for (const cle of six) {
      const action = ACTIONS.find((a) => a.cle === cle)!;
      expect(actionCompatible(action, 'custom_field.changed', 'client'), cle).toBe(false);
      // Sans champ choisi, l'entité dépend de la donnée : rien n'est exclu d'avance.
      expect(actionCompatible(action, 'custom_field.changed'), cle).toBe(true);
      expect(actionCompatible(action, 'custom_field.changed', null), cle).toBe(true);
    }
    // Un champ de DEVIS : « Envoyer le devis » et « Déplacer l'opportunité » (liée au devis) vont.
    expect(actionCompatible(ACTIONS.find((a) => a.cle === 'envoyer_soumission')!, 'custom_field.changed', 'quote')).toBe(true);
    expect(actionCompatible(ACTIONS.find((a) => a.cle === 'move_deal_stage')!, 'custom_field.changed', 'quote')).toBe(true);
    expect(actionCompatible(ACTIONS.find((a) => a.cle === 'envoyer_facture')!, 'custom_field.changed', 'quote')).toBe(false);
  });
});
