// @vitest-environment jsdom
//
// « Statistiques » a été absorbé par « Prévisions ».
//
// Ce que ces tests protègent : la fusion ne doit rien PERDRE. L'historique
// reste atteignable, et cliquer un deal depuis « À traiter » doit encore
// remonter au parent — sinon on a juste caché un écran.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));

vi.mock('../src/lib/pipelineVentesApi', () => ({
  fetchPrevisions: async () => ({
    max_potentiel_cents: 0, attendu_cents: 0, gagne_cents: 0,
    ouverts: 0, sans_date: 0, sans_montant: 0, en_retard: 0,
  }),
  fetchARisque: async () => [],
  fetchChronologie: async () => [],
  fetchPrevisionsGroupees: async () => [],
}));

/**
 * L'historique complet est lourd (neuf requêtes). On le remplace par un
 * témoin : ce test vérifie le CÂBLAGE de la fusion, pas le contenu de
 * `PipelineStats`, qui a ses propres tests.
 */
vi.mock('../src/components/pipeline/PipelineStats', () => ({
  default: ({ onOuvrirDeal }: { onOuvrirDeal?: (id: string) => void }) => (
    <div data-testid="historique">
      <button type="button" onClick={() => onOuvrirDeal?.('deal-42')}>
        ouvrir un deal
      </button>
    </div>
  ),
}));

import PipelinePrevisions from '../src/components/pipeline/PipelinePrevisions';

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(onOuvrirDeal = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <PipelinePrevisions
          pipelines={[{ id: 'p1', name: 'Principal', is_default: true }] as any}
          pipelineActif="p1"
          onOuvrirDeal={onOuvrirDeal}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return onOuvrirDeal;
}

function onglet(libelle: string): HTMLButtonElement | undefined {
  return [...conteneur.querySelectorAll('button[role="tab"]')]
    .find((b) => b.textContent?.trim() === libelle) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('Prévisions absorbe l historique', () => {
  it('propose les trois vues', async () => {
    await rendre();
    const vues = [...conteneur.querySelectorAll('button[role="tab"]')].map((b) => b.textContent?.trim());
    expect(vues).toEqual(['Sommaire', 'Chronologie', 'Historique']);
  });

  it('ouvre sur le sommaire, pas sur l historique', async () => {
    await rendre();
    expect(conteneur.querySelector('[data-testid="historique"]')).toBeNull();
    expect(onglet('Sommaire')?.getAttribute('aria-selected')).toBe('true');
  });

  it('l onglet Historique affiche les statistiques', async () => {
    await rendre();
    await act(async () => { onglet('Historique')?.click(); });
    expect(conteneur.querySelector('[data-testid="historique"]')).not.toBeNull();
    expect(onglet('Historique')?.getAttribute('aria-selected')).toBe('true');
  });

  it('cliquer un deal depuis l historique remonte au parent', async () => {
    // Sans ça, « À traiter » deviendrait une liste morte.
    const onOuvrir = await rendre();
    await act(async () => { onglet('Historique')?.click(); });
    const b = [...conteneur.querySelectorAll('button')]
      .find((x) => x.textContent === 'ouvrir un deal');
    await act(async () => { b?.click(); });
    expect(onOuvrir).toHaveBeenCalledWith('deal-42');
  });

  it('revenir au sommaire referme l historique', async () => {
    await rendre();
    await act(async () => { onglet('Historique')?.click(); });
    await act(async () => { onglet('Sommaire')?.click(); });
    expect(conteneur.querySelector('[data-testid="historique"]')).toBeNull();
  });
});
