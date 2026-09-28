// @vitest-environment jsdom
//
// Étape 4 du plan « Étiquettes et champs dans la pipeline » — suite :
//
//   · Réglages d'un pipeline → onglet « Cartes » : les champs affichés sur
//     les cartes de CE pipeline (sans sélecteur de pipeline, 6 au plus) ;
//   · recherche globale : une valeur trouvée dans un champ du DEAL ouvre le
//     deal (/ventes?deal=…), plus la fiche du client.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const majCartesMock = vi.fn(async (..._a: any[]) => undefined);
let cartesActuelles: string[] = [];

vi.mock('../src/lib/pipelineVentesApi', () => ({
  fetchStages: vi.fn(async () => []),
  fetchDeals: vi.fn(async () => []),
  fetchPipelines: vi.fn(async () => { throw new Error('le sélecteur ne doit pas charger les pipelines ici'); }),
  renommerPipeline: vi.fn(async () => undefined),
  renommerEtape: vi.fn(async () => undefined),
  definirAffichagePipeline: vi.fn(async () => undefined),
  reordonnerEtapes: vi.fn(async () => undefined),
  ajouterEtape: vi.fn(async () => ({ id: 'e' })),
  desarchiverEtape: vi.fn(async () => undefined),
  supprimerEtape: vi.fn(async () => 0),
  fetchRaisonsProposees: vi.fn(async () => []),
  ajouterRaisonProposee: vi.fn(async () => undefined),
  archiverRaisonProposee: vi.fn(async () => undefined),
  fetchBureauxAdministres: vi.fn(async () => []),
  copierVersBureaux: vi.fn(async () => 1),
  fetchMembres: vi.fn(async () => []),
  fetchRolesMembres: vi.fn(async () => ({})),
  fetchAccesPipeline: vi.fn(async () => []),
  donnerAccesPipeline: vi.fn(async () => undefined),
  retirerAccesPipeline: vi.fn(async () => undefined),
  majDroitModifier: vi.fn(async () => undefined),
  compterDealsPipeline: vi.fn(async () => 0),
}));
const champ = (id: string, label: string) => ({
  id, object_type: 'deal', folder_id: null, key: id, label, placeholder: null, help_text: null, field_type: 'single_line',
  config: {}, is_required: false, is_searchable: false, is_unique: false, position: 0, created_at: 'x', updated_at: 'x',
  archived_at: null, options: [],
});
const CHAMPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l) => champ(`f-${l}`, `Champ ${l}`));
vi.mock('../src/lib/champsPersoApi', () => ({
  listerChamps: vi.fn(async () => ({ fields: CHAMPS, folders: [] })),
  lireCartesPipeline: vi.fn(async () => cartesActuelles),
  majCartesPipeline: (...a: any[]) => majCartesMock(...a),
}));
vi.mock('../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import PipelineDetail from '../src/components/pipeline/ghl/PipelineDetail';
import { getSearchItemHref } from '../src/lib/searchHelpers';
import { rechercherDansChamps } from '../server/lib/champs/recherche';

const P1 = { id: 'p-1', name: 'Marketing Pipeline', is_default: true, position: 1, nb_etapes: 6, updated_at: '2026-09-23T16:54:00Z', color_mode: 'none' as const, use_deal_probability: false };

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;
async function attendre() { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

beforeEach(() => {
  cartesActuelles = [];
  majCartesMock.mockClear();
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

async function ouvrirCartes() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}><MemoryRouter>
        <PipelineDetail fr pipeline={P1} onRetour={vi.fn()} onChangement={vi.fn()} />
      </MemoryRouter></QueryClientProvider>,
    );
  });
  await attendre();
  const onglet = [...conteneur.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Cartes') as HTMLButtonElement;
  expect(onglet, 'onglet « Cartes » absent').toBeTruthy();
  await act(async () => { onglet.click(); });
  await attendre();
}

const caseDe = (label: string) => {
  const lab = [...conteneur.querySelectorAll('label')].find((l) => l.textContent?.trim() === label);
  return [...conteneur.querySelectorAll('input[type="checkbox"]')].find((i) => i.id === lab?.getAttribute('for')) as HTMLInputElement;
};

describe('réglages d’un pipeline — onglet « Cartes »', () => {
  it('règle les cartes de CE pipeline, sans sélecteur de pipeline', async () => {
    await ouvrirCartes();
    expect(conteneur.textContent).toContain('Champs affichés sur les cartes du pipeline');
    // Pas de choix de pipeline : c'est celui de la page.
    expect([...conteneur.querySelectorAll('label')].some((l) => l.textContent === 'Pipeline')).toBe(false);
    await act(async () => { caseDe('Champ B').click(); });
    await act(async () => { caseDe('Champ A').click(); });
    const enregistrer = [...conteneur.querySelectorAll('button')].find((b) => /Enregistrer l’affichage/.test(b.textContent ?? '')) as HTMLButtonElement;
    await act(async () => { enregistrer.click(); });
    expect(majCartesMock).toHaveBeenCalledWith('p-1', ['f-B', 'f-A']);
  });

  it('6 champs au plus', async () => {
    cartesActuelles = ['f-A', 'f-B', 'f-C', 'f-D', 'f-E', 'f-F'];
    await ouvrirCartes();
    expect(caseDe('Champ G').disabled).toBe(true);
    expect(caseDe('Champ A').checked).toBe(true);
  });
});

describe('recherche globale — un champ de deal ouvre le deal', () => {
  it('le lien mène à la fiche du deal dans le pipeline', () => {
    expect(getSearchItemHref('client', 'c1', { clientId: 'c1', dealId: 'd-9' })).toBe('/ventes?deal=d-9');
    // Sans deal : inchangé.
    expect(getSearchItemHref('client', 'c1', { clientId: 'c1' })).toBe('/clients/c1');
  });

  it('le serveur rattache la valeur au deal (dealId), la valeur d’un client reste au client', async () => {
    const lignes: Record<string, any[]> = {
      deals: [{ id: 'd-9', client_id: 'c1' }],
      clients: [
        { id: 'c1', first_name: 'Alice', last_name: 'Alpha', company: null, status: 'active', created_at: 'x' },
        { id: 'c2', first_name: 'Bob', last_name: 'Bravo', company: null, status: 'lead', created_at: 'x' },
      ],
    };
    const requete = (table: string) => {
      const q: any = { select: () => q, eq: () => q, in: () => q, is: () => q, then: (ok: any) => ok({ data: lignes[table] ?? [] }) };
      return q;
    };
    const db: any = {
      rpc: async () => ({
        data: [
          { object_type: 'deal', entity_id: 'd-9', field_id: 'f', field_label: 'Référé par', value_text: 'Marc' },
          { object_type: 'client', entity_id: 'c2', field_id: 'g', field_label: 'Surnom', value_text: 'Marco' },
        ],
        error: null,
      }),
      from: requete,
    };
    const res = await rechercherDansChamps(db, 'org', 'marc', new Set());
    const alice = res.find((r) => r.id === 'c1')!;
    expect(alice.dealId).toBe('d-9');
    expect(alice.subtitle).toBe('Deal · Référé par : Marc');
    expect(getSearchItemHref(alice.type, alice.id, { clientId: alice.clientId, dealId: alice.dealId })).toBe('/ventes?deal=d-9');
    const bob = res.find((r) => r.id === 'c2')!;
    expect(bob.dealId).toBeUndefined();
    expect(getSearchItemHref(bob.type, bob.id, { clientId: bob.clientId, dealId: bob.dealId })).toBe('/clients/c2');
  });
});
