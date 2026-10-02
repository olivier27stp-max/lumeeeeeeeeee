/**
 * LES ROUTES DES AUTOMATISATIONS — corrections de l'agent U, côté SERVEUR.
 *
 * Les VRAIES routes sont montées (règles + publication). Seuls Supabase et
 * l'authentification sont simulés : le faux client du lot 2
 * (tests/automation/lot2-faux-supabase.ts) applique POUR VRAI les filtres et
 * répond comme PostgREST quand `.single()` ne trouve pas exactement une ligne.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Ligne } from '../../automation/lot2-faux-supabase';

const ORG = '11111111-2222-4333-8444-555555555555';
const REGLE = 'aaaaaaaa-0000-4000-8000-0000000000b1';
const V1 = '2026-10-01T23:33:26.774123+00:00';

const { etat, client: fauxClient } = await vi.hoisted(async () => (await import('../../automation/lot2-faux-supabase')).creerFausseBase());

vi.mock('../../../server/lib/supabase', () => ({
  requireAuthedClient: async () => ({ client: fauxClient(), orgId: ORG, user: { id: 'u1' } }),
  getServiceClient: () => fauxClient(),
}));
vi.mock('../../../server/lib/automatisations-bureaux', () => ({
  bureauxCibles: vi.fn(), copierVersBureaux: vi.fn(), propagerAuxCopies: vi.fn(async () => []),
}));

const { default: routeurRegles } = await import('../../../server/routes/automation-rules');
const { default: routeurPublication } = await import('../../../server/routes/automation-publication');

let serveur: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', routeurRegles);
  app.use('/api', routeurPublication);
  await new Promise<void>((ok) => { serveur = app.listen(0, '127.0.0.1', () => ok()); });
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise((ok) => serveur.close(ok)); });

async function appeler(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  const res = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x', ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  // `any` : corps JSON libre, lu par les assertions (même harnais que tests/automation/lot2-corbeille-serveur).
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

const texto = (body: string) => ({ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body } }, suivant: null });
function regle(sup: Ligne = {}): Ligne {
  return {
    id: REGLE, org_id: ORG, name: 'Relance', description: '', trigger_event: 'invoice.overdue', conditions: {},
    delay_seconds: 0, actions: [{ type: 'send_sms', config: { body: 'À compléter' } }], settings: null,
    is_active: false, is_preset: false, preset_key: null, folder_id: null, modele_id: null,
    deleted_at: null, purged_at: null, lumi_conversation: [], updated_at: V1,
    steps: [texto('Texte d’origine')],
    ...sup,
  };
}
const enBase = () => (etat.tables.automation_rules ?? []).find((l) => l.id === REGLE) as Ligne;
const textoEnBase = () => ((enBase().steps as Array<{ action?: { config?: { body?: string } } }>)[0]?.action?.config?.body);
const ecritures = () => etat.ecritures.filter((e) => e.table === 'automation_rules' && e.ids.includes(REGLE));

beforeEach(() => {
  etat.ecritures.length = 0;
  etat.disparaitApresLecture = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  etat.tables = { automation_rules: [regle()], automation_scheduled_tasks: [], automation_folders: [], org_features: [], custom_fields: [] };
});

// ─── Triage « actions », lignes 5 et 7 (= déclencheurs 06:181) ──

describe('lignes 5 et 7 — la publication juge les actions sur l’entité que fixe le champ surveillé', () => {
  const DATE_PIPELINE = 'cccccccc-0000-4000-8000-0000000000d1';
  const DATE_CLIENT = 'cccccccc-0000-4000-8000-0000000000d2';
  const TEXTE_CLIENT = 'cccccccc-0000-4000-8000-0000000000d3';
  const D_UN_AUTRE_BUREAU = 'cccccccc-0000-4000-8000-0000000000d4';
  const MEMBRE = '99999999-0000-4000-8000-000000000001';
  const etape = (id: string, type: string, config: Record<string, string>, suivant: string | null) => ({ id, type: 'action', action: { type, config }, suivant });
  /** Un texto au client, puis l'action jugée. */
  const parcours = (...actions: Array<[string, Record<string, string>]>) => [
    etape('e1', 'send_sms', { body: 'Bonjour [client_first_name]' }, 'e2'),
    ...actions.map(([type, config], i) => etape(`e${i + 2}`, type, config, i + 1 < actions.length ? `e${i + 3}` : null)),
  ];
  const SIX: Array<[string, Record<string, string>]> = [
    ['envoyer_facture', {}], ['envoyer_soumission', {}], ['modifier_statut_rendezvous', { statut: 'completed' }],
    ['move_deal_stage', { cible: 'gagne' }], ['modifier_deal', { source: 'Site' }], ['assigner_deal', { membre_id: MEMBRE }],
  ];
  const publier = () => appeler('POST', `/automations/rules/${REGLE}/publication`, { actif: true });

  beforeEach(() => {
    etat.tables.custom_fields = [
      { id: DATE_PIPELINE, org_id: ORG, object_type: 'deal', field_type: 'date' },
      { id: DATE_CLIENT, org_id: ORG, object_type: 'client', field_type: 'date' },
      { id: TEXTE_CLIENT, org_id: ORG, object_type: 'client', field_type: 'text' },
      { id: D_UN_AUTRE_BUREAU, org_id: 'un-autre-bureau', object_type: 'deal', field_type: 'date' },
    ];
  });

  it('« Date atteinte » sur un champ date du PIPELINE + « Assigner l’opportunité » : publiée (c’est bien une opportunité qui arrive)', async () => {
    etat.tables.automation_rules = [regle({ trigger_event: 'date.reached', conditions: { champ_id: DATE_PIPELINE, jours_avant: 7 }, steps: parcours(['assigner_deal', { membre_id: MEMBRE }]) })];
    const r = await publier();
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(enBase().is_active).toBe(true);
  });

  it('… les trois actions sur l’opportunité passent ; facture, devis et rendez-vous restent refusés', async () => {
    etat.tables.automation_rules = [regle({ trigger_event: 'date.reached', conditions: { champ_id: DATE_PIPELINE }, steps: parcours(...SIX) })];
    const r = await publier();
    expect(r.status).toBe(422);
    expect(r.json.problemes).toEqual([
      '« Envoyer la facture » ne peut pas suivre ce déclencheur.',
      '« Envoyer le devis » ne peut pas suivre ce déclencheur.',
      '« Changer le statut du rendez-vous » ne peut pas suivre ce déclencheur.',
    ]);
  });

  it('« Date atteinte » sur un champ date du CLIENT : « Assigner l’opportunité » reste refusée', async () => {
    etat.tables.automation_rules = [regle({ trigger_event: 'date.reached', conditions: { champ_id: DATE_CLIENT }, steps: parcours(['assigner_deal', { membre_id: MEMBRE }]) })];
    const r = await publier();
    expect(r.status).toBe(422);
    expect(r.json.problemes).toEqual(['« Assigner l’opportunité » ne peut pas suivre ce déclencheur.']);
  });

  it('le champ d’un AUTRE bureau ne compte pas : jugé sur le déclencheur seul', async () => {
    etat.tables.automation_rules = [regle({ trigger_event: 'date.reached', conditions: { champ_id: D_UN_AUTRE_BUREAU }, steps: parcours(['assigner_deal', { membre_id: MEMBRE }]) })];
    expect((await publier()).status).toBe(422);
  });

  it('« Champ personnalisé modifié » sur un champ du CLIENT : les six actions liées à une autre fiche sont refusées (le tiroir les grise déjà)', async () => {
    etat.tables.automation_rules = [regle({ trigger_event: 'custom_field.changed', conditions: { field_id: { eq: TEXTE_CLIENT } }, steps: parcours(...SIX) })];
    const r = await publier();
    expect(r.status).toBe(422);
    expect(r.json.problemes).toEqual([
      '« Envoyer la facture » ne peut pas suivre ce déclencheur.',
      '« Envoyer le devis » ne peut pas suivre ce déclencheur.',
      '« Changer le statut du rendez-vous » ne peut pas suivre ce déclencheur.',
      '« Déplacer l’opportunité » ne peut pas suivre ce déclencheur.',
      '« Modifier l’opportunité » ne peut pas suivre ce déclencheur.',
      '« Assigner l’opportunité » ne peut pas suivre ce déclencheur.',
    ]);
    expect(enBase().is_active).toBe(false);
  });

  it('« Champ personnalisé modifié » SANS champ choisi : l’entité dépend de la donnée, rien n’est refusé d’avance', async () => {
    etat.tables.automation_rules = [regle({ trigger_event: 'custom_field.changed', conditions: {}, steps: parcours(...SIX) })];
    expect((await publier()).status).toBe(200);
  });

  it('publier par PATCH (`is_active: true`) et créer déjà publiée suivent la même règle', async () => {
    etat.tables.automation_rules = [regle({ trigger_event: 'date.reached', conditions: { champ_id: DATE_PIPELINE }, steps: parcours(['assigner_deal', { membre_id: MEMBRE }]) })];
    expect((await appeler('PATCH', `/automations/rules/${REGLE}`, { is_active: true })).status).toBe(200);

    const corps = { name: 'Neuve', trigger_event: 'custom_field.changed', delay_seconds: 0, is_active: true, conditions: { field_id: { eq: TEXTE_CLIENT } }, actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }], steps: parcours(['envoyer_facture', {}]) };
    const creee = await appeler('POST', '/automations/rules', corps);
    expect(creee.status).toBe(422);
    expect(creee.json.problemes).toEqual(['« Envoyer la facture » ne peut pas suivre ce déclencheur.']);
  });

  it('automatisation PUBLIÉE : pointer « Date atteinte » d’un champ du pipeline vers un champ du client est refusé si une action sur l’opportunité s’y trouve', async () => {
    etat.tables.automation_rules = [regle({ is_active: true, trigger_event: 'date.reached', conditions: { champ_id: DATE_PIPELINE }, steps: parcours(['assigner_deal', { membre_id: MEMBRE }]) })];
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { conditions: { champ_id: DATE_CLIENT } });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe('publiee_cassee');
    expect(r.json.problemes).toEqual(['« Assigner l’opportunité » ne peut pas suivre ce déclencheur.']);
  });
});

