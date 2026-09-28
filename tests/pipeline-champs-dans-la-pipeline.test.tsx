// @vitest-environment jsdom
//
// Étape 4 du plan « Étiquettes et champs dans la pipeline » : les champs
// personnalisés du deal, là où le vendeur travaille — sur le VRAI board.
//
//   · le tri par champ sait trier une liste (ordre des options), du texte
//     (A → Z) et une case (cochés d'abord) — avant : nombre, montant, date ;
//   · « Enregistrer la vue » n'est plus grisé quand le SEUL filtre posé est
//     une condition de champ ;
//   · la vue Liste affiche des colonnes de champs (« Gérer les champs ») ;
//   · « Nouveau deal » sur un contact qui a déjà un deal ouvert : les valeurs
//     tapées complètent les champs VIDES du deal existant, jamais n'écrasent.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));

const toastSucces = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: any[]) => toastSucces(...a), error: vi.fn(), info: vi.fn() } }));

const creerDealMock = vi.fn(async (..._a: any[]) => ({ dealId: 'd-neuf', fusionne: false, dealExistant: false, pipelineId: 'p1' }) as any);

vi.mock('../src/lib/pipelineVentesApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/pipelineVentesApi');
  return {
    ...reel,
    fetchVues: async () => [],
    creerVue: async () => 'v1',
    supprimerVue: async () => {},
    creerDealManuel: (...a: any[]) => creerDealMock(...(a as [])),
    journaliserLot: async () => {},
    rechercherClientsPourDeal: async () => [],
    rechercherDevisPourDeal: async () => [],
  };
});

// ── Champs d'opportunité ─────────────────────────────────────
function champ(over: Record<string, unknown>) {
  return {
    object_type: 'deal', folder_id: null, placeholder: null, help_text: null, config: {}, is_required: false,
    is_searchable: false, is_unique: false, position: 0, created_at: 'x', updated_at: 'x', archived_at: null,
    options: [], default_value: null, ...over,
  } as any;
}
const URGENT = champ({ id: 'f-case', key: 'urgent', label: 'Urgent', field_type: 'checkbox' });
const TYPE = champ({
  id: 'f-type', key: 'type', label: 'Type de service', field_type: 'dropdown_single',
  options: [
    // Volontairement à rebours de l'alphabet : le tri suit l'ordre des OPTIONS.
    { id: 'o-res', label: 'Résidentiel', color: null, position: 0, archived_at: null },
    { id: 'o-com', label: 'Commercial', color: '#3b82f6', position: 1, archived_at: null },
  ],
});
const REFERE = champ({ id: 'f-ref', key: 'refere', label: 'Référé par', field_type: 'single_line', default_value: 'Marc' });
const FENETRES = champ({ id: 'f-nb', key: 'fenetres', label: 'Nombre de fenêtres', field_type: 'number', default_value: 12 });

let champsDeal: any[] = [URGENT, TYPE];
const v = (field_id: string, value: unknown, version = 1) => ({ field_id, value, version, updated_at: 'x' });
const VALEURS: Record<string, Record<string, any>> = {
  d1: { 'f-type': v('f-type', 'o-com') },
  d2: { 'f-type': v('f-type', 'o-res') },
};
const lireValeursMock = vi.fn(async (..._a: any[]) => ({ fields: [], folders: [], values: {} }) as any);
const ecrireValeursMock = vi.fn(async (_o: string, _id: string, vals: any[]) => vals.map((x) => ({ field_id: x.field_id, ok: true, changed: true, version: 1 })));

vi.mock('../src/lib/champsPersoApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/champsPersoApi');
  return {
    ...reel,
    listerChamps: async () => ({ fields: champsDeal, folders: [] }),
    lireCartesPipeline: async () => [],
    lireValeursLot: async () => VALEURS,
    filtrerParChamps: async () => ['d1'],
    lireFuseau: async () => 'America/Toronto',
    lireValeurs: (...a: any[]) => lireValeursMock(...a),
    ecrireValeurs: (...a: any[]) => ecrireValeursMock(...(a as [string, string, any[]])),
  };
});

