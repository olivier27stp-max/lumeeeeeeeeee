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
const lireValeursMock = vi.fn(async () => ({ fields: [], folders: [], values: {} }) as any);
const ecrireValeursMock = vi.fn(async () => [] as any[]);
const rdvMock = vi.fn(async () => [] as any[]);
const tachesMock = vi.fn(async () => [] as any[]);
const updateTaskMock = vi.fn(async (..._a: any[]) => ({}) as any);
const deleteTaskMock = vi.fn(async (..._a: any[]) => undefined);
const confirmerMock = vi.fn(async (..._a: any[]) => true);
const dossierMock = vi.fn(async () => ({
  jobs: [], devis: [], factures: [], transactions: [], messages: [], paye_cents: 0, du_cents: 0,
}) as any);

vi.mock('../src/lib/pipelineVentesApi', () => ({
  fetchRaisonsProposees: () => fetchRaisonsMock(),
  fetchElementsLies: vi.fn(async () => ({ job: null, devis: null, paiements: [], porte: null })),
  fetchDossierClient: (...a: any[]) => dossierMock(...(a as [])),
  fetchRendezVousClient: (...a: any[]) => rdvMock(...(a as [])),
  fetchHistorique: vi.fn(async () => []),
  fetchTachesDuDeal: (...a: any[]) => tachesMock(...(a as [])),
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

// Champs personnalisés v2 : le VRAI panneau est rendu ; seules l'API et le
// drapeau sont simulés.
vi.mock('../src/lib/champsPersoApi', () => ({
  lireValeurs: (...a: any[]) => lireValeursMock(...(a as [])),
  ecrireValeurs: (...a: any[]) => ecrireValeursMock(...(a as [])),
}));
vi.mock('../src/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ isEnabled: true, indetermine: false, loading: false, activate: async () => true, activating: false, platformLocked: false }),
}));

// Les notes et la chronologie parlent à la base : hors sujet ici.
vi.mock('../src/components/SpecificNotes', () => ({ default: () => null }));
// Les tâches passent par les MÊMES fonctions que la page Tâches.
vi.mock('../src/lib/tasksApi', () => ({
  updateTask: (...a: any[]) => updateTaskMock(...a),
  deleteTask: (...a: any[]) => deleteTaskMock(...a),
}));
vi.mock('../src/components/ui/ConfirmDialog', () => ({
  confirmer: (...a: any[]) => confirmerMock(...a),
}));
vi.mock('../src/components/ActivityTimeline', () => ({ default: () => null }));

vi.mock('../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: {} }) }));

import DealDrawer from '../src/components/pipeline/DealDrawer';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau lead', name_en: 'New lead', guidance_fr: '', guidance_en: '', position: 1, kind: 'open' as const, probability: null, show_in_reports: true, show_in_pie: true, archived_at: null },
  { id: 'e2', pipeline_id: 'p1', name_fr: 'Gagné', name_en: 'Won', guidance_fr: '', guidance_en: '', position: 2, kind: 'won' as const, probability: null, show_in_reports: true, show_in_pie: true, archived_at: null },
  { id: 'e3', pipeline_id: 'p1', name_fr: 'Perdu', name_en: 'Lost', guidance_fr: '', guidance_en: '', position: 3, kind: 'lost' as const, probability: null, show_in_reports: true, show_in_pie: true, archived_at: null },
];

function faireDeal(over: Record<string, unknown> = {}) {
  const t = new Date().toISOString();
  return {
    id: 'd1', pipeline_id: 'p1', stage_id: 'e1', client_id: 'c1',
    assigned_user_id: null, source: 'manual',
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
    job_id: null, quote_id: null, first_contacted_at: null,
    last_activity_at: t, stage_entered_at: t, won_at: null, lost_at: null,
    lost_reason: null, lost_from_stage_id: null, expected_close_date: null, pin_id: null, field_rep_id: null,
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

/**
 * Ouvre une section de la fiche.
 *
 * Depuis que la fiche s'ouvre sur le CLIENT, les éléments du deal (étape,
 * abandon, champs du métier) demandent un clic — c'est le comportement
 * voulu, pas un contournement de test.
 */
async function ouvrirSection(nom: string) {
  const b = [...conteneur.querySelectorAll('[role="tab"]')]
    .find((x) => (x.textContent ?? '').trim() === nom) as HTMLButtonElement | undefined;
  expect(b, `section ${nom} introuvable`).toBeTruthy();
  await act(async () => { b!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Rend la fiche avec un montant et sa provenance. */
async function rendreAvecMontant(cents: number, provenance: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <DealDrawer
            deal={faireDeal()}
            etapes={ETAPES}
            membres={[]}
            montantCents={cents}
            montantProvenance={provenance as any}
            onClose={vi.fn()}
            onAssigner={vi.fn()}
            onCreerJob={vi.fn()}
            onChangement={vi.fn()}
          />
        </MemoryRouter>
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
  fetchRaisonsMock.mockClear().mockResolvedValue([]);
  tachesMock.mockClear().mockResolvedValue([]);
  updateTaskMock.mockClear();
  deleteTaskMock.mockClear();
  confirmerMock.mockClear().mockResolvedValue(true);
  lireValeursMock.mockClear().mockResolvedValue({ fields: [], folders: [], values: {} });
  ecrireValeursMock.mockClear().mockResolvedValue([]);
  rdvMock.mockClear().mockResolvedValue([]);
  dossierMock.mockClear().mockResolvedValue({
    jobs: [], devis: [], factures: [], transactions: [], messages: [], paye_cents: 0, du_cents: 0,
  });
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
    await ouvrirSection('Deal');
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

const SUPERFICIE = {
  id: 'col1', object_type: 'deal', folder_id: null, key: 'superficie', label: 'Superficie', placeholder: null, help_text: null,
  field_type: 'number', config: {}, is_required: false, is_searchable: false, is_unique: false, position: 0,
  created_at: 'x', updated_at: 'x', archived_at: null, options: [],
};

describe('fiche du deal — champs personnalisés', () => {
  it("n'affiche rien tant qu'aucun champ n'est défini", async () => {
    await rendre();
    // Une section vide ferait croire à un écran cassé.
    expect(conteneur.textContent).not.toContain('Informations du métier');
  });

  it('affiche les champs définis, avec leur valeur', async () => {
    lireValeursMock.mockResolvedValue({
      fields: [SUPERFICIE], folders: [], values: { col1: { field_id: 'col1', value: 2400, version: 3, updated_at: 'x' } },
    });
    await rendre();
    await ouvrirSection('Deal');

    expect(lireValeursMock).toHaveBeenCalledWith('deal', expect.any(String));
    expect(conteneur.textContent).toContain('Informations du métier');
    expect(conteneur.textContent).toContain('Superficie');
    const champ = conteneur.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    expect(champ.value).toBe('2400');
  });

  it('enregistre au blur, avec la version lue (verrou optimiste)', async () => {
    lireValeursMock.mockResolvedValue({
      fields: [SUPERFICIE], folders: [], values: { col1: { field_id: 'col1', value: 2400, version: 3, updated_at: 'x' } },
    });
    ecrireValeursMock.mockResolvedValue([{ field_id: 'col1', ok: true, changed: true, version: 4 }]);
    await rendre();
    await ouvrirSection('Deal');
    const champ = conteneur.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(champ, '2500');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { champ.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(ecrireValeursMock).toHaveBeenCalledWith('deal', expect.any(String), [{ field_id: 'col1', value: 2500, version: 3 }]);
  });

  it('montre le refus du serveur sous le champ, en clair', async () => {
    lireValeursMock.mockResolvedValue({ fields: [SUPERFICIE], folders: [], values: {} });
    ecrireValeursMock.mockResolvedValue([{ field_id: 'col1', ok: false, changed: false, version: null, erreur: '« Superficie » doit être au plus 100.' }]);
    await rendre();
    await ouvrirSection('Deal');
    const champ = conteneur.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(champ, '900');
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { champ.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toContain('doit être au plus 100');
  });
});

describe('fiche du deal — motifs de perte', () => {
  it('propose les motifs de la liste quand on vise une étape perdue', async () => {
    fetchRaisonsMock.mockResolvedValue([
      { id: 'r1', libelle: 'Prix trop élevé', position: 1 },
      { id: 'r2', libelle: 'A choisi un concurrent', position: 2 },
    ]);
    await rendre();
    await ouvrirSection('Deal');

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

describe('fiche du deal — dossier du client', () => {
  /** Ouvre l'onglet « Client », où vit le dossier. */
  async function ouvrirOngletClient() {
    const b = [...conteneur.querySelectorAll('button')]
      .find((x) => (x.textContent ?? '').trim() === 'Client') as HTMLButtonElement;
    expect(b, "onglet « Client » introuvable").toBeTruthy();
    await act(async () => { b.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }

  it("montre tout l'historique du client, pas juste ce deal", async () => {
    dossierMock.mockResolvedValue({
      jobs: [
        { id: 'j1', numero: 'JOB-101', titre: 'Lavage printemps', statut: 'completed', cents: 45000, date: '2026-05-01T00:00:00Z' },
        { id: 'j2', numero: 'JOB-088', titre: 'Lavage automne', statut: 'completed', cents: 40000, date: '2025-10-01T00:00:00Z' },
      ],
      devis: [{ id: 'q1', numero: 'DEV-12', titre: 'Gouttières', statut: 'sent', cents: 90000, date: '2026-09-01T00:00:00Z' }],
      factures: [{ id: 'f1', numero: 'FAC-55', titre: '', statut: 'sent', cents: 45000, solde_cents: 12000, date: '2026-05-02T00:00:00Z' }],
      messages: [{ id: 'm1', direction: 'inbound', texte: 'Ok pour mardi', date: '2026-09-20T00:00:00Z' }],
      paye_cents: 73000, du_cents: 12000,
    });
    await rendre();
    await ouvrirOngletClient();

    // Les montants sont formatés avec des espaces INSÉCABLES ( ,  ) :
    // comparer avec une espace ordinaire échouerait sans rien dire d'utile.
    const texte = conteneur.textContent ?? '';
    // L'historique complet : deux jobs que ce deal n'a pas produits.
    expect(texte).toContain('JOB-101');
    expect(texte).toContain('JOB-088');
    expect(texte).toContain('DEV-12');
    expect(texte).toContain('FAC-55');
    // Le dernier échange, pour savoir où on en est.
    expect(texte).toContain('Ok pour mardi');
  });

  it('met en évidence ce que le client doit encore', async () => {
    dossierMock.mockResolvedValue({
      jobs: [], devis: [],
      factures: [{ id: 'f1', numero: 'FAC-55', titre: '', statut: 'sent', cents: 45000, solde_cents: 12000, date: '2026-05-02T00:00:00Z' }],
      messages: [], paye_cents: 33000, du_cents: 12000,
    });
    await rendre();
    await ouvrirOngletClient();

    // La première question avant de rappeler quelqu'un pour lui vendre
    // autre chose : est-ce qu'il me doit déjà de l'argent ?
    const argent = conteneur.textContent ?? '';
    expect(argent).toContain('Doit');
    expect(argent).toContain('Payé');

    // Et la PORTÉE doit être écrite. Ces totaux couvrent tout le client :
    // une facture n'est rattachée qu'au client, jamais au deal. Sans le
    // dire, trois deals d'un même client affichaient chacun la même dette,
    // et on lisait trois dettes au lieu d'une. Le libellé nu « Doit encore »
    // était donc faux dès le deuxième deal d'un client.
    expect(argent).toContain('tout le client');
    expect(argent).not.toContain('Doit encore');
  });

  it("un BROUILLON n'affiche jamais « dû » — rien n'a été réclamé", async () => {
    dossierMock.mockResolvedValue({
      jobs: [], devis: [],
      factures: [
        // Envoyée : le client la connaît, il doit vraiment 120 $.
        { id: 'f1', numero: 'FAC-55', titre: '', statut: 'sent', cents: 45000, solde_cents: 12000, date: '2026-05-02T00:00:00Z' },
        // Brouillon : jamais envoyé. Son solde de 450 $ ne doit apparaître
        // nulle part — ni en rouge sur la ligne, ni dans le total.
        { id: 'f2', numero: 'FAC-56', titre: '', statut: 'draft', cents: 45000, solde_cents: 45000, date: '2026-05-03T00:00:00Z' },
      ],
      messages: [], paye_cents: 33000, du_cents: 12000,
    });
    await rendre();
    await ouvrirOngletClient();

    // Les montants portent une espace INSÉCABLE (U+00A0) entre le nombre
    // et le « $ » : comparer avec une espace ordinaire échoue sans rien
    // dire d'utile. On normalise avant de comparer.
    const texte = (conteneur.textContent ?? '').replace(/[  ]/g, ' ');
    // Le brouillon reste VISIBLE : c'est du travail en cours, le cacher
    // ferait croire qu'il n'existe pas.
    expect(texte).toContain('FAC-56');
    // Mais il ne réclame rien. « 450,00 $ dû » sur une facture que personne
    // n'a reçue inventait une dette — 5 823 $ sur 14 brouillons en prod.
    expect(texte).not.toContain('450 $ dû');
    // La vraie dette, elle, s'affiche.
    expect(texte).toContain('120 $ dû');
  });

  it("dit « premier contact » quand le client n'a aucun historique", async () => {
    await rendre();
    await ouvrirOngletClient();
    // Mieux qu'une section vide, qui ferait croire à un écran cassé.
    expect(conteneur.textContent).toContain('Premier contact');
  });
});

describe('fiche du deal — navigation', () => {
  it('ouvre sur le CLIENT, pas sur le deal', async () => {
    dossierMock.mockResolvedValue({
      jobs: [{ id: 'j1', numero: 'JOB-77', titre: 'Lavage', statut: 'completed', cents: 40000, date: '2026-05-01T00:00:00Z' }],
      devis: [], factures: [], messages: [], paye_cents: 40000, du_cents: 0,
    });
    await rendre();
    // La première question en ouvrant un deal est « c'est qui ? », pas
    // « quelle étape ? ». Sans clic, l'historique doit déjà être là.
    expect(conteneur.textContent).toContain('JOB-77');
  });

  it('range les sections en colonne, le client en premier', async () => {
    await rendre();
    const sections = [...conteneur.querySelectorAll('[role="tab"]')]
      .map((b) => b.textContent?.trim() ?? '');
    expect(sections[0]).toBe('Client');
    expect(sections).toContain('Rendez-vous');
    expect(sections).toContain('Tâches');
    expect(sections).toContain('Notes');
  });

  it('la liste des sections est annoncée comme verticale', async () => {
    await rendre();
    const liste = conteneur.querySelector('[role="tablist"]');
    // Sans cette annonce, un lecteur d'écran lit les flèches horizontales
    // alors que la navigation se fait de haut en bas.
    expect(liste?.getAttribute('aria-orientation')).toBe('vertical');
  });
});

describe('fiche du deal — rendez-vous', () => {
  it("offre un gros bouton quand il n'y a aucun rendez-vous", async () => {
    await rendre();
    await ouvrirSection('Rendez-vous');
    // Une section qui n'offre qu'une phrase laisse chercher quoi faire.
    expect(conteneur.textContent).toContain('Créer un rendez-vous');
  });

  it('montre une bande par visite, avec un bouton pour la modifier', async () => {
    rdvMock.mockResolvedValue([
      { id: 'r1', job_id: 'j1', titre: 'Lavage de vitres', debut: '2099-05-04T14:00:00Z', statut: 'scheduled' },
    ]);
    await rendre();
    await ouvrirSection('Rendez-vous');

    expect(conteneur.textContent).toContain('Lavage de vitres');
    expect(conteneur.textContent).toContain('Modifier');
    // Le gros bouton du vide disparaît dès qu'il y a une visite.
    expect(conteneur.textContent).not.toContain('Créer un rendez-vous');
    expect(conteneur.textContent).toContain('Ajouter un rendez-vous');
  });

  it('marque une visite annulée sans la cacher', async () => {
    rdvMock.mockResolvedValue([
      { id: 'r1', job_id: 'j1', titre: 'Visite', debut: '2099-05-04T14:00:00Z', statut: 'cancelled' },
    ]);
    await rendre();
    await ouvrirSection('Rendez-vous');
    // La masquer ferait croire qu'aucun rendez-vous n'a jamais été pris.
    expect(conteneur.textContent).toContain('Annulée');
  });
});

describe('fiche du deal — valeur', () => {
  it("n'affiche PAS en gros le devis d'un autre contrat", async () => {
    // `devis_client` = le dernier devis du client, pas un chiffrage de ce
    // deal. En gros, il se prend pour une promesse.
    await rendreAvecMontant(490000, 'devis_client');
    await ouvrirSection('Deal');

    expect(conteneur.textContent).toContain('Rien de chiffré pour ce deal');
    expect(conteneur.textContent).toContain('Dernier devis du client');
  });

  it('affiche en gros le montant du devis DE CE deal', async () => {
    await rendreAvecMontant(490000, 'devis');
    await ouvrirSection('Deal');
    expect(conteneur.textContent).not.toContain('Rien de chiffré');
    expect(conteneur.textContent).toContain('Montant du devis');
  });
});

describe('fiche du deal — paiements', () => {
  const DOSSIER = {
    jobs: [],
    devis: [{ id: 'q1', numero: 'DEV-12', titre: 'Gouttières', statut: 'sent', cents: 90000, date: '2026-09-01T00:00:00Z' }],
    factures: [{ id: 'f1', numero: 'FAC-55', titre: '', statut: 'sent', cents: 45000, solde_cents: 12000, date: '2026-05-02T00:00:00Z' }],
    transactions: [{ id: 't1', numero: 'card', titre: '', statut: 'succeeded', cents: 33000, date: '2026-05-10T00:00:00Z' }],
    messages: [], paye_cents: 33000, du_cents: 12000,
  };

  it('offre de créer un devis et une facture', async () => {
    await rendre();
    await ouvrirSection('Paiements');
    // GHL a un menu « Actions » ; ici les deux gestes sont visibles d'emblée.
    expect(conteneur.textContent).toContain('Créer un devis');
    expect(conteneur.textContent).toContain('Créer une facture');
  });

  it('montre devis, factures et transactions ensemble par défaut', async () => {
    dossierMock.mockResolvedValue(DOSSIER);
    await rendre();
    await ouvrirSection('Paiements');

    expect(conteneur.textContent).toContain('DEV-12');
    expect(conteneur.textContent).toContain('FAC-55');
    // Le solde restant, sur la facture à moitié payée.
    expect(conteneur.textContent).toContain('dû');
  });

  it('le filtre ne garde que le type demandé', async () => {
    dossierMock.mockResolvedValue(DOSSIER);
    await rendre();
    await ouvrirSection('Paiements');

    const sel = [...conteneur.querySelectorAll('select')]
      .find((x) => [...x.options].some((o) => o.value === 'devis')) as HTMLSelectElement;
    expect(sel, 'filtre de type introuvable').toBeTruthy();
    await act(async () => {
      sel.value = 'devis';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(conteneur.textContent).toContain('DEV-12');
    expect(conteneur.textContent).not.toContain('FAC-55');
  });
});

describe('fiche du deal — tâches', () => {
  const TACHE = {
    id: 't1', title: 'Rappeler Jean', status: 'open', priority: 'medium',
    due_date: '2026-10-01', created_at: new Date().toISOString(),
  };

  function bouton(re: RegExp): HTMLButtonElement | undefined {
    return [...conteneur.querySelectorAll('button')]
      .find((b) => re.test(b.getAttribute('aria-label') ?? b.textContent ?? '')) as HTMLButtonElement | undefined;
  }

  async function ouvrirTaches() {
    tachesMock.mockResolvedValue([TACHE]);
    await rendre();
    await ouvrirSection('Tâches');
  }

  it('chaque tâche peut être modifiée et supprimée', async () => {
    await ouvrirTaches();
    expect(bouton(/Modifier la tâche « Rappeler Jean »/)).toBeTruthy();
    expect(bouton(/Supprimer la tâche « Rappeler Jean »/)).toBeTruthy();
  });

  it('modifier : enregistre le nouveau titre et la nouvelle échéance', async () => {
    await ouvrirTaches();
    await act(async () => { bouton(/Modifier la tâche/)!.click(); });

    const titre = conteneur.querySelector('#tache-titre-t1') as HTMLInputElement;
    const echeance = conteneur.querySelector('#tache-echeance-t1') as HTMLInputElement;
    expect(titre.value).toBe('Rappeler Jean');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(titre, 'Rappeler Jean vendredi');
      titre.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(echeance, '2026-10-03');
      echeance.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { bouton(/^Enregistrer$/)!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(updateTaskMock).toHaveBeenCalledWith('t1', { title: 'Rappeler Jean vendredi', due_date: '2026-10-03' });
  });

  it('supprimer : demande confirmation, puis supprime', async () => {
    await ouvrirTaches();
    await act(async () => { bouton(/Supprimer la tâche/)!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(confirmerMock).toHaveBeenCalled();
    expect(deleteTaskMock).toHaveBeenCalledWith('t1');
  });

  it('supprimer : rien ne part si on annule', async () => {
    confirmerMock.mockResolvedValueOnce(false);
    await ouvrirTaches();
    await act(async () => { bouton(/Supprimer la tâche/)!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(deleteTaskMock).not.toHaveBeenCalled();
  });
});