// ─── Triage « actions », ligne 6 ────────────────────────────────

describe('ligne 6 — « Appel reçu de l’extérieur » : la publication refuse les six actions qui échoueraient à chaque passage', () => {
  const etape = (id: string, type: string, config: Record<string, string>, suivant: string | null) => ({ id, type: 'action', action: { type, config }, suivant });

  it('facture, devis, rendez-vous et opportunité : 422, chacune nommée', async () => {
    etat.tables.automation_rules = [regle({
      trigger_event: 'webhook.received', conditions: {},
      steps: [
        etape('e1', 'send_sms', { body: 'Bonjour' }, 'e2'),
        etape('e2', 'envoyer_facture', {}, 'e3'),
        etape('e3', 'envoyer_soumission', {}, 'e4'),
        etape('e4', 'modifier_statut_rendezvous', { statut: 'completed' }, 'e5'),
        etape('e5', 'move_deal_stage', { cible: 'gagne' }, 'e6'),
        etape('e6', 'modifier_deal', { source: 'Site' }, 'e7'),
        etape('e7', 'assigner_deal', {}, null),
      ],
    })];
    const r = await appeler('POST', `/automations/rules/${REGLE}/publication`, { actif: true });
    expect(r.status).toBe(422);
    expect(r.json.problemes).toEqual([
      '« Envoyer la facture » ne peut pas suivre ce déclencheur.',
      '« Envoyer le devis » ne peut pas suivre ce déclencheur.',
      '« Changer le statut du rendez-vous » ne peut pas suivre ce déclencheur.',
      '« Déplacer l’opportunité » ne peut pas suivre ce déclencheur.',
      '« Modifier l’opportunité » ne peut pas suivre ce déclencheur.',
      '« Assigner l’opportunité » ne peut pas suivre ce déclencheur.',
    ]);
    expect(enBase().is_active).toBe(false);
  });

  it('un parcours qui n’en contient aucune se publie', async () => {
    etat.tables.automation_rules = [regle({
      trigger_event: 'webhook.received', conditions: {},
      steps: [etape('e1', 'send_sms', { body: 'Bonjour' }, 'e2'), etape('e2', 'create_task', { title: 'Rappeler' }, null)],
    })];
    expect((await appeler('POST', `/automations/rules/${REGLE}/publication`, { actif: true })).status).toBe(200);
  });
});

