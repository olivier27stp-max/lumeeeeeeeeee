/**
 * Launch 2026-09-28 — bloc 4 : on ne range une automatisation que dans un
 * dossier de SON bureau. L'identifiant venu du navigateur n'était pas
 * vérifié. (modele_id : faux positif de l'audit — seul le serveur l'écrit,
 * pour lier une copie à sa règle d'origine dans un bureau frère.)
 */
import { describe, it, expect, vi, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const MIEN = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';
const etat = vi.hoisted(() => ({ majs: [] as any[] }));
vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  requireAuthedClient: async () => ({
    orgId: 'org', user: { id: 'u' },
    client: {
      from: (t: string) => {
        const f: Array<[string, unknown]> = [];
        const q: any = {};
        for (const m of ['select', 'is', 'order', 'limit']) q[m] = () => q;
        q.eq = (c: string, v: unknown) => { f.push([c, v]); return q; };
        q.update = (v: any) => { etat.majs.push(v); return q; };
        q.maybeSingle = async () => {
          if (t === 'automation_folders') return { data: f.some(([c, v]) => c === 'id' && v === MIEN) ? { id: MIEN } : null, error: null };
          return { data: { id: 'r', is_preset: false, trigger_event: 'quote.sent', delay_seconds: 0, modele_id: null }, error: null };
        };
        q.single = q.maybeSingle;
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
const url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/automations/rules/r`;
afterAll(() => serveur.close());
const deplacer = (folder_id: string | null) => fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ folder_id }) });

describe('dossier d’une automatisation', () => {
  it('le dossier d’un AUTRE bureau est refusé, rien n’est écrit', async () => {
    etat.majs.length = 0;
    const r = await deplacer(AUTRE);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/Dossier introuvable/);
    expect(etat.majs).toHaveLength(0);
  });
  it('son propre dossier (ou la racine) passe', async () => {
    etat.majs.length = 0;
    expect((await deplacer(MIEN)).status).not.toBe(400);
    expect((await deplacer(null)).status).not.toBe(400);
    expect(etat.majs.length).toBeGreaterThan(0);
  });
});
