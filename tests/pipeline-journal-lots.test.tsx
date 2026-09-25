// @vitest-environment jsdom
//
// L'onglet « Actions en lot », quand il est vide.
//
// Ce que ces tests protègent : un écran qui se contente de dire « rien »
// laisse croire que la page est cassée. Celui-ci doit expliquer À QUOI il
// sert et COMMENT produire une entrée — c'est la seule chose utile à
// montrer quand il n'y a rien à lister.
//
// Et les filtres ne doivent pas s'afficher au-dessus du vide : cinq champs
// sans résultat donnent l'impression qu'on a mal cherché.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const journalMock = vi.fn(async (..._a: any[]) => [] as any[]);

vi.mock('../src/lib/pipelineVentesApi', () => ({
  fetchJournalLots: (...a: any[]) => journalMock(...(a as [])),
  restaurerLot: vi.fn(async () => 0),
}));

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true) }));

import PipelineJournalLots from '../src/components/pipeline/PipelineJournalLots';

const LOT = {
  id: 'l-1',
  libelle: 'Import — clients.csv',
  operation: 'import',
  statut: 'termine',
  total: 12,
  reussis: 12,
  echoues: 0,
  erreurs: [],
  user_nom: 'Marie Tremblay',
  restaure_le: null,
  created_at: new Date().toISOString(),
};

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <PipelineJournalLots />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  vi.clearAllMocks();
  journalMock.mockResolvedValue([]);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('journal vide — il doit expliquer, pas constater', () => {
  it('dit comment produire une action en lot', async () => {
    await rendre();
    const txt = conteneur.textContent ?? '';
    // Le geste concret, pas une promesse vague.
    expect(txt).toMatch(/coche plusieurs deals/i);
    expect(txt).toMatch(/assigner ou les déplacer/i);
  });

  it('dit à quoi sert le journal', async () => {
    // La vraie raison d'être : rendre une suppression de masse réversible.
    await rendre();
    expect(conteneur.textContent).toMatch(/réversible/i);
  });

  it('mentionne les imports CSV', async () => {
    await rendre();
    expect(conteneur.textContent).toMatch(/imports CSV/i);
  });

  it('ne montre pas les filtres quand il n y a rien', async () => {
    // Cinq champs au-dessus du vide donnent l'impression d'avoir mal cherché.
    await rendre();
    expect(conteneur.querySelectorAll('input[type="date"]')).toHaveLength(0);
    expect(conteneur.querySelectorAll('select')).toHaveLength(0);
  });
});

describe('journal rempli', () => {
  it('montre les filtres et la ligne', async () => {
    journalMock.mockResolvedValue([LOT]);
    await rendre();
    expect(conteneur.textContent).toContain('Import — clients.csv');
    // Les filtres reviennent dès qu'il y a matière à filtrer.
    expect(conteneur.querySelectorAll('input[type="date"]').length).toBeGreaterThan(0);
  });

  it('n affiche plus le mode d emploi', async () => {
    journalMock.mockResolvedValue([LOT]);
    await rendre();
    expect(conteneur.textContent).not.toMatch(/coche plusieurs deals/i);
  });
});
