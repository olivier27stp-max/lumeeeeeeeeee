// @vitest-environment jsdom
//
// LA VUE D'ENSEMBLE — aucune case vide au launch (audit du 2026-09-28).
//
// La courbe lit les vrais déclenchements : on la garde. L'« Analyse des
// déclencheurs » n'avait AUCUNE donnée (trois « — ») : elle est retirée.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/lib/automationRulesApi', () => ({
  getAutomationRules: vi.fn(async () => [{ id: 'a', is_active: true }, { id: 'b', is_active: false }]),
  getRecentAutomationFailures: vi.fn(async () => []),
}));
vi.mock('../src/lib/automationJournauxApi', () => ({
  activiteParSemaine: vi.fn(async () => {
    const debut = new Date('2026-09-21T00:00:00');
    const fin = new Date('2026-09-27T23:59:59');
    return { total: 12, parSemaine: [{ debut, fin, n: 12 }] };
  }),
}));
vi.mock('../src/components/PermissionGate', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AutomationsApercu from '../src/pages/AutomationsApercu';
import { LanguageProvider } from '../src/i18n';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  localStorage.setItem('lume-language', 'fr');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('la vue d’ensemble ne montre que de vraies données', () => {
  it('pas d’« Analyse des déclencheurs » ni de case « — » ; la courbe réelle est là', async () => {
    await act(async () => {
      root.render(<MemoryRouter><LanguageProvider><AutomationsApercu /></LanguageProvider></MemoryRouter>);
    });
    for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
    const texte = container.textContent ?? '';
    expect(texte).toContain('Déclenchements — 7 dernières semaines');
    expect(texte).not.toContain('Analyse des déclencheurs');
    const casesVides = Array.from(container.querySelectorAll('p')).filter((p) => p.textContent?.trim() === '—');
    expect(casesVides).toHaveLength(0);
  });
});
