// @vitest-environment jsdom
//
// La répartition des prévisions (« Group by » de GHL).
//
// Ce que ces tests protègent : le total du tableau doit retomber sur les
// tuiles du haut. Deux chiffres différents pour la même chose, et on ne croit
// plus ni l'un ni l'autre — c'est le genre d'écart qui fait abandonner un
// écran de statistiques.
//
// Et le changement d'axe doit vraiment REQUÊTER : un sélecteur qui ne
// change que l'étiquette de la colonne serait décoratif.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PREVISIONS = {
  max_potentiel_cents: 300000,
  attendu_cents: 120000,
  gagne_cents: 50000,
  ouverts: 4,
  sans_date: 1,
  sans_montant: 0,
  en_retard: 0,
};

/** Les trois lignes somment exactement aux totaux ci-dessus. */
const PAR_ETAPE = [
  { cle: 's1', libelle: 'Nouveau lead', nb: 2, potentiel_cents: 100000, attendu_cents: 20000, gagne_cents: 0, total_cents: 100000 },
  { cle: 's2', libelle: 'Soumission', nb: 2, potentiel_cents: 200000, attendu_cents: 100000, gagne_cents: 0, total_cents: 200000 },
  { cle: 's3', libelle: 'Gagné', nb: 0, potentiel_cents: 0, attendu_cents: 0, gagne_cents: 50000, total_cents: 50000 },
];

const PAR_VENDEUR = [
  { cle: 'u1', libelle: 'Marie Tremblay', nb: 3, potentiel_cents: 250000, attendu_cents: 110000, gagne_cents: 50000, total_cents: 300000 },
  { cle: 'u2', libelle: '(non assigné)', nb: 1, potentiel_cents: 50000, attendu_cents: 10000, gagne_cents: 0, total_cents: 50000 },
];

const groupeesMock = vi.fn(async (_p: unknown, axe: string) =>
  (axe === 'vendeur' ? PAR_VENDEUR : PAR_ETAPE));

vi.mock('../src/lib/pipelineVentesApi', () => ({
  fetchPrevisions: async () => PREVISIONS,
  fetchARisque: async () => [],
  fetchChronologie: async () => [],
  fetchPrevisionsGroupees: (...a: any[]) => groupeesMock(a[0], a[1] as string),
}));

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));

import PipelinePrevisions from '../src/components/pipeline/PipelinePrevisions';

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <PipelinePrevisions
          pipelines={[{ id: 'p-1', name: 'Résidentiel', is_default: true }] as any}
          pipelineActif="p-1"
        />
      </QueryClientProvider>,
    );
  });
  // Les requêtes se résolvent APRÈS le premier rendu : sans ce deuxième
  // passage, l'écran est encore sur « Chargement… » et le test lirait un
  // tableau vide en croyant qu'il n'existe pas.
  await vider();
}

/** Laisse les promesses en attente se résoudre, puis React re-rendre. */
async function vider() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Le texte d'une ligne du tableau de répartition, par son libellé. */
function ligne(libelle: string): string {
  const tr = [...conteneur.querySelectorAll('tbody tr')]
    .find((r) => r.textContent?.includes(libelle));
  return tr?.textContent ?? '';
}

function piedDuTableau(): string {
  return conteneur.querySelector('tfoot')?.textContent ?? '';
}

/**
 * Les montants du pied, cellule par cellule.
 *
 * Lire le texte entier puis y chercher des nombres colle le compteur de
 * deals (« 4 ») au montant qui suit (« 3 000,00 $ ») et donne 4 300 000.
 * Chaque cellule est donc lue séparément.
 */
function montantsDuPied(): number[] {
  const cells = [...(conteneur.querySelectorAll('tfoot td') ?? [])].map((c) => c.textContent ?? '');
  return cells
    .map((t) => {
      const m = t.match(/([\d   ]+,\d{2})/);
      if (!m) return null;
      return Math.round(parseFloat(m[1].replace(/[   ]/g, '').replace(',', '.')) * 100);
    })
    .filter((n): n is number => n !== null);
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

describe('répartition', () => {
  it('groupe par étape au départ', async () => {
    await rendre();
    expect(groupeesMock).toHaveBeenCalledWith('p-1', 'etape');
    expect(ligne('Nouveau lead')).toContain('Nouveau lead');
    expect(ligne('Soumission')).toContain('Soumission');
  });

  it('affiche les cinq colonnes de GHL', async () => {
    await rendre();
    const entetes = [...conteneur.querySelectorAll('thead th')].map((e) => e.textContent?.trim());
    expect(entetes).toContain('Étape');
    expect(entetes).toContain('Deals');
    expect(entetes).toContain('Potentiel max');
    expect(entetes).toContain('Attendu');
    expect(entetes).toContain('Gagné');
    expect(entetes).toContain('Potentiel total');
  });

  it('le total du tableau retombe sur les tuiles du haut', async () => {
    await rendre();
    const pied = montantsDuPied();
    // potentiel, attendu, gagné, total — dans l'ordre des colonnes.
    expect(pied).toEqual([
      PREVISIONS.max_potentiel_cents,
      PREVISIONS.attendu_cents,
      PREVISIONS.gagne_cents,
      PREVISIONS.max_potentiel_cents + PREVISIONS.gagne_cents,
    ]);
  });

  it('le nombre de deals du pied égale la somme des lignes', async () => {
    await rendre();
    const attendu = PAR_ETAPE.reduce((n, g) => n + g.nb, 0);
    expect(piedDuTableau()).toContain(String(attendu));
  });

  it('changer d\'axe relance une vraie requête', async () => {
    await rendre();
    const select = conteneur.querySelector<HTMLSelectElement>('select#\\:r1\\:, select')!;
    // Le sélecteur « Regrouper par » est celui dont les options sont les axes.
    const axes = [...conteneur.querySelectorAll('select')]
      .find((s) => [...s.options].some((o) => o.value === 'vendeur'))!;
    expect(axes).toBeTruthy();
    void select;

    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(axes, 'vendeur');
      axes.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vider();

    expect(groupeesMock).toHaveBeenCalledWith('p-1', 'vendeur');
    expect(ligne('Marie Tremblay')).toContain('Marie Tremblay');
  });

  it('l\'en-tête de la première colonne suit l\'axe choisi', async () => {
    await rendre();
    const axes = [...conteneur.querySelectorAll('select')]
      .find((s) => [...s.options].some((o) => o.value === 'vendeur'))!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(axes, 'vendeur');
      axes.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vider();
    const entetes = [...conteneur.querySelectorAll('thead th')].map((e) => e.textContent?.trim());
    expect(entetes).toContain('Responsable');
    expect(entetes).not.toContain('Étape');
  });

  it('une barre par ligne, à une échelle commune', async () => {
    await rendre();
    // La plus grosse ligne (200 000) doit être la plus large, et la barre
    // d'une ligne à 100 000 doit faire la moitié de l'échelle (max 200 000).
    const barres = conteneur.querySelectorAll('[aria-hidden="true"] > div > div');
    expect(barres.length).toBeGreaterThan(0);
    const largeurs = [...barres].map((b) => (b as HTMLElement).style.width);
    expect(largeurs).toContain('100%');
    expect(largeurs).toContain('50%');
  });
});
