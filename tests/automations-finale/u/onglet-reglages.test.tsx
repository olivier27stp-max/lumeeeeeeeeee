// @vitest-environment jsdom
/**
 * L'ONGLET « RÉGLAGES » d'une automatisation — corrections de l'agent U.
 * Le vrai composant ; seule l'écriture est simulée.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ modifier: vi.fn() }));
vi.mock('../../../src/lib/automationBuilderApi', () => ({
  modifierAutomatisation: (id: string, patch: unknown) => api.modifier(id, patch),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import OngletReglages, { type ReglagesAutomatisation } from '../../../src/components/automations/OngletReglages';

let hote: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  api.modifier.mockReset();
  api.modifier.mockImplementation(async () => ({}));
  hote = document.createElement('div');
  document.body.appendChild(hote);
  racine = createRoot(hote);
});
afterEach(() => { act(() => racine.unmount()); hote.remove(); });

const monter = (reglages: Record<string, unknown> | null, props: Partial<React.ComponentProps<typeof OngletReglages>> = {}) =>
  act(() => racine.render(<OngletReglages ruleId="r-1" reglages={reglages as ReglagesAutomatisation | null} fr onChange={() => {}} {...props} />));
const interrupteur = (titre: string) => Array.from(hote.querySelectorAll<HTMLButtonElement>('button[role="switch"]'))
  .find((b) => (b.getAttribute('aria-label') ?? b.closest('div')?.textContent ?? '').includes(titre)
    || hote.querySelector(`[id="${b.getAttribute('aria-labelledby')}"]`)?.textContent?.includes(titre));
const basculer = async (titre: string) => {
  const b = interrupteur(titre);
  if (!b) throw new Error(`interrupteur « ${titre} » introuvable`);
  act(() => { b.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
};
const envoye = () => (api.modifier.mock.calls.at(-1)?.[1] as { settings: unknown } | undefined)?.settings;

// ─── Triage « éditeur », S-08 (= déclencheurs 03:647) ───────────

describe('S-08 — basculer un réglage n’efface pas `arreter_si_resolu: false` (la case « Arrêter si… » décochée)', () => {
  it('« Jours ouvrables seulement » : la case décochée du déclencheur reste décochée en base', async () => {
    monter({ arreter_si_resolu: false });
    await basculer('Jours ouvrables seulement');
    expect(envoye()).toEqual({ arreter_si_resolu: false, jours_ouvrables: true });
  });

  it('… et le parent reçoit des réglages qui la portent toujours', async () => {
    const onChange = vi.fn();
    monter({ arreter_si_resolu: false }, { onChange });
    await basculer('Laisser le client repasser');
    expect(onChange).toHaveBeenLastCalledWith({ arreter_si_resolu: false, reentree: true });
  });

  it('remettre un réglage de cet onglet à son défaut retire SA clé, pas celle du déclencheur', async () => {
    monter({ arreter_si_resolu: false, jours_ouvrables: true });
    await basculer('Jours ouvrables seulement');
    expect(envoye()).toEqual({ arreter_si_resolu: false });
  });

  it('les clés vraies restent, comme avant (`arreter_si_resolu: true`)', async () => {
    monter({ arreter_si_resolu: true, reentree: true });
    await basculer('Laisser le client repasser');
    expect(envoye()).toEqual({ arreter_si_resolu: true });
  });

  it('tout remis par défaut, sans rien d’autre : `null` (jamais un objet vide en base)', async () => {
    monter({ reentree: true });
    await basculer('Laisser le client repasser');
    expect(envoye()).toBeNull();
  });
});

// ─── Priorité — constat A-09 ────────────────────────────────────

describe('A-09 — dans l’éditeur, l’onglet écrit par l’écriture de l’éditeur (même file, même garde de version)', () => {
  it('`enregistrer` fourni : c’est lui qui est appelé, pas l’écriture directe', async () => {
    const enregistrer = vi.fn(async () => ({}));
    monter(null, { enregistrer });
    await basculer('Jours ouvrables seulement');
    expect(enregistrer).toHaveBeenCalledWith({ settings: { jours_ouvrables: true } });
    expect(api.modifier).not.toHaveBeenCalled();
  });

  it('sans `enregistrer` : l’écriture directe, comme avant', async () => {
    monter(null);
    await basculer('Jours ouvrables seulement');
    expect(api.modifier).toHaveBeenCalledWith('r-1', { settings: { jours_ouvrables: true } });
  });
});
