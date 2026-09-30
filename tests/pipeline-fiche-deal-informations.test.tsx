// @vitest-environment jsdom
//
// Les champs du deal DÈS l'ouverture de la fiche (étape 4 du plan).
//
// La fiche s'ouvre sur l'onglet « Client » : les champs du métier vivaient
// seulement dans le 2e onglet, qu'on n'ouvrait pas. Et quelqu'un sans le
// droit de modifier les deals voyait des cases modifiables qui refusaient
// ensuite d'enregistrer (la RLS exige « leads.update »).
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const lireValeursMock = vi.fn(async (..._a: any[]) => ({ fields: [], folders: [], values: {} }) as any);
let permissions: { role: string | null; permissions: Record<string, boolean> | null } = { role: 'owner', permissions: {} };

vi.mock('../src/lib/pipelineVentesApi', () => ({
  fetchRaisonsProposees: async () => [],
  fetchElementsLies: vi.fn(async () => ({ job: null, devis: null, paiements: [], porte: null })),
  fetchDossierClient: vi.fn(async () => ({ jobs: [], devis: [], factures: [], transactions: [], messages: [], paye_cents: 0, du_cents: 0 })),
  fetchRendezVousClient: vi.fn(async () => []),
  fetchHistorique: vi.fn(async () => []),
  fetchRelances: vi.fn(async () => []),
  fetchTachesDuDeal: vi.fn(async () => []),
  estJobACreer: () => false,
  nomClient: (d: any) => `${d.client?.first_name ?? ''} ${d.client?.last_name ?? ''}`.trim() || 'Client',
}));
vi.mock('../src/lib/champsPersoApi', () => ({
  lireValeurs: (...a: any[]) => lireValeursMock(...a),
  ecrireValeurs: vi.fn(async () => []),
  listerChamps: vi.fn(async () => ({ fields: [], folders: [] })),
}));
vi.mock('../src/hooks/usePermissions', () => ({ usePermissions: () => permissions }));
vi.mock('../src/components/SpecificNotes', () => ({ default: () => null }));
vi.mock('../src/components/ActivityTimeline', () => ({ default: () => null }));
vi.mock('../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));

import DealDrawer from '../src/components/pipeline/DealDrawer';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau lead', name_en: 'New lead', guidance_fr: '', guidance_en: '', position: 1, kind: 'open' as const, probability: null, show_in_reports: true, show_in_pie: true, archived_at: null },
];
const t = new Date().toISOString();
const DEAL = {
  id: 'd1', pipeline_id: 'p1', stage_id: 'e1', client_id: 'c1', assigned_user_id: null, source: 'manual',
  utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
  job_id: null, quote_id: null, first_contacted_at: null, last_activity_at: t, stage_entered_at: t,
  won_at: null, lost_at: null, lost_reason: null, lost_from_stage_id: null, expected_close_date: null,
  pin_id: null, field_rep_id: null, created_at: t,
  client: { first_name: 'Jean', last_name: 'Tremblay', company: null, email: null, phone: null, address: null },
} as any;

const SUPERFICIE = {
  id: 'col1', object_type: 'deal', folder_id: null, key: 'superficie', label: 'Superficie', placeholder: null, help_text: null,
  field_type: 'number', config: {}, is_required: false, is_searchable: false, is_unique: false, position: 0,
  created_at: 'x', updated_at: 'x', archived_at: null, options: [],
};

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <DealDrawer deal={DEAL} etapes={ETAPES} membres={[]} montantCents={null} montantProvenance="aucun"
            onClose={vi.fn()} onAssigner={vi.fn()} onCreerJob={vi.fn()} onChangement={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const champSuperficie = () => conteneur.querySelector('input[inputmode="decimal"]') as HTMLInputElement | null;

beforeEach(() => {
  permissions = { role: 'owner', permissions: {} };
  lireValeursMock.mockReset().mockResolvedValue({
    fields: [SUPERFICIE], folders: [], values: { col1: { field_id: 'col1', value: 2400, version: 3, updated_at: 'x' } },
  });
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('fiche du deal — section « Informations » dans l’onglet qui s’ouvre', () => {
  it('montre les champs du deal sans changer d’onglet', async () => {
    await rendre();
    const actif = conteneur.querySelector('[role="tab"][aria-selected="true"]');
    // L'onglet qui s'ouvre est « Détails du deal » (Rafba, 2026-09-29) ; les champs y sont.
    expect(actif?.textContent?.trim()).toBe('Détails du deal');
    expect(conteneur.querySelector('[data-section-informations]'), 'section « Informations » absente').toBeTruthy();
    expect(champSuperficie()?.value).toBe('2400');
    expect(champSuperficie()?.disabled).toBe(false);
  });

  it('se replie et se déplie', async () => {
    await rendre();
    const b = [...conteneur.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'Informations') as HTMLButtonElement;
    expect(b.getAttribute('aria-expanded')).toBe('true');
    await act(async () => { b.click(); });
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(champSuperficie()).toBeNull();
  });

  it('n’apparaît pas tant qu’aucun champ n’est défini', async () => {
    lireValeursMock.mockResolvedValue({ fields: [], folders: [], values: {} });
    await rendre();
    expect(conteneur.querySelector('[data-section-informations]')).toBeNull();
  });

  it('en lecture seule sans le droit « leads.update » (onglet Client ET onglet Deal)', async () => {
    permissions = { role: 'technician', permissions: { 'leads.read': true } };
    await rendre();
    expect(champSuperficie()?.disabled).toBe(true);
    expect(conteneur.textContent).toContain('Lecture seule');
    const ongletDeal = [...conteneur.querySelectorAll('[role="tab"]')].find((x) => x.textContent?.trim() === 'Deal') as HTMLButtonElement;
    await act(async () => { ongletDeal.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(champSuperficie()?.disabled).toBe(true);
  });

  it('modifiable avec « leads.update »', async () => {
    permissions = { role: 'sales_rep', permissions: { 'leads.read': true, 'leads.update': true } };
    await rendre();
    expect(champSuperficie()?.disabled).toBe(false);
  });
});
