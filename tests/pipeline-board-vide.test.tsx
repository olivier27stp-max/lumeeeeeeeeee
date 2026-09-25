// @vitest-environment jsdom
//
// Un pipeline vide doit DIRE où sont les deals.
//
// Le board affichait des colonnes vides sans un mot. Rafba a cru ses 25
// deals perdus — ils étaient simplement dans un autre pipeline. Le
// navigateur rouvre toujours le dernier consulté : avoir ouvert un pipeline
// de test une seule fois suffisait à vider le board pour de bon.
//
// L'écran ne doit pas seulement constater le vide, il doit donner la sortie.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/lib/pipelineVentesApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/pipelineVentesApi');
  return {
    ...reel,
    fetchVues: async () => [],
    creerVue: async () => 'v1',
    supprimerVue: async () => {},
    creerDealManuel: async () => ({ dealId: 'd', fusionne: false, dealExistant: false, pipelineId: 'p1' }),
    journaliserLot: async () => {},
  };
});

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import PipelineBoard from '../src/components/pipeline/PipelineBoard';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p-vide', name_fr: 'Nouveau', name_en: 'New', guidance_fr: '', guidance_en: '', position: 1, kind: 'open', probability: 20, show_in_reports: true, archived_at: null },
] as any[];

const PIPELINES = [
  { id: 'p1', name: 'Pipeline de ventes', is_default: true },
  { id: 'p-vide', name: 'xdthdcg', is_default: false },
];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(over: Record<string, unknown> = {}) {
  const onChangerPipeline = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PipelineBoard
            deals={[]}
            etapes={ETAPES}
            montants={{}}
            membres={[]}
            pipelines={PIPELINES}
            pipelineActif="p-vide"
            onChangerPipeline={onChangerPipeline}
            onOuvrir={vi.fn()}
            onDeplacer={vi.fn()}
            onAssigner={vi.fn()}
            {...over}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return { onChangerPipeline };
}

const texte = () => (conteneur.textContent ?? '').replace(/\s+/g, ' ');

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

describe('board vide — il doit donner la sortie', () => {
  it('dit que le pipeline est vide', async () => {
    await rendre();
    expect(texte()).toMatch(/ce pipeline est vide/i);
  });

  it('explique POURQUOI le board a rouvert ici', async () => {
    // Sans ça, on croit que les deals ont disparu.
    await rendre();
    expect(texte()).toMatch(/dernier que tu as consulté/i);
  });

  it('propose les autres pipelines, le défaut en tête', async () => {
    await rendre();
    const boutons = [...conteneur.querySelectorAll('button')]
      .map((b) => (b.textContent ?? '').trim())
      .filter((t) => /^Voir/.test(t));
    expect(boutons.length).toBeGreaterThan(0);
    expect(boutons[0]).toMatch(/Pipeline de ventes/);
    expect(boutons[0]).toMatch(/par défaut/);
  });

  it('cliquer y emmène vraiment', async () => {
    const { onChangerPipeline } = await rendre();
    const b = [...conteneur.querySelectorAll('button')]
      .find((x) => /^Voir/.test((x.textContent ?? '').trim()));
    await act(async () => { b?.click(); });
    expect(onChangerPipeline).toHaveBeenCalledWith('p1');
  });

  it('ne se propose pas lui-même', async () => {
    await rendre();
    const boutons = [...conteneur.querySelectorAll('button')]
      .map((b) => (b.textContent ?? '').trim());
    expect(boutons.some((t) => /^Voir.*xdthdcg/.test(t))).toBe(false);
  });

  it('se tait pendant le chargement', async () => {
    // Un board qui n'a pas fini de charger n'est pas un board vide :
    // annoncer le vide trop tôt ferait clignoter un faux message.
    await rendre({ chargement: true });
    expect(texte()).not.toMatch(/ce pipeline est vide/i);
  });

  it('se tait quand il n y a qu un seul pipeline', async () => {
    // Avec un seul pipeline, « tes deals sont ailleurs » serait faux :
    // il n'y a pas d'ailleurs. C'est une organisation qui démarre.
    await rendre({ pipelines: [PIPELINES[0]], pipelineActif: 'p1' });
    expect(texte()).not.toMatch(/ce pipeline est vide/i);
  });
});
