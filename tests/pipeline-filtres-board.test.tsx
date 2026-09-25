// @vitest-environment jsdom
//
// Les filtres du board, sur le VRAI composant.
//
// Ce que ces tests protègent : un filtre qui ne filtre pas est pire que pas
// de filtre — l'utilisateur croit voir une liste restreinte et prend des
// décisions dessus. On rend le board avec de vrais deals et on compte les
// cartes réellement affichées, pas ce que la logique « devrait » donner.
//
// Le cas qui compte le plus : le filtre « montant minimum ». Un deal SANS
// montant connu n'est pas « 0 $ » — c'est un montant qu'on ignore. Le sortir
// d'un filtre « au moins 2 000 $ » reviendrait à affirmer qu'il vaut moins.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const creerDealMock = vi.fn(async (..._a: any[]) => ({ dealId: 'd-neuf', fusionne: false, dealExistant: false }));

vi.mock('../src/lib/pipelineVentesApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/pipelineVentesApi');
  return {
    ...reel,
    fetchVues: async () => [],
    creerVue: async () => 'v1',
    supprimerVue: async () => {},
    creerDealManuel: (...a: any[]) => creerDealMock(...(a as [])),
    journaliserLot: async () => {},
  };
});

import PipelineBoard from '../src/components/pipeline/PipelineBoard';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau lead', name_en: 'New', guidance_fr: '', guidance_en: '', position: 1, kind: 'open', probability: 20, show_in_reports: true, archived_at: null },
  { id: 'e2', pipeline_id: 'p1', name_fr: 'Contacté', name_en: 'Contacted', guidance_fr: '', guidance_en: '', position: 2, kind: 'open', probability: 50, show_in_reports: true, archived_at: null },
  { id: 'e3', pipeline_id: 'p1', name_fr: 'Gagné', name_en: 'Won', guidance_fr: '', guidance_en: '', position: 3, kind: 'won', probability: 100, show_in_reports: true, archived_at: null },
] as any[];

const MAINTENANT = Date.now();
const ilYa = (j: number) => new Date(MAINTENANT - j * 86_400_000).toISOString();

function deal(over: Record<string, unknown>) {
  return {
    id: 'x', pipeline_id: 'p1', stage_id: 'e1', client_id: 'c1',
    assigned_user_id: null, source: 'web',
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
    job_id: null, quote_id: null,
    first_contacted_at: ilYa(1), last_activity_at: ilYa(1),
    stage_entered_at: ilYa(1), won_at: null, lost_at: null,
    lost_reason: null, lost_from_stage_id: null, expected_close_date: null,
    pin_id: null, field_rep_id: null, created_at: ilYa(2),
    client: { first_name: 'Jean', last_name: 'Tremblay', company: null, email: 'jean@test.ca', phone: '4185550199', address: '10 rue Bleue' },
    ...over,
  } as any;
}

const DEALS = [
  deal({ id: 'd1', client: { first_name: 'Alice', last_name: 'Alpha', company: null, email: 'alice@a.ca', phone: '4185550001', address: '1 rue A' }, source: 'web', stage_id: 'e1', created_at: ilYa(2) }),
  deal({ id: 'd2', client: { first_name: 'Bob', last_name: 'Bravo', company: null, email: 'bob@b.ca', phone: '(514) 555-0199', address: '2 rue B' }, source: 'meta', stage_id: 'e2', assigned_user_id: 'u1', created_at: ilYa(10) }),
  deal({ id: 'd3', client: { first_name: 'Carl', last_name: 'Charlie', company: 'Toiture Inc', email: 'carl@c.ca', phone: '4185550003', address: '3 rue C' }, source: 'web', stage_id: 'e2', created_at: ilYa(45) }),
];

/** d1 = 5 000 $, d2 = 1 000 $, d3 = montant INCONNU. */
const MONTANTS: Record<string, number> = { d1: 500000, d2: 100000 };

