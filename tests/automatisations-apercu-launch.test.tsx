// @vitest-environment jsdom
//
// LA VUE D'ENSEMBLE — aucune case vide au launch (audit du 2026-09-28).
//
// La courbe lit les vrais déclenchements : on la garde. L'« Analyse des
// déclencheurs » n'avait AUCUNE donnée (trois « — ») : elle est retirée.
//
// Mission du 2026-10-01 : les chiffres viennent de la route de statistiques
// (comptés en base, période choisie) et non plus d'une lecture du navigateur.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/lib/automationRulesApi', () => ({
  getAutomationRules: vi.fn(async () => [{ id: 'a', is_active: true }, { id: 'b', is_active: false }]),
}));
vi.mock('../src/lib/automationStatsApi', async () => {
  const { versStatistiques } = await import('./aides/stats-automatisations');
  return {
    chargerStatistiquesBureau: vi.fn(async () => ({
      ...versStatistiques({ par_regle: { a: { declenches: 12, envoyes: 9 } } }, [], 7),
      par_jour: ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']
        .map((jour, i) => ({ jour, declenchees: i === 6 ? 12 : 0, envoyees: i === 6 ? 9 : 0, echouees: 0, ignorees: 0 })),
    })),
    lirePeriodeChoisie: () => 7,
    retenirPeriode: () => undefined,
  };
});
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
    expect(texte).toContain('Déclenchées par jour — 7 derniers jours');
    // La courbe : une barre par jour, la somme est le total de la tuile.
    expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Déclenchées par jour : 0, 0, 0, 0, 0, 0, 12');
    expect(texte).not.toContain('Analyse des déclencheurs');
    const casesVides = Array.from(container.querySelectorAll('p')).filter((p) => p.textContent?.trim() === '—');
    expect(casesVides).toHaveLength(0);
  });
});
