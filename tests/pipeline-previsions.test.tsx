// @vitest-environment jsdom
//
// L'écran de prévisions.
//
// Ce que ces tests protègent, c'est une décision de conception : le revenu
// attendu ne compte QUE les étapes qui portent une probabilité. Une étape
// non renseignée est absente du calcul, jamais comptée à zéro — sinon un
// pipeline non configuré afficherait « 0 $ attendu » avec des deals bien
// vivants, et le patron conclurait que le mois est mort.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const previsionsMock = vi.fn(async () => null as any);
const risqueMock = vi.fn(async () => [] as any[]);
const chronoMock = vi.fn(async () => [] as any[]);

vi.mock('../src/lib/pipelineVentesApi', () => ({
  fetchPrevisions: (...a: any[]) => previsionsMock(...(a as [])),
  fetchARisque: (...a: any[]) => risqueMock(...(a as [])),
  fetchChronologie: (...a: any[]) => chronoMock(...(a as [])),
}));

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));

import PipelinePrevisions from '../src/components/pipeline/PipelinePrevisions';

const PIPELINES = [
  { id: 'p1', name: 'Pipeline de ventes', is_default: true },
  { id: 'p2', name: 'Contrats saisonniers', is_default: false },
];

const PREVISIONS = {
  max_potentiel_cents: 393400,
  attendu_cents: 157360,
  gagne_cents: 155400,
  ouverts: 4,
  sans_date: 2,
  sans_montant: 1,
  en_retard: 0,
};

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(actif: string | null = 'p1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={client}>
        <PipelinePrevisions pipelines={PIPELINES} pipelineActif={actif} />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function boutonNomme(motif: RegExp): HTMLButtonElement | undefined {
  return [...conteneur.querySelectorAll('button')]
    .find((b) => motif.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  previsionsMock.mockClear().mockResolvedValue(PREVISIONS);
  risqueMock.mockClear().mockResolvedValue([
    { niveau: 'haut', deals: 1, montant_cents: 100000 },
    { niveau: 'moyen', deals: 2, montant_cents: 50000 },
    { niveau: 'faible', deals: 0, montant_cents: 0 },
  ]);
  chronoMock.mockClear().mockResolvedValue([]);
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('prévisions — sommaire', () => {
  it('affiche les quatre chiffres du haut', async () => {
    await rendre();
    const t = conteneur.textContent ?? '';
    expect(t).toContain('Revenu potentiel maximum');
    expect(t).toContain('Revenu attendu');
    expect(t).toContain('Revenu gagné');
    expect(t).toContain('Deals ouverts');
  });

  it('dit que le revenu attendu dépend des probabilités saisies', async () => {
    await rendre();
    // Un chiffre pondéré présenté sans sa méthode se prend pour une
    // certitude ; celui-ci dépend de pourcentages écrits à la main.
    expect(conteneur.textContent).toContain('probabilité');
  });

  it("montre les trous de données plutôt que de les taire", async () => {
    await rendre();
    const t = conteneur.textContent ?? '';
    expect(t).toContain('Sans date de fermeture');
    expect(t).toContain('Sans montant');
    expect(t).toContain('En retard');
  });

  it('classe les deals à risque en trois niveaux', async () => {
    await rendre();
    const t = conteneur.textContent ?? '';
    expect(t).toContain('Risque élevé');
    expect(t).toContain('Risque moyen');
    expect(t).toContain('Risque faible');
  });

  it('redemande les chiffres quand on change les seuils', async () => {
    await rendre();
    const bouton = boutonNomme(/Ajuster les seuils/);
    expect(bouton).toBeTruthy();
    await act(async () => { bouton!.click(); });

    const champ = [...conteneur.querySelectorAll('input[type="number"]')][0] as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const avant = risqueMock.mock.calls.length;
    await act(async () => {
      setter?.call(champ, '3');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // Un seuil qu'on change sans relire les données ne sert à rien.
    expect(risqueMock.mock.calls.length).toBeGreaterThan(avant);
  });

  it('demande TOUS les pipelines quand on choisit « Tous »', async () => {
    await rendre();
    const sel = [...conteneur.querySelectorAll('select')]
      .find((x) => [...x.options].some((o) => o.value === 'p2')) as HTMLSelectElement;
    await act(async () => {
      sel.value = '';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // `null` = toutes les portées confondues, côté base.
    expect(previsionsMock).toHaveBeenCalledWith(null);
  });
});

describe('prévisions — chronologie', () => {
  it("explique quoi faire quand aucun deal n'a de date", async () => {
    await rendre();
    await act(async () => { boutonNomme(/Chronologie/)!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    // Un écran vide sans explication laisse croire à une panne.
    expect(conteneur.textContent).toContain('Aucun deal avec une date');
  });

  it('range les deals par mois, et montre la part déjà gagnée', async () => {
    chronoMock.mockResolvedValue([
      { mois: '2026-09-01', deals: 3, potentiel_cents: 300000, gagne_cents: 150000 },
      { mois: '2026-10-01', deals: 1, potentiel_cents: 90000, gagne_cents: 0 },
    ]);
    await rendre();
    await act(async () => { boutonNomme(/Chronologie/)!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const t = conteneur.textContent ?? '';
    expect(t).toContain('septembre 2026');
    expect(t).toContain('octobre 2026');
    expect(t).toContain('50 % déjà gagné');
    // Les deals SANS date apparaissent à part : les cacher reviendrait à
    // sous-estimer le mois sans le dire.
    expect(t).toContain('Sans date');
  });
});