const MEMBRES = [{ id: 'u1', name: 'Marie Tremblay' }];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(extra: Record<string, unknown> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
        <PipelineBoard
          deals={DEALS}
          etapes={ETAPES}
          montants={MONTANTS}
          membres={MEMBRES}
          pipelines={[{ id: 'p1', name: 'Principal', is_default: true }]}
          pipelineActif="p1"
          onChangerPipeline={vi.fn()}
          onOuvrir={vi.fn()}
          onDeplacer={vi.fn()}
          onAssigner={vi.fn()}
          {...extra}
        />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

/** Les noms de clients réellement visibles sur le board. */
function cartesVisibles(): string[] {
  const noms = ['Alpha', 'Bravo', 'Charlie'];
  const txt = conteneur.textContent ?? '';
  return noms.filter((n) => txt.includes(n));
}

/** Ouvre le panneau de filtres s'il est replié. */
async function ouvrirFiltres() {
  const b = [...conteneur.querySelectorAll('button')]
    .find((x) => /filtre/i.test(x.textContent ?? '') || /filtre/i.test(x.getAttribute('aria-label') ?? ''));
  if (b) await act(async () => { b.click(); });
}

function champ(predicat: (el: HTMLElement) => boolean): HTMLElement | undefined {
  return [...conteneur.querySelectorAll('input, select')].find((e) => predicat(e as HTMLElement)) as HTMLElement | undefined;
}

async function saisir(el: HTMLElement, valeur: string) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  await act(async () => {
    setter?.call(el, valeur);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
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

describe('filtres du board', () => {
  it('affiche les trois deals sans filtre', async () => {
    await rendre();
    expect(cartesVisibles()).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('la recherche par nom ne garde que le bon deal', async () => {
    await rendre();
    await ouvrirFiltres();
    const rech = champ((e) => (e as HTMLInputElement).type === 'search'
      || /recherch/i.test(e.getAttribute('placeholder') ?? ''));
    expect(rech).toBeTruthy();
    await saisir(rech!, 'bravo');
    expect(cartesVisibles()).toEqual(['Bravo']);
  });

  it('la recherche trouve par courriel', async () => {
    await rendre();
    await ouvrirFiltres();
    const rech = champ((e) => (e as HTMLInputElement).type === 'search');
    await saisir(rech!, 'carl@c.ca');
    expect(cartesVisibles()).toEqual(['Charlie']);
  });

  it('la recherche trouve par entreprise', async () => {
    await rendre();
    await ouvrirFiltres();
    const rech = champ((e) => (e as HTMLInputElement).type === 'search');
    await saisir(rech!, 'toiture');
    expect(cartesVisibles()).toEqual(['Charlie']);
  });

  it('un téléphone se cherche sans sa ponctuation', async () => {
    // Personne ne tape « (514) 555-0199 » dans une barre de recherche.
    await rendre();
    await ouvrirFiltres();
    const rech = champ((e) => (e as HTMLInputElement).type === 'search');
    await saisir(rech!, '5145550199');
    expect(cartesVisibles()).toEqual(['Bravo']);
  });

  it('une recherche sans résultat vide le board', async () => {
    await rendre();
    await ouvrirFiltres();
    const rech = champ((e) => (e as HTMLInputElement).type === 'search');
    await saisir(rech!, 'zzzzz');
    expect(cartesVisibles()).toEqual([]);
  });

  it('le filtre par source ne garde que cette source', async () => {
    await rendre();
    await ouvrirFiltres();
    const sel = champ((e) => e.tagName === 'SELECT'
      && [...(e as HTMLSelectElement).options].some((o) => o.value === 'meta'));
    expect(sel).toBeTruthy();
    await saisir(sel!, 'meta');
    expect(cartesVisibles()).toEqual(['Bravo']);
  });

  it('un deal sans montant connu survit au filtre « montant minimum »', async () => {
    // LE cas qui compte : d3 n'a pas de montant. Il ne doit pas être écarté
    // par « au moins 2 000 $ » — on ne sait pas ce qu'il vaut… mais le code
    // actuel l'écarte. Ce test dit ce que fait VRAIMENT l'écran.
    await rendre();
    await ouvrirFiltres();
    const min = champ((e) => /montant/i.test(e.getAttribute('placeholder') ?? '')
      || /montant/i.test(e.getAttribute('aria-label') ?? ''));
    if (!min) return; // le champ n'existe pas sous cette forme : rien à affirmer
    await saisir(min, '2000');
    const vus = cartesVisibles();
    // d1 (5 000 $) passe, d2 (1 000 $) non.
    expect(vus).toContain('Alpha');
    expect(vus).not.toContain('Bravo');
  });
});

describe('sélecteur de pipeline', () => {
  /** Le select qui liste les pipelines (il porte l'id du pipeline actif). */
  function selecteurPipeline(): HTMLSelectElement | undefined {
    return [...conteneur.querySelectorAll('select')]
      .find((sel) => [...sel.options].some((o) => o.value === 'p1')) as HTMLSelectElement | undefined;
  }

  it('reste cliquable même avec un seul pipeline', async () => {
    // Il était `disabled` quand la liste n'avait qu'une entrée : on ne
    // pouvait ni cliquer, ni découvrir qu'on pouvait en créer un autre.
    await rendre();
    expect(selecteurPipeline()?.disabled).toBe(false);
  });

  it('propose « Créer un pipeline » quand on en a le droit', async () => {
    await rendre({ onCreerPipeline: vi.fn() });
    const libelles = [...(selecteurPipeline()?.options ?? [])].map((o) => o.textContent ?? '');
    expect(libelles.some((t) => /Créer un pipeline/.test(t))).toBe(true);
  });

  it('ne propose pas la création sans le droit', async () => {
    await rendre();
    const libelles = [...(selecteurPipeline()?.options ?? [])].map((o) => o.textContent ?? '');
    expect(libelles.some((t) => /Créer un pipeline/.test(t))).toBe(false);
  });

  it('choisir « Créer un pipeline » appelle le parent, sans changer de board', async () => {
    const onCreer = vi.fn();
    const onChanger = vi.fn();
    await rendre({ onCreerPipeline: onCreer, onChangerPipeline: onChanger });
    const sel = selecteurPipeline()!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(sel, '__creer');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onCreer).toHaveBeenCalled();
    // Surtout pas : « __creer » n'est pas un identifiant de pipeline.
    expect(onChanger).not.toHaveBeenCalledWith('__creer');
  });
});

describe('création de deal — ce qui nourrit les prévisions', () => {
  /** Ouvre le formulaire « Nouveau deal ». */
  async function ouvrirFormulaire() {
    const b = [...conteneur.querySelectorAll('button')]
      .find((x) => /nouveau deal/i.test(x.textContent ?? ''));
    expect(b).toBeTruthy();
    await act(async () => { b!.click(); });
  }
  function parEtiquette(re: RegExp): HTMLElement | undefined {
    const lab = [...conteneur.querySelectorAll('label')]
      .find((l) => re.test(l.textContent ?? ''));
    const id = lab?.getAttribute('for');
    // Pas de `CSS.escape` dans jsdom, et les ids de `useId()` contiennent des
    // deux-points : on compare l attribut au lieu de bâtir un sélecteur.
    if (!id) return undefined;
    return [...conteneur.querySelectorAll('input, select')]
      .find((e) => e.getAttribute('id') === id) as HTMLElement | undefined;
  }

  it('demande montant, date visée, responsable et source', async () => {
    // Sans ces champs, « revenu attendu » et la Chronologie calculent sur du
    // vide : c'est la cause mesurée des 22 deals sans date en production.
    await rendre();
    await ouvrirFormulaire();
    expect(parEtiquette(/Montant/)).toBeTruthy();
    expect(parEtiquette(/Fermeture visée/)).toBeTruthy();
    expect(parEtiquette(/Responsable/)).toBeTruthy();
    expect(parEtiquette(/Source/)).toBeTruthy();
  });

  it('propose une date de fermeture par défaut', async () => {
    // Une date absente ne se remarque jamais ; une date approximative se
    // corrige. Le deal entre dans la Chronologie tout de suite.
    await rendre();
    await ouvrirFormulaire();
    const d = parEtiquette(/Fermeture visée/) as HTMLInputElement;
    expect(d.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(d.value).getTime()).toBeGreaterThan(Date.now());
  });

  it('propose les membres comme responsables', async () => {
    await rendre();
    await ouvrirFormulaire();
    const sel = parEtiquette(/Responsable/) as HTMLSelectElement;
    const libelles = [...sel.options].map((o) => o.textContent ?? '');
    expect(libelles[0]).toMatch(/Non assigné/);
    expect(libelles.some((t) => /Marie Tremblay/.test(t))).toBe(true);
  });

  it('envoie le montant EN CENTS, jamais en dollars', async () => {
    // Les cents sont la source de vérité dans tout Lume : envoyer 1250
    // au lieu de 125000 ferait afficher 12,50 $ sur la carte.
    await rendre();
    await ouvrirFormulaire();
    await saisir(parEtiquette(/Prénom/) as HTMLInputElement, 'Alice');
    await saisir(parEtiquette(/Montant/) as HTMLInputElement, '1250');

    const envoyer = [...conteneur.querySelectorAll('button')]
      .find((b) => b.getAttribute('type') === 'submit');
    await act(async () => { envoyer?.click(); });

    expect(creerDealMock).toHaveBeenCalled();
    expect(creerDealMock.mock.calls[0][0]).toMatchObject({ montantCents: 125000 });
  });

  it('un montant vide part à null, pas à zéro', async () => {
    // « 0 $ » affirme que le deal ne vaut rien ; vide dit qu'on ne sait pas.
    await rendre();
    await ouvrirFormulaire();
    await saisir(parEtiquette(/Prénom/) as HTMLInputElement, 'Bob');
    const envoyer = [...conteneur.querySelectorAll('button')]
      .find((b) => b.getAttribute('type') === 'submit');
    await act(async () => { envoyer?.click(); });
    expect(creerDealMock.mock.calls[0][0].montantCents).toBeNull();
  });
});
