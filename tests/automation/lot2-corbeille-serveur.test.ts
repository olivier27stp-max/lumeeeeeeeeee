/**
 * Audit du 2026-10-01, lot 2 — CE QUI EST À LA CORBEILLE (OU SUPPRIMÉ POUR DE
 * BON) NE SE PUBLIE, NE SE DUPLIQUE ET NE SE MODIFIE PAR AUCUN CHEMIN.
 *
 * Constats roles-08, roles-09, roles-10 (lecture de l'éditeur) et actions-07,
 * relevés par des appels directs à l'API : le serveur acceptait, sur une règle
 * à la corbeille ou supprimée définitivement, ce que l'écran n'offre pas.
 *
 * Les VRAIES routes sont montées (règles + publication). Seuls Supabase et
 * l'authentification sont simulés : le faux client (lot2-faux-supabase.ts)
 * applique POUR VRAI les filtres `eq`, `is null` et `not is null`, et répond
 * comme PostgREST quand `.single()` ne trouve pas exactement une ligne
 * (PGRST116).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Ligne } from './lot2-faux-supabase';

const ORG = '11111111-2222-4333-8444-555555555555';
const VIVANTE = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const CORBEILLE = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const PURGEE = 'aaaaaaaa-0000-4000-8000-0000000000a3';
const ABSENTE = 'aaaaaaaa-0000-4000-8000-0000000000a4';

const { etat, client: fauxClient } = await vi.hoisted(async () => (await import('./lot2-faux-supabase')).creerFausseBase());

vi.mock('../../server/lib/supabase', () => ({
  requireAuthedClient: async () => ({ client: fauxClient(), orgId: ORG, user: { id: 'u1' } }),
  getServiceClient: () => fauxClient(),
}));
vi.mock('../../server/lib/automatisations-bureaux', () => ({
  bureauxCibles: vi.fn(), copierVersBureaux: vi.fn(), propagerAuxCopies: vi.fn(async () => []),
}));

const { default: routeurRegles } = await import('../../server/routes/automation-rules');
const { default: routeurPublication } = await import('../../server/routes/automation-publication');

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
  // `any` : corps JSON libre, lu par les assertions (même harnais que automatisations-publication-serveur).
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

const MESSAGE_CORBEILLE = 'Cette automatisation est à la corbeille : restaurez-la pour la modifier.';

/** Une règle saine et publiable : un texto avec son texte. */
function regle(id: string, sup: Ligne = {}): Ligne {
  return {
    id, org_id: ORG, name: `Règle ${id.slice(-2)}`, description: '', trigger_event: 'quote.sent', conditions: {},
    delay_seconds: 0, actions: [], settings: null, is_active: false, is_preset: false, preset_key: null,
    folder_id: null, modele_id: null, deleted_at: null, purged_at: null, lumi_conversation: [],
    steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: null }],
    ...sup,
  };
}
const regleEnBase = (id: string) => (etat.tables.automation_rules ?? []).find((l) => l.id === id);
const ecrituresSur = (id: string) => etat.ecritures.filter((e) => e.table === 'automation_rules' && e.ids.includes(id));

beforeEach(() => {
  etat.ecritures.length = 0;
  etat.disparaitApresLecture = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  etat.tables = {
    automation_rules: [
      regle(VIVANTE),
      regle(CORBEILLE, { deleted_at: '2026-10-01T15:20:46.872+00:00' }),
      regle(PURGEE, { deleted_at: '2026-10-01T15:22:44.658+00:00', purged_at: '2026-10-01T15:22:44.658+00:00' }),
    ],
    automation_scheduled_tasks: [],
    automation_folders: [],
    org_features: [],
  };
});

// ─── roles-08 ───────────────────────────────────────────────────

