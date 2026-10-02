/**
 * Agent P — les trois routes de `server/routes/automation-ciblage.ts`, la VRAIE route montée
 * dans une app Express de test :
 *   POST /api/automations/ciblage/apercu · GET /api/automations/rules/:id/conflits ·
 *   POST /api/automations/rules/:id/tester
 *
 *   npx vitest run --maxWorkers=2 tests/automations-finale/p/routes-ciblage.test.ts
 *
 * Seuls Supabase et la session sont simulés (fausse-base.ts). Le droit est lu pour de bon dans
 * la fausse table `memberships`. Les variables d'un client, elles, sont celles d'un faux
 * `resolveEntityVariables` (la vraie résolution est éprouvée contre la vraie base :
 * integration/p-essai.test.ts).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const etat = vi.hoisted(() => ({ base: null as unknown as import('./fausse-base').FausseBase, utilisateur: 'proprio', vars: {} as Record<string, string>, executions: 0 }));

vi.mock('../../../server/lib/supabase', () => ({
  requireAuthedClient: async (req: { header: (n: string) => string | undefined }, res: { status: (n: number) => { json: (c: unknown) => void } }) => {
    if (!req.header('authorization')) { res.status(401).json({ error: 'Missing authorization header.' }); return null; }
    return { client: etat.base.client, orgId: ORG, user: { id: etat.utilisateur, email: `${etat.utilisateur}@lume-qa.test` } };
  },
  getServiceClient: () => etat.base.client,
}));
vi.mock('../../../server/lib/actions', async (original) => ({
  ...(await original<typeof import('../../../server/lib/actions')>()),
  // Les variables du client de l'essai (la vraie résolution lit dix tables : éprouvée en intégration).
  resolveEntityVariables: async () => ({ ...etat.vars }),
  // Si l'essai exécutait une action, ce compteur le dirait.
  executeAction: async () => { etat.executions++; return { success: true }; },
}));

import { FausseBase, uuid } from './fausse-base';
import routeur, { apercuCiblageSchema, essaiSchema } from '../../../server/routes/automation-ciblage';
import type { ResultatEssai } from '../../../src/lib/automationEssai';

const ORG = uuid(1, 9);
const REGLE = uuid(1, 5);
const AUTRE_REGLE = uuid(2, 5);
const CLIENT = uuid(1);

const adhesion = (utilisateur: string, role: string, permissions: Record<string, boolean> = {}) => ({
  id: `m-${utilisateur}`, user_id: utilisateur, org_id: ORG, status: 'active', role, scope: 'company', team_id: null, department_id: null, manager_id: null, permissions,
});
const client = (n: number, p: Record<string, unknown> = {}) => ({
  id: uuid(n), org_id: ORG, first_name: `Prénom${n}`, last_name: `Nom${n}`, company: null, display_as_company: false, status: 'active',
  city: 'Montréal', lead_source: null, source: null, phone: `+1514555010${n}`, email: `client${n}@lume-qa.test`, email_opt_out_at: null, deleted_at: null, ...p,
});
const texto = (body: string, plus: Record<string, unknown> = {}) => ({ type: 'send_sms', config: { body, ...plus } });
const regle = (id: string, p: Record<string, unknown> = {}) => ({
  id, org_id: ORG, name: 'Bienvenue', trigger_event: 'lead.created', conditions: {}, steps: [], actions: [texto('Bonjour [client_first_name], merci de votre demande.')],
  delay_seconds: 0, settings: {}, is_active: false, is_preset: false, preset_key: null, deleted_at: null, purged_at: null, created_at: '2026-09-01', ...p,
});

let serveur: Server;
let origine = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', routeur);
  serveur = await new Promise<Server>((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  origine = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((ok) => serveur.close(ok)); });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  etat.utilisateur = 'proprio';
  etat.executions = 0;
  etat.vars = { client_first_name: 'Prénom1', client_last_name: 'Nom1', client_name: 'Prénom1 Nom1', client_phone: '+15145550101', client_email: 'client1@lume-qa.test', company_name: 'Votre entreprise' };
  etat.base = new FausseBase({
    memberships: [adhesion('proprio', 'owner'), adhesion('technicien', 'technician'), adhesion('lecteur', 'technician', { 'automations.read': true, 'clients.read': false })],
    clients: [client(1), client(2), client(3, { phone: null }), { ...client(4), org_id: uuid(2, 9) }],
    client_tags: [{ id: 't1', client_id: uuid(1), tag: 'VIP' }, { id: 't2', client_id: uuid(2), tag: 'VIP' }, { id: 't3', client_id: uuid(2), tag: 'Ne pas relancer' }],
    custom_fields: [], custom_field_values: [], custom_field_value_options: [],
    sms_opt_outs: [{ id: 's1', org_id: ORG, phone: '+15145550102' }], email_unsubscribes: [],
    company_settings: [{ org_id: ORG, timezone: 'America/Toronto', default_language: 'fr' }],
    automation_rules: [regle(REGLE), regle(AUTRE_REGLE, { name: 'Bienvenue (ancienne)', is_active: true })],
    automation_execution_logs: [],
  });
});

async function appeler(methode: 'GET' | 'POST', chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
  const res = await fetch(`${origine}/api${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jeton-de-test', 'Accept-Language': 'fr', ...entetes },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

describe('P — POST /api/automations/ciblage/apercu', () => {
  it('rend le compteur, les sous-comptes et les premiers clients — par le même évaluateur que le moteur', async () => {
    const r = await appeler('POST', '/automations/ciblage/apercu', {
      ciblage: { inclure: { mode: 'toutes', regles: [{ type: 'etiquette', valeur: 'VIP' }] } }, canaux: ['sms'], demande_avis: false,
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      total: 2, dont: { stop_texto: 1, desabonnes_courriel: 0, sans_telephone: 0, sans_courriel: 0, sans_avis: 0 },
      apercu: [{ id: uuid(1), nom: 'Prénom1 Nom1', empechements: [] }, { id: uuid(2), nom: 'Prénom2 Nom2', empechements: ['stop_texto'] }],
      tronque: false, plafond: 20000, carnet: 3,
    });
  });

  it('un corps sans ciblage = tous les clients du bureau de la SESSION (jamais un autre bureau)', async () => {
    const r = await appeler('POST', '/automations/ciblage/apercu', {});
    expect(r.json.total).toBe(3);
    expect(r.json.apercu.map((c: { id: string }) => c.id)).not.toContain(uuid(4));
  });

  it('refuse un corps mal formé : clé inconnue, canal inconnu, règle invalide, onze inclusions', async () => {
    const onze = Array.from({ length: 11 }, (_, i) => ({ type: 'etiquette', valeur: `E${i}` }));
    for (const corps of [
      { org_id: uuid(2, 9) }, { canaux: ['fax'] }, { ciblage: { exclure: [{ type: 'segment', valeur: 'x' }] } },
      { ciblage: { inclure: { mode: 'une', regles: onze } } }, { demande_avis: 'oui' },
    ]) {
      expect((await appeler('POST', '/automations/ciblage/apercu', corps)).status, JSON.stringify(corps)).toBe(400);
    }
    expect(apercuCiblageSchema.safeParse({}).success).toBe(true);
  });

  it('sans session : 401 ; sans le droit de voir les automatisations : 403 lisible', async () => {
    expect((await appeler('POST', '/automations/ciblage/apercu', {}, { Authorization: '' })).status).toBe(401);
    etat.utilisateur = 'technicien';
    const r = await appeler('POST', '/automations/ciblage/apercu', {});
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('Permission denied: automations.read');
  });

  it('le droit de voir les automatisations sans celui de voir les clients : le COMPTE, jamais les noms', async () => {
    etat.utilisateur = 'lecteur';
    const r = await appeler('POST', '/automations/ciblage/apercu', {});
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(3);
    expect(r.json.apercu).toEqual([]);
  });

  it('lecture ratée : 500 « Compteur indisponible », jamais un faux nombre', async () => {
    etat.base.pannes.clients = { message: 'délai dépassé' };
    const r = await appeler('POST', '/automations/ciblage/apercu', {});
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: 'Compteur indisponible pour l’instant.' });
    expect((await appeler('POST', '/automations/ciblage/apercu', {}, { 'Accept-Language': 'en' })).json.error).toBe('Counter unavailable right now.');
  });
});

describe('P — GET /api/automations/rules/:id/conflits', () => {
  it('nomme l’automatisation publiée qui envoie déjà le même message aux mêmes clients', async () => {
    const r = await appeler('GET', `/automations/rules/${REGLE}/conflits`);
    expect(r.status).toBe(200);
    expect(r.json.conflits).toEqual([{
      regle_id: AUTRE_REGLE, nom: 'Bienvenue (ancienne)', canaux: ['sms'], meme_message: true,
      message: '« Bienvenue (ancienne) » envoie déjà presque le même message (un texto) aux mêmes clients sur ce déclencheur. Un seul des deux partira : le second sera ignoré comme doublon.',
    }]);
    expect(r.json.lignes).toHaveLength(1);
    const en = await appeler('GET', `/automations/rules/${REGLE}/conflits`, undefined, { 'Accept-Language': 'en' });
    expect(en.json.lignes[0]).toMatch(/^“Bienvenue \(ancienne\)” already sends almost the same message/);
  });

  it('aucun conflit : listes vides ; règle à la corbeille : rien à signaler', async () => {
    etat.base.lignes('automation_rules').find((x) => x.id === AUTRE_REGLE)!.is_active = false;
    expect((await appeler('GET', `/automations/rules/${REGLE}/conflits`)).json).toEqual({ conflits: [], lignes: [] });
    etat.base.lignes('automation_rules').find((x) => x.id === AUTRE_REGLE)!.is_active = true;
    etat.base.lignes('automation_rules').find((x) => x.id === REGLE)!.deleted_at = '2026-10-01';
    expect((await appeler('GET', `/automations/rules/${REGLE}/conflits`)).json).toEqual({ conflits: [], lignes: [] });
  });

  it('règle inconnue, d’un autre bureau, supprimée définitivement, ou identifiant mal formé : 404', async () => {
    etat.base.lignes('automation_rules').push(regle(uuid(7, 5), { org_id: uuid(2, 9) }), regle(uuid(8, 5), { purged_at: '2026-10-01' }));
    for (const id of [uuid(99, 5), uuid(7, 5), uuid(8, 5), 'pas-un-uuid']) {
      expect((await appeler('GET', `/automations/rules/${id}/conflits`)).status, id).toBe(404);
    }
  });

  it('sans le droit : 403', async () => {
    etat.utilisateur = 'technicien';
    expect((await appeler('GET', `/automations/rules/${REGLE}/conflits`)).status).toBe(403);
  });
});

describe('P — POST /api/automations/rules/:id/tester (« Tester avec un client »)', () => {
  const essayer = (corps: Record<string, unknown> = { client_id: CLIENT }, id = REGLE, entetes: Record<string, string> = {}) =>
    appeler('POST', `/automations/rules/${id}/tester`, corps, entetes) as Promise<{ status: number; json: ResultatEssai & Record<string, any> }>;

  it('rend le message EXACT que ce client lirait, étape par étape', async () => {
    const r = await essayer();
    expect(r.status).toBe(200);
    expect(r.json.simulation).toBe(true);
    expect(r.json.client).toEqual({ id: CLIENT, nom: 'Prénom1 Nom1' });
    expect(r.json.ciblage).toEqual({ cible: true, raison: null });
    expect(r.json.etapes).toEqual([{
      etape_id: 'origine-0', rang: 1, sur_le_chemin: 'oui', libelle: 'Envoyer un texto', issue: 'partirait',
      rendu: { canal: 'sms', destinataire: '+15145550101', texte: 'Bonjour Prénom1, merci de votre demande.', sms: 1 },
    }]);
  });

  it('RIEN n’est envoyé, exécuté ni écrit : aucune action, aucune ligne en base', async () => {
    etat.base.lignes('automation_rules').find((x) => x.id === REGLE)!.steps = [
      { id: 'e1', type: 'action', action: texto('Bonjour [client_first_name]'), suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'ajouter_etiquette', config: { etiquette: 'Testé' } }, suivant: 'e3' },
      { id: 'e3', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } } },
    ];
    const r = await essayer();
    expect(r.json.etapes.map((e) => [e.libelle, e.issue])).toEqual([['Envoyer un texto', 'partirait'], ['Ajouter une étiquette', 'partirait'], ['Créer une tâche', 'partirait']]);
    expect(r.json.etapes[2]).toMatchObject({ textes: { title: 'Rappeler Prénom1 Nom1' }, raison: 'Non exécutée pendant l’essai.' });
    expect(etat.executions).toBe(0);
    expect(etat.base.ecritures).toEqual([]);
    expect(etat.base.lignes('client_tags')).toHaveLength(3);
    expect(r.json.avertissements.join(' ')).toContain('Rien n’a été envoyé ni modifié.');
    // Garde de construction : le module de l'essai n'appelle jamais l'exécution d'une action ni une écriture.
    const source = readFileSync(resolve(__dirname, '../../../server/lib/automations-essai.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/executeAction|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/);
  });

  it('le parcours À L’ÉCRAN (non enregistré) est essayé à la place de la version enregistrée — sans être enregistré', async () => {
    const r = await essayer({ client_id: CLIENT, brouillon: { steps: [
      { id: 'e1', type: 'attendre', delai_secondes: 3 * 86400, suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'send_email', config: { subject: 'Suivi pour [client_first_name]', body: '<p>Bonjour [client_first_name|là], ici [company_name].</p>' } } },
    ] } });
    expect(r.json.etapes.map((e) => [e.libelle, e.issue, e.sur_le_chemin])).toEqual([['Attendre 3 jours', 'attente', 'oui'], ['Envoyer un courriel', 'partirait', 'oui']]);
    expect(r.json.etapes[1].rendu).toMatchObject({ canal: 'email', destinataire: 'client1@lume-qa.test', objet: 'Suivi pour Prénom1' });
    expect(r.json.etapes[1].rendu?.texte).toContain('ici Votre entreprise.');
    expect(etat.base.lignes('automation_rules').find((x) => x.id === REGLE)!.steps).toEqual([]);
  });

  it('une étape ignorée dit POURQUOI : pas de téléphone, STOP, hors ciblage', async () => {
    etat.vars = { ...etat.vars, client_phone: '' };
    const sansTel = await essayer({ client_id: uuid(3) });
    expect(sansTel.json.etapes[0]).toMatchObject({ issue: 'ignoree', raison: 'Aucun numéro de téléphone pour ce client' });
    // Le message est quand même rendu : on voit ce qui SERAIT parti.
    expect(sansTel.json.etapes[0].rendu?.texte).toBe('Bonjour Prénom1, merci de votre demande.');

    etat.vars = { ...etat.vars, client_phone: '(514) 555-0102' };
    const stop = await essayer({ client_id: uuid(2) });
    expect(stop.json.etapes[0]).toMatchObject({ issue: 'ignoree', raison: 'Client désabonné (texto)' });

    etat.base.lignes('automation_rules').find((x) => x.id === REGLE)!.conditions = { client_sans_etiquette: 'Ne pas relancer' };
    const exclu = await essayer({ client_id: uuid(2) });
    expect(exclu.json.ciblage).toEqual({ cible: false, raison: 'Ignoré : hors ciblage — exclu par l’étiquette « Ne pas relancer »' });
  });

  it('une variable sans valeur pour CE client est signalée ; avec une valeur de remplacement, non', async () => {
    etat.vars = { ...etat.vars, client_first_name: '' };
    const r = await essayer({ client_id: CLIENT, brouillon: { steps: [
      { id: 'e1', type: 'action', action: texto('Bonjour [client_first_name], facture [invoice_number].'), suivant: 'e2' },
      { id: 'e2', type: 'action', action: texto('Bonjour [client_first_name|là] !') },
    ] } });
    expect(r.json.etapes[0].variables_vides).toEqual(['[client_first_name]', '[invoice_number]']);
    // Une étape de PARCOURS est une relance (envoi marketing) : la mention STOP que le serveur ajoute fait partie du texte exact — et du compte de SMS.
    expect(r.json.etapes[0].rendu?.texte).toBe('Bonjour, facture .\nVotre entreprise - Répondez STOP pour ne plus recevoir.');
    expect(r.json.etapes[1].variables_vides).toBeUndefined();
  });

  it('TOUTES les branches sont montrées : celle que le client prend (« oui »), l’autre (« non »), ou les deux quand la condition n’est pas jugée', async () => {
    const parcours = (conditions: Record<string, unknown>) => [
      { id: 'si', type: 'si', conditions, alors: 'oui', sinon: 'non' },
      { id: 'oui', type: 'action', action: texto('Offre VIP'), suivant: 'fin' },
      { id: 'non', type: 'action', action: texto('Offre ordinaire'), suivant: 'fin' },
      { id: 'fin', type: 'arreter' },
    ];
    const chemins = (r: { json: ResultatEssai }) => r.json.etapes.map((e) => [e.etape_id, e.sur_le_chemin, e.branche ?? null]);
    // Jugée sur les étiquettes du client 1 (VIP) : branche « alors ».
    expect(chemins(await essayer({ client_id: CLIENT, brouillon: { steps: parcours({ client_a_etiquette: 'VIP' }) } })))
      .toEqual([['si', 'oui', 'alors'], ['oui', 'oui', null], ['non', 'non', null], ['fin', 'oui', null]]);
    // Le client 3 n'est pas VIP : branche « sinon ».
    expect(chemins(await essayer({ client_id: uuid(3), brouillon: { steps: parcours({ client_a_etiquette: 'VIP' }) } })))
      .toEqual([['si', 'oui', 'sinon'], ['oui', 'non', null], ['non', 'oui', null], ['fin', 'oui', null]]);
    // Une condition sur l'ÉTAT de la fiche : non jugée, les deux branches « peut-être », et l'essai le dit.
    const r = await essayer({ client_id: CLIENT, brouillon: { steps: parcours({ status: 'approved' }) } });
    expect(chemins(r)).toEqual([['si', 'oui', null], ['oui', 'peut_etre', null], ['non', 'peut_etre', null], ['fin', 'peut_etre', null]]);
    expect(r.json.avertissements.join(' ')).toContain('l’essai ne la juge pas et montre les deux branches');
  });

  it('un déclencheur de facture pour un client SANS facture : l’essai se fait sur sa fiche et le dit', async () => {
    etat.base.tables.invoices = [];
    const r = await essayer({ client_id: CLIENT, brouillon: { trigger_event: 'invoice.overdue' } });
    expect(r.json.fiche).toBeNull();
    expect(r.json.avertissements[0]).toBe('Prénom1 Nom1 n’a aucune facture : l’essai se fait sur sa fiche client, et les champs propres à ce déclencheur seront vides.');
    etat.base.tables.invoices = [{ id: uuid(5, 2), org_id: ORG, client_id: CLIENT, invoice_number: 'F-0042', deleted_at: null, created_at: '2026-09-30' }];
    expect((await essayer({ client_id: CLIENT, brouillon: { trigger_event: 'invoice.overdue' } })).json.fiche).toEqual({ type: 'invoice', id: uuid(5, 2), libelle: 'Facture F-0042' });
  });

  it('client d’un autre bureau, inconnu ou supprimé : 404 « Client introuvable » — jamais ses données', async () => {
    etat.base.lignes('clients').push(client(5, { deleted_at: '2026-01-01' }));
    for (const id of [uuid(4), uuid(77), uuid(5)]) {
      const r = await essayer({ client_id: id });
      expect(r.status, id).toBe(404);
      expect(r.json).toEqual({ error: 'Client introuvable.' });
    }
  });

  it('règle inconnue : 404 ; à la corbeille : 409 ; corps invalide : 400', async () => {
    expect((await essayer({ client_id: CLIENT }, uuid(99, 5))).status).toBe(404);
    etat.base.lignes('automation_rules').find((x) => x.id === REGLE)!.deleted_at = '2026-10-01';
    const corbeille = await essayer();
    expect(corbeille.status).toBe(409);
    expect(corbeille.json.error).toBe('Cette automatisation est à la corbeille : restaurez-la pour la modifier.');
    expect((await essayer({ client_id: 'x' })).status).toBe(400);
    expect((await essayer({ client_id: CLIENT, envoyer: true })).status).toBe(400);
    expect(essaiSchema.safeParse({ client_id: CLIENT, brouillon: { is_active: true } }).success).toBe(false);
  });

  it('il faut le droit de voir les automatisations ET celui de voir les clients', async () => {
    etat.utilisateur = 'technicien';
    expect((await essayer()).status).toBe(403);
    etat.utilisateur = 'lecteur';
    const r = await essayer();
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('Permission denied: clients.read');
  });

  it('en anglais : libellés, raisons et avertissements', async () => {
    etat.vars = { ...etat.vars, client_phone: '' };
    const r = await essayer({ client_id: uuid(3) }, REGLE, { 'Accept-Language': 'en' });
    expect(r.json.etapes[0]).toMatchObject({ libelle: 'Send a text message', raison: 'No phone number for this client' });
    expect(r.json.avertissements.join(' ')).toContain('Nothing was sent or changed.');
  });
});
