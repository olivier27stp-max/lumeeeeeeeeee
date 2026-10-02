/**
 * LES RÈGLES PARTAGÉES entre l'éditeur et le serveur — `src/lib/
 * automationCatalogue.ts` et `src/lib/publicationAutomatisation.ts`, copiés
 * dans l'image du serveur. Une seule règle, deux lecteurs : ces tests la
 * fixent là où elle vit.
 */
import { describe, it, expect } from 'vitest';
import { actionsDuParcours } from '../../../src/lib/publicationAutomatisation';
import { estFormatOrigine } from '../../../src/lib/sequenceTypes';
import { ACTIONS, ENTITE_PAR_DECLENCHEUR, actionCompatible, champQuiFixeLEntite, entiteDuChamp, fauteDeValeur, problemesAvantPublication } from '../../../src/lib/automationCatalogue';
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

// ─── Triage « actions », ligne 6 (= déclencheurs 06:191) ────────

describe('ligne 6 — « Appel reçu de l’extérieur » n’apporte ni devis, ni facture, ni rendez-vous, ni opportunité', () => {
  const SIX = ['envoyer_facture', 'envoyer_soumission', 'modifier_statut_rendezvous', 'move_deal_stage', 'modifier_deal', 'assigner_deal'];

  it('l’entité du déclencheur est celle que le serveur émet (`automation_webhook_receipt`)', () => {
    expect(ENTITE_PAR_DECLENCHEUR['webhook.received']).toBe('automation_webhook_receipt');
  });

  it('les six actions liées à une fiche sont incompatibles ; toutes les autres restent offertes', () => {
    const refusees = ACTIONS.filter((a) => !actionCompatible(a, 'webhook.received')).map((a) => a.cle).sort();
    expect(refusees).toEqual([...SIX].sort());
    for (const cle of ['send_sms', 'send_email', 'create_task', 'create_notification', 'ajouter_etiquette', 'webhook', 'ajouter_note']) {
      expect(actionCompatible(ACTIONS.find((a) => a.cle === cle)!, 'webhook.received'), cle).toBe(true);
    }
  });

  it('la publication les refuse, en les nommant', () => {
    const bloquants = problemesAvantPublication({
      trigger_event: 'webhook.received', conditions: {},
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'envoyer_facture', config: {} }, suivant: 'e3' },
        { id: 'e3', type: 'action', action: { type: 'assigner_deal', config: {} }, suivant: null },
      ],
    }).filter((p) => p.gravite === 'bloquant').map((p) => p.message);
    expect(bloquants).toEqual([
      '« Envoyer la facture » ne peut pas suivre ce déclencheur.',
      '« Assigner l’opportunité » ne peut pas suivre ce déclencheur.',
    ]);
  });
});

// ─── Triage « actions », lignes 8 et 9 ──────────────────────────

