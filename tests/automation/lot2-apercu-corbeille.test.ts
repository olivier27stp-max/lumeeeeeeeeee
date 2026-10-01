/**
 * Audit du 2026-10-01, lot 2 (constat roles-10) — « TESTER » UNE RÈGLE À LA
 * CORBEILLE.
 *
 * POST /api/automations/rules/:id/apercu sur une règle à la corbeille
 * répondait 200 avec l'aperçu rendu sur un vrai client (nom, courriel,
 * téléphone). Une règle à la corbeille ne part plus : il n'y a rien à tester,
 * et aucune raison de sortir les coordonnées d'un client. On la restaure
 * d'abord — même refus (409, même phrase) que pour la modifier. Supprimée
 * définitivement : 404, elle n'existe plus.
 *
 * La VRAIE route est montée, avec le vrai moteur de variables ; seuls
 * Supabase et l'authentification sont simulés (lot2-faux-supabase.ts).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Ligne } from './lot2-faux-supabase';

const ORG = '11111111-2222-4333-8444-555555555555';
const VIVANTE = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const CORBEILLE = 'bbbbbbbb-0000-4000-8000-0000000000b2';
const PURGEE = 'bbbbbbbb-0000-4000-8000-0000000000b3';
const CLIENTE = 'cccccccc-0000-4000-8000-0000000000c1';

const { etat, client: fauxClient } = await vi.hoisted(async () => (await import('./lot2-faux-supabase')).creerFausseBase());

vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireAuthedClient: async () => ({ client: fauxClient(), orgId: ORG, user: { id: 'u1' } }),
  getServiceClient: () => fauxClient(),
}));

const { default: routeur } = await import('../../server/routes/automation-test');

let serveur: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', routeur);
  await new Promise<void>((ok) => { serveur = app.listen(0, '127.0.0.1', () => ok()); });
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise((ok) => serveur.close(ok)); });

async function tester(id: string, entetes: Record<string, string> = {}) {
  const res = await fetch(`${base}/automations/rules/${id}/apercu`, { method: 'POST', headers: { Authorization: 'Bearer x', ...entetes } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corps JSON libre, lu par les assertions
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

function regle(id: string, sup: Ligne = {}): Ligne {
  return {
    id, org_id: ORG, name: 'Bienvenue', trigger_event: 'lead.created', actions: [], deleted_at: null, purged_at: null,
    steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: null }],
    ...sup,
  };
}

beforeEach(() => {
  etat.ecritures.length = 0;
  etat.acces.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  etat.tables = {
    automation_rules: [
      regle(VIVANTE),
      regle(CORBEILLE, { deleted_at: '2026-10-01T15:20:46.872+00:00' }),
      regle(PURGEE, { deleted_at: '2026-10-01T15:22:44.658+00:00', purged_at: '2026-10-01T15:22:44.658+00:00' }),
    ],
    clients: [{
      id: CLIENTE, org_id: ORG, first_name: 'Marie', last_name: 'Décor', email: 'decor-roles@lume-qa.test',
      phone: '+15555550177', deleted_at: null, created_at: '2026-09-30T12:00:00Z',
    }],
    company_settings: [{ org_id: ORG, company_name: 'Nettoyage Test A', default_language: 'fr', timezone: 'America/Montreal' }],
  };
});

describe('roles-10 — « Tester » une automatisation', () => {
  it('règle vivante : l’aperçu est rendu sur un vrai client (comportement inchangé)', async () => {
    const r = await tester(VIVANTE);
    expect(r.status).toBe(200);
    expect(r.json.client.email).toBe('decor-roles@lume-qa.test');
    expect(r.json.apercu).toEqual([{ action: 'send_sms', nom: null, rendu: { body: 'Bonjour Marie' } }]);
  });

  it('règle à la CORBEILLE : 409, le message de la corbeille, aucun client lu ni rendu', async () => {
    const r = await tester(CORBEILLE);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('Cette automatisation est à la corbeille : restaurez-la pour la modifier.');
    expect(r.json.client).toBeUndefined();
    expect(r.json.apercu).toBeUndefined();
    expect(JSON.stringify(r.json)).not.toContain('decor-roles@lume-qa.test');
    expect(etat.acces).not.toContain('clients');
  });

  it('en anglais, le refus est dit en anglais', async () => {
    const r = await tester(CORBEILLE, { 'Accept-Language': 'en' });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe('This automation is in the bin: restore it to edit it.');
  });

  it('règle supprimée DÉFINITIVEMENT : 404 « Automatisation introuvable. », aucun client lu', async () => {
    const r = await tester(PURGEE);
    expect(r.status).toBe(404);
    expect(r.json.error).toBe('Automatisation introuvable.');
    expect(etat.acces).not.toContain('clients');
  });

  it('rien n’est écrit, dans aucun des cas', async () => {
    for (const id of [VIVANTE, CORBEILLE, PURGEE]) await tester(id);
    expect(etat.ecritures).toEqual([]);
  });
});
