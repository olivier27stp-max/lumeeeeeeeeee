/**
 * Audit du 2026-10-01, lot 2 — CE QUI EST À LA CORBEILLE (OU SUPPRIMÉ POUR DE
 * BON) NE SE PUBLIE, NE SE DUPLIQUE ET NE SE MODIFIE PAR AUCUN CHEMIN.
 *
 * Constats roles-08, roles-09, roles-10 (lecture de l'éditeur) et actions-07,
 * relevés par des appels directs à l'API : le serveur acceptait, sur une règle
 * à la corbeille ou supprimée définitivement, ce que l'écran n'offre pas.
 *
 * Les VRAIES routes sont montées (règles + publication). Seuls Supabase et
 * l'authentification sont simulés : le faux client applique POUR VRAI les
 * filtres `eq`, `is null` et `not is null`, et répond comme PostgREST quand
 * `.single()` ne trouve pas exactement une ligne (PGRST116).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const ORG = '11111111-2222-4333-8444-555555555555';
const VIVANTE = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const CORBEILLE = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const PURGEE = 'aaaaaaaa-0000-4000-8000-0000000000a3';
const ABSENTE = 'aaaaaaaa-0000-4000-8000-0000000000a4';

type Ligne = Record<string, unknown>;
const etat = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  /** Chaque écriture réellement appliquée : table, opération, lignes touchées. */
  ecritures: [] as Array<{ table: string; op: 'update' | 'insert' | 'delete'; ids: unknown[]; valeurs: Record<string, unknown> }>,
  /** Identifiant d'une règle qui DISPARAÎT de la base juste après avoir été lue. */
  disparaitApresLecture: null as string | null,
}));

/** Un faux client Supabase qui filtre pour vrai et parle comme PostgREST. */
function fauxClient() {
  return {
    from: (table: string) => {
      const filtres: Array<(l: Ligne) => boolean> = [];
      let op: 'select' | 'update' | 'insert' | 'delete' = 'select';
      let valeurs: Ligne = {};
      const lignes = () => (etat.tables[table] ??= []);

      const executer = (): Ligne[] => {
        if (op === 'insert') {
          const nouvelle = { id: `nouvelle-${lignes().length + 1}`, deleted_at: null, purged_at: null, ...valeurs };
          lignes().push(nouvelle);
          etat.ecritures.push({ table, op, ids: [nouvelle.id], valeurs });
          return [nouvelle];
        }
        const visees = lignes().filter((l) => filtres.every((f) => f(l)));
        if (op === 'update' && visees.length) {
          for (const l of visees) Object.assign(l, valeurs);
          etat.ecritures.push({ table, op, ids: visees.map((l) => l.id), valeurs });
        }
        if (op === 'delete' && visees.length) {
          etat.tables[table] = lignes().filter((l) => !visees.includes(l));
          etat.ecritures.push({ table, op, ids: visees.map((l) => l.id), valeurs: {} });
        }
        if (op === 'select' && etat.disparaitApresLecture) {
          const id = etat.disparaitApresLecture;
          if (visees.some((l) => l.id === id)) {
            // Copie rendue à l'appelant ; la ligne, elle, n'existe plus.
            const copies = visees.map((l) => ({ ...l }));
            etat.tables[table] = lignes().filter((l) => l.id !== id);
            etat.disparaitApresLecture = null;
            return copies;
          }
        }
        return visees;
      };

      const PGRST116 = { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' };
      const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        limit: () => q,
        insert: (v: Ligne) => { op = 'insert'; valeurs = v; return q; },
        update: (v: Ligne) => { op = 'update'; valeurs = v; return q; },
        delete: () => { op = 'delete'; return q; },
        eq: (col: string, v: unknown) => { filtres.push((l) => l[col] === v); return q; },
        in: (col: string, vs: unknown[]) => { filtres.push((l) => vs.includes(l[col])); return q; },
        is: (col: string, v: unknown) => { filtres.push((l) => (l[col] ?? null) === v); return q; },
        not: (col: string, operateur: string, v: unknown) => {
          if (operateur !== 'is' || v !== null) throw new Error(`faux client : not(${col}, ${operateur}) non simulé`);
          filtres.push((l) => (l[col] ?? null) !== null);
          return q;
        },
        maybeSingle: async () => {
          const r = executer();
          if (r.length > 1) return { data: null, error: PGRST116 };
          return { data: r[0] ?? null, error: null };
        },
        single: async () => {
          const r = executer();
          if (r.length !== 1) return { data: null, error: PGRST116 };
          return { data: r[0], error: null };
        },
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve({ data: executer(), error: null }).then(ok, ko),
      };
      return q;
    },
  };
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corps JSON libre, lu par les assertions
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
    const parId = Object.fromEntries((r.json.resultats as Array<{ id: string }>).map((x) => [x.id, x])) as Record<string, { ok: boolean; erreur?: string }>;
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
