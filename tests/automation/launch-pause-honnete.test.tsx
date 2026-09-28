// @vitest-environment jsdom
/**
 * Launch 2026-09-28 — « Tout arrêter » dit la vérité.
 *
 * La RLS de company_settings ne laisse modifier qu'un administrateur. Pour
 * un autre rôle, la mise à jour touchait ZÉRO ligne sans erreur ; la route
 * répondait « en pause » et le bandeau l'affichait, alors que rien n'était
 * arrêté. Maintenant : 403 avec un message clair, et l'écran affiche l'état
 * RELU de la base.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const etat = vi.hoisted(() => ({ lignesModifiees: [] as any[], toastErr: [] as string[], toastOk: [] as string[], pauseReelle: false }));

vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  requireAuthedClient: async () => ({
    orgId: '11111111-1111-4111-8111-111111111111',
    user: { id: 'u1' },
    client: {
      from: () => {
        const q: any = {};
        q.update = () => q; q.eq = () => q;
        q.select = async () => ({ data: etat.lignesModifiees, error: null });
        return q;
      },
    },
  }),
}));
vi.mock('../../src/lib/automationWebhooksApi', () => ({
  lireEtatPause: async () => ({ paused: etat.pauseReelle, pausedAt: null }),
  basculerPause: async (_v: boolean) => ({ paused: etat.pauseReelle, pausedAt: null }),
}));
vi.mock('../../src/components/ui/ConfirmDialog', () => ({ confirmer: async () => true }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => etat.toastOk.push(m), error: (m: string) => etat.toastErr.push(m) } }));

import router from '../../server/routes/automation-rules';
import BandeauPause from '../../src/components/automations/BandeauPause';

const app = express();
app.use(express.json());
app.use('/api', router);
const serveur = app.listen(0);
const url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/automations/pause`;
afterAll(() => serveur.close());

const poster = (paused: boolean) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused }) });

describe('route « Tout arrêter »', () => {
  it('rôle sans le droit (0 ligne modifiée) : 403 avec un message clair, jamais « en pause »', async () => {
    etat.lignesModifiees = [];
    const r = await poster(true);
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/administrateur.*Rien n’a été arrêté/);
  });

  it('administrateur : l’état RELU de la base est renvoyé', async () => {
    etat.lignesModifiees = [{ automations_paused: true }];
    const r = await poster(true);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ paused: true });
  });
});

describe('bandeau « Tout arrêter »', () => {
  let racine: Root | null = null;
  let hote: HTMLDivElement | null = null;
  afterEach(() => { act(() => racine?.unmount()); hote?.remove(); racine = null; hote = null; etat.toastErr.length = 0; etat.toastOk.length = 0; });

  it('si la base n’a pas été mise en pause, l’écran ne dit PAS « en pause »', async () => {
    etat.pauseReelle = false; // la base refuse : rien n'est arrêté
    hote = document.createElement('div');
    document.body.appendChild(hote);
    racine = createRoot(hote);
    await act(async () => { racine!.render(<BandeauPause fr />); });
    const bouton = [...hote.querySelectorAll('button')].find((b) => /Tout arrêter/.test(b.textContent ?? ''))!;
    await act(async () => { bouton.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(hote.textContent).not.toMatch(/sont en pause/);
    expect(etat.toastOk).toHaveLength(0);
    expect(etat.toastErr.length).toBeGreaterThan(0);
  });
});
