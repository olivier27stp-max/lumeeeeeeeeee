// @vitest-environment jsdom
//
// P0-1 — choisir « Gagné » dans la fiche doit DÉPLACER le deal.
//
// Le bug : `onCreerJob(deal)` partait sans l'étape visée. Le parent ne
// savait donc pas où aller, la job se créait, le message disait « Job créée
// et liée au deal » — et la carte restait exactement où elle était.
//
// Ce test vérifie le contrat entre la fiche et la page : l'étape voyage.
// Sans elle, aucun déplacement n'est possible en aval, quoi que fasse le
// parent.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('../src/lib/pipelineVentesApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/pipelineVentesApi');
  return {
    ...reel,
    fetchHistorique: async () => [],
    fetchRelances: async () => [],
    fetchTachesDuDeal: async () => [],
    fetchDossierClient: async () => ({
      jobs: [], devis: [], factures: [], transactions: [], proprietes: [],
      messages: [], paye_cents: 0, du_cents: 0,
    }),
    fetchRendezVousClient: async () => [],
  };
});

import DealDrawer from '../src/components/pipeline/DealDrawer';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau', name_en: 'New', guidance_fr: '', guidance_en: '', position: 1, kind: 'open', probability: 20, show_in_reports: true, archived_at: null },
  { id: 'e2', pipeline_id: 'p1', name_fr: 'Contacté', name_en: 'Contacted', guidance_fr: '', guidance_en: '', position: 2, kind: 'open', probability: 50, show_in_reports: true, archived_at: null },
  { id: 'ew', pipeline_id: 'p1', name_fr: 'Gagné', name_en: 'Won', guidance_fr: '', guidance_en: '', position: 3, kind: 'won', probability: 100, show_in_reports: true, archived_at: null },
  { id: 'el', pipeline_id: 'p1', name_fr: 'Perdu', name_en: 'Lost', guidance_fr: '', guidance_en: '', position: 4, kind: 'lost', probability: 0, show_in_reports: true, archived_at: null },
] as any[];

const DEAL = {
  id: 'd-1', pipeline_id: 'p1', stage_id: 'e1', client_id: 'c-1',
  assigned_user_id: null, source: 'manual',
  utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
  job_id: null, quote_id: null, first_contacted_at: null,
  last_activity_at: new Date().toISOString(), stage_entered_at: new Date().toISOString(),
  won_at: null, lost_at: null, lost_reason: null, lost_from_stage_id: null,
  expected_close_date: null, pin_id: null, field_rep_id: null,
  created_at: new Date().toISOString(),
  client: { first_name: 'Alice', last_name: 'Alpha', company: null, email: 'a@a.ca', phone: '4180000001', address: '1 rue A' },
} as any;

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(over: Record<string, unknown> = {}) {
  const props = {
    deal: DEAL,
    etapes: ETAPES,
    membres: [],
    montantCents: 150000,
    montantProvenance: 'devis',
    onClose: vi.fn(),
    onAssigner: vi.fn(),
    onCreerJob: vi.fn(),
    ...over,
  };
  // La fiche interroge la base par `useQuery` : sans fournisseur, elle lève
  // avant d'avoir rendu quoi que ce soit.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <DealDrawer {...(props as any)} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await ouvrirOngletDeal();
  return props;
}

/** Ouvre l'onglet « Deal », où vit le sélecteur d'étape. */
async function ouvrirOngletDeal() {
  const b = [...conteneur.querySelectorAll('button')]
    .find((x) => (x.textContent || '').trim() === 'Deal');
  if (b) await act(async () => { b.click(); });
}

/** Le sélecteur d'étape de la fiche. */
function selecteurEtape(): HTMLSelectElement | undefined {
  return [...conteneur.querySelectorAll('select')]
    .find((s) => [...s.options].some((o) => o.value === 'ew')) as HTMLSelectElement | undefined;
}

async function choisir(sel: HTMLSelectElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(sel, valeur);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
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

describe('P0-1 — « Gagné » transmet l étape visée', () => {
  it('le sélecteur d étape est là', async () => {
    await rendre();
    expect(selecteurEtape()).toBeTruthy();
  });

  it('choisir « Gagné » envoie le deal ET l étape au parent', async () => {
    // Sans le 2e argument, le parent ne peut PAS déplacer le deal : c'est
    // exactement ce qui se passait — job créée, carte immobile.
    const props = await rendre();
    await choisir(selecteurEtape()!, 'ew');

    expect(props.onCreerJob).toHaveBeenCalled();
    const [dealRecu, etapeRecue] = (props.onCreerJob as any).mock.calls[0];
    expect(dealRecu.id).toBe('d-1');
    expect(etapeRecue).toBe('ew');
  });

  it('« Perdu » ne passe PAS par la création de job', async () => {
    // Non-régression : perdre demande une raison, pas une job. Le flux
    // « Perdu » avec raison obligatoire est une protection à préserver.
    const props = await rendre();
    await choisir(selecteurEtape()!, 'el');
    expect(props.onCreerJob).not.toHaveBeenCalled();
    // La fenêtre de raison s'ouvre à la place.
    expect(conteneur.textContent).toMatch(/raison|perdu/i);
  });

  it('une étape ouverte ne déclenche aucune création de job', async () => {
    const props = await rendre();
    await choisir(selecteurEtape()!, 'e2');
    expect(props.onCreerJob).not.toHaveBeenCalled();
  });
});
