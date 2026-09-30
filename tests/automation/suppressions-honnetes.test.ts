/**
 * Vague 3 (audit V2, S9, Faible) — des suppressions qui répondaient « OK »
 * sans rien faire : `DELETE folders/<dossier du bureau B>` → 204 et
 * `DELETE webhooks/<webhook de B>` → { ok: true }, alors que rien n'était
 * supprimé (la RLS, ou le filtre de bureau, laissait 0 ligne). Désormais
 * 0 ligne = 404.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const MIEN = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';
vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  requireAuthedClient: async () => ({
    orgId: 'org-a', user: { id: 'u' },
    client: {
      // La base simulée ne contient que MIEN : tout autre id = 0 ligne touchée.
      from: () => {
        let id: unknown = null;
        const q: any = {};
        for (const m of ['is', 'order', 'limit', 'delete', 'update']) q[m] = () => q;
        q.eq = (c: string, v: unknown) => { if (c === 'id') id = v; return q; };
        q.select = () => q;
        q.then = (res: any, rej: any) => Promise.resolve({ data: id === MIEN ? [{ id: MIEN }] : [], error: null }).then(res, rej);
        return q;
      },
    },
  }),
}));

import router from '../../server/routes/automation-rules';
const app = express();
app.use(express.json());
app.use('/api', router);
const serveur = app.listen(0);
const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/automations`;
afterAll(() => serveur.close());

describe('S9 — une suppression qui ne supprime rien ne dit plus « OK »', () => {
  it('dossier d’un autre bureau : 404', async () => {
    const r = await fetch(`${base}/folders/${AUTRE}`, { method: 'DELETE' });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('Dossier introuvable.');
  });
  it('son propre dossier : 204', async () => {
    expect((await fetch(`${base}/folders/${MIEN}`, { method: 'DELETE' })).status).toBe(204);
  });
  it('adresse d’appel d’un autre bureau : 404', async () => {
    const r = await fetch(`${base}/webhooks/${AUTRE}`, { method: 'DELETE' });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('Adresse d’appel introuvable.');
  });
  it('sa propre adresse d’appel : { ok: true }', async () => {
    const r = await fetch(`${base}/webhooks/${MIEN}`, { method: 'DELETE' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });
});
