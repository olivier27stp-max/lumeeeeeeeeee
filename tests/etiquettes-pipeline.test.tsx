// @vitest-environment jsdom
//
// Étape 3 du plan « Étiquettes et champs dans la pipeline » : les étiquettes
// du CLIENT (D1), là où le vendeur travaille — sur le VRAI board.
//
//   · la carte montre les étiquettes du client en couleur, 2 puis « +N » ;
//   · Filtres → « Étiquettes du client » : a toutes / a au moins une / n'a pas,
//     compté par le badge et « Enregistrer la vue », gardé dans la vue ;
//   · actions en lot : l'étiquette va sur les CLIENTS distincts des deals
//     cochés, après confirmation ;
//   · en-tête de la fiche du deal : lecture seule sans « clients.update » ;
//   · « Nouveau deal » pose les étiquettes choisies sur le client créé ;
//   · la liste Clients filtre EN BASE (jointure client_tags).
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

const confirmerMock = vi.fn(async (..._a: any[]) => true);
vi.mock('../src/components/ui/ConfirmDialog', () => ({ confirmer: (...a: any[]) => confirmerMock(...a) }));

let perms: { role: string; permissions: Record<string, boolean> } = { role: 'owner', permissions: {} };
vi.mock('../src/hooks/usePermissions', () => ({ usePermissions: () => perms }));

const fetchVuesMock = vi.fn(async (..._a: any[]) => [] as any[]);
const creerVueMock = vi.fn(async (..._a: any[]) => 'v-neuve');
const creerDealMock = vi.fn(async (..._a: any[]) => ({ dealId: 'd-neuf', fusionne: false, dealExistant: false, pipelineId: 'p1', clientId: 'c-neuf' }) as any);
const journalMock = vi.fn(async (..._a: any[]) => {});
vi.mock('../src/lib/pipelineVentesApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/pipelineVentesApi');
  return {
    ...reel,
    fetchVues: (...a: any[]) => fetchVuesMock(...a),
    creerVue: (...a: any[]) => creerVueMock(...a),
    supprimerVue: async () => {},
    creerDealManuel: (...a: any[]) => creerDealMock(...a),
    journaliserLot: (...a: any[]) => journalMock(...a),
    rechercherClientsPourDeal: async () => [],
    rechercherDevisPourDeal: async () => [],
  };
});

vi.mock('../src/lib/champsPersoApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/champsPersoApi');
  return {
    ...reel,
    listerChamps: async () => ({ fields: [], folders: [] }),
    lireCartesPipeline: async () => [],
    lireValeursLot: async () => ({}),
    filtrerParChamps: async () => [],
    lireFuseau: async () => 'America/Toronto',
  };
});
vi.mock('../src/lib/colonnesTableauApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/colonnesTableauApi');
  return { ...reel, lireColonnesTableau: async () => null, enregistrerColonnesTableau: async () => {} };
});

// ── Étiquettes ───────────────────────────────────────────────
const CATALOGUE = [
  { nom: 'Commercial', couleur: '#2563eb', nb_clients: 1, catalogue: true },
  { nom: 'Été', couleur: '#f59e0b', nb_clients: 1, catalogue: true },
  { nom: 'VIP', couleur: '#dc2626', nb_clients: 2, catalogue: true },
];
const PAR_CLIENT: Record<string, string[]> = { c1: ['Commercial', 'Été', 'VIP'], c2: ['VIP'] };
const lotMock = vi.fn(async (ids: string[]) => Object.fromEntries(ids.filter((i) => PAR_CLIENT[i]).map((i) => [i, PAR_CLIENT[i]])));
const poserMock = vi.fn(async (..._a: any[]) => {});
const retirerMock = vi.fn(async (..._a: any[]) => {});
vi.mock('../src/lib/etiquettesApi', async () => {
  const reel = await vi.importActual<any>('../src/lib/etiquettesApi');
  return {
    ...reel,
    listerEtiquettes: async () => CATALOGUE,
    etiquettesDesClients: (ids: string[]) => lotMock(ids),
    poserEtiquette: (...a: any[]) => poserMock(...a),
    retirerEtiquette: (...a: any[]) => retirerMock(...a),
    creerEtiquette: async (nom: string) => ({ nom, couleur: '#000000', existait: false }),
  };
});

import PipelineBoard from '../src/components/pipeline/PipelineBoard';
import EtiquettesDuClient from '../src/components/etiquettes/EtiquettesDuClient';
import {
  FILTRE_ETIQUETTES_VIDE, clientsDistincts, correspondEtiquettes, etiquettesDepuisUrl, etiquettesDepuisVue,
  etiquettesVersVue, nbFiltresEtiquettes,
} from '../src/lib/etiquettesFiltre';
import { jointureEtiquettes } from '../src/lib/clientsApi';