// Colonnes de la liste : réglage par utilisateur (table_view_preferences).
let colonnesReglees: string[] | null = null;
vi.mock('../src/lib/colonnesTableauApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/colonnesTableauApi');
  return {
    ...reel,
    lireColonnesTableau: async () => colonnesReglees,
    enregistrerColonnesTableau: async () => {},
  };
});

import PipelineBoard from '../src/components/pipeline/PipelineBoard';
import { comparerParChamp, nbFiltresChamps } from '../src/components/champs/pipeline';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau lead', name_en: 'New', guidance_fr: '', guidance_en: '', position: 1, kind: 'open', probability: 20, show_in_reports: true, archived_at: null },
  { id: 'e3', pipeline_id: 'p1', name_fr: 'Gagné', name_en: 'Won', guidance_fr: '', guidance_en: '', position: 3, kind: 'won', probability: 100, show_in_reports: true, archived_at: null },
] as any[];

const ilYa = (j: number) => new Date(Date.now() - j * 86_400_000).toISOString();
function deal(over: Record<string, unknown>) {
  return {
    id: 'x', pipeline_id: 'p1', stage_id: 'e1', client_id: 'c1', assigned_user_id: null, source: 'web',
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
    job_id: null, quote_id: null, first_contacted_at: ilYa(1), last_activity_at: ilYa(1),
    stage_entered_at: ilYa(1), won_at: null, lost_at: null, lost_reason: null, lost_from_stage_id: null,
    expected_close_date: null, pin_id: null, field_rep_id: null, created_at: ilYa(2),
    client: { first_name: 'Jean', last_name: 'Tremblay', company: null, email: null, phone: null, address: null },
    ...over,
  } as any;
}
const DEALS = [
  deal({ id: 'd1', client: { first_name: 'Alice', last_name: 'Alpha', company: null, email: null, phone: null, address: null } }),
  deal({ id: 'd2', client: { first_name: 'Bob', last_name: 'Bravo', company: null, email: null, phone: null, address: null } }),
];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function laisserRepondre() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function rendre() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <PipelineBoard
            deals={DEALS} etapes={ETAPES} montants={{}} membres={[]}
            pipelines={[{ id: 'p1', name: 'Principal', is_default: true }]} pipelineActif="p1"
            onChangerPipeline={vi.fn()} onOuvrir={vi.fn()} onDeplacer={vi.fn()} onAssigner={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await laisserRepondre();
}

const boutons = () => [...conteneur.querySelectorAll('button')] as HTMLButtonElement[];
const bouton = (re: RegExp) => boutons().find((b) => re.test(b.textContent ?? '') || re.test(b.getAttribute('aria-label') ?? ''));

