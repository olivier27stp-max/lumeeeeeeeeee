/**
 * Vague 3 (audit V2, C22, Faible) — `/api/hooks/:cle` n'avait aucune limite
 * par IP : 80 clés au hasard = 80 × 404 et 80 requêtes SQL, sans un 429
 * (preuve `hooks.json` `cles_aleatoires_80`). Désormais, au-delà de 20
 * ÉCHECS par minute et par IP, 429 sans toucher la base ; une vraie clé
 * n'est jamais freinée par les échecs des autres.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

const base = vi.hoisted(() => ({ lectures: 0, cleValide: '' }));
vi.mock('../server/lib/supabase', () => ({
  getServiceClient: () => ({
    from: () => {
      let cle = '';
      const q: any = {
        select: () => q, is: () => q,
        eq: (c: string, v: string) => { if (c === 'api_key') cle = v; return q; },
        maybeSingle: async () => { base.lectures++; return { data: cle === base.cleValide ? { id: 'h1', org_id: 'org-a', enabled: true, deleted_at: null } : null, error: null }; },
        insert: async () => ({ data: null, error: null }),
        update: () => q,
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));
vi.mock('../server/lib/eventBus', () => ({ eventBus: { emit: vi.fn(), emitAsync: vi.fn(async () => undefined) } }));

import router, { oublierCompteursWebhooks } from '../server/routes/webhooks-entrants';

async function avecServeur<T>(f: (url: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use('/api', router);
  const srv = app.listen(0);
  try {
    const { port } = srv.address() as AddressInfo;
    return await f(`http://127.0.0.1:${port}/api/hooks/`);
  } finally {
    srv.close();
  }
}
const cleAuHasard = () => randomBytes(32).toString('hex');

beforeEach(() => { oublierCompteursWebhooks(); base.lectures = 0; base.cleValide = cleAuHasard(); });

describe('C22 — limite des échecs par IP sur les webhooks entrants', () => {
  it('80 clés au hasard : 20 × 404 (20 lectures SQL), puis 429 sans toucher la base', async () => {
    const codes = await avecServeur(async (url) => {
      const out: number[] = [];
      for (let i = 0; i < 80; i++) out.push((await fetch(url + cleAuHasard(), { method: 'POST' })).status);
      return out;
    });
    expect(codes.filter((c) => c === 404)).toHaveLength(20);
    expect(codes.filter((c) => c === 429)).toHaveLength(60);
    expect(base.lectures).toBe(20);
  });

  it('les clés mal formées comptent aussi comme échecs', async () => {
    const codes = await avecServeur(async (url) => {
      const out: number[] = [];
      for (let i = 0; i < 22; i++) out.push((await fetch(url + 'court' + i, { method: 'POST' })).status);
      return out;
    });
    expect(codes.slice(0, 20).every((c) => c === 404)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
  });

  it('une vraie clé n’est pas comptée comme un échec', async () => {
    const codes = await avecServeur(async (url) => {
      const out: number[] = [];
      for (let i = 0; i < 30; i++) out.push((await fetch(url + base.cleValide, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status);
      return out;
    });
    expect(codes.some((c) => c === 404 || c === 429)).toBe(false);
  });
});
