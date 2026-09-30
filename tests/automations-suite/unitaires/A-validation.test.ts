/**
 * A — Validation de la configuration d'une automatisation.
 *
 *  · `automationRuleCreateSchema` / `automationRuleUpdateSchema` : ce que la
 *    route POST/PATCH /automations/rules accepte (via `validate`, qui renvoie
 *    `error = messages.join('; ')` — c'est CE texte que l'éditeur affiche) ;
 *  · `automationSettingsSchema`, `sequenceEtapes`, `problemesDuGraphe` ;
 *  · `verifierCoherence` (délai « avant », actions en double) ;
 *  · `problemesAvantPublication` / `bloquantsPublication` (bouton Publier).
 *
 * Exigence : chaque règle invalide est REFUSÉE avec un message clair, en
 * français, compréhensible par un entrepreneur — jamais « Invalid input:
 * expected string, received null ». Les règles valides passent, et `null`
 * est accepté là où le navigateur peut l'envoyer.
 *
 * Unitaire pur : aucune base, aucun réseau.
 */
import { describe, it, expect } from 'vitest';
import {
  automationRuleCreateSchema, automationRuleUpdateSchema, automationSettingsSchema, sequenceEtapes,
} from '../../../server/lib/validation';
import { problemesDuGraphe, type Etape } from '../../../server/lib/automationSequences';
import { verifierCoherence } from '../../../server/routes/automation-rules';
import { problemesAvantPublication, DELAI_MAX_SECONDES, DELAI_NEGATIF_MAX_SECONDES } from '../../../src/lib/automationCatalogue';
import { problemesPublication, bloquantsPublication } from '../../../src/lib/publicationAutomatisation';
import { MESSAGES_EN } from '../../../server/lib/automations-langue';

type Schema = { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: Array<{ message: string; params?: { en?: string } }> } } };

/** Le texte que l'éditeur affiche : exactement ce que `validate` renvoie. */
function refus(schema: Schema, corps: unknown): string {
  const r = schema.safeParse(corps);
  expect(r.success, `accepté alors qu'il devait être refusé : ${JSON.stringify(corps).slice(0, 200)}`).toBe(false);
  return r.error!.issues.map((i) => i.message).join('; ');
}
function refusEn(schema: Schema, corps: unknown): string {
  const r = schema.safeParse(corps);
  expect(r.success).toBe(false);
  return r.error!.issues.map((i) => i.params?.en ?? MESSAGES_EN[i.message] ?? i.message).join('; ');
}
function accepte(schema: Schema, corps: unknown): unknown {
  const r = schema.safeParse(corps);
  expect(r.success, r.success ? '' : r.error!.issues.map((i) => i.message).join('; ')).toBe(true);
  return r.data;
}

/** Jargon de développeur qu'un entrepreneur ne doit jamais lire. */
const JARGON = /Invalid input|expected|received|Unrecognized|Too (big|small)|\bundefined\b|\bnull\b|\brecord\b|\bnever\b|discriminator|\bRequired\b/i;
const ANGLAIS = /\b(is required|Unknown|Cannot|must|at least|at most|Add |Too many|Nothing|Empty|Invalid|needs|carries|whole number)\b/;
function clair(message: string): void {
  expect(message, 'message vide').not.toBe('');
  expect(message, `jargon : ${message}`).not.toMatch(JARGON);
  expect(message, `anglais : ${message}`).not.toMatch(ANGLAIS);
}

const SMS = { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } };
const OK = { name: 'Relance', trigger_event: 'quote.sent', delay_seconds: 86_400, actions: [SMS] };

