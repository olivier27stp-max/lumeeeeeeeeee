// @vitest-environment jsdom
/**
 * Launch 2026-09-28 — bloc 5 : l'onglet « Réglages » d'une automatisation
 * envoie ses changements UN À LA FOIS. Deux interrupteurs basculés vite
 * partaient en parallèle ; le second, calculé sur l'état d'avant le premier,
 * l'effaçait en base. Vrai composant rendu.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const envois = vi.hoisted(() => ({ liste: [] as any[], enVol: 0, maxEnVol: 0 }));
vi.mock('../src/lib/automationBuilderApi', () => ({
  modifierAutomatisation: vi.fn(async (_id: string, patch: any) => {
    envois.enVol++; envois.maxEnVol = Math.max(envois.maxEnVol, envois.enVol);
    await new Promise((r) => setTimeout(r, 20));
    envois.enVol--; envois.liste.push(patch.settings);
    return {};
  }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import OngletReglages from '../src/components/automations/OngletReglages';

describe('réglages d’une automatisation', () => {
  it('deux interrupteurs basculés vite : les deux sont en base, jamais deux envois à la fois', async () => {
    const hote = document.createElement('div');
    document.body.appendChild(hote);
    const racine = createRoot(hote);
    act(() => racine.render(<OngletReglages ruleId="r" reglages={null} fr onChange={() => {}} />));
    const [reentree, arret] = [...hote.querySelectorAll('button[role="switch"]')] as HTMLButtonElement[];
    act(() => { reentree.click(); });
    act(() => { arret.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(envois.maxEnVol).toBe(1);
    expect(envois.liste.at(-1)).toEqual({ reentree: true, arret_sur_reponse: true });
    act(() => racine.unmount());
    hote.remove();
  });
});
