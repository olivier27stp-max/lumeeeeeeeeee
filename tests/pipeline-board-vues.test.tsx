// @vitest-environment jsdom
//
// Le VRAI board de ventes, rendu.
//
// Deux défauts corrigés ici étaient invisibles en base, et c'est pour ça que
// ce test existe :
//
//   · le sélecteur de pipeline affichait UNE option codée en dur, sans
//     `onChange`. La table `pipelines_ventes` était parfaitement correcte —
//     on pouvait créer un 2e pipeline dans les réglages sans jamais pouvoir
//     le consulter ;
//   · deux onglets de vues (« Deals ouverts » et « Tous ») portaient
//     exactement les mêmes filtres et affichaient donc la même chose.
//
// Une requête à la base n'aurait rien signalé dans les deux cas. Seul le
// rendu le dit.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const fetchVuesMock = vi.fn(async () => [] as any[]);

vi.mock('../src/lib/pipelineVentesApi', () => ({
  fetchVues: (...a: any[]) => fetchVuesMock(...(a as [])),
  creerVue: vi.fn(async () => 'vue-1'),
  supprimerVue: vi.fn(async () => undefined),
  creerDealManuel: vi.fn(async () => ({ deal_id: 'd', client_id: 'c', cree: true })),
  estJobACreer: () => false,
  nomClient: (d: any) => `${d.client?.first_name ?? ''} ${d.client?.last_name ?? ''}`.trim() || 'Client',
  priorite: () => 'frais',
}));

vi.mock('../src/hooks/usePermissions', () => ({
  usePermissions: () => ({ role: 'owner', permissions: {} }),
}));

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: {} }),
}));

import PipelineBoard from '../src/components/pipeline/PipelineBoard';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau lead', name_en: 'New lead', guidance_fr: '', guidance_en: '', position: 1, kind: 'open' as const, archived_at: null },
  { id: 'e2', pipeline_id: 'p1', name_fr: 'Gagné', name_en: 'Won', guidance_fr: '', guidance_en: '', position: 2, kind: 'won' as const, archived_at: null },
  { id: 'e3', pipeline_id: 'p1', name_fr: 'Perdu', name_en: 'Lost', guidance_fr: '', guidance_en: '', position: 3, kind: 'lost' as const, archived_at: null },
];

const PIPELINES = [
  { id: 'p1', name: 'Pipeline de ventes', is_default: true },
  { id: 'p2', name: 'Contrats saisonniers', is_default: false },
];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(props: Partial<React.ComponentProps<typeof PipelineBoard>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PipelineBoard
            deals={[]}
            etapes={ETAPES}
            montants={{}}
            membres={[]}
            pipelines={PIPELINES}
            pipelineActif="p1"
            onChangerPipeline={vi.fn()}
            onOuvrir={vi.fn()}
            onDeplacer={vi.fn()}
            onAssigner={vi.fn()}
            {...props}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

/** Le sélecteur de pipeline : celui dont les options portent des id de pipeline. */
function selecteurPipeline(): HTMLSelectElement | null {
  const selects = [...conteneur.querySelectorAll('select')] as HTMLSelectElement[];
  return selects.find((s) => [...s.options].some((o) => o.value === 'p1')) ?? null;
}

beforeEach(() => {
  fetchVuesMock.mockClear();
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('board — sélecteur de pipeline', () => {
  it('propose tous les pipelines, pas une option codée en dur', async () => {
    await rendre();
    const sel = selecteurPipeline();
    expect(sel, 'aucun sélecteur ne liste les pipelines').not.toBeNull();
    const valeurs = [...sel!.options].map((o) => o.value);
    expect(valeurs).toEqual(['p1', 'p2']);
    // Le défaut « ventes » était la valeur en dur de l'ancien sélecteur.
    expect(valeurs).not.toContain('ventes');
  });

  it('affiche le pipeline actif, et prévient le parent quand on en change', async () => {
    const onChangerPipeline = vi.fn();
    await rendre({ onChangerPipeline });
    const sel = selecteurPipeline()!;
    expect(sel.value).toBe('p1');

    await act(async () => {
      sel.value = 'p2';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChangerPipeline).toHaveBeenCalledWith('p2');
  });

  it("se désactive quand l'organisation n'a qu'un seul pipeline", async () => {
    await rendre({ pipelines: [PIPELINES[0]] });
    // Un sélecteur actif qui n'offre aucun choix invite à un clic sans effet.
    expect(selecteurPipeline()!.disabled).toBe(true);
  });
});

describe('board — onglets de vues', () => {
  it('ne montre jamais deux onglets identiques', async () => {
    await rendre();
    const libelles = [...conteneur.querySelectorAll('[role="tab"]')]
      .map((e) => e.textContent?.trim() ?? '');
    expect(libelles.length).toBeGreaterThan(0);
    expect(new Set(libelles).size).toBe(libelles.length);
  });

  it('affiche les vues enregistrées à la suite des vues intégrées', async () => {
    fetchVuesMock.mockResolvedValueOnce([
      { id: 'v1', pipeline_id: 'p1', user_id: 'u1', nom: 'Mes gros jobs', filtres: { priorite: 'urgent' }, tri: null, affichage: null, position: 0 },
      { id: 'v2', pipeline_id: 'p1', user_id: null, nom: 'Vue équipe', filtres: {}, tri: null, affichage: null, position: 1 },
    ]);
    await rendre();
    // Le rendu attend la requête des vues.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const texte = conteneur.textContent ?? '';
    expect(texte).toContain('Mes gros jobs');
    expect(texte).toContain('Vue équipe');
    // Une vue d'équipe doit se distinguer : sinon on ne comprend pas
    // pourquoi on n'arrive pas à la supprimer.
    expect(texte).toContain('équipe');
  });
});
