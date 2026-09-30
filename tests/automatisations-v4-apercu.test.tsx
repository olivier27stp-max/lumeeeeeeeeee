// @vitest-environment jsdom
//
// VAGUE 4 — la Vue d'ensemble des automatisations (audit V2, 11-interface.md §9).

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const api = {
  regles: vi.fn(async (): Promise<any[]> => []),
  echecs: vi.fn(async (): Promise<any[]> => []),
};
const naviguer = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => naviguer,
}));
vi.mock('../src/lib/automationRulesApi', () => ({
  getAutomationRules: () => api.regles(),
  getRecentAutomationFailures: () => api.echecs(),
  getAutomationLanguage: vi.fn(async () => 'fr'),
}));
vi.mock('../src/components/automations/AdressesDAppel', () => ({ default: () => null }));
vi.mock('../src/lib/automationJournauxApi', () => ({
  activiteParSemaine: vi.fn(async () => ({ total: 0, parSemaine: [] })),
}));
vi.mock('../src/components/PermissionGate', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AutomationsApercu from '../src/pages/AutomationsApercu';
import AutomationsReglages from '../src/pages/AutomationsReglages';
import { LanguageProvider } from '../src/i18n';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  api.regles.mockReset();
  api.regles.mockImplementation(async () => []);
  api.echecs.mockReset();
  api.echecs.mockImplementation(async () => []);
  naviguer.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem('lume-language', 'fr');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function rendre() {
  await act(async () => {
    root.render(<MemoryRouter><LanguageProvider><AutomationsApercu /></LanguageProvider></MemoryRouter>);
  });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

/** La valeur d'une tuile, par son libellé. */
function tuile(libelle: string): string | undefined {
  const carte = Array.from(container.querySelectorAll('.section-card'))
    .find((c) => c.querySelector('p')?.textContent === libelle);
  return carte?.querySelectorAll('p')[1]?.textContent ?? undefined;
}

describe('A-08 — des journaux illisibles ne deviennent pas « Aucune erreur »', () => {
  it('dit que les erreurs n’ont pas pu être lues', async () => {
    api.echecs.mockImplementation(async () => { throw new Error('500'); });
    await rendre();
    const texte = container.textContent ?? '';
    expect(texte).not.toContain('Aucune erreur');
    expect(texte).toContain('Les erreurs n’ont pas pu être lues');
  });

  it('des règles illisibles donnent « — », pas 0', async () => {
    api.regles.mockImplementation(async () => { throw new Error('500'); });
    await rendre();
    expect(tuile('Total des automatisations')).toBe('—');
    expect(tuile('Automatisations publiées')).toBe('—');
  });
});

describe('A-14 — Vue d’ensemble : la corbeille ne compte pas, « à vérifier » mène au bon onglet', () => {
  it('le total ignore les automatisations à la corbeille', async () => {
    api.regles.mockImplementation(async () => [
      { id: 'a', is_active: true, deleted_at: null },
      { id: 'b', is_active: false, deleted_at: null },
      { id: 'c', is_active: false, deleted_at: '2026-09-29T00:00:00Z' },
    ]);
    await rendre();
    expect(tuile('Total des automatisations')).toBe('2');
    expect(tuile('Automatisations publiées')).toBe('1');
  });

  it('« Voir les automatisations à vérifier » ouvre l’onglet « À vérifier »', async () => {
    api.echecs.mockImplementation(async () => [{ id: 'x', automation_rule_id: 'a', action_type: 'send_sms', result_error: 'boom', entity_type: null, created_at: '' }]);
    await rendre();
    const b = Array.from(container.querySelectorAll('button')).find((x) => x.textContent?.includes('Voir les automatisations à vérifier'));
    act(() => { b?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(naviguer).toHaveBeenCalledWith('/automations?onglet=verifier');
  });
});

// ─── A-15 (Réglages globaux) ────────────────────────────────────

describe('A-15 — Réglages globaux : les textes disent le vrai', () => {
  it('trois secondes (pas « une seconde ») ; la fenêtre d’envoi se règle par automatisation', async () => {
    await act(async () => {
      root.render(<MemoryRouter><LanguageProvider><AutomationsReglages /></LanguageProvider></MemoryRouter>);
    });
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
    const texte = container.textContent ?? '';
    expect(texte).not.toContain('une seconde après');
    expect(texte).toContain('trois secondes après');
    expect(texte).not.toContain('Ce n’est pas encore réglable');
    expect(texte).toContain('onglet Réglages');
  });
});