describe('`fauteDeValeur` — ce qu’une valeur de champ a de fautif : la même règle pour le panneau, la publication et le serveur', () => {
  const champ = (cleAction: string, cle: string) => ACTIONS.find((a) => a.cle === cleAction)!.champs.find((c) => c.cle === cle)!;
  const jours = champ('create_task', 'echeance_jours');
  const valeur = champ('modifier_client', 'valeur');
  const adresse = champ('webhook', 'url');

  it('un nombre hors bornes : la borne est dite, en français (avec ses accents) et en anglais', () => {
    expect(fauteDeValeur(jours, '999')).toEqual({ fr: 'doit être au plus 365', en: 'must be at most 365' });
    expect(fauteDeValeur(jours, '-5')).toEqual({ fr: 'doit être au moins 0', en: 'must be at least 0' });
    expect(fauteDeValeur(valeur, '10000001')).toEqual({ fr: 'doit être au plus 10000000', en: 'must be at most 10000000' });
    expect(fauteDeValeur(jours, 'abc')).toEqual({ fr: 'doit être un nombre', en: 'must be a number' });
  });

  it('aux bornes, et vide : valide', () => {
    for (const v of ['0', '365', ' 30 ', '']) expect(fauteDeValeur(jours, v), v).toBeNull();
    expect(fauteDeValeur(valeur, '10000000')).toBeNull();
  });

  it('une adresse de webhook : https seulement, bien formée, jamais interne', () => {
    expect(fauteDeValeur(adresse, 'http://crochets.lume-qa.test/entrant')).toEqual({ fr: 'doit commencer par https://', en: 'must start with https://' });
    expect(fauteDeValeur(adresse, 'pas une adresse')?.fr).toBe('doit commencer par https://');
    expect(fauteDeValeur(adresse, 'ftp://crochets.lume-qa.test')?.fr).toBe('doit commencer par https://');
    expect(fauteDeValeur(adresse, 'https://localhost/interne')).toEqual({ fr: 'ne peut pas viser une adresse interne', en: 'cannot target an internal address' });
    for (const interne of ['https://127.0.0.1/x', 'https://10.0.0.4/x', 'https://192.168.1.1/x', 'https://172.16.0.1/x', 'https://169.254.169.254/latest', 'https://serveur.local/x', 'https://base.internal/x']) {
      expect(fauteDeValeur(adresse, interne)?.fr, interne).toBe('ne peut pas viser une adresse interne');
    }
    expect(fauteDeValeur(adresse, 'https://')?.fr).toBe('n’est pas une adresse valide');
    expect(fauteDeValeur(adresse, 'https://crochets.lume-qa.test/entrant')).toBeNull();
  });

  it('une valeur semée en vrai nombre ou en vrai booléen (règle d’avant la validation) est jugée sur sa forme, pas refusée pour son type', () => {
    expect(fauteDeValeur(jours, 30)).toBeNull();
    expect(fauteDeValeur(jours, 999)?.fr).toBe('doit être au plus 365');
    expect(fauteDeValeur(champ('create_notification', 'par_courriel'), true)).toBeNull();
    expect(fauteDeValeur(jours, undefined)).toBeNull();
    expect(fauteDeValeur(jours, { n: 1 })?.fr).toBe('doit être du texte');
  });

  it('la publication le refuse, sur l’étape, avec la même phrase', () => {
    const problemes = problemesAvantPublication({
      trigger_event: 'lead.created', conditions: {},
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler', echeance_jours: '999' } }, suivant: 'e3' },
        { id: 'e3', type: 'action', action: { type: 'webhook', config: { url: 'http://crochets.lume-qa.test/entrant' } }, suivant: null },
      ],
    }).filter((p) => p.gravite === 'bloquant');
    expect(problemes.map((p) => [p.etapeId, p.message])).toEqual([
      ['e2', '« Créer une tâche » : « À faire dans (jours) » doit être au plus 365.'],
      ['e3', '« Appeler un webhook » : « L’adresse » doit commencer par https://.'],
    ]);
  });

  it('… en anglais', () => {
    const problemes = problemesAvantPublication({
      trigger_event: 'lead.created', conditions: {}, fr: false,
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Hi' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'webhook', config: { url: 'http://x.test' } }, suivant: null },
      ],
    }).filter((p) => p.gravite === 'bloquant').map((p) => p.message);
    expect(problemes).toEqual(['“Call a webhook”: “The address” must start with https://.']);
  });

  it('un champ CACHÉ ne bloque rien (son contrôle n’est pas à l’écran)', () => {
    const problemes = problemesAvantPublication({
      trigger_event: 'quote.sent', conditions: {},
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: 'e2' },
        // « Le membre » n'est visible que pour « Un membre précis ».
        { id: 'e2', type: 'action', action: { type: 'create_notification', config: { title: 'Suivi', destinataire: 'proprietaire', membre_id: 'pas-un-identifiant' } }, suivant: null },
      ],
    }).filter((p) => p.gravite === 'bloquant');
    expect(problemes).toEqual([]);
  });
});