beforeEach(() => {
  champsDeal = [URGENT, TYPE];
  colonnesReglees = null;
  lireValeursMock.mockReset().mockResolvedValue({ fields: [], folders: [], values: {} });
  ecrireValeursMock.mockClear();
  creerDealMock.mockClear();
  toastSucces.mockClear();
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('tri par champ — les nouveaux types', () => {
  const lignes = (ids: string[]) => ids.map((id) => ({ id }));
  const ordre = (tri: any, valeurs: any, c: any, ids: string[]) => [...lignes(ids)].sort(comparerParChamp(tri, valeurs, c)).map((x) => x.id);

  it('liste : suit la position des options, pas l’alphabet ; vides en dernier', () => {
    const vals = { a: { 'f-type': v('f-type', 'o-com') }, b: { 'f-type': v('f-type', 'o-res') }, c: {} };
    expect(ordre({ field_id: 'f-type', sens: 'asc' }, vals, TYPE, ['a', 'c', 'b'])).toEqual(['b', 'a', 'c']);
    expect(ordre({ field_id: 'f-type', sens: 'desc' }, vals, TYPE, ['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('texte : A → Z, sans tenir compte de la casse ni des accents ; vides en dernier', () => {
    const vals = { a: { t: v('t', 'émile') }, b: { t: v('t', 'Bernard') }, c: { t: v('t', '') }, d: { t: v('t', 'alain') } };
    const texte = champ({ id: 't', field_type: 'single_line' });
    expect(ordre({ field_id: 't', sens: 'asc' }, vals, texte, ['a', 'b', 'c', 'd'])).toEqual(['d', 'b', 'a', 'c']);
    expect(ordre({ field_id: 't', sens: 'desc' }, vals, texte, ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'd', 'c']);
    // Courriel, téléphone, lien, texte long : même règle.
    for (const type of ['email', 'phone', 'url', 'multi_line']) {
      expect(ordre({ field_id: 't', sens: 'asc' }, vals, champ({ id: 't', field_type: type }), ['a', 'b', 'd'])).toEqual(['d', 'b', 'a']);
    }
  });

  it('case : cochés d’abord (sens par défaut « desc ») ; jamais remplie en dernier', () => {
    const vals = { a: { u: v('u', false) }, b: { u: v('u', true) }, c: {} };
    const casé = champ({ id: 'u', field_type: 'checkbox' });
    expect(ordre({ field_id: 'u', sens: 'desc' }, vals, casé, ['a', 'c', 'b'])).toEqual(['b', 'a', 'c']);
    expect(ordre({ field_id: 'u', sens: 'asc' }, vals, casé, ['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('nombre : inchangé', () => {
    const vals = { a: { n: v('n', 3) }, b: { n: v('n', 10) } };
    expect(ordre({ field_id: 'n', sens: 'desc' }, vals, champ({ id: 'n', field_type: 'number' }), ['a', 'b'])).toEqual(['b', 'a']);
  });

  it('le panneau propose maintenant listes, textes et cases au tri', async () => {
    champsDeal = [URGENT, TYPE, REFERE];
    await rendre();
    await act(async () => { bouton(/^Filtres/)!.click(); });
    await laisserRepondre();
    const label = [...conteneur.querySelectorAll('label')].find((l) => /Trier par champ/.test(l.textContent ?? ''));
    expect(label, 'aucun tri par champ proposé').toBeTruthy();
    const sel = [...conteneur.querySelectorAll('select')].find((s) => s.id === label!.getAttribute('for')) as HTMLSelectElement;
    const proposes = [...sel.options].map((o) => o.textContent);
    expect(proposes).toEqual(expect.arrayContaining(['Urgent', 'Type de service', 'Référé par']));
  });
});

describe('« Enregistrer la vue » avec un filtre de champ seulement', () => {
  it('compte les conditions complètes et le tri', () => {
    expect(nbFiltresChamps([], null)).toBe(0);
    expect(nbFiltresChamps([{ field_id: 'f-case', op: 'is_true' as any, value: true } as any], null)).toBe(1);
    expect(nbFiltresChamps([], { field_id: 'f-type', sens: 'asc' })).toBe(1);
  });

  it('le bouton s’active quand la seule condition posée porte sur un champ', async () => {
    await rendre();
    const enregistrer = () => bouton(/Enregistrer la vue/)!;
    expect(enregistrer().disabled).toBe(true);
    await act(async () => { bouton(/^Filtres/)!.click(); });
    await laisserRepondre();
    // « Urgent » (case) est le premier champ : sa condition est complète d'emblée.
    await act(async () => { bouton(/Ajouter une condition/)!.click(); });
    await laisserRepondre();
    expect(enregistrer().disabled, 'grisé alors qu’une condition de champ est posée').toBe(false);
  });
});

describe('vue Liste — colonnes de champs', () => {
  it('affiche la colonne d’un champ choisi, avec sa valeur formatée', async () => {
    colonnesReglees = ['client', 'etape', 'cf:f-type'];
    await rendre();
    await act(async () => { bouton(/Vue liste/)!.click(); });
    await laisserRepondre();
    const entetes = [...conteneur.querySelectorAll('th')].map((t) => t.textContent?.trim());
    expect(entetes).toEqual(['Client', 'Étape', 'Type de service']);
    const lignes = [...conteneur.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()));
    expect(lignes).toContainEqual(['Alice Alpha', 'Nouveau lead', 'Commercial']);
    expect(lignes).toContainEqual(['Bob Bravo', 'Nouveau lead', 'Résidentiel']);
    // Le même « Gérer les champs » que la liste Clients.
    expect(bouton(/Gérer les champs/)).toBeTruthy();
  });

  it('sans réglage : les colonnes habituelles, et un clic sur l’en-tête d’un champ trie', async () => {
    colonnesReglees = ['client', 'cf:f-type'];
    await rendre();
    await act(async () => { bouton(/Vue liste/)!.click(); });
    await laisserRepondre();
    const noms = () => [...conteneur.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent?.trim());
    await act(async () => { bouton(/Trier par Type de service/)!.click(); });
    await laisserRepondre();
    // Ordre des options : Résidentiel (Bob) avant Commercial (Alice).
    expect(noms()).toEqual(['Bob Bravo', 'Alice Alpha']);
    await act(async () => { bouton(/Trier par Type de service/)!.click(); });
    await laisserRepondre();
    expect(noms()).toEqual(['Alice Alpha', 'Bob Bravo']);
  });
});

describe('Nouveau deal sur un contact qui a déjà un deal ouvert', () => {
  async function creerAvecValeursParDefaut() {
    await act(async () => { bouton(/nouveau deal/i)!.click(); });
    await act(async () => { bouton(/nouveau contact/i)!.click(); });
    await laisserRepondre();
    const lab = [...conteneur.querySelectorAll('label')].find((l) => /Prénom/.test(l.textContent ?? ''));
    const prenom = [...conteneur.querySelectorAll('input')].find((e) => e.id === lab?.getAttribute('for')) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(prenom, 'Alice');
      prenom.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const envoyer = boutons().find((b) => b.getAttribute('type') === 'submit');
    await act(async () => { envoyer!.click(); });
    await laisserRepondre();
  }

  it('complète SEULEMENT les champs vides du deal existant, et le dit', async () => {
    // « Référé par » = Marc et « Nombre de fenêtres » = 12 sont préremplis.
    champsDeal = [REFERE, FENETRES];
    creerDealMock.mockResolvedValue({ dealId: 'd-existant', fusionne: true, dealExistant: true, pipelineId: 'p1' });
    // Le deal existant a DÉJÀ « Référé par » = Julie : on n'y touche pas.
    lireValeursMock.mockResolvedValue({ fields: [REFERE, FENETRES], folders: [], values: { 'f-ref': v('f-ref', 'Julie', 2) } });
    await rendre();
    await creerAvecValeursParDefaut();

    expect(lireValeursMock).toHaveBeenCalledWith('deal', 'd-existant');
    expect(ecrireValeursMock).toHaveBeenCalledTimes(1);
    // Version 0 : « doit encore être vide » — un remplissage concurrent serait un conflit, pas un écrasement.
    expect(ecrireValeursMock).toHaveBeenCalledWith('deal', 'd-existant', [{ field_id: 'f-nb', value: 12, version: 0 }]);
    expect(toastSucces).toHaveBeenCalledWith(expect.stringContaining('les champs vides y ont été complétés'));
  });

  it('n’écrit rien quand tous les champs du deal existant sont déjà remplis', async () => {
    champsDeal = [REFERE];
    creerDealMock.mockResolvedValue({ dealId: 'd-existant', fusionne: true, dealExistant: true, pipelineId: 'p1' });
    lireValeursMock.mockResolvedValue({ fields: [REFERE], folders: [], values: { 'f-ref': v('f-ref', 'Julie', 2) } });
    await rendre();
    await creerAvecValeursParDefaut();
    expect(ecrireValeursMock).not.toHaveBeenCalled();
    expect(toastSucces).toHaveBeenCalledWith(expect.stringContaining('on l\'a gardé'));
  });

  it('un deal NEUF reçoit toutes ses valeurs, sans lecture préalable', async () => {
    champsDeal = [REFERE, FENETRES];
    creerDealMock.mockResolvedValue({ dealId: 'd-neuf', fusionne: false, dealExistant: false, pipelineId: 'p1' });
    await rendre();
    await creerAvecValeursParDefaut();
    expect(lireValeursMock).not.toHaveBeenCalled();
    expect(ecrireValeursMock).toHaveBeenCalledWith('deal', 'd-neuf', [{ field_id: 'f-ref', value: 'Marc' }, { field_id: 'f-nb', value: 12 }]);
  });
});