// ─── Triage « éditeur », 05b-canevas-outils-origine:303 ─────────

describe('05b:303 — une automatisation PUBLIÉE ne se vide pas ; `actions` peut refléter un parcours', () => {
  const MESSAGE = 'Cette automatisation est publiée : on ne peut pas lui retirer toutes ses étapes. Gardez-en au moins une, ou repassez-la en brouillon d’abord.';
  /** Un parcours CONVERTI : `actions` porte encore l'ancien message (ce que « Convertir » laissait). */
  const convertie = (sup: Ligne = {}) => regle({ actions: [{ type: 'send_sms', config: { body: 'Texte d’origine' } }], ...sup });

  it('publiée : retirer toutes ses étapes est refusé (422), rien n’est écrit — elle ne retombe pas au « format d’origine »', async () => {
    etat.tables.automation_rules = [convertie({ is_active: true })];
    for (const vide of [[], null]) {
      const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { name: 'Relance', steps: vide });
      expect(r.status).toBe(422);
      expect(r.json).toEqual({ error: MESSAGE, code: 'publiee_cassee' });
    }
    expect(ecritures()).toEqual([]);
    expect((enBase().steps as unknown[]).length).toBe(1);
  });

  it('en anglais', async () => {
    etat.tables.automation_rules = [convertie({ is_active: true })];
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { steps: [] }, { 'Accept-Language': 'en' });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe('This automation is published: you cannot remove all of its steps. Keep at least one, or switch it back to draft first.');
  });

  it('… sauf si la même modification la repasse en brouillon', async () => {
    etat.tables.automation_rules = [convertie({ is_active: true })];
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { steps: [], is_active: false, actions: [{ type: 'send_sms', config: { body: 'À compléter' } }] });
    expect(r.status).toBe(200);
    expect(enBase().is_active).toBe(false);
    expect(enBase().steps).toBeNull();
  });

  it('un brouillon se vide : les étapes ET le reflet `actions` envoyé par l’éditeur sont écrits ensemble', async () => {
    etat.tables.automation_rules = [convertie()];
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { name: 'Relance', steps: [], actions: [{ type: 'send_sms', config: { body: 'À compléter' } }] });
    expect(r.status).toBe(200);
    expect(enBase().steps).toBeNull();
    expect(enBase().actions).toEqual([{ type: 'send_sms', config: { body: 'À compléter' } }]);
  });

  it('publiée, une étape en moins mais il en reste : accepté', async () => {
    etat.tables.automation_rules = [convertie({ is_active: true, steps: [{ ...texto('Un'), suivant: 'e2' }, { ...texto('Deux'), id: 'e2' }] })];
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { steps: [texto('Un')], actions: [{ type: 'send_sms', config: { body: 'Un' } }] });
    expect(r.status).toBe(200);
  });

  it('deux étapes identiques dans un PARCOURS : le reflet `actions` qui les porte toutes les deux est accepté', async () => {
    const deux = [{ ...texto('Rappel'), suivant: 'e2' }, { ...texto('Rappel'), id: 'e2' }];
    const reflet = [{ type: 'send_sms', config: { body: 'Rappel' } }, { type: 'send_sms', config: { body: 'Rappel' } }];
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { steps: deux, actions: reflet });
    expect(r.status).toBe(200);
    expect(enBase().actions).toEqual(reflet);
    // À la création aussi.
    const creee = await appeler('POST', '/automations/rules', { name: 'Neuve', trigger_event: 'quote.sent', delay_seconds: 0, steps: deux, actions: reflet });
    expect(creee.status).toBe(201);
  });

  it('… mais une règle SIMPLE (sans parcours) avec deux actions identiques reste refusée : elles partiraient ensemble', async () => {
    etat.tables.automation_rules = [regle({ steps: null })];
    const reflet = [{ type: 'send_sms', config: { body: 'Rappel' } }, { type: 'send_sms', config: { body: 'Rappel' } }];
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { actions: reflet });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('Deux actions identiques : le client recevrait le même message en double.');
  });
});