describe('roles-08 — une règle à la corbeille ne se publie par AUCUN chemin', () => {
  it('PATCH { is_active: true } → 409, le message de la corbeille, rien n’est écrit', async () => {
    const r = await appeler('PATCH', `/automations/rules/${CORBEILLE}`, { is_active: true });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe(MESSAGE_CORBEILLE);
    expect(ecrituresSur(CORBEILLE)).toEqual([]);
    expect(regleEnBase(CORBEILLE)?.is_active).toBe(false);
  });

  it('POST /rules/:id/publication { actif: true } → 422 « restaurez-la avant de la publier », rien n’est écrit', async () => {
    const r = await appeler('POST', `/automations/rules/${CORBEILLE}/publication`, { actif: true });
    expect(r.status).toBe(422);
    expect(r.json.error).toBe('Cette automatisation est à la corbeille : restaurez-la avant de la publier.');
    expect(ecrituresSur(CORBEILLE)).toEqual([]);
    expect(regleEnBase(CORBEILLE)?.is_active).toBe(false);
  });

  it('publication EN LOT : la règle à la corbeille est refusée et nommée, la vivante est publiée', async () => {
    const r = await appeler('POST', '/automations/rules/publication', { actif: true, ids: [CORBEILLE, VIVANTE] });
    expect(r.status).toBe(200);
    const resultats = r.json.resultats as Array<{ id: string; ok: boolean; erreur?: string }>;
    const parId = Object.fromEntries(resultats.map((x) => [x.id, x]));
    expect(parId[CORBEILLE].ok).toBe(false);
    expect(parId[CORBEILLE].erreur).toMatch(/à la corbeille/);
    expect(parId[VIVANTE].ok).toBe(true);
    expect(ecrituresSur(CORBEILLE)).toEqual([]);
    expect(regleEnBase(CORBEILLE)?.is_active).toBe(false);
    expect(regleEnBase(VIVANTE)?.is_active).toBe(true);
  });

  it('PATCH sur une règle supprimée DÉFINITIVEMENT → 404, rien n’est écrit', async () => {
    const r = await appeler('PATCH', `/automations/rules/${PURGEE}`, { is_active: true });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Automatisation introuvable.');
    expect(ecrituresSur(PURGEE)).toEqual([]);
  });

  it('en anglais, le refus de la corbeille est dit en anglais', async () => {
    const r = await appeler('PATCH', `/automations/rules/${CORBEILLE}`, { is_active: true }, { 'Accept-Language': 'en' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('This automation is in the bin: restore it to edit it.');
  });
});

// ─── roles-09 ───────────────────────────────────────────────────

describe('roles-09 — on ne duplique ni une règle supprimée définitivement, ni une règle à la corbeille', () => {
  const copies = () => etat.ecritures.filter((e) => e.table === 'automation_rules' && e.op === 'insert');

  it('règle supprimée DÉFINITIVEMENT → 404 « Automatisation introuvable. », aucune copie ne naît', async () => {
    const r = await appeler('POST', `/automations/rules/${PURGEE}/duplicate`);
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Automatisation introuvable.');
    expect(copies()).toEqual([]);
    expect(etat.tables.automation_rules).toHaveLength(3);
  });

  it('règle à la CORBEILLE (l’écran n’y offre pas « Dupliquer ») → 409, le message de la corbeille, aucune copie', async () => {
    const r = await appeler('POST', `/automations/rules/${CORBEILLE}/duplicate`);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe(MESSAGE_CORBEILLE);
    expect(copies()).toEqual([]);
    expect(etat.tables.automation_rules).toHaveLength(3);
  });

  it('en anglais, le refus de la corbeille est dit en anglais', async () => {
    const r = await appeler('POST', `/automations/rules/${CORBEILLE}/duplicate`, undefined, { 'Accept-Language': 'en' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('This automation is in the bin: restore it to edit it.');
  });

  it('règle inexistante → 404', async () => {
    const r = await appeler('POST', `/automations/rules/${ABSENTE}/duplicate`);
    expect(r.status).toBe(404);
    expect(copies()).toEqual([]);
  });

  it('une règle vivante se duplique toujours : 201, copie en brouillon, « (copie) »', async () => {
    const r = await appeler('POST', `/automations/rules/${VIVANTE}/duplicate`);
    expect(r.status).toBe(201);
    expect(r.json.name).toBe('Règle a1 (copie)');
    expect(r.json.is_active).toBe(false);
    expect(copies()).toHaveLength(1);
  });
});

// ─── roles-10 (lecture de l'éditeur) ────────────────────────────

describe('roles-10 — ce que l’éditeur lit d’une règle supprimée', () => {
  it('à la CORBEILLE : la règle reste lisible, avec `deleted_at` — l’écran en a besoin pour dire « à la corbeille » et offrir « Restaurer »', async () => {
    const r = await appeler('GET', `/automations/editeur?rule_id=${CORBEILLE}`);
    expect(r.status).toBe(200);
    expect(r.json.rule?.id).toBe(CORBEILLE);
    expect(r.json.rule?.deleted_at).toBe('2026-10-01T15:20:46.872+00:00');
  });

  it('supprimée DÉFINITIVEMENT : jamais rendue (`rule: null`), l’écran dit « introuvable »', async () => {
    const r = await appeler('GET', `/automations/editeur?rule_id=${PURGEE}`);
    expect(r.status).toBe(200);
    expect(r.json.rule).toBeNull();
    expect(JSON.stringify(r.json)).not.toContain(PURGEE);
  });

  it('la liste des automatisations ne rend jamais une règle supprimée définitivement', async () => {
    const r = await appeler('GET', '/automations/rules');
    expect(r.status).toBe(200);
    const ids = (r.json.rules as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(CORBEILLE);
    expect(ids).not.toContain(PURGEE);
  });

  it('les « autres automatisations » offertes à l’éditeur ne citent ni corbeille ni purgée', async () => {
    etat.tables.automation_rules.forEach((l) => { l.is_active = true; });
    const r = await appeler('GET', `/automations/editeur?rule_id=${VIVANTE}`);
    expect(r.status).toBe(200);
    expect(r.json.autres).toEqual([]);
  });
});

// ─── actions-07 ─────────────────────────────────────────────────

describe('actions-07 — écrire sur une automatisation qui n’existe plus répond 404, pas 500', () => {
  it('PATCH sur un identifiant inconnu → 404 « Automatisation introuvable. »', async () => {
    const r = await appeler('PATCH', `/automations/rules/${ABSENTE}`, { name: 'Nouveau nom' });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Automatisation introuvable.');
  });

  it('PATCH : la règle disparaît ENTRE la lecture et l’écriture (PGRST116) → 404, pas « Impossible de modifier »', async () => {
    /*
     * Le cas observé : l'éditeur est resté ouvert pendant que la règle était
     * supprimée en base. L'enregistrement automatique recevait 500 « Impossible
     * de modifier l'automatisation. » et réessayait sans fin.
     */
    etat.disparaitApresLecture = VIVANTE;
    const r = await appeler('PATCH', `/automations/rules/${VIVANTE}`, { name: 'Nouveau nom' });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Automatisation introuvable.');
    expect(ecrituresSur(VIVANTE)).toEqual([]);
  });

  it('PATCH d’un dossier qui n’existe plus → 404 « Dossier introuvable. »', async () => {
    const r = await appeler('PATCH', `/automations/folders/${ABSENTE}`, { name: 'Relances' });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Dossier introuvable.');
  });

  it('DELETE : la règle disparaît entre la lecture et l’écriture → 404, pas « ok » pour une suppression qui n’a rien supprimé', async () => {
    etat.disparaitApresLecture = VIVANTE;
    const r = await appeler('DELETE', `/automations/rules/${VIVANTE}`);
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Automatisation introuvable.');
  });

  it('DELETE d’une règle supprimée DÉFINITIVEMENT → 404, sa date de suppression n’est pas réécrite', async () => {
    const r = await appeler('DELETE', `/automations/rules/${PURGEE}`);
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Automatisation introuvable.');
    expect(ecrituresSur(PURGEE)).toEqual([]);
    expect(regleEnBase(PURGEE)?.deleted_at).toBe('2026-10-01T15:22:44.658+00:00');
  });

  it('DELETE d’une règle vivante : inchangé — elle part à la corbeille, en brouillon, et ses envois prévus sont annulés', async () => {
    etat.tables.automation_scheduled_tasks.push({ id: 't1', org_id: ORG, automation_rule_id: VIVANTE, status: 'pending' });
    const r = await appeler('DELETE', `/automations/rules/${VIVANTE}`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
    expect(regleEnBase(VIVANTE)?.deleted_at).toBeTruthy();
    expect(regleEnBase(VIVANTE)?.is_active).toBe(false);
    expect(etat.tables.automation_scheduled_tasks[0].status).toBe('cancelled');
  });

  it('restaurer / supprimer définitivement une règle absente → 404 (déjà le cas)', async () => {
    const a = await appeler('POST', `/automations/rules/${ABSENTE}/restaurer`);
    const b = await appeler('DELETE', `/automations/rules/${ABSENTE}/definitivement`);
    expect([a.status, b.status]).toEqual([404, 404]);
  });
});
