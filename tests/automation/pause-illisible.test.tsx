// @vitest-environment jsdom
/**
 * « Tout arrêter » ne disparaît pas quand l'état de la pause est illisible.
 *
 * Audit du 2026-10-01 (constat majeur, observé à l'écran avec une panne
 * simulée) : si `GET /api/automations/pause` échouait, le bandeau ne rendait
 * RIEN — ni le lien « Tout arrêter », ni message. Le bouton d'urgence
 * disparaissait en silence, et un bureau réellement en pause ne le savait plus.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  lire: vi.fn(async (): Promise<{ paused: boolean; pausedAt: null }> => ({ paused: false, pausedAt: null })),
  basculer: vi.fn(async (v: boolean) => ({ paused: v, pausedAt: null })),
  toastOk: [] as string[],
  toastErr: [] as string[],
}));
vi.mock('../../src/lib/automationWebhooksApi', () => ({
  lireEtatPause: () => api.lire(),
  basculerPause: (v: boolean) => api.basculer(v),
}));
vi.mock('../../src/components/ui/ConfirmDialog', () => ({ confirmer: async () => true }));
vi.mock('sonner', () => ({ toast: { success: (m: string) => api.toastOk.push(m), error: (m: string) => api.toastErr.push(m) } }));

import BandeauPause from '../../src/components/automations/BandeauPause';

let conteneur: HTMLDivElement;
let racine: Root | null = null;
const vu: boolean[] = [];

async function rendre() {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => { racine!.render(<BandeauPause fr onChange={(p) => vu.push(p)} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const bouton = (motif: RegExp) => Array.from(conteneur.querySelectorAll('button')).find((b) => motif.test((b.textContent || '').trim()));
async function cliquer(el: Element | undefined) {
  if (!el) throw new Error('bouton introuvable');
  await act(async () => { (el as HTMLElement).click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  api.lire.mockReset(); api.basculer.mockReset();
  api.basculer.mockImplementation(async (v: boolean) => ({ paused: v, pausedAt: null }));
  api.toastOk.length = 0; api.toastErr.length = 0; vu.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
  vi.mocked(console.error).mockRestore?.();
});

describe('état de la pause illisible', () => {
  it('l’écran le DIT, et garde « Tout arrêter » sous la main', async () => {
    api.lire.mockRejectedValue(new Error('500'));
    await rendre();
    expect(conteneur.textContent).toContain('Impossible de savoir si vos automatisations sont en pause pour le moment.');
    expect(bouton(/^Tout arrêter$/)).toBeDefined();
    expect(bouton(/^Réessayer$/)).toBeDefined();
    // Rien n'est annoncé à la page tant qu'on ne sait pas.
    expect(vu).toEqual([]);
  });

  it('« Réessayer » relit ; si le bureau EST en pause, le bandeau rouge apparaît', async () => {
    api.lire.mockRejectedValueOnce(new Error('500'));
    api.lire.mockResolvedValue({ paused: true, pausedAt: null });
    await rendre();
    await cliquer(bouton(/^Réessayer$/));
    expect(api.lire).toHaveBeenCalledTimes(2);
    expect(conteneur.textContent).toContain('Vos automatisations sont en pause.');
    expect(bouton(/^Reprendre$/)).toBeDefined();
    expect(vu).toEqual([true]);
  });

  it('l’arrêt d’urgence marche même sans avoir pu lire l’état', async () => {
    api.lire.mockRejectedValue(new Error('500'));
    await rendre();
    await cliquer(bouton(/^Tout arrêter$/));
    expect(api.basculer).toHaveBeenCalledWith(true);
    expect(conteneur.textContent).toContain('Vos automatisations sont en pause.');
    expect(api.toastOk).toContain('Automatisations en pause.');
  });
});

describe('lecture réussie : rien ne change', () => {
  it('pas en pause : le seul lien « Tout arrêter », sans message d’erreur', async () => {
    api.lire.mockResolvedValue({ paused: false, pausedAt: null });
    await rendre();
    expect(bouton(/^Tout arrêter$/)).toBeDefined();
    expect(conteneur.textContent).not.toContain('Impossible de savoir');
    expect(bouton(/^Réessayer$/)).toBeUndefined();
  });
});
