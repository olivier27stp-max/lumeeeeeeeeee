// @vitest-environment jsdom
//
// Carte « Santé des bureaux » : le vrai composant, rendu avec la réponse de
// la route. On vérifie ce que le propriétaire VOIT et que le bouton
// « Reprendre du bureau de base » appelle bien la route avec le bon bureau.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const reprendreMock = vi.fn(async (_org: string, _section: string) => ({ rapport: { modeles: {}, tax_groups: 1, warnings: [] } }));

vi.mock('../src/lib/officesApi', () => ({
  getSanteBureaux: vi.fn(async () => ({
    base_id: 'coquin',
    bureaux: [
      { org_id: 'coquin', nom: 'Coquin lavage', est_base: true, a_regler: 1, points: [
        { cle: 'paiements', etat: 'attention', infos: { stripe: 'incomplet' }, action: { type: 'page', chemin: '/settings/payments' } },
        { cle: 'taxes', etat: 'ok', infos: { nb: 2 } },
      ] },
      { org_id: 'vision', nom: 'Vision Lavage', est_base: false, a_regler: 2, points: [
        { cle: 'taxes', etat: 'manquant', infos: { base: 'Coquin lavage' }, action: { type: 'reprendre', section: 'taxes' } },
        { cle: 'sms', etat: 'manquant', infos: { base_en_a: true, base: 'Coquin lavage' }, action: { type: 'page', chemin: '/settings/messaging' } },
        { cle: 'prefixe', etat: 'ok', infos: { prefixe: 'VL' } },
      ] },
    ],
  })),
  reprendreDuBureauDeBase: (...a: any[]) => reprendreMock(a[0], a[1]),
  suivreMarqueEntreprise: vi.fn(async () => undefined),
}));

vi.mock('../src/contexts/CompanyContext', () => ({
  useCompany: () => ({ current: { orgId: 'coquin' }, switchCompany: vi.fn() }),
}));

import SanteBureauxCard from '../src/components/offices/SanteBureauxCard';
import { LanguageProvider } from '../src/i18n';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  reprendreMock.mockClear();
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
    root.render(
      <MemoryRouter>
        <LanguageProvider>
          <SanteBureauxCard onChanged={() => undefined} />
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {});
}

describe('SanteBureauxCard', () => {
  it('affiche chaque bureau, le bureau de base marqué, le score et les points en mots', async () => {
    await rendre();
    const t = container.textContent || '';
    expect(t).toContain('Santé des bureaux');
    expect(t).toContain('Bureau de base');
    expect(t).toContain('Vision Lavage');
    expect(t).toContain('1 / 3');
    expect(t).toContain('Taxes par défaut · absentes');
    expect(t).toContain('Coquin lavage en a un. Chaque numéro a un coût mensuel.');
    expect(t).toContain('Préfixe des numéros · VL');
  });

  it('« Reprendre du bureau de base » appelle la route pour Vision, section taxes', async () => {
    await rendre();
    const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Reprendre du bureau de base'));
    expect(btn).toBeDefined();
    await act(async () => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(reprendreMock).toHaveBeenCalledWith('vision', 'taxes');
  });

  it('le numéro SMS n’a jamais de bouton « Reprendre » (coût) mais « Obtenir un numéro »', async () => {
    await rendre();
    const libelles = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(libelles.filter((l) => l?.includes('Reprendre'))).toHaveLength(1);
    expect(libelles.some((l) => l?.includes('Obtenir un numéro'))).toBe(true);
  });
});
