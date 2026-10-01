/**
 * Le refus de la TABLE DES ROUTES porte la phrase lisible, lui aussi.
 *
 * Audit du 2026-10-01 (constat roles-12) : les routes d'automatisations sont
 * gardées par `rbacMiddleware` (table `route-permissions.ts`), pas par
 * `requirePermission`. C'est donc CE refus que reçoit l'écran — et il ne
 * portait que « Permission denied: automations.update », affiché tel quel.
 *
 * Vrai serveur Express, vraie table des routes ; l'authentification et le
 * contexte de l'utilisateur sont simulés.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../../server/lib/supabase', () => ({
  requireAuthedClient: async () => ({ client: {}, user: { id: 'u-technicien' }, orgId: 'org-1' }),
}));
vi.mock('../../server/lib/rbac', () => ({
  getUserContext: async () => ({ role: 'technician' }),
  hasPermission: () => false,
}));

import { rbacMiddleware } from '../../server/lib/route-permissions';

let serveur: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(rbacMiddleware());
  const routeur = express.Router();
  routeur.get('/automations/rules', (_req, res) => res.json({ rules: [] }));
  routeur.patch('/automations/rules/:id', (_req, res) => res.json({ ok: true }));
  routeur.get('/clients/search', (_req, res) => res.json({ clients: [] }));
  app.use('/api', routeur);
  await new Promise<void>((ok) => { serveur = app.listen(0, '127.0.0.1', () => ok()); });
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((ok) => serveur.close(ok)); });

const appel = async (methode: string, chemin: string) => {
  const r = await fetch(base + chemin, { method: methode });
  return { status: r.status, corps: (await r.json()) as Record<string, string> };
};

describe('403 de la table des routes', () => {
  it('lire les automatisations : le texte technique reste, la phrase lisible s’ajoute', async () => {
    const { status, corps } = await appel('GET', '/api/automations/rules');
    expect(status).toBe(403);
    expect(corps.error).toBe('Permission denied: automations.read');
    expect(corps.message).toBe('Votre rôle ne permet pas de voir les automatisations.');
    expect(corps.message_en).toBe('Your role does not allow viewing automations.');
    expect(corps.permission).toBe('automations.read');
  });

  it('modifier une automatisation', async () => {
    const { status, corps } = await appel('PATCH', '/api/automations/rules/11111111-1111-4111-8111-111111111111');
    expect(status).toBe(403);
    expect(corps.error).toBe('Permission denied: automations.update');
    expect(corps.message).toBe('Votre rôle ne permet pas de modifier les automatisations.');
  });

  it('une autre famille de permission reçoit la phrase générique, jamais un nom de clé', async () => {
    const { status, corps } = await appel('GET', '/api/clients/search');
    expect(status).toBe(403);
    expect(corps.error).toMatch(/^Permission denied: /);
    expect(corps.message).toBe('Votre rôle ne permet pas cette action.');
    expect(corps.message).not.toMatch(/\w+\.\w+/);
  });
});
