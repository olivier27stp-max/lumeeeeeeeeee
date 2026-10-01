/**
 * SÉCURITÉ — une barre finale ou une majuscule ne contourne plus les gardes.
 *
 * Confirmé sur lumecrm.net le 2026-10-01, avec un compte technicien de test :
 *   GET /api/automations/pause    → 403 « Permission denied: automations.read »
 *   GET /api/automations/pause/   → 200
 *   GET /API/automations/pause    → 200
 * La garde de permission (et celles de MFA, d'abonnement et de forfait)
 * comparait `req.path` à des chemins exacts ; Express route sans tenir compte
 * de la casse ni de la barre finale. « Aucune règle trouvée » laissait passer.
 *
 * Ces tests montent un VRAI serveur Express avec la vraie garde de permission
 * et la vraie table des routes ; seuls l'authentification et le contexte de
 * l'utilisateur sont simulés.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../server/lib/supabase', () => ({
  requireAuthedClient: async (req: express.Request, res: express.Response) => {
    const role = req.header('x-role-de-test');
    if (!role) { res.status(401).json({ error: 'Missing authorization header.' }); return null; }
    return { client: {}, user: { id: `u-${role}` }, orgId: 'org-1' };
  },
}));
vi.mock('../server/lib/rbac', () => ({
  // Le technicien n'a AUCUNE permission d'automatisation ; le propriétaire les a toutes.
  getUserContext: async (_c: unknown, userId: string) => ({ role: userId.replace('u-', '') }),
  hasPermission: (ctx: { role: string }) => ctx.role === 'owner',
}));

import { rbacMiddleware } from '../server/lib/route-permissions';
import { canoniserChemin, cheminCanonique } from '../server/lib/chemin-canonique';

function monter(avecCanonisation: boolean): Promise<{ base: string; serveur: Server }> {
  const app = express();
  if (avecCanonisation) app.use(canoniserChemin());
  app.use(rbacMiddleware());
  // Un routeur monté comme ceux de l'application (options par défaut d'Express).
  const routeur = express.Router();
  routeur.get('/automations/pause', (_req, res) => res.json({ paused: false }));
  routeur.post('/automations/events/lead-created', (_req, res) => res.json({ emis: true }));
  routeur.get('/reservation/:jeton', (req, res) => res.json({ jeton: req.params.jeton, originalUrl: req.originalUrl }));
  app.use('/api', routeur);
  app.get('/Devis/:jeton', (req, res) => res.json({ page: req.path }));
  return new Promise((ok) => {
    const serveur = app.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`, serveur }));
  });
}
const appel = async (base: string, chemin: string, role?: string, methode = 'GET') => {
  const r = await fetch(base + chemin, { method: methode, headers: role ? { 'x-role-de-test': role } : {} });
  return { status: r.status, corps: await r.text() };
};

let avec: { base: string; serveur: Server };
let sans: { base: string; serveur: Server };
beforeAll(async () => { avec = await monter(true); sans = await monter(false); });
afterAll(async () => { await Promise.all([avec, sans].map((s) => new Promise((ok) => s.serveur.close(ok)))); });

const VARIANTES = [
  '/api/automations/pause',
  '/api/automations/pause/',
  '/api/automations/pause//',
  '/API/automations/pause',
  '/api/Automations/Pause',
  '/Api/AUTOMATIONS/pause/',
  '/api//automations/pause',
  '//api/automations/pause',
];

describe('témoin : sans la canonisation, la faille est bien là (le test sait la voir)', () => {
  it('le chemin exact est refusé au technicien', async () => {
    expect((await appel(sans.base, '/api/automations/pause', 'technician')).status).toBe(403);
  });
  it('une barre finale ou une majuscule le fait passer', async () => {
    expect((await appel(sans.base, '/api/automations/pause/', 'technician')).status).toBe(200);
    expect((await appel(sans.base, '/API/automations/pause', 'technician')).status).toBe(200);
  });
});

describe('avec la canonisation, toutes les écritures du même chemin reçoivent la même garde', () => {
  for (const chemin of VARIANTES) {
    it(`technicien  GET ${chemin} → 403`, async () => {
      const r = await appel(avec.base, chemin, 'technician');
      expect(r.status, r.corps).toBe(403);
      expect(r.corps).toContain('Permission denied: automations.read');
    });
    it(`propriétaire GET ${chemin} → 200`, async () => {
      expect((await appel(avec.base, chemin, 'owner')).status).toBe(200);
    });
    it(`sans jeton   GET ${chemin} → 401`, async () => {
      expect((await appel(avec.base, chemin)).status).toBe(401);
    });
  }

  it('une écriture : le technicien ne peut plus émettre « prospect créé » par une barre finale (constat roles-01)', async () => {
    for (const chemin of ['/api/automations/events/lead-created/', '/API/automations/events/lead-created', '/api/automations/events/Lead-Created']) {
      const r = await appel(avec.base, chemin, 'technician', 'POST');
      expect(r.status, `${chemin} → ${r.corps}`).toBe(403);
    }
  });
});

describe('ce qui ne doit PAS changer', () => {
  it('un jeton garde sa casse, et l’adresse d’origine reste lisible (signature des webhooks)', async () => {
    const r = await appel(avec.base, '/API/Reservation/AbC123dEf/');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.corps)).toEqual({ jeton: 'AbC123dEf', originalUrl: '/API/Reservation/AbC123dEf/' });
  });

  it('une page hors API garde son adresse', async () => {
    expect(cheminCanonique('/Devis/AbCdEf/')).toBe('/Devis/AbCdEf/');
    expect(cheminCanonique('/apiculture/Ruche/')).toBe('/apiculture/Ruche/');
    expect((await appel(avec.base, '/Devis/x1')).status).toBe(200);
  });

  it('la chaîne de requête n’est jamais touchée', () => {
    expect(cheminCanonique('/API/Clients/?Nom=Tremblay&Page=/A/')).toBe('/api/clients?Nom=Tremblay&Page=/A/');
  });

  it('un identifiant ou un jeton (avec un chiffre) n’est pas mis en minuscules', () => {
    expect(cheminCanonique('/api/automations/rules/0C07A90D-D29C-4DED-8971-DF4C17D98A25/Dupliquer/'))
      .toBe('/api/automations/rules/0C07A90D-D29C-4DED-8971-DF4C17D98A25/dupliquer');
  });

  it('la racine de l’API', () => {
    expect(cheminCanonique('/API')).toBe('/api');
    expect(cheminCanonique('/api/')).toBe('/api');
  });
});

describe('branchement dans le serveur', () => {
  const index = readFileSync(resolve(__dirname, '..', 'server/index.ts'), 'utf8');
  it('la canonisation est montée AVANT toute garde qui lit le chemin', () => {
    const canonisation = index.indexOf('app.use(canoniserChemin());');
    expect(canonisation).toBeGreaterThan(0);
    for (const garde of ['app.use(mfaEnforcementMiddleware());', 'app.use(rbacMiddleware());', "app.use('/api', mfaSmsRouter);"]) {
      expect(index.indexOf(garde), garde).toBeGreaterThan(canonisation);
    }
    // … et avant tout autre `app.use` : rien ne lit le chemin avant elle.
    expect(index.indexOf('app.use(')).toBe(canonisation);
  });
});
