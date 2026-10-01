/**
 * Audit du 2026-10-01, lot 2 (constat roles-12) — UN REFUS DE PERMISSION
 * PORTE UNE PHRASE LISIBLE.
 *
 * Corps réellement reçus par le navigateur : 403 { "error": "Permission
 * denied: automations.update" } — de l'anglais technique, avec le nom d'une
 * clé interne, que certains écrans affichent tel quel à un utilisateur
 * francophone.
 *
 * `error` est un CONTRAT (des tests et des appelants le comparent) : il ne
 * change pas. Le refus gagne `message` (la phrase à afficher, en français),
 * `message_en` (la même en anglais) et `permission` (la clé, pour le code).
 *
 * Les VRAIS middlewares de server/lib/rbac.ts sont montés sur une vraie
 * application Express ; seuls Supabase et l'authentification sont simulés.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const ORG = '11111111-2222-4333-8444-555555555555';

const { etat, client: fauxClient } = await vi.hoisted(async () => (await import('../automation/lot2-faux-supabase')).creerFausseBase());
const session = vi.hoisted(() => ({ userId: 'u1' }));

vi.mock('../../server/lib/supabase', () => ({
  requireAuthedClient: async () => ({ client: fauxClient(), orgId: '11111111-2222-4333-8444-555555555555', user: { id: session.userId } }),
  getServiceClient: () => fauxClient(),
}));

const { requirePermission, requireFinancialAccess, corpsRefusPermission, clearRbacCache } = await import('../../server/lib/rbac');

let serveur: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  const ok: express.RequestHandler = (_req, res) => { res.json({ ok: true }); };
  app.get('/modifier', requirePermission('automations.update'), ok);
  app.get('/voir', requirePermission('automations.read'), ok);
  app.get('/terminer', requirePermission('jobs.complete'), ok);
  app.get('/encaisser', requireFinancialAccess('payments.create'), ok);
  await new Promise<void>((pret) => { serveur = app.listen(0, '127.0.0.1', () => pret()); });
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((fini) => serveur.close(fini)); });

async function appeler(chemin: string) {
  const res = await fetch(`${base}${chemin}`);
  return { status: res.status, json: await res.json() as Record<string, unknown> };
}

/** Un membre dont le rôle ne permet rien de ce que ces routes demandent. */
function membre(permissions: Record<string, boolean>, role = 'sales_rep') {
  etat.tables.memberships = [{ user_id: session.userId, org_id: ORG, role, scope: 'company', status: 'active', team_id: null, department_id: null, manager_id: null, permissions }];
}

beforeEach(() => {
  clearRbacCache();
  membre({ 'automations.read': false, 'automations.update': false, 'jobs.complete': false, 'payments.create': false });
});

describe('roles-12 — le refus d’une permission des automatisations', () => {
  it('« modifier » : `error` inchangé (contrat), une phrase en français, la clé à part', async () => {
    const r = await appeler('/modifier');
    expect(r.status).toBe(403);
    expect(r.json).toEqual({
      error: 'Permission denied: automations.update',
      message: 'Votre rôle ne permet pas de modifier les automatisations.',
      message_en: 'Your role does not allow editing automations.',
      permission: 'automations.update',
    });
  });

  it('« voir » : sa propre phrase', async () => {
    const r = await appeler('/voir');
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('Permission denied: automations.read');
    expect(r.json.message).toBe('Votre rôle ne permet pas de voir les automatisations.');
    expect(r.json.message_en).toBe('Your role does not allow viewing automations.');
    expect(r.json.permission).toBe('automations.read');
  });

  it('la phrase à afficher ne contient ni anglais technique ni nom de clé', async () => {
    for (const chemin of ['/modifier', '/voir', '/terminer', '/encaisser']) {
      const { json } = await appeler(chemin);
      expect(String(json.message), chemin).not.toMatch(/Permission denied|[a-z_]+\.[a-z_]+/);
      expect(String(json.message), chemin).toMatch(/^Votre rôle ne permet pas /);
    }
  });
});

describe('roles-12 — toute autre permission : la phrase générique', () => {
  it('requirePermission(« jobs.complete »)', async () => {
    const r = await appeler('/terminer');
    expect(r.status).toBe(403);
    expect(r.json).toEqual({
      error: 'Permission denied: jobs.complete',
      message: 'Votre rôle ne permet pas cette action.',
      message_en: 'Your role does not allow this action.',
      permission: 'jobs.complete',
    });
  });

  it('requireFinancialAccess(« payments.create ») : même forme', async () => {
    const r = await appeler('/encaisser');
    expect(r.status).toBe(403);
    expect(r.json).toEqual({
      error: 'Permission denied: payments.create',
      message: 'Votre rôle ne permet pas cette action.',
      message_en: 'Your role does not allow this action.',
      permission: 'payments.create',
    });
  });
});

describe('roles-12 — ce qui ne change pas', () => {
  it('avec la permission, la route répond', async () => {
    membre({ 'automations.update': true });
    const r = await appeler('/modifier');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
  });

  it('sans adhésion active : 403 « No active membership found. », tel quel', async () => {
    etat.tables.memberships = [];
    const r = await appeler('/modifier');
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: 'No active membership found.' });
  });

  it('technicien sur une route financière : « Financial access denied. », tel quel', async () => {
    membre({}, 'technician');
    const r = await appeler('/encaisser');
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: 'Financial access denied.' });
  });
});

describe('roles-12 — `corpsRefusPermission`, pour les autres gardes du serveur', () => {
  it('plusieurs clés acceptées (« l’une OU l’autre ») : même `error` que le garde des routes, phrase générique', () => {
    expect(corpsRefusPermission(['jobs.update', 'calendar.update'])).toEqual({
      error: 'Permission denied: jobs.update or calendar.update',
      message: 'Votre rôle ne permet pas cette action.',
      message_en: 'Your role does not allow this action.',
      permission: 'jobs.update or calendar.update',
    });
  });

  it('une seule clé dans un tableau : la phrase de la clé', () => {
    expect(corpsRefusPermission(['automations.update']).message).toBe('Votre rôle ne permet pas de modifier les automatisations.');
  });
});
