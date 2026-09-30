/**
 * Vague 3 (audit V2, C33, Faible) — la garde de forfait ne couvrait que
 * `/api/automations/*` et `/api/reminders/*` : l'adresse d'appel
 * `/api/hooks/:cle` déclenchait les automatisations d'un bureau dont le
 * forfait ne les inclut pas. La clé désigne le bureau : son forfait est
 * vérifié, avec le même mode que partout (FEATURE_GUARD).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

const base = vi.hoisted(() => ({ plan: null as null | Record<string, unknown>, emis: 0 }));
vi.mock('../server/lib/supabase', () => ({
  companyOrgIds: async (_a: unknown, org: string) => [org],
  getServiceClient: () => ({
    from: (table: string) => {
      const q: any = {};
      for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({
        data: table === 'automation_webhooks'
          ? { id: 'h1', org_id: 'org-starter', enabled: true, deleted_at: null }
          : table === 'subscriptions' ? (base.plan ? { plans: base.plan } : null) : null,
        error: null,
      });
      // Reçu : attendu directement, ou .select('id').single() pour son id (occurrence).
      q.insert = () => Object.assign(Promise.resolve({ data: null, error: null }), { select: () => ({ single: async () => ({ data: { id: 'recu-1' }, error: null }) }) });
      return q;
    },
  }),
}));
vi.mock('../server/lib/eventBus', () => ({ eventBus: { emit: vi.fn(async () => { base.emis++; }) } }));

import router, { oublierCompteursWebhooks } from '../server/routes/webhooks-entrants';
import { viderCacheFonction } from '../server/lib/feature-guard';

const MODE = process.env.FEATURE_GUARD;
beforeEach(() => { oublierCompteursWebhooks(); viderCacheFonction(); base.emis = 0; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { if (MODE === undefined) delete process.env.FEATURE_GUARD; else process.env.FEATURE_GUARD = MODE; });

async function appeler(): Promise<{ status: number; json: any }> {
  const app = express();
  app.use('/api', router);
  const srv = app.listen(0);
  try {
    const { port } = srv.address() as AddressInfo;
    const r = await fetch(`http://127.0.0.1:${port}/api/hooks/${randomBytes(32).toString('hex')}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"source":"site"}' });
    return { status: r.status, json: await r.json().catch(() => null) };
  } finally {
    srv.close();
  }
}

describe('C33 — garde de forfait sur /api/hooks', () => {
  it('enforce + forfait sans automatisations : 403, aucun événement émis', async () => {
    process.env.FEATURE_GUARD = 'enforce';
    base.plan = { slug: 'starter', includes_automations: false };
    const r = await appeler();
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ error: 'feature_not_in_plan', feature: 'includes_automations' });
    expect(r.json.message).toContain('n’inclut pas les automatisations');
    expect(r.json.message).toContain('does not include automations');
    expect(base.emis).toBe(0);
  });

  it('enforce + forfait avec automatisations : accepté', async () => {
    process.env.FEATURE_GUARD = 'enforce';
    base.plan = { slug: 'autopilot', includes_automations: true };
    const r = await appeler();
    expect(r.status).toBeLessThan(300);
    expect(base.emis).toBe(1);
  });

  it('mode log (défaut) : laisse passer et journalise ce qui AURAIT été bloqué', async () => {
    delete process.env.FEATURE_GUARD;
    base.plan = { slug: 'starter', includes_automations: false };
    const avertir = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await appeler();
    expect(r.status).toBeLessThan(300);
    expect(avertir.mock.calls.flat().join(' ')).toContain('AURAIT BLOQUÉ POST /api/hooks');
  });

  it('forfait illisible : fail-open, comme le middleware', async () => {
    process.env.FEATURE_GUARD = 'enforce';
    base.plan = null;
    expect((await appeler()).status).toBeLessThan(300);
  });
});
