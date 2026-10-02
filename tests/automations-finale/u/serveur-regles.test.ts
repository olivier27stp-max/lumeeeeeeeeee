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
