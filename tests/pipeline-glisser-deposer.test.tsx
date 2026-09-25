// @vitest-environment jsdom
//
// Le glisser-déposer du board — sa LOGIQUE, testable sans souris.
//
// Le QA n'a pas pu le tester : `@dnd-kit` exige 4 px de mouvement réel avant
// de déclencher un glissement, et un clic synthétique ne les parcourt
// jamais. On ne peut donc pas simuler le geste — mais on peut vérifier ce
// que le board FAIT quand dnd-kit lui annonce une fin de glissement.
//
// C'est là que vit le comportement : sur quelle étape le deal atterrit, et
// quand on ne fait rien. Si cette logique est juste, un éventuel bug restant
// est dans la prise de la carte, pas dans son traitement.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * On intercepte `DndContext` pour récupérer son `onDragEnd`, puis on
 * l'appelle nous-mêmes avec les événements que dnd-kit produirait. Le reste
 * de la bibliothèque est laissé intact.
 */
let dragEnd: ((e: any) => void) | null = null;

vi.mock('@dnd-kit/core', async () => {
  const reel = await vi.importActual<any>('@dnd-kit/core');
  return {
    ...reel,
    DndContext: ({ children, onDragEnd }: any) => {
      dragEnd = onDragEnd;
      return <div data-dnd>{children}</div>;
    },
  };
});

vi.mock('../src/lib/pipelineVentesApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/pipelineVentesApi');
  return {
    ...reel,
    fetchVues: async () => [],
    creerVue: async () => 'v1',
    supprimerVue: async () => {},
    journaliserLot: async () => {},
  };
});

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import PipelineBoard from '../src/components/pipeline/PipelineBoard';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau', name_en: 'New', guidance_fr: '', guidance_en: '', position: 1, kind: 'open', probability: 20, show_in_reports: true, archived_at: null },
  { id: 'e2', pipeline_id: 'p1', name_fr: 'Contacté', name_en: 'Contacted', guidance_fr: '', guidance_en: '', position: 2, kind: 'open', probability: 50, show_in_reports: true, archived_at: null },
  { id: 'ew', pipeline_id: 'p1', name_fr: 'Gagné', name_en: 'Won', guidance_fr: '', guidance_en: '', position: 3, kind: 'won', probability: 100, show_in_reports: true, archived_at: null },
] as any[];

function deal(id: string, stage: string) {
  return {
    id, pipeline_id: 'p1', stage_id: stage, client_id: `c-${id}`,
    assigned_user_id: null, source: 'manual',
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
    job_id: null, quote_id: null, first_contacted_at: null,
    last_activity_at: new Date().toISOString(), stage_entered_at: new Date().toISOString(),
    won_at: null, lost_at: null, lost_reason: null, lost_from_stage_id: null,
    expected_close_date: null, pin_id: null, field_rep_id: null,
    created_at: new Date().toISOString(),
    client: { first_name: 'A', last_name: id, company: null, email: `${id}@t.ca`, phone: '418', address: '1 rue' },
  } as any;
}

const DEALS = [deal('d1', 'e1'), deal('d2', 'e2')];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre() {
  const onDeplacer = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PipelineBoard
            deals={DEALS}
            etapes={ETAPES}
            montants={{}}
            membres={[]}
            pipelines={[{ id: 'p1', name: 'Principal', is_default: true }]}
            pipelineActif="p1"
            onChangerPipeline={vi.fn()}
            onOuvrir={vi.fn()}
            onDeplacer={onDeplacer}
            onAssigner={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return { onDeplacer };
}

/** La fin de glissement telle que dnd-kit la produit. */
async function deposer(dealId: string, surId: string | null) {
  await act(async () => {
    dragEnd?.({ active: { id: dealId }, over: surId ? { id: surId } : null });
  });
}

beforeEach(() => {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  dragEnd = null;
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('glisser-déposer — ce que le board fait du geste', () => {
  it('le board installe bien un gestionnaire de dépôt', async () => {
    await rendre();
    expect(typeof dragEnd).toBe('function');
  });

  it('déposer sur une colonne déplace le deal', async () => {
    const { onDeplacer } = await rendre();
    await deposer('d1', 'e2');
    expect(onDeplacer).toHaveBeenCalledWith('d1', 'e2');
  });

  it('déposer sur une CARTE vise l étape de cette carte', async () => {
    // On lâche rarement sur le vide d'une colonne : le plus souvent on
    // vise une carte existante, et l'étape doit s'en déduire.
    const { onDeplacer } = await rendre();
    await deposer('d1', 'd2');
    expect(onDeplacer).toHaveBeenCalledWith('d1', 'e2');
  });

  it('relâcher hors de toute colonne ne fait rien', async () => {
    const { onDeplacer } = await rendre();
    await deposer('d1', null);
    expect(onDeplacer).not.toHaveBeenCalled();
  });

  it('reposer une carte sur sa propre colonne ne fait rien', async () => {
    // Sinon chaque reprise de carte écrirait en base pour rien, et
    // l'historique se remplirait de mouvements fantômes.
    const { onDeplacer } = await rendre();
    await deposer('d1', 'e1');
    expect(onDeplacer).not.toHaveBeenCalled();
  });

  it('un deal inconnu est ignoré', async () => {
    const { onDeplacer } = await rendre();
    await deposer('fantome', 'e2');
    expect(onDeplacer).not.toHaveBeenCalled();
  });

  it('déposer vers « Gagné » passe par le même chemin', async () => {
    // Le parent ouvre alors la création de job : le board ne court-circuite
    // pas le comportement par type d'étape.
    const { onDeplacer } = await rendre();
    await deposer('d1', 'ew');
    expect(onDeplacer).toHaveBeenCalledWith('d1', 'ew');
  });
});
