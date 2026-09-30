// @vitest-environment jsdom
//
// Colonnes repliables, comme GoHighLevel (2026-09-30) : « Replier » réduit une
// colonne à une bande (nom + compte), le choix est retenu par pipeline dans
// le navigateur, « Déplier » la rouvre.
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
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau lead', name_en: 'New lead', guidance_fr: '', guidance_en: '', position: 1, kind: 'open', probability: 20, show_in_reports: true, archived_at: null },
  { id: 'e2', pipeline_id: 'p1', name_fr: 'Contacté', name_en: 'Contacted', guidance_fr: '', guidance_en: '', position: 2, kind: 'open', probability: 40, show_in_reports: true, archived_at: null },
] as any[];
const DEALS = [
  { id: 'd1', org_id: 'o', pipeline_id: 'p1', stage_id: 'e2', client_id: 'c1', title: null, source: 'manual', statut: 'ouvert', assigned_user_id: null, quote_id: null, job_id: null,
    created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(), stage_entered_at: new Date().toISOString(),
    client: { id: 'c1', first_name: 'Julie', last_name: 'Test', email: null, phone: null, address: null, company: null } },
] as any[];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PipelineBoard deals={DEALS} etapes={ETAPES} montants={{}} membres={[]} pipelines={[{ id: 'p1', name: 'Pipeline de ventes', is_default: true }]}
            pipelineActif="p1" onChangerPipeline={vi.fn()} onOuvrir={vi.fn()} onDeplacer={vi.fn()} onAssigner={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

const bouton = (re: RegExp) => [...conteneur.querySelectorAll('button')].find((b) => re.test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement | undefined;

beforeEach(() => {
  localStorage.clear();
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

describe('colonnes repliables', () => {
  it('replier réduit la colonne à une bande, sans ses cartes, et le retient', async () => {
    await rendre();
    expect(conteneur.textContent).toContain('Julie Test');
    await act(async () => { bouton(/Replier la colonne « Contacté »/)!.click(); });
    expect(bouton(/Déplier la colonne « Contacté »/)).toBeTruthy();
    expect(conteneur.textContent).not.toContain('Julie Test');
    expect(JSON.parse(localStorage.getItem('lume.pipeline.repliees.p1') ?? '[]')).toEqual(['e2']);
  });

  it('le repli survit à un rechargement, et « Déplier » rouvre la colonne', async () => {
    localStorage.setItem('lume.pipeline.repliees.p1', JSON.stringify(['e2']));
    await rendre();
    expect(bouton(/Déplier la colonne « Contacté »/)).toBeTruthy();
    await act(async () => { bouton(/Déplier la colonne « Contacté »/)!.click(); });
    expect(conteneur.textContent).toContain('Julie Test');
    expect(JSON.parse(localStorage.getItem('lume.pipeline.repliees.p1') ?? '[]')).toEqual([]);
  });
});