const ETAPES = [
  { id: 'e1', pipeline_id: 'p1', name_fr: 'Nouveau lead', name_en: 'New', guidance_fr: '', guidance_en: '', position: 1, kind: 'open', probability: 20, show_in_reports: true, archived_at: null },
] as any[];

const ilYa = (j: number) => new Date(Date.now() - j * 86_400_000).toISOString();
function deal(id: string, client_id: string | null, prenom: string, nom: string) {
  return {
    id, pipeline_id: 'p1', stage_id: 'e1', client_id, assigned_user_id: null, source: 'web',
    utm_source: null, utm_medium: null, utm_campaign: null, utm_content: null, fbclid: null,
    job_id: null, quote_id: null, first_contacted_at: ilYa(1), last_activity_at: ilYa(1),
    stage_entered_at: ilYa(1), won_at: null, lost_at: null, lost_reason: null, lost_from_stage_id: null,
    expected_close_date: null, pin_id: null, field_rep_id: null, created_at: ilYa(2),
    client: { first_name: prenom, last_name: nom, company: null, email: null, phone: null, address: null },
  } as any;
}
// Alice a deux deals (même client c1) ; Carl n'a aucune étiquette ; Dany n'a pas de client.
const DEALS = [
  deal('d1', 'c1', 'Alice', 'Alpha'),
  deal('d2', 'c2', 'Bob', 'Bravo'),
  deal('d3', 'c3', 'Carl', 'Charlie'),
  deal('d4', 'c1', 'Alice', 'Deux'),
  deal('d5', null, 'Dany', 'Sansclient'),
];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function laisserRepondre() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function rendre(noeud: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => {
    racine.render(<QueryClientProvider client={qc}><MemoryRouter>{noeud}</MemoryRouter></QueryClientProvider>);
  });
  await laisserRepondre();
}
const rendreBoard = () => rendre(
  <PipelineBoard
    deals={DEALS} etapes={ETAPES} montants={{}} membres={[]}
    pipelines={[{ id: 'p1', name: 'Principal', is_default: true }]} pipelineActif="p1"
    onChangerPipeline={vi.fn()} onOuvrir={vi.fn()} onDeplacer={vi.fn()} onAssigner={vi.fn()}
  />,
);

const boutons = () => [...conteneur.querySelectorAll('button')] as HTMLButtonElement[];
const bouton = (re: RegExp) => boutons().find((b) => re.test((b.textContent ?? '').trim()) || re.test(b.getAttribute('aria-label') ?? ''));
/** Les noms de clients affichés sur les cartes (1re ligne de chaque carte). */
const nomsCartes = () => [...conteneur.querySelectorAll('[role="button"] p.font-semibold')].map((p) => p.textContent);
/** La pastille à bascule d'une étiquette dans la rangée `legende` du filtre. */
function choix(legende: RegExp, nom: string): HTMLButtonElement {
  const fs = [...conteneur.querySelectorAll('fieldset')].find((f) => legende.test(f.querySelector('legend')?.textContent ?? ''));
  const b = [...(fs?.querySelectorAll('button') ?? [])].find((x) => x.textContent?.replace(/\s/g, '') === nom.replace(/\s/g, ''));
  if (!b) throw new Error(`pas de choix « ${nom} » sous ${legende}`);
  return b as HTMLButtonElement;
}
async function clic(el: Element | undefined | null) {
  if (!el) throw new Error('élément introuvable');
  await act(async () => { (el as HTMLElement).click(); });
  await laisserRepondre();
}
async function saisir(el: HTMLInputElement | HTMLSelectElement, valeur: string) {
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, valeur);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  await laisserRepondre();
}

