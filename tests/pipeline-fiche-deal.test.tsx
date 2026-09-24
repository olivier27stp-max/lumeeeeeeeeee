// @vitest-environment jsdom
//
// La VRAIE fiche d'un deal, rendue.
//
// Trois livraisons récentes vivent uniquement dans cet écran, et aucune
// n'était couverte : les motifs de perte proposés, le bouton « Abandonner »,
// et les champs personnalisés du métier. Toutes les trois sont du genre à
// paraître parfaites en base — la table est correcte, la RLS est correcte —
// pendant que l'écran n'affiche rien.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const fetchRaisonsMock = vi.fn(async () => [] as any[]);
const listColumnsMock = vi.fn(async () => [] as any[]);
const getValuesMock = vi.fn(async () => ({}) as Record<string, any>);

vi.mock('../src/lib/pipelineVentesApi', () => ({
  fetchRaisonsProposees: () => fetchRaisonsMock(),
  fetchElementsLies: vi.fn(async () => ({ job: null, devis: null, paiements: [], porte: null })),
  fetchHistorique: vi.fn(async () => []),
  fetchTachesDuDeal: vi.fn(async () => []),
  creerTacheDeal: vi.fn(async () => undefined),
  basculerTacheDeal: vi.fn(async () => undefined),
  deplacerDeal: vi.fn(async () => undefined),
  marquerPerdu: vi.fn(async () => undefined),
  abandonnerDeal: vi.fn(async () => undefined),
  majContactDuDeal: vi.fn(async () => undefined),
  majRaisonPerte: vi.fn(async () => undefined),
  majSourceDuDeal: vi.fn(async () => undefined),
  estJobACreer: () => false,
  nomClient: (d: any) => `${d.client?.first_name ?? ''} ${d.client?.last_name ?? ''}`.trim() || 'Client',
}));

vi.mock('../src/lib/customFieldsApi', () => ({
  listColumns: (...a: any[]) => listColumnsMock(...(a as [])),
  getValuesForRecord: (...a: any[]) => getValuesMock(...(a as [])),
  setValue: vi.fn(async () => undefined),
}));

// Les notes et la chronologie parlent à la base : hors sujet ici.
vi.mock('../src/components/SpecificNotes', () => ({ default: () => null }));
vi.mock('../src/components/ActivityTimeline', () => ({ default: () => null }));

vi.mock('../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));

import DealDrawer from '../src/components/pipeline/DealDrawer';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau lead', name_en: 'New lead', guidance_fr: '', guidance_en: '', position: 1, kind: 'open' as const, archived_at: null },
  { id: 'e2', pipeline_id: 'p1', name_fr: 'Gagné', name_en: 'Won', guidance_fr: '', guidance_en: '', position: 2, kind: 'won' as const, archived_at: null },
  { id: 'e3', pipeline_id: 'p1', name_fr: 'Perdu', name_en: 'Lost', guidance_fr: '', guidance_en: '', position: 3, kind: 'lost' as const, archived_at: null },
];

function faireDeal(over: Record<string, unknown> = {}) {
  const t = new Date().toISOString();
  return {
    id: 'd1', pipeline_id: 'p1', stage_id: 'e1', client_id: 'c1',
    assigned_user_id: null, source: 'manual',
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
    job_id: null, quote_id: null, first_contacted_at: null,
    last_activity_at: t, stage_entered_at: t, won_at: null, lost_at: null,
    lost_reason: null, lost_from_stage_id: null, pin_id: null, field_rep_id: null,
    created_at: t,
    client: { first_name: 'Jean', last_name: 'Tremblay', company: null, email: null, phone: null, address: null },
    ...over,
  } as any;
}

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(over: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <DealDrawer
            deal={faireDeal(over)}
            etapes={ETAPES}
            membres={[]}
            montantCents={null}
            montantProvenance="aucun"
            onClose={vi.fn()}
            onAssigner={vi.fn()}
            onCreerJob={vi.fn()}
            onChangement={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  // Les requêtes (motifs, champs personnalisés) se résolvent.
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function boutonNomme(motif: RegExp): HTMLButtonElement | undefined {
  return [...conteneur.querySelectorAll('button')]
    .find((b) => motif.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  fetchRaisonsMock.mockClear().mockResolvedValue([]);
  listColumnsMock.mockClear().mockResolvedValue([]);
  getValuesMock.mockClear().mockResolvedValue({});
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('fiche du deal — abandonner', () => {
  it('propose « Abandonner » sur un deal encore ouvert', async () => {
    await rendre();
    // Le statut existait en base, testé, sans qu'aucun bouton ne l'atteigne.
    expect(boutonNomme(/Abandonner ce deal/)).toBeTruthy();
  });

  it('ne le propose PAS sur un deal déjà gagné', async () => {
    await rendre({ stage_id: 'e2' });
    // Abandonner un deal gagné n'a pas de sens.
    expect(boutonNomme(/Abandonner ce deal/)).toBeFalsy();
  });

  it('ne le propose PAS sur un deal déjà perdu', async () => {
    await rendre({ stage_id: 'e3', lost_reason: 'Prix trop élevé' });
    expect(boutonNomme(/Abandonner ce deal/)).toBeFalsy();
  });
});

describe('fiche du deal — champs personnalisés', () => {
  it("n'affiche rien tant qu'aucun champ n'est défini", async () => {
    await rendre();
    // Une section vide ferait croire à un écran cassé.
    expect(conteneur.textContent).not.toContain('Informations du métier');
  });

  it('affiche les champs définis, avec leur valeur', async () => {
    listColumnsMock.mockResolvedValue([
      { id: 'col1', org_id: 'o1', entity: 'deals', name: 'Superficie', col_type: 'number', config: {}, position: 0, visible: true, required: false },
    ]);
    getValuesMock.mockResolvedValue({ col1: 2400 });
    await rendre();

    expect(listColumnsMock).toHaveBeenCalledWith('deals');
    expect(conteneur.textContent).toContain('Informations du métier');
    expect(conteneur.textContent).toContain('Superficie');
  });

  it('ignore un champ masqué', async () => {
    listColumnsMock.mockResolvedValue([
      { id: 'col1', org_id: 'o1', entity: 'deals', name: 'Interne', col_type: 'text', config: {}, position: 0, visible: false, required: false },
    ]);
    await rendre();
    expect(conteneur.textContent).not.toContain('Interne');
  });
});

describe('fiche du deal — motifs de perte', () => {
  it('propose les motifs de la liste quand on vise une étape perdue', async () => {
    fetchRaisonsMock.mockResolvedValue([
      { id: 'r1', libelle: 'Prix trop élevé', position: 1 },
      { id: 'r2', libelle: 'A choisi un concurrent', position: 2 },
    ]);
    await rendre();

    // Viser « Perdu » ouvre la demande de raison SANS écrire l'étape.
    const sel = [...conteneur.querySelectorAll('select')]
      .find((x) => [...x.options].some((o) => o.value === 'e3')) as HTMLSelectElement;
    expect(sel, "sélecteur d'étape introuvable").toBeTruthy();
    await act(async () => {
      sel.value = 'e3';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(conteneur.textContent).toContain('Prix trop élevé');
    expect(conteneur.textContent).toContain('A choisi un concurrent');
  });
});
