// @vitest-environment jsdom
/**
 * Launch 2026-09-28 — bloc 4 : la clé d'une adresse d'appel (webhook entrant).
 *
 * Qui détient la clé déclenche les automatisations de l'entreprise depuis
 * l'extérieur. Avant : renvoyée en clair à chaque lecture, à quiconque avait
 * « Voir les automatisations ». Maintenant : la liste n'en montre que les 4
 * derniers caractères ; la clé complète ne sort qu'à la création ou à la
 * régénération.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CLE = 'a'.repeat(60) + 'b1c2';
const etat = vi.hoisted(() => ({ majUtilisateur: [] as any[], lignesMaj: [{ id: 'w1', name: 'Site', enabled: true, created_at: 'x' }] as any[] }));

const chaine = (resultat: () => any) => {
  const q: any = {};
  for (const m of ['select', 'eq', 'is', 'order', 'in', 'insert']) q[m] = () => q;
  q.update = (v: any) => { etat.majUtilisateur.push(v); return q; };
  q.maybeSingle = async () => ({ data: resultat()?.[0] ?? null, error: null });
  q.single = q.maybeSingle;
  q.then = (res: any, rej: any) => Promise.resolve({ data: resultat(), error: null }).then(res, rej);
  return q;
};
vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  requireAuthedClient: async () => ({ orgId: 'org', user: { id: 'u' }, client: { from: () => chaine(() => etat.lignesMaj) } }),
  getServiceClient: () => ({ from: () => chaine(() => [{ id: 'w1', api_key: CLE }]) }),
}));

import router from '../../server/routes/automation-rules';

const app = express();
app.use(express.json());
app.use('/api', router);
const serveur = app.listen(0);
const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/automations/webhooks`;
afterAll(() => serveur.close());

describe('route des adresses d’appel', () => {
  it('la liste ne renvoie JAMAIS la clé complète', async () => {
    const corps = await (await fetch(base)).json();
    expect(JSON.stringify(corps)).not.toContain(CLE);
    expect(corps.webhooks[0].cle_masquee).toBe('••••b1c2');
    expect(corps.webhooks[0].api_key).toBeUndefined();
  });

  it('la création rend la clé complète, une fois', async () => {
    const corps = await (await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Site"}' })).json();
    expect(corps.api_key).toBe(CLE);
  });

  it('régénérer : nouvelle clé (64 caractères hex), rendue une fois ; 404 si la RLS refuse', async () => {
    const r = await (await fetch(`${base}/w1/regenerer`, { method: 'POST' })).json();
    expect(r.api_key).toMatch(/^[0-9a-f]{64}$/);
    expect(r.api_key).not.toBe(CLE);
    expect(etat.majUtilisateur.at(-1).api_key).toBe(r.api_key);
    etat.lignesMaj = [];
    expect((await fetch(`${base}/w1/regenerer`, { method: 'POST' })).status).toBe(404);
    etat.lignesMaj = [{ id: 'w1', name: 'Site', enabled: true, created_at: 'x' }];
  });
});

vi.mock('../../src/lib/automationWebhooksApi', () => ({
  listerAdressesDAppel: async () => [{ id: 'w1', name: 'Site', enabled: true, created_at: 'x', cle_masquee: '••••b1c2' }],
  creerAdresseDAppel: vi.fn(), basculerAdresseDAppel: vi.fn(), supprimerAdresseDAppel: vi.fn(), regenererAdresseDAppel: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('écran des adresses d’appel', () => {
  it('une adresse existante : clé masquée, pas de bouton « afficher » ni « copier », un bouton « Régénérer »', async () => {
    const { default: AdressesDAppel } = await import('../../src/components/automations/AdressesDAppel');
    const hote = document.createElement('div');
    document.body.appendChild(hote);
    const racine = createRoot(hote);
    await act(async () => { racine.render(<AdressesDAppel fr />); });
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(hote.textContent).toContain('/api/hooks/••••b1c2');
    expect(hote.querySelector('[aria-label="Copier l’adresse"]')).toBeNull();
    expect(hote.querySelector('[aria-label="Afficher l’adresse"]')).toBeNull();
    expect([...hote.querySelectorAll('button')].some((b) => /Régénérer/.test(b.textContent ?? ''))).toBe(true);
    act(() => racine.unmount());
    hote.remove();
  });
});