beforeEach(() => {
  perms = { role: 'owner', permissions: {} };
  fetchVuesMock.mockReset().mockResolvedValue([]);
  creerVueMock.mockClear();
  creerDealMock.mockClear();
  confirmerMock.mockClear().mockResolvedValue(true);
  poserMock.mockClear();
  retirerMock.mockClear();
  lotMock.mockClear();
  journalMock.mockClear();
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

// ── Logique pure ─────────────────────────────────────────────

describe('filtre d’étiquettes — logique', () => {
  const f = (avec: string[], mode: 'toutes' | 'une' = 'une', sans: string[] = []) => ({ avec, mode, sans });

  it('au moins une / toutes / exclusion, sans tenir compte de la casse', () => {
    expect(correspondEtiquettes(['VIP', 'Été'], FILTRE_ETIQUETTES_VIDE)).toBe(true);
    expect(correspondEtiquettes(undefined, FILTRE_ETIQUETTES_VIDE)).toBe(true);
    expect(correspondEtiquettes(['VIP'], f(['vip', 'Été']))).toBe(true);
    expect(correspondEtiquettes(['VIP'], f(['VIP', 'Été'], 'toutes'))).toBe(false);
    expect(correspondEtiquettes(['VIP', 'été'], f(['VIP', 'Été'], 'toutes'))).toBe(true);
    expect(correspondEtiquettes(undefined, f(['VIP']))).toBe(false);
    expect(correspondEtiquettes(['VIP', 'Été'], f([], 'une', ['ÉTÉ']))).toBe(false);
    expect(correspondEtiquettes(undefined, f([], 'une', ['Été']))).toBe(true);
    expect(correspondEtiquettes(['VIP', 'Été'], f(['VIP'], 'une', ['Été']))).toBe(false);
  });

  it('compte un filtre par rangée posée', () => {
    expect(nbFiltresEtiquettes(FILTRE_ETIQUETTES_VIDE)).toBe(0);
    expect(nbFiltresEtiquettes(f(['VIP', 'Été']))).toBe(1);
    expect(nbFiltresEtiquettes(f(['VIP'], 'une', ['Été']))).toBe(2);
  });

  it('aller-retour par une vue enregistrée (objet de chaînes)', () => {
    const vue = etiquettesVersVue(f(['VIP', 'Été'], 'toutes', ['Commercial']));
    expect(Object.values(vue).every((v) => typeof v === 'string')).toBe(true);
    expect(etiquettesDepuisVue(vue)).toEqual(f(['VIP', 'Été'], 'toutes', ['Commercial']));
    expect(etiquettesVersVue(FILTRE_ETIQUETTES_VIDE)).toEqual({});
    // Une vieille vue, ou du JSON cassé : ignoré, jamais bloquant.
    expect(etiquettesDepuisVue({ texte: 'x' })).toEqual(FILTRE_ETIQUETTES_VIDE);
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(etiquettesDepuisVue({ etiquettes: '{pas du json', etiquettes_sans: '["Été", 3]' })).toEqual(f([], 'une', ['Été']));
    erreur.mockRestore();
  });

  it('lit ?etiquette= de l’URL, décodé et répétable', () => {
    expect(etiquettesDepuisUrl(`?etiquette=${encodeURIComponent('Été à faire')}`)).toEqual(['Été à faire']);
    expect(etiquettesDepuisUrl('?etiquette=VIP&etiquette=Chaud&etiquette=VIP')).toEqual(['VIP', 'Chaud']);
    expect(etiquettesDepuisUrl('?autre=1')).toEqual([]);
  });

  it('les clients DISTINCTS d’une sélection, sans les deals orphelins', () => {
    expect(clientsDistincts(DEALS, ['d1', 'd4', 'd2', 'd5']).sort()).toEqual(['c1', 'c2']);
  });

  it('liste Clients : jointure client_tags en base, une par étiquette en mode « toutes »', () => {
    const appels: string[] = [];
    const q: any = {
      eq: (c: string, v: unknown) => { appels.push(`eq ${c}=${v}`); return q; },
      in: (c: string, v: unknown[]) => { appels.push(`in ${c}=${v.join('|')}`); return q; },
    };
    expect(jointureEtiquettes(null).select).toBe('');
    const une = jointureEtiquettes({ noms: ['VIP', 'Été'], mode: 'une' });
    expect(une.select).toBe(',et0:client_tags!inner(tag)');
    une.appliquer(q);
    expect(appels).toEqual(['in et0.tag=VIP|Été']);
    appels.length = 0;
    const toutes = jointureEtiquettes({ noms: ['VIP', 'Été'], mode: 'toutes' });
    expect(toutes.select).toBe(',et0:client_tags!inner(tag),et1:client_tags!inner(tag)');
    toutes.appliquer(q);
    expect(appels).toEqual(['eq et0.tag=VIP', 'eq et1.tag=Été']);
  });
});

// ── Board ────────────────────────────────────────────────────

describe('carte du deal — étiquettes du client', () => {
  it('une seule requête groupée pour les clients des deals', async () => {
    await rendreBoard();
    expect(lotMock).toHaveBeenCalledTimes(1);
    expect(lotMock.mock.calls[0][0]).toEqual(['c1', 'c2', 'c3']);
  });

  it('deux pastilles en couleur, puis « +N » qui nomme le reste', async () => {
    await rendreBoard();
    const groupes = [...conteneur.querySelectorAll('[role="group"][aria-label^="Étiquettes :"]')];
    // Deux cartes d'Alice (c1) + Bob (c2) ; Carl et Dany n'en ont pas.
    expect(groupes).toHaveLength(3);
    const alice = groupes.find((g) => g.getAttribute('aria-label') === 'Étiquettes : Commercial, Été, VIP')!;
    const pastilles = [...alice.querySelectorAll('span[style]')];
    expect(pastilles.map((p) => p.textContent)).toEqual(['Commercial', 'Été']);
    expect((pastilles[0] as HTMLElement).style.backgroundColor).toBe('rgb(37, 99, 235)');
    const plus = [...alice.querySelectorAll('span')].find((s) => s.textContent === '+1')!;
    expect(plus.getAttribute('title')).toBe('VIP');
  });

  it('vue Liste : colonne « Étiquettes »', async () => {
    await rendreBoard();
    await clic(bouton(/Vue liste/));
    expect([...conteneur.querySelectorAll('th')].map((t) => t.textContent)).toContain('Étiquettes');
    const ligneBob = [...conteneur.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('Bob Bravo'))!;
    expect(ligneBob.textContent).toContain('VIP');
  });
});

describe('filtre « Étiquettes » du board', () => {
  it('au moins une, toutes, et « n’a pas » ; compté par le badge et « Enregistrer la vue »', async () => {
    await rendreBoard();
    expect(nomsCartes()).toHaveLength(5);
    expect(bouton(/Enregistrer la vue/)!.disabled).toBe(true);
    await clic(bouton(/^Filtres/));

    await clic(choix(/A l’étiquette/, 'VIP'));
    expect(nomsCartes().sort()).toEqual(['Alice Alpha', 'Alice Deux', 'Bob Bravo']);
    expect(bouton(/Enregistrer la vue/)!.disabled, 'une étiquette seule doit pouvoir s’enregistrer').toBe(false);
    expect(bouton(/^Filtres/)!.textContent).toContain('1');

    await clic(choix(/A l’étiquette/, 'Été'));
    // Au moins une : VIP ou Été → toujours Alice ×2 et Bob.
    expect(nomsCartes()).toHaveLength(3);
    const mode = [...conteneur.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'toutes')) as HTMLSelectElement;
    await saisir(mode, 'toutes');
    expect(nomsCartes().sort()).toEqual(['Alice Alpha', 'Alice Deux']);

    // Exclusion seule : pas « Été » → Bob, Carl, Dany.
    await clic(choix(/A l’étiquette/, 'VIP'));
    await clic(choix(/A l’étiquette/, 'Été'));
    await clic(choix(/N’a pas l’étiquette/, 'Été'));
    expect(nomsCartes().sort()).toEqual(['Bob Bravo', 'Carl Charlie', 'Dany Sansclient']);

    await clic(bouton(/^Effacer les filtres$/));
    expect(nomsCartes()).toHaveLength(5);
    expect(bouton(/Enregistrer la vue/)!.disabled).toBe(true);
  });

  it('enregistré dans la vue, puis restauré en rouvrant la vue', async () => {
    await rendreBoard();
    await clic(bouton(/^Filtres/));
    await clic(choix(/A l’étiquette/, 'VIP'));
    await clic(choix(/N’a pas l’étiquette/, 'Été'));
    await clic(bouton(/Enregistrer la vue/));
    const nom = [...conteneur.querySelectorAll('input')].find((i) => i.placeholder?.startsWith('Ex. : Soumissions')) as HTMLInputElement;
    await saisir(nom, 'VIP sans été');
    await act(async () => { nom.form!.requestSubmit(); });
    await laisserRepondre();
    expect(creerVueMock).toHaveBeenCalledTimes(1);
    const filtres = creerVueMock.mock.calls[0][2];
    expect(filtres).toMatchObject({ etiquettes: '["VIP"]', etiquettes_mode: 'une', etiquettes_sans: '["Été"]' });

    // Rouvrir : la vue en base remet le filtre (Bob seul : VIP sans Été).
    fetchVuesMock.mockResolvedValue([{ id: 'v1', pipeline_id: 'p1', user_id: 'u', nom: 'VIP sans été', filtres, tri: null, affichage: 'kanban', position: 0 }]);
    act(() => racine.unmount());
    racine = createRoot(conteneur);
    await rendreBoard();
    expect(nomsCartes()).toHaveLength(5);
    await clic([...conteneur.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'VIP sans été'));
    expect(nomsCartes()).toEqual(['Bob Bravo']);
    // « Tous » efface aussi le filtre d'étiquettes.
    await clic([...conteneur.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Tous'));
    expect(nomsCartes()).toHaveLength(5);
  });
});

describe('actions en lot — étiquettes', () => {
  async function cocher(nom: string) {
    const c = [...conteneur.querySelectorAll('input[type="checkbox"]')].find((i) => i.getAttribute('aria-label') === `Sélectionner ${nom}`);
    await clic(c);
  }
  async function choisirDansSelecteur(nom: string) {
    await clic(boutons().find((b) => b.textContent?.trim() === 'Étiquette'));
    const opt = [...conteneur.querySelectorAll('[role="option"]')].find((o) => o.textContent === nom)!;
    await act(async () => { opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    await laisserRepondre();
  }

  it('ajoute aux CLIENTS distincts, une fois chacun, après confirmation qui prévient des automatisations', async () => {
    await rendreBoard();
    await cocher('Alice Alpha');
    await cocher('Alice Deux');
    await cocher('Bob Bravo');
    await cocher('Dany Sansclient');
    await clic(bouton(/^Ajouter une étiquette$/));
    expect(conteneur.textContent).toContain('2 client(s) pour 4 deal(s)');
    expect(conteneur.textContent).toContain('1 deal(s) sans client ignoré(s)');
    await choisirDansSelecteur('Été');
    await clic(bouton(/^Appliquer$/));

    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(confirmerMock.mock.calls[0][0].message).toContain('« Étiquette ajoutée » partiront pour chaque client');
    expect(confirmerMock.mock.calls[0][0].message).toContain('2 client(s)');
    expect(poserMock.mock.calls.map((c) => c.join(':')).sort()).toEqual(['c1:Été', 'c2:Été']);
    expect(journalMock).toHaveBeenCalledWith(expect.objectContaining({ total: 2, reussis: 2, echoues: 0, cibles: ['c1', 'c2'] }));
  });

  it('rien n’est écrit si on annule la confirmation ; « Retirer » passe par retirerEtiquette', async () => {
    confirmerMock.mockResolvedValue(false);
    await rendreBoard();
    await cocher('Bob Bravo');
    await clic(bouton(/^Retirer une étiquette$/));
    await choisirDansSelecteur('VIP');
    await clic(bouton(/^Appliquer$/));
    expect(retirerMock).not.toHaveBeenCalled();
    confirmerMock.mockResolvedValue(true);
    await clic(bouton(/^Appliquer$/));
    expect(retirerMock).toHaveBeenCalledWith('c2', 'VIP');
    expect(poserMock).not.toHaveBeenCalled();
  });
});

describe('Nouveau deal — étiquettes du client', () => {
  it('pose les étiquettes choisies sur le client du deal créé', async () => {
    await rendreBoard();
    await clic(bouton(/nouveau deal/i));
    const lab = [...conteneur.querySelectorAll('label')].find((l) => /Contact principal/.test(l.textContent ?? ''));
    await saisir([...conteneur.querySelectorAll('input')].find((e) => e.id === lab?.getAttribute('for')) as HTMLInputElement, 'Zoé');
    await clic(boutons().find((b) => b.textContent?.trim() === 'Étiquette'));
    const opt = [...conteneur.querySelectorAll('[role="option"]')].find((o) => o.textContent === 'VIP')!;
    await act(async () => { opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    await laisserRepondre();
    expect(poserMock).not.toHaveBeenCalled();
    await clic(boutons().find((b) => b.getAttribute('type') === 'submit'));
    expect(creerDealMock).toHaveBeenCalledTimes(1);
    expect(poserMock).toHaveBeenCalledWith('c-neuf', 'VIP');
  });
});

// ── Fiche du deal ────────────────────────────────────────────

describe('en-tête de la fiche du deal', () => {
  it('sans « clients.update » : pastilles en lecture seule, ni ajout ni retrait', async () => {
    perms = { role: 'technician', permissions: { 'leads.update': true } };
    await rendre(<EtiquettesDuClient clientId="c1" fr />);
    expect(conteneur.textContent).toContain('Commercial');
    expect(bouton(/^Étiquette$/)).toBeUndefined();
    expect(bouton(/Retirer l’étiquette/)).toBeUndefined();
  });

  it('avec le droit : on retire sur place, sur le CLIENT du deal', async () => {
    perms = { role: 'sales_rep', permissions: { 'clients.update': true } };
    await rendre(<EtiquettesDuClient clientId="c2" fr />);
    expect(bouton(/^Étiquette$/)).toBeTruthy();
    await clic(bouton(/Retirer l’étiquette VIP/));
    expect(retirerMock).toHaveBeenCalledWith('c2', 'VIP');
  });
});