// ─── Priorité — constat A-09 ────────────────────────────────────

describe('A-09 — garde de version : une écriture PÉRIMÉE de l’éditeur n’écrase plus ce que Lumi (ou un autre onglet) vient d’écrire', () => {
  const DE_LUMI = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard : [invoice_link]';
  /** Lumi (clavardage général) réécrit le texto : la ligne change, sa version aussi. */
  function lumiReecrit() {
    Object.assign(enBase(), { steps: [texto(DE_LUMI)], updated_at: '2026-10-01T23:40:00.000001+00:00' });
  }

  it('la séquence du constat : l’éditeur charge, Lumi écrit, l’éditeur enregistre son parcours en mémoire → 409, rien n’est écrit, le texto de Lumi survit', async () => {
    const charge = await appeler('GET', `/automations/editeur?rule_id=${REGLE}`);
    expect(charge.status).toBe(200);
    const enMemoire = charge.json.rule as { name: string; steps: unknown[]; updated_at: string };
    expect(enMemoire.updated_at).toBe(V1);

    lumiReecrit();

    const perime = [{ id: 'e0', type: 'attendre', delai_secondes: 86400, suivant: 'e1' }, ...enMemoire.steps];
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { name: enMemoire.name, steps: perime, version_lue: enMemoire.updated_at });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({
      error: 'Cette automatisation a été modifiée ailleurs (par Lumi ou dans un autre onglet).',
      code: 'modifiee_ailleurs',
      updated_at: '2026-10-01T23:40:00.000001+00:00',
    });
    expect(ecritures()).toEqual([]);
    expect(textoEnBase()).toBe(DE_LUMI);
  });

  it('en anglais', async () => {
    lumiReecrit();
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { name: 'Relance', version_lue: V1 }, { 'Accept-Language': 'en' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('This automation was changed elsewhere (by Lumi or in another tab).');
    expect(r.json.code).toBe('modifiee_ailleurs');
  });

  it('la version lue est la bonne : l’écriture passe, et la réponse porte la NOUVELLE version', async () => {
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { name: 'Relance', steps: [texto('Nouveau texte')], version_lue: V1 });
    expect(r.status).toBe(200);
    expect(textoEnBase()).toBe('Nouveau texte');
    expect(r.json.updated_at).not.toBe(V1);
    // La garde ne s'enregistre pas dans la ligne.
    expect(enBase()).not.toHaveProperty('version_lue');
    expect(ecritures()[0].valeurs).not.toHaveProperty('version_lue');

    // … et l'enregistrement SUIVANT de l'éditeur, avec cette nouvelle version, passe aussi.
    const suite = await appeler('PATCH', `/automations/rules/${REGLE}`, { name: 'Relance 2', version_lue: r.json.updated_at });
    expect(suite.status).toBe(200);
    expect(enBase().name).toBe('Relance 2');
  });

  it('un appelant qui n’envoie PAS la garde (outils de Lumi, scripts) garde le comportement d’avant', async () => {
    lumiReecrit();
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { name: 'Renommée par un script' });
    expect(r.status).toBe(200);
    expect(enBase().name).toBe('Renommée par un script');
  });

  it('la règle change ENTRE la lecture de la route et son écriture : toujours 409, jamais un écrasement', async () => {
    // La PREMIÈRE lecture de la version (celle de la route, avant d'écrire) voit
    // V1 ; juste après, quelqu'un d'autre a écrit : toute lecture suivante — dont
    // le filtre de l'écriture elle-même — voit une version plus récente.
    const ligne = enBase();
    let lectures = 0;
    let plusRecente = '2026-10-01T23:41:00.000002+00:00';
    Object.defineProperty(ligne, 'updated_at', {
      configurable: true, enumerable: true,
      get: () => { lectures += 1; return lectures <= 1 ? V1 : plusRecente; },
      set: (v: string) => { plusRecente = v; },
    });
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { name: 'Périmée', version_lue: V1 });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('modifiee_ailleurs');
    expect(enBase().name).toBe('Relance');
  });

  it('une garde seule, sans rien à modifier : refusée (400), rien n’est écrit', async () => {
    const r = await appeler('PATCH', `/automations/rules/${REGLE}`, { version_lue: V1 });
    expect(r.status).toBe(400);
    expect(ecritures()).toEqual([]);
  });

  it('publier rend la version de la règle après le changement (l’éditeur ouvert reste à jour)', async () => {
    const r = await appeler('POST', `/automations/rules/${REGLE}/publication`, { actif: false });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: REGLE, is_active: false });
    expect(typeof r.json.updated_at).toBe('string');
    expect(r.json.updated_at).toBe(enBase().updated_at);
  });
});