// ─────────────────────────────────────────────────────────────
describe('A-330…A-339 — règles VALIDES : acceptées', () => {
  it('[A-330] règle simple minimale ; brouillon par défaut, conditions {} par défaut', () => {
    const d = accepte(automationRuleCreateSchema, OK) as Record<string, unknown>;
    expect(d.is_active).toBe(false);
    expect(d.conditions).toEqual({});
  });

  it.each([
    ['description', { description: null }], ['folder_id', { folder_id: null }], ['settings', { settings: null }],
    ['steps', { steps: null }], ['conditions', { conditions: null }],
  ])('[A-331] %s: null accepté (le navigateur peut l\'envoyer)', (_l, extra) => {
    const d = accepte(automationRuleCreateSchema, { ...OK, ...extra }) as Record<string, unknown>;
    if ('conditions' in extra) expect(d.conditions).toEqual({});
  });

  it('[A-332] parcours vide [] = règle simple (null)', () => {
    expect((accepte(automationRuleCreateSchema, { ...OK, steps: [] }) as { steps: unknown }).steps).toBeNull();
  });

  it.each([
    ['égalité', { canal: 'sms' }], ['nombre', { view_count: 0 }], ['booléen', { is_first_view: true }],
    ['eq', { canal: { eq: 'sms' } }], ['neq', { canal: { neq: 'sms' } }], ['in', { canal: { in: ['sms', 'email'] } }],
    ['not_in', { canal: { not_in: ['sms'] } }], ['gt/lt', { montant: { gt: 100, lt: 500 } }], ['gte/lte', { montant: { gte: '100', lte: '500' } }],
    ['suffixes', { montant__gte: 500, montant__lte: 1000 }], ['champs perso', { champs_perso: [{ field_id: '00000000-0000-4000-8000-000000000001', op: 'contains', value: 'toit' }] }],
    ['étiquettes', { client_a_etiquette: 'VIP', client_sans_etiquette: 'Froid' }],
  ])('[A-333] conditions %s acceptées', (_l, conditions) => {
    accepte(automationRuleCreateSchema, { ...OK, conditions });
  });

  it('[A-334] parcours complet : action, attente, attente réponse, avant la date, si, arrêter', () => {
    accepte(automationRuleCreateSchema, {
      ...OK, trigger_event: 'appointment.created', steps: [
        { id: 'e1', type: 'action', action: SMS, suivant: 'e2', nom: 'Confirmation' },
        { id: 'e2', type: 'attendre', delai_secondes: 3600, suivant: 'e3' },
        { id: 'e3', type: 'attendre', mode: 'reponse', delai_secondes: 86_400, si_reponse: 'e6', suivant: 'e4' },
        { id: 'e4', type: 'attendre', mode: 'avant_date', delai_secondes: 0, secondes_avant: 86_400, si_depasse: 'e6', suivant: 'e5' },
        { id: 'e5', type: 'si', conditions: { statut: 'scheduled' }, alors: 'e7', sinon: 'e6' },
        { id: 'e6', type: 'arreter' },
        { id: 'e7', type: 'action', action: { type: 'log_activity', config: { event_type: 'rappel' } } },
      ],
    });
  });

  it('[A-335] réglages complets et bornes exactes', () => {
    accepte(automationSettingsSchema, { reentree: true, arret_sur_reponse: true, fenetre: { debut: 7, fin: 22 }, jours_ouvrables: true, delai_entre_passages_jours: 365, marquer_lu: true, arreter_si_resolu: false });
    accepte(automationSettingsSchema, { fenetre: { debut: 21, fin: 22 }, delai_entre_passages_jours: 1 });
    accepte(automationSettingsSchema, {});
  });

  it('[A-336] délais aux bornes : 0, 1 an, −30 jours', () => {
    accepte(automationRuleCreateSchema, { ...OK, delay_seconds: 0 });
    accepte(automationRuleCreateSchema, { ...OK, delay_seconds: DELAI_MAX_SECONDES });
    accepte(automationRuleCreateSchema, { ...OK, trigger_event: 'appointment.created', delay_seconds: -DELAI_NEGATIF_MAX_SECONDES });
  });

  it('[A-337] modification : seules les clés ENVOYÉES sont gardées (pas de défaut qui dépublie)', () => {
    expect(accepte(automationRuleUpdateSchema, { name: 'Nouveau nom' })).toEqual({ name: 'Nouveau nom' });
    expect(accepte(automationRuleUpdateSchema, { is_active: true })).toEqual({ is_active: true });
    expect(accepte(automationRuleUpdateSchema, { settings: null })).toEqual({ settings: null });
  });

  it('[A-338] 5 actions simples acceptées ; au-delà, une séquence peut en porter plus', () => {
    const cinq = Array.from({ length: 5 }, (_, i) => ({ type: 'send_sms', config: { body: `m${i}` } }));
    accepte(automationRuleCreateSchema, { ...OK, actions: cinq });
    const huit = Array.from({ length: 8 }, (_, i) => ({ type: 'send_sms', config: { body: `m${i}` } }));
    accepte(automationRuleCreateSchema, { ...OK, actions: huit, steps: [{ id: 'a', type: 'action', action: SMS }] });
  });

  it('[A-339] variante anglaise d\'un champ (body_en) acceptée', () => {
    accepte(automationRuleCreateSchema, { ...OK, actions: [{ type: 'send_sms', config: { body: 'Bonjour', body_en: 'Hi' } }] });
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-340…A-369 — règles INVALIDES : refusées avec un message clair en français', () => {
  const cas: Array<[string, string, unknown, RegExp]> = [
    ['A-340', 'nom absent', { ...OK, name: undefined }, /nom/i],
    ['A-340', 'nom null', { ...OK, name: null }, /nom/i],
    ['A-340', 'nom vide', { ...OK, name: '' }, /nom/i],
    ['A-340', 'nom espaces', { ...OK, name: '   ' }, /nom/i],
    ['A-341', 'nom trop long', { ...OK, name: 'x'.repeat(121) }, /nom.*120/i],
    ['A-341', 'nom qui n\'est pas du texte', { ...OK, name: 42 }, /nom/i],
    ['A-342', 'description trop longue', { ...OK, description: 'x'.repeat(501) }, /description.*500/i],
    ['A-343', 'déclencheur inconnu', { ...OK, trigger_event: 'quote.created' }, /déclencheur/i],
    ['A-343', 'déclencheur absent', { ...OK, trigger_event: undefined }, /déclencheur/i],
    ['A-343', 'déclencheur null', { ...OK, trigger_event: null }, /déclencheur/i],
    ['A-344', 'délai absent', { ...OK, delay_seconds: undefined }, /délai/i],
    ['A-344', 'délai null', { ...OK, delay_seconds: null }, /délai/i],
    ['A-344', 'délai en texte', { ...OK, delay_seconds: '3600' }, /délai.*nombre/i],
    ['A-344', 'délai décimal', { ...OK, delay_seconds: 1.5 }, /délai.*entier/i],
    ['A-345', 'délai de plus d\'un an', { ...OK, delay_seconds: DELAI_MAX_SECONDES + 1 }, /an/i],
    ['A-345', 'plus de 30 jours avant', { ...OK, delay_seconds: -DELAI_NEGATIF_MAX_SECONDES - 1 }, /30 jours/i],
    ['A-346', 'aucune action', { ...OK, actions: [] }, /action/i],
    ['A-346', 'actions null', { ...OK, actions: null }, /action/i],
    ['A-346', 'actions absentes', { ...OK, actions: undefined }, /action/i],
    ['A-347', '6 actions simples', { ...OK, actions: Array.from({ length: 6 }, (_, i) => ({ type: 'send_sms', config: { body: `m${i}` } })) }, /5/],
    ['A-347', '21 actions', { ...OK, actions: Array.from({ length: 21 }, (_, i) => ({ type: 'send_sms', config: { body: `m${i}` } })), steps: [{ id: 'a', type: 'arreter' }] }, /20/],
    ['A-348', 'action inconnue', { ...OK, actions: [{ type: 'teleporter', config: {} }] }, /action/i],
    ['A-348', 'action sans config', { ...OK, actions: [{ type: 'send_sms' }] }, /action 1/i],
    ['A-349', 'texto sans texte', { ...OK, actions: [{ type: 'send_sms', config: {} }] }, /texte du message/i],
    ['A-349', 'texto au texte null', { ...OK, actions: [{ type: 'send_sms', config: { body: null } }] }, /texte du message/i],
    ['A-349', 'courriel sans objet', { ...OK, actions: [{ type: 'send_email', config: { body: 'x' } }] }, /objet/i],
    ['A-350', 'destinataire imposé (clé « to »)', { ...OK, actions: [{ type: 'send_sms', config: { body: 'x', to: '+15145550000' } }] }, /« to »/],
    ['A-350', 'clé d\'un autre type d\'action', { ...OK, actions: [{ type: 'send_sms', config: { body: 'x', subject: 'y' } }] }, /subject/],
    ['A-351', 'webhook en http', { ...OK, actions: [{ type: 'webhook', config: { url: 'http://exemple.test/h' } }] }, /https/],
    ['A-351', 'webhook interne', { ...OK, actions: [{ type: 'webhook', config: { url: 'https://169.254.169.254/x' } }] }, /interne/],
    ['A-351', 'webhook localhost', { ...OK, actions: [{ type: 'webhook', config: { url: 'https://localhost/x' } }] }, /interne/],
    ['A-352', 'condition : opérateur inconnu', { ...OK, conditions: { montant: { contains: 5 } } }, /montant.*contains/i],
    ['A-352', 'condition : objet vide', { ...OK, conditions: { montant: {} } }, /montant|condition/i],
    ['A-352', 'condition : liste hors champs perso', { ...OK, conditions: { canal: ['sms'] } }, /canal/i],
    ['A-352', 'condition : valeur null', { ...OK, conditions: { canal: null } }, /canal/i],
    ['A-352', 'condition : in vide', { ...OK, conditions: { canal: { in: [] } } }, /canal/i],
    ['A-353', 'trop de conditions', { ...OK, conditions: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`c${i}`, 'x'])) }, /10/],
    ['A-353', 'champ perso : opérateur inconnu', { ...OK, conditions: { champs_perso: [{ field_id: '00000000-0000-4000-8000-000000000001', op: 'ressemble' }] } }, /condition|champ/i],
    ['A-353', 'champ perso : id invalide', { ...OK, conditions: { champs_perso: [{ field_id: 'toit', op: 'is_empty' }] } }, /champ/i],
    ['A-354', 'réglage inconnu', { ...OK, settings: { envoyer_la_nuit: true } }, /envoyer_la_nuit/],
    ['A-354', 'fenêtre inversée', { ...OK, settings: { fenetre: { debut: 17, fin: 9 } } }, /fenêtre/i],
    ['A-354', 'fenêtre la nuit', { ...OK, settings: { fenetre: { debut: 3, fin: 8 } } }, /7 h et 22 h/],
    ['A-354', 'fenêtre en texte', { ...OK, settings: { fenetre: { debut: '9', fin: '17' } } }, /fenêtre/i],
    ['A-355', 'délai entre passages 0', { ...OK, settings: { delai_entre_passages_jours: 0 } }, /passage/i],
    ['A-355', 'délai entre passages 366', { ...OK, settings: { delai_entre_passages_jours: 366 } }, /passage/i],
    ['A-356', 'publication « oui »', { ...OK, is_active: 'oui' }, /publi/i],
    ['A-356', 'dossier invalide', { ...OK, folder_id: 'mon-dossier' }, /dossier/i],
    ['A-357', 'étape au type inconnu', { ...OK, steps: [{ id: 'a', type: 'sauter' }] }, /étape 1/i],
    ['A-357', 'étape sans identifiant', { ...OK, steps: [{ id: null, type: 'arreter' }] }, /étape 1/i],
    ['A-357', 'identifiant d\'étape illisible', { ...OK, steps: [{ id: 'a b', type: 'arreter' }] }, /identifiant/i],
    ['A-358', 'attente négative', { ...OK, steps: [{ id: 'a', type: 'attendre', delai_secondes: -1, suivant: 'b' }, { id: 'b', type: 'arreter' }] }, /attente/i],
    ['A-358', 'attente de plus d\'un an', { ...OK, steps: [{ id: 'a', type: 'attendre', delai_secondes: DELAI_MAX_SECONDES + 1, suivant: 'b' }, { id: 'b', type: 'arreter' }] }, /an/i],
    ['A-358', '« avant la date » sans durée', { ...OK, steps: [{ id: 'a', type: 'attendre', mode: 'avant_date', delai_secondes: 0, suivant: 'b' }, { id: 'b', type: 'arreter' }] }, /avant la date/i],
    ['A-358', '« avant la date » plus de 30 jours', { ...OK, steps: [{ id: 'a', type: 'attendre', mode: 'avant_date', delai_secondes: 0, secondes_avant: 31 * 86_400, suivant: 'b' }, { id: 'b', type: 'arreter' }] }, /30 jours/],
    ['A-359', 'parcours en boucle', { ...OK, steps: [{ id: 'a', type: 'attendre', delai_secondes: 60, suivant: 'b' }, { id: 'b', type: 'action', action: SMS, suivant: 'a' }] }, /boucle/],
    ['A-359', 'renvoi vers une étape absente', { ...OK, steps: [{ id: 'a', type: 'action', action: SMS, suivant: 'zz' }] }, /zz/],
    ['A-359', 'parcours qui finit sur une attente', { ...OK, steps: [{ id: 'a', type: 'action', action: SMS, suivant: 'b' }, { id: 'b', type: 'attendre', delai_secondes: 60 }] }, /attente/],
    ['A-359', '31 étapes', { ...OK, steps: Array.from({ length: 31 }, (_, i) => ({ id: `e${i}`, type: 'arreter' })) }, /30/],
    ['A-360', 'étape « si » sans conditions', { ...OK, steps: [{ id: 'a', type: 'si', alors: null, sinon: null }] }, /étape 1/i],
  ];

  it.each(cas)('[%s] %s → refusé, message clair', (_id, _l, corps, attendu) => {
    const msg = refus(automationRuleCreateSchema, corps);
    clair(msg);
    expect(msg).toMatch(attendu);
  });

  it.each(cas)('[A-361] %s (%s) : même refus en anglais pour une interface anglaise', (_id, _l, corps) => {
    const msg = refusEn(automationRuleCreateSchema, corps);
    expect(msg).not.toMatch(/Invalid input|expected .*received|Unrecognized key/);
  });

  it.each([
    ['A-362', 'corps vide', {}, /modifier/i],
    ['A-362', 'nom null', { name: null }, /nom/i],
    ['A-362', 'publication « oui »', { is_active: 'oui' }, /publi/i],
    ['A-362', 'délai en texte', { delay_seconds: 'demain' }, /délai/i],
    ['A-362', 'déclencheur inconnu', { trigger_event: 'x' }, /déclencheur/i],
    ['A-362', 'parcours en boucle', { steps: [{ id: 'a', type: 'attendre', delai_secondes: 1, suivant: 'a' }] }, /boucle/],
  ])('[%s] modification — %s → refusé, message clair', (_id, _l, corps, attendu) => {
    const msg = refus(automationRuleUpdateSchema, corps);
    clair(msg);
    expect(msg).toMatch(attendu);
  });

  it('[A-363] modification : conditions null acceptées (= aucune condition)', () => {
    expect(accepte(automationRuleUpdateSchema, { conditions: null })).toEqual({ conditions: {} });
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-370…A-379 — graphe du parcours (problemesDuGraphe)', () => {
  const act = (id: string, suivant?: string | null): Etape => ({ id, type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant });
  it.each([
    ['A-370', 'parcours vide', [], /au moins une étape/],
    ['A-371', 'identifiants en double', [act('a', 'b'), act('a')], /même identifiant/],
    ['A-372', 'suivant → absent', [act('a', 'x')], /« a ».*« x »/],
    ['A-372', 'alors → absent', [{ id: 's', type: 'si', conditions: { a: 1 }, alors: 'x', sinon: null }], /« x »/],
    ['A-372', 'sinon → absent', [{ id: 's', type: 'si', conditions: { a: 1 }, alors: null, sinon: 'x' }], /« x »/],
    ['A-372', 'si_reponse → absent', [{ id: 'w', type: 'attendre', mode: 'reponse', delai_secondes: 1, suivant: 'z', si_reponse: 'x' }, act('z')], /« x »/],
    ['A-372', 'si_depasse → absent', [{ id: 'w', type: 'attendre', mode: 'avant_date', delai_secondes: 0, secondes_avant: 1, suivant: 'z', si_depasse: 'x' }, act('z')], /« x »/],
    ['A-373', 'boucle directe a → a', [act('a', 'a')], /boucle/],
    ['A-373', 'boucle par sinon', [act('a', 's'), { id: 's', type: 'si', conditions: { a: 1 }, alors: null, sinon: 'a' }], /boucle/],
    ['A-373', 'boucle par si_reponse', [{ id: 'w', type: 'attendre', mode: 'reponse', delai_secondes: 1, suivant: 'z', si_reponse: 'w' }, act('z')], /boucle/],
    ['A-373', 'boucle par si_depasse', [act('z', 'w'), { id: 'w', type: 'attendre', mode: 'avant_date', delai_secondes: 0, secondes_avant: 1, suivant: 'y', si_depasse: 'z' }, act('y')], /boucle/],
    ['A-374', 'fin sur une attente', [act('a', 'w'), { id: 'w', type: 'attendre', delai_secondes: 60 }], /se termine par une attente/],
  ])('[%s] %s → %s', (_id, _l, steps, attendu) => {
    const p = problemesDuGraphe(steps as Etape[]);
    expect(p.join(' | ')).toMatch(attendu);
    p.forEach(clair);
  });

  it('[A-375] parcours correct (branches qui se rejoignent, pas de boucle) : aucun problème', () => {
    expect(problemesDuGraphe([
      act('a', 's'), { id: 's', type: 'si', conditions: { a: 1 }, alors: 'b', sinon: 'c' }, act('b', 'd'), act('c', 'd'), act('d'),
    ])).toEqual([]);
  });

  it('[A-376] sequenceEtapes seul (utilisé par Lumi) refuse les mêmes graphes', () => {
    expect(sequenceEtapes.safeParse([act('a', 'a')]).success).toBe(false);
    expect(sequenceEtapes.safeParse([act('a')]).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-380…A-384 — cohérence (verifierCoherence, route)', () => {
  it.each([
    ['A-380', 'délai négatif sur « Soumission envoyée »', { trigger_event: 'quote.sent', delay_seconds: -3600 }, /date future/],
    ['A-380', 'délai négatif sans déclencheur', { delay_seconds: -3600 }, /déclencheur/],
    ['A-381', 'plus de 30 jours avant un rendez-vous', { trigger_event: 'appointment.created', delay_seconds: -31 * 86_400 }, /30 jours/],
    ['A-382', 'deux actions identiques', { trigger_event: 'quote.sent', actions: [SMS, SMS] }, /double/],
  ])('[%s] %s → refusé', (_id, _l, corps, attendu) => {
    const msg = verifierCoherence(corps as Parameters<typeof verifierCoherence>[0]);
    expect(msg).toMatch(attendu);
    clair(msg as string);
    // L'interface anglaise reçoit l'anglais (message calculé ou table de traduction).
    const en = verifierCoherence(corps as Parameters<typeof verifierCoherence>[0], false) as string;
    expect(MESSAGES_EN[en] ?? en).not.toMatch(/[éèà]/);
  });

  it.each([
    ['A-383', 'rappel 1 jour avant un rendez-vous', { trigger_event: 'appointment.created', delay_seconds: -86_400 }],
    ['A-383', 'deux textos différents', { trigger_event: 'quote.sent', actions: [SMS, { type: 'send_sms', config: { body: 'Autre' } }] }],
    ['A-383', 'délai positif', { trigger_event: 'quote.sent', delay_seconds: 3600 }],
  ])('[%s] %s → accepté', (_id, _l, corps) => {
    expect(verifierCoherence(corps as Parameters<typeof verifierCoherence>[0])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('A-385…A-399 — avant de publier (problemesAvantPublication, bloquantsPublication)', () => {
  const bloquants = (r: Parameters<typeof problemesAvantPublication>[0]) =>
    problemesAvantPublication(r).filter((p) => p.gravite === 'bloquant');
  const pas = (id: string, extra: Record<string, unknown>) => ({ id, ...extra });

  it.each([
    ['A-385', 'sans déclencheur', { actions: [SMS] }, /déclenche/],
    ['A-385', 'déclencheur inconnu', { trigger_event: 'quote.created', actions: [SMS] }, /déclenche/],
    ['A-386', '« Date atteinte » sans champ date', { trigger_event: 'date.reached', conditions: {}, actions: [SMS] }, /doit être rempli/],
    ['A-387', 'aucune action ni étape', { trigger_event: 'quote.sent', actions: [], steps: [] }, /au moins une étape/],
    ['A-388', 'action inconnue', { trigger_event: 'quote.sent', actions: [{ type: 'teleporter', config: {} }] }, /inconnue/],
    ['A-388', 'action indisponible (Slack)', { trigger_event: 'quote.sent', actions: [{ type: 'envoyer_slack', config: { body: 'x' } }] }, /Slack/],
    ['A-389', 'action incompatible avec le déclencheur', { trigger_event: 'quote.sent', actions: [{ type: 'envoyer_facture', config: {} }] }, /ne peut pas suivre/],
    ['A-390', 'champ obligatoire vide', { trigger_event: 'quote.sent', actions: [{ type: 'send_sms', config: { body: '  ' } }] }, /est vide/],
    ['A-391', 'étape → étape supprimée (suivant)', { trigger_event: 'quote.sent', steps: [pas('a', { type: 'action', action: SMS, suivant: 'x' })] }, /supprimée/],
    ['A-391', 'étape → étape supprimée (si_depasse)', { trigger_event: 'appointment.created', steps: [
      pas('w', { type: 'attendre', mode: 'avant_date', delai_secondes: 0, secondes_avant: 3600, suivant: 'a', si_depasse: 'x' }), pas('a', { type: 'action', action: SMS }),
    ] }, /supprimée/],
    ['A-392', 'parcours qui finit sur une attente', { trigger_event: 'quote.sent', steps: [pas('a', { type: 'action', action: SMS, suivant: 'w' }), pas('w', { type: 'attendre', delai_secondes: 60 })] }, /attente/],
  ])('[%s] %s → bloquant, en français', (_id, _l, regle, attendu) => {
    const b = bloquants(regle);
    expect(b.map((p) => p.message).join(' | ')).toMatch(attendu);
    b.forEach((p) => clair(p.message));
  });

  it('[A-393] l\'étape fautive est nommée (pour l\'ouvrir d\'un clic)', () => {
    const b = bloquants({ trigger_event: 'quote.sent', steps: [pas('e7', { type: 'action', action: { type: 'send_sms', config: {} } })] });
    expect(b[0].etapeId).toBe('e7');
  });

  it('[A-394] avertissements (non bloquants) : condition vide, aucun message au client', () => {
    const p = problemesAvantPublication({ trigger_event: 'quote.sent', steps: [
      pas('s', { type: 'si', conditions: {}, alors: 'a', sinon: null }), pas('a', { type: 'action', action: { type: 'create_notification', config: { title: 'x' } } }),
    ] });
    expect(p.filter((x) => x.gravite === 'avertissement').map((x) => x.message).join(' | ')).toMatch(/condition est vide.*Aucun message/);
  });

  it('[A-395] règle correcte : rien de bloquant', () => {
    expect(bloquants({ trigger_event: 'quote.sent', actions: [SMS] })).toEqual([]);
    expect(bloquants({ trigger_event: 'date.reached', conditions: { champ_id: '00000000-0000-4000-8000-000000000001' }, actions: [SMS] })).toEqual([]);
  });

  it('[A-396] en anglais, les mêmes refus parlent anglais', () => {
    const b = problemesAvantPublication({ trigger_event: null, actions: [SMS], fr: false });
    expect(b[0].message).toBe('Pick what triggers this automation.');
  });

  it('[A-397] préréglage au format d\'origine (log_activity, avis sans texte) : publiable tel quel', () => {
    expect(bloquantsPublication({ trigger_event: 'job.completed', actions: [{ type: 'log_activity', config: { event_type: 'x' } }, { type: 'request_review', config: {} }], is_preset: true })).toEqual([]);
  });

  it('[A-398] l\'action provisoire « À compléter » compte pour un parcours vide', () => {
    const b = bloquantsPublication({ trigger_event: 'quote.sent', steps: [], actions: [{ type: 'send_sms', config: { body: 'À compléter' } }] });
    expect(b.map((p) => p.message).join(' ')).toMatch(/au moins une étape/);
  });

  it('[A-399] problemesPublication renvoie aussi les avertissements, bloquantsPublication seulement les bloquants', () => {
    const r = { trigger_event: 'quote.sent', steps: [pas('a', { type: 'action', action: { type: 'create_notification', config: { title: 'x' } } })], actions: [] };
    expect(problemesPublication(r).some((p) => p.gravite === 'avertissement')).toBe(true);
    expect(bloquantsPublication(r)).toEqual([]);
  });
});
