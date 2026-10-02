// @vitest-environment jsdom
//
// L'ÉDITEUR D'AUTOMATISATIONS — corrections du triage « actions » (2026-10-01),
// côté PAGE : on monte la VRAIE `AutomationBuilderPage` derrière un vrai
// routeur, avec le VRAI catalogue, et on regarde ce que l'écran dit et ce qui
// part au serveur. Un bloc `describe` par ligne du triage.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = '11111111-1111-1111-1111-111111111111';
const ID = 'aaaaaaaa-0000-4000-8000-000000000001';

type Regle = Record<string, unknown> & { id: string };

function regle(over: Record<string, unknown> = {}): Regle {
  return {
    id: ID, org_id: ORG, name: 'Relance devis', description: null,
    trigger_event: 'quote.sent', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }],
    steps: [
      { id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: 'e2' },
      { id: 'e2', type: 'action', nom: null, action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
    ],
    settings: null, is_active: false, is_preset: false, preset_key: null,
    folder_id: null, deleted_at: null, lumi_conversation: [],
    created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
    ...over,
  };
}

const etat = vi.hoisted(() => ({
  regles: [] as Array<Record<string, unknown> & { id: string }>,
  champs: [] as unknown[],
  membres: [] as Array<{ user_id: string; nom: string }> | Error,
}));
const api = vi.hoisted(() => ({
  editeur: vi.fn(),
  creer: vi.fn(),
  modifier: vi.fn(),
  publier: vi.fn(),
  stats: vi.fn(),
  lumi: vi.fn(),
  version: vi.fn(),
}));
const confirmerMock = vi.hoisted(() => vi.fn(async (_o: unknown) => true));
const toasts = vi.hoisted(() => ({
  erreur: [] as string[], succes: [] as string[], info: [] as string[],
  /** Les boutons d'action des toasts de succès (« Ouvrir »…), par libellé. */
  actions: [] as Array<{ label: string; onClick: () => void }>,
}));
type OptionsToast = { action?: { label: string; onClick: () => void } };

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: (m: string, o?: OptionsToast) => {
      toasts.erreur.push(String(m));
      if (o?.action) toasts.actions.push(o.action);
    },
    success: (m: string, o?: OptionsToast) => {
      toasts.succes.push(String(m));
      if (o?.action) toasts.actions.push(o.action);
    },
    info: (m: string) => { toasts.info.push(String(m)); },
  }),
}));
vi.mock('../../../src/lib/automationBuilderApi', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/automationBuilderApi')>()),
  chargerEditeur: (id: string | null) => api.editeur(id),
  creerAutomatisation: (b: unknown) => api.creer(b),
  modifierAutomatisation: (id: string, p: unknown, version?: string | null) => api.modifier(id, p, version),
  lireVersionAutomatisation: (id: string) => api.version(id),
  genererParcoursAvecLumi: (...a: unknown[]) => api.lumi(...a),
  chargerMembres: vi.fn(async () => { if (etat.membres instanceof Error) throw etat.membres; return etat.membres; }),
  chargerEtiquettes: vi.fn(async () => []),
  apercuAutomatisation: vi.fn(async () => ({ client: null, message: 'Aucun client', apercu: [] })),
  changerPublication: (id: string, a: boolean) => api.publier(id, a),
  chargerStatistiques: (id?: string) => api.stats(id),
  restaurerAutomatisation: vi.fn(),
}));
vi.mock('../../../src/lib/supabase', () => {
  const chaine: unknown = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'then') return (res: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(res);
      return () => chaine;
    },
    apply: () => chaine,
  });
  return {
    supabase: {
      from: () => chaine,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getUser: async () => ({ data: { user: null } }),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});
vi.mock('../../../src/hooks/usePlanFeature', () => ({ usePlanFeature: () => ({ hasFeature: true, loading: false }) }));
vi.mock('../../../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: false, loading: false }) }));
vi.mock('../../../src/components/champs/automatisations', async (orig) => ({
  ...(await orig<typeof import('../../../src/components/champs/automatisations')>()),
  useChampsTous: () => etat.champs,
}));
vi.mock('../../../src/lib/pipelineVentesApi', () => ({ fetchPipelines: vi.fn(async () => []), fetchStages: vi.fn(async () => []) }));
vi.mock('../../../src/lib/servicesApi', () => ({ listPredefinedServices: vi.fn(async () => []) }));
vi.mock('../../../src/lib/reservationApi', () => ({ apercuClientsInactifs: vi.fn(async () => 0) }));
vi.mock('../../../src/components/ui/ConfirmDialog', () => ({
  confirmer: (o: unknown) => confirmerMock(o),
  default: () => null,
}));
vi.mock('../../../src/components/automations/OngletJournaux', () => ({
  OngletJournaux: () => <p>journaux</p>,
  OngletHistorique: () => <p>historique</p>,
}));

import AutomationBuilderPage from '../../../src/pages/AutomationBuilderPage';
import { LanguageProvider } from '../../../src/i18n';
import { ACTIONS, DECLENCHEURS } from '../../../src/lib/automationCatalogue';

function Lieu() {
  const l = useLocation();
  return <output data-testid="lieu">{l.pathname + l.search}</output>;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  etat.regles = [regle()];
  etat.champs = [];
  etat.membres = [];
  api.editeur.mockReset();
  api.editeur.mockImplementation(async (id: string | null) => ({
    rule: etat.regles.find((r) => r.id === id) ?? null,
    catalogue: { declencheurs: DECLENCHEURS.filter((d) => !d.drapeau), actions: ACTIONS },
    autres: [],
  }));
  api.creer.mockReset();
  api.creer.mockImplementation(async (b: Record<string, unknown>) => ({ ...regle({ id: 'neuve-1', steps: [] }), ...b }));
  api.modifier.mockReset();
  api.modifier.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({ ...(etat.regles.find((r) => r.id === id) ?? regle({ id })), ...patch }));
  api.publier.mockReset();
  api.publier.mockImplementation(async () => undefined);
  api.stats.mockReset();
  api.stats.mockImplementation(async () => ({ par_regle: {}, par_etape: {} }));
  api.lumi.mockReset();
  api.version.mockReset();
  api.version.mockImplementation(async () => null);
  confirmerMock.mockReset();
  confirmerMock.mockImplementation(async () => true);
  toasts.erreur = []; toasts.succes = []; toasts.info = []; toasts.actions = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem('lume-language', 'fr');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function attendre(n = 8) {
  for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve(); });
}

async function ouvrir(chemin = `/automations/${ID}`) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[chemin]}>
        <LanguageProvider>
          <Routes>
            <Route path="/automations/:id" element={<><AutomationBuilderPage /><Lieu /></>} />
            <Route path="/automations" element={<Lieu />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  await attendre();
}

const boutons = (dans: ParentNode = container) => Array.from(dans.querySelectorAll('button'));
const bouton = (texte: string, dans: ParentNode = container) => boutons(dans).find((b) => b.textContent?.includes(texte));
const boutonExact = (texte: string, dans: ParentNode = container) => boutons(dans).find((b) => b.textContent?.trim() === texte);
function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('rien à cliquer');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
/** Changer la valeur d'un champ comme l'utilisateur (setter natif). */
function saisir(el: Element | null | undefined, v: string) {
  if (!el) throw new Error('champ introuvable');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
  act(() => { el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
}
const lieu = () => container.querySelector('[data-testid="lieu"]')?.textContent ?? '';
const barreDuHaut = () => container.querySelector('header')?.textContent ?? '';
const panneaux = () => Array.from(container.querySelectorAll('aside')).map((a) => a.getAttribute('aria-label'));
const PANNEAU_ETAPE = 'Modifier l’étape';
const panneauEtape = () => container.querySelector(`aside[aria-label="${PANNEAU_ETAPE}"]`);
const tiroirActions = () => container.querySelector('aside[aria-label="Actions"]');
/** La carte d'une étape du canevas (son bouton principal). */
const carteEtape = (texte: string) => boutons().find((b) => b.textContent?.includes(texte) && b.parentElement?.className.includes('w-[260px]'));
/** Les titres des cartes d'étape, dans l'ordre du canevas. */
const cartes = () => boutons()
  // Le bouton principal de la carte — pas son menu « … », qui porte un aria-label.
  .filter((b) => b.parentElement?.className.includes('w-[260px]') && b.parentElement?.className.includes('relative') && !b.getAttribute('aria-label'))
  .map((b) => b.querySelector('.font-medium')?.textContent ?? '');

/** « Ajouter » (fin du parcours), puis le choix dans le tiroir. */
async function ajouterParLeTiroir(titre: string) {
  cliquer(boutonExact('Ajouter'));
  await attendre(2);
  cliquer(bouton(titre, tiroirActions() ?? undefined));
  await attendre(2);
}
/** Les `steps` du dernier enregistrement parti au serveur. */
const derniersSteps = () => (api.modifier.mock.calls.at(-1)?.[1] as { steps?: Array<Record<string, unknown>> } | undefined)?.steps ?? null;

// ─── Priorité — bug n° 1 (constat A-01) ─────────────────────────

describe('A-01 — Lumi modifie l’étape dont le panneau est ouvert : le panneau montre SON texte', () => {
  const EXEMPLE = 'Bonjour [client_name], c’est [company_name]. Merci !';
  const DE_LUMI = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard. Réglez-la ici : [invoice_link]. [company_name]';
  /** Une automatisation « Facture en retard » sans étape encore (action provisoire de l'éditeur). */
  const vide = () => regle({ trigger_event: 'invoice.overdue', actions: [{ type: 'send_sms', config: { body: 'À compléter' } }], steps: [] });
  const zone = () => panneauEtape()?.querySelector('textarea') ?? null;

  /** Lumi rend le même parcours, le texto réécrit (même identifiant d'étape, comme le vrai modèle). */
  function lumiReecritLeTexto() {
    api.lumi.mockImplementation(async (_demande: string, _langue: string, contexte: { parcoursActuel?: { steps?: Array<Record<string, unknown>> } | null }) => ({
      nom: 'Relance devis', trigger_event: 'invoice.overdue',
      resume: `J’ai remplacé le texte d’exemple.\n\nNouveau texte :\n• Texto : « ${DE_LUMI} »`,
      steps: (contexte.parcoursActuel?.steps ?? []).map((e) => (e.type === 'action' ? { ...e, action: { type: 'send_sms', config: { body: DE_LUMI } } } : e)),
      autre: null,
    }));
  }
  async function demanderALumi(demande: string) {
    saisir(container.querySelector('textarea[id$="-prompt"]'), demande);
    cliquer(boutonExact('Construire') ?? boutonExact('Envoyer'));
    await attendre(12);
  }

  it('le geste du propriétaire : « Envoyer un texto », puis « change le message » — le panneau resté ouvert montre le texte de Lumi', async () => {
    etat.regles = [vide()];
    lumiReecritLeTexto();
    await ouvrir();
    vi.useFakeTimers();
    cliquer(bouton('Ajouter une première étape'));
    await attendre(2);
    cliquer(bouton('Envoyer un texto', tiroirActions() ?? undefined));
    await attendre(2);
    expect(zone()?.value).toBe(EXEMPLE);

    await demanderALumi('change le message de l’automatisation');
    // Lumi a bien reçu l'étape qu'on venait de choisir (elle est « le parcours à l'écran »).
    const contexte = api.lumi.mock.calls[0][2] as { parcoursActuel: { steps: Array<{ id: string }> } };
    expect(contexte.parcoursActuel.steps.map((e) => e.id)).toEqual(['e1']);

    // À l'écran : la carte ET le panneau disent la même chose.
    expect(zone()?.value).toBe(DE_LUMI);
    expect(carteEtape('Envoyer un texto')?.textContent).toContain('Bonjour [client_first_name]');
    expect(panneauEtape()?.querySelector('[role="alert"]')).toBeNull();

    // Fermer le panneau sans y avoir rien tapé ne demande rien.
    cliquer(panneauEtape()?.querySelector('button[aria-label="Fermer le panneau"]'));
    await attendre();
    expect(confirmerMock).not.toHaveBeenCalled();
    expect(panneaux()).not.toContain(PANNEAU_ETAPE);

    // L'enregistrement automatique écrit le texte de Lumi.
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect((derniersSteps() ?? [])[0]).toMatchObject({ id: 'e1', action: { type: 'send_sms', config: { body: DE_LUMI } } });
  });

  it('« Enregistrer » dans le panneau resté ouvert n’écrase PAS le texte de Lumi', async () => {
    etat.regles = [vide()];
    lumiReecritLeTexto();
    await ouvrir();
    vi.useFakeTimers();
    cliquer(bouton('Ajouter une première étape'));
    await attendre(2);
    cliquer(bouton('Envoyer un texto', tiroirActions() ?? undefined));
    await attendre(2);
    await demanderALumi('change le message de l’automatisation');
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    const ecrits = api.modifier.mock.calls.map((c) => (c[1] as { steps?: Array<{ action?: { config?: { body?: string } } }> }).steps?.[0]?.action?.config?.body).filter(Boolean);
    expect(ecrits.length).toBeGreaterThan(0);
    expect(new Set(ecrits)).toEqual(new Set([DE_LUMI]));
  });

  it('une étape DÉJÀ dans le parcours, panneau ouvert : même chose', async () => {
    lumiReecritLeTexto();
    await ouvrir();
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    expect(zone()?.value).toBe('Bonjour [client_first_name]');
    await demanderALumi('change le message de l’automatisation');
    expect(zone()?.value).toBe(DE_LUMI);
  });

  it('une saisie en cours dans le panneau quand Lumi répond : bandeau, et rien n’est écrasé dans un sens ni dans l’autre', async () => {
    lumiReecritLeTexto();
    await ouvrir();
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    saisir(zone(), 'Mon texte à moi.');
    await demanderALumi('change le message de l’automatisation');
    expect(zone()?.value).toBe('Mon texte à moi.');
    expect(panneauEtape()?.querySelector('[role="alert"]')?.textContent).toContain('Lumi a modifié cette étape pendant que vous l’éditiez.');
    expect(boutonExact('Enregistrer', panneauEtape() ?? undefined)?.disabled).toBe(true);
    // Le canevas, lui, porte bien la version de Lumi.
    expect(carteEtape('Envoyer un texto')?.textContent).toContain('votre facture');
    cliquer(boutonExact('Voir la version de Lumi'));
    expect(zone()?.value).toBe(DE_LUMI);
  });

  it('« Annuler » (flèche du haut) pendant que le panneau est ouvert et intact : le panneau suit le canevas', async () => {
    lumiReecritLeTexto();
    await ouvrir();
    await demanderALumi('change le message de l’automatisation');
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    expect(zone()?.value).toBe(DE_LUMI);
    cliquer(container.querySelector('button[aria-label="Annuler"]'));
    await attendre(2);
    expect(zone()?.value).toBe('Bonjour [client_first_name]');
  });
});

// ─── Triage « éditeur », S-01 ───────────────────────────────────

describe('S-01 — « Ouvrir » une 2e automatisation sur réseau lent : chacune garde SON nom et SON parcours', () => {
  const DEUXIEME = 'bbbbbbbb-0000-4000-8000-000000000002';
  const deuxieme = () => regle({
    id: DEUXIEME, name: 'Réponse du client', trigger_event: 'client.replied',
    steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Texto de la DEUXIÈME' } }, suivant: null }],
  });
  const texteDe = (steps: unknown) => JSON.stringify(steps ?? null);

  /** Lumi pose un parcours dans la 1re ET crée une 2e automatisation (toast « Ouvrir »). */
  function lumiCreeUneDeuxieme() {
    api.lumi.mockImplementation(async () => ({
      nom: 'Relance devis', trigger_event: 'quote.sent', resume: 'Fait.',
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texto de LUMI' } }, suivant: null }],
      autre: { nom: 'Réponse du client', trigger_event: 'client.replied', resume: 'Quand le client répond.', steps: deuxieme().steps },
    }));
    api.creer.mockImplementation(async (b: Record<string, unknown>) => ({ ...deuxieme(), ...b, id: DEUXIEME }));
  }

  it('l’enregistrement automatique de la 1re ne part JAMAIS dans la 2e pendant qu’elle charge — il part dans la 1re', async () => {
    lumiCreeUneDeuxieme();
    // Réseau lent : la 2e automatisation ne finit de charger que quand le test le décide.
    let finirChargement: () => void = () => {};
    api.editeur.mockImplementation((id: string | null) => {
      const reponse = { rule: id === DEUXIEME ? deuxieme() : (etat.regles.find((r) => r.id === id) ?? null), catalogue: { declencheurs: DECLENCHEURS.filter((d) => !d.drapeau), actions: ACTIONS }, autres: [] };
      if (id !== DEUXIEME) return Promise.resolve(reponse);
      return new Promise((ok) => { finirChargement = () => ok(reponse); });
    });
    await ouvrir();
    vi.useFakeTimers();
    saisir(container.querySelector('textarea[id$="-prompt"]'), 'relance mon devis et réponds au client');
    cliquer(boutonExact('Construire') ?? boutonExact('Envoyer'));
    await attendre(12);
    expect(toasts.succes.join('\n')).toContain('« Réponse du client » créée en brouillon');
    api.modifier.mockClear();

    // « Ouvrir », tout de suite : le parcours de Lumi n'est pas encore enregistré dans la 1re.
    await act(async () => { toasts.actions.find((a) => a.label === 'Ouvrir')?.onClick(); });
    await attendre();
    expect(lieu()).toBe(`/automations/${DEUXIEME}`);
    // L'écran a quitté la 1re : il dit qu'il charge, il ne montre plus son parcours.
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Chargement de l’automatisation…');
    expect(container.textContent).not.toContain('Texto de LUMI');

    // Les 3 s de l'enregistrement automatique passent, et bien plus, pendant que la 2e charge.
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await attendre();
    const ecrits = api.modifier.mock.calls.map((c) => ({ id: c[0] as string, patch: c[1] as { name?: string; steps?: unknown } }));
    // Rien n'est parti dans la 2e…
    expect(ecrits.filter((e) => e.id === DEUXIEME)).toEqual([]);
    // … et ce que Lumi venait de poser dans la 1re y est bien enregistré, sous SON nom.
    const dansLaPremiere = ecrits.filter((e) => e.id === ID && e.patch.steps);
    expect(dansLaPremiere).toHaveLength(1);
    expect(dansLaPremiere[0].patch.name).toBe('Relance devis');
    expect(texteDe(dansLaPremiere[0].patch.steps)).toContain('Texto de LUMI');

    // La 2e finit de charger : elle a SON nom et SON parcours, et rien n'attend d'être écrit.
    await act(async () => { finirChargement(); });
    await attendre(12);
    expect(container.querySelector('header')?.textContent).toContain('Réponse du client');
    expect(cartes()).toEqual(['Envoyer un texto']);
    expect(carteEtape('Envoyer un texto')?.textContent).toContain('Texto de la DEUXIÈME');
    expect(barreDuHaut()).toContain('Enregistré');
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await attendre();
    expect(api.modifier.mock.calls.filter((c) => c[0] === DEUXIEME)).toEqual([]);
  });

  it('une modification faite ENSUITE dans la 2e s’écrit dans la 2e, avec sa version à elle', async () => {
    lumiCreeUneDeuxieme();
    api.editeur.mockImplementation(async (id: string | null) => ({
      rule: id === DEUXIEME ? { ...deuxieme(), updated_at: 'V-deuxieme' } : (etat.regles.find((r) => r.id === id) ?? null),
      catalogue: { declencheurs: DECLENCHEURS.filter((d) => !d.drapeau), actions: ACTIONS }, autres: [],
    }));
    await ouvrir();
    vi.useFakeTimers();
    saisir(container.querySelector('textarea[id$="-prompt"]'), 'relance mon devis et réponds au client');
    cliquer(boutonExact('Construire') ?? boutonExact('Envoyer'));
    await attendre(12);
    await act(async () => { toasts.actions.find((a) => a.label === 'Ouvrir')?.onClick(); });
    await attendre(12);
    api.modifier.mockClear();
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    saisir(panneauEtape()?.querySelector('textarea'), 'Texto de la DEUXIÈME, corrigé');
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(api.modifier).toHaveBeenCalledTimes(1);
    const [id, patch, version] = api.modifier.mock.calls[0] as [string, { name: string; steps: unknown }, string];
    expect(id).toBe(DEUXIEME);
    expect(patch.name).toBe('Réponse du client');
    expect(texteDe(patch.steps)).toContain('Texto de la DEUXIÈME, corrigé');
    expect(version).toBe('V-deuxieme');
  });
});

// ─── Triage « éditeur », 05b-canevas-outils-origine:303 ─────────

describe('05b:303 — `actions` suit le parcours : un parcours converti se vide vraiment, sans retomber au « format d’origine »', () => {
  const D_ORIGINE = [{ type: 'send_sms', config: { body: 'Texto d’origine' } }];
  const PROVISOIRE = [{ type: 'send_sms', config: { body: 'À compléter' } }];
  /** Une automatisation fournie : pas d'étapes, des `actions`. */
  const origine = (over: Record<string, unknown> = {}) => regle({ steps: null, actions: D_ORIGINE, ...over });
  const dernierPatch = () => api.modifier.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;
  const avancer = async (ms: number) => {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await attendre();
  };
  async function convertir() {
    cliquer(boutonExact('Convertir en parcours modifiable'));
    await attendre(12);
  }

  it('« Convertir » écrit les étapes ET `actions` en accord, en une seule écriture', async () => {
    etat.regles = [origine()];
    await ouvrir();
    expect(container.textContent).toContain('Parcours au format d’origine');
    await convertir();
    expect(api.modifier).toHaveBeenCalledTimes(1);
    expect(dernierPatch()).toEqual({
      steps: [{ id: 'origine-0', type: 'action', action: { type: 'send_sms', config: { body: 'Texto d’origine' } }, suivant: null }],
      actions: D_ORIGINE,
    });
    expect(container.textContent).not.toContain('Parcours au format d’origine');
  });

  it('supprimer la dernière étape d’un parcours converti : un canevas VIDE — elle ne revient pas en lecture seule — et la base reçoit un parcours vide', async () => {
    etat.regles = [origine()];
    await ouvrir();
    await convertir();
    vi.useFakeTimers();
    cliquer(container.querySelector('button[aria-label="Options de l’étape Envoyer un texto"]'));
    cliquer(bouton('Supprimer l’action'));
    await attendre();

    expect(container.textContent).not.toContain('Parcours au format d’origine');
    expect(container.textContent).not.toContain('Texto d’origine');
    expect(cartes()).toEqual([]);
    expect(bouton('Ajouter une première étape')).toBeDefined();

    await avancer(3000);
    // Le parcours vide ET son reflet partent ensemble : plus aucune copie de l'ancien message.
    expect(dernierPatch()).toMatchObject({ steps: [], actions: PROVISOIRE });
  });

  it('chaque enregistrement d’un parcours envoie `actions` en accord avec ses étapes', async () => {
    await ouvrir();
    vi.useFakeTimers();
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    saisir(panneauEtape()?.querySelector('textarea'), 'Texto réécrit');
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await avancer(3000);
    expect(dernierPatch()?.actions).toEqual([
      { type: 'send_sms', config: { body: 'Texto réécrit' } },
      { type: 'create_task', config: { title: 'Rappeler [client_name]' } },
    ]);
  });

  it('renommer une règle au format d’origine, sans toucher à son parcours, ne réécrit PAS ses `actions`', async () => {
    etat.regles = [origine()];
    await ouvrir();
    vi.useFakeTimers();
    cliquer(container.querySelector('header button .truncate')?.closest('button'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Fournie, renommée');
    await avancer(3000);
    expect(api.modifier).toHaveBeenCalledTimes(1);
    expect(dernierPatch()).not.toHaveProperty('actions');
    expect(dernierPatch()?.name).toBe('Fournie, renommée');
  });

  it('« Annuler » ne remonte pas avant la conversion (il viderait le parcours)', async () => {
    etat.regles = [origine()];
    await ouvrir();
    await convertir();
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="Annuler"]')?.disabled).toBe(true);
  });

  it('Lumi remplace une règle au format d’origine, puis « Annuler » : elle redevient ce qu’elle était, à l’écran ET dans ce qui est enregistré', async () => {
    etat.regles = [origine()];
    api.lumi.mockImplementation(async () => ({
      nom: 'Relance devis', trigger_event: 'quote.sent', resume: 'Fait.', autre: null,
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texto de LUMI' } }, suivant: null }],
    }));
    await ouvrir();
    vi.useFakeTimers();
    saisir(container.querySelector('textarea[id$="-prompt"]'), 'réécris ce message pour moi');
    cliquer(boutonExact('Construire') ?? boutonExact('Envoyer'));
    await attendre(12);
    await avancer(3000);
    expect(dernierPatch()).toMatchObject({ actions: [{ type: 'send_sms', config: { body: 'Texto de LUMI' } }] });

    cliquer(container.querySelector('button[aria-label="Annuler"]'));
    await attendre(2);
    expect(container.textContent).toContain('Parcours au format d’origine');
    expect(container.textContent).toContain('Texto d’origine');
    await avancer(3000);
    expect(dernierPatch()).toMatchObject({ steps: [], actions: D_ORIGINE });
  });
});

// ─── Triage « éditeur », S-04 ───────────────────────────────────

describe('S-04 — un refus du serveur (400, 422) n’est pas une panne : dit comme un refus, jamais renvoyé, et l’étape est désignée', () => {
  const ATTENTE_FINALE = 'La séquence se termine par une attente : rien ne se passera après.';
  const refus = (statut: number, message: string, plus: Record<string, unknown> = {}) => Object.assign(new Error(message), { status: statut, ...plus });
  const alertes = () => Array.from(container.querySelectorAll('[role="alert"]')).map((a) => a.textContent ?? '');
  const avancer = async (ms: number) => {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await attendre();
  };
  /** Réécrit le texto de la carte donnée, par son panneau. */
  async function reecrire(carte: string, texte: string) {
    cliquer(carteEtape(carte));
    await attendre(2);
    saisir(panneauEtape()?.querySelector('textarea, input[type="text"]:not([id$="-nom"])'), texte);
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
  }

  it('« Attendre » en dernière étape : un seul envoi, un message de REFUS (pas « pour le moment — nouvel essai automatique »), et aucun essai en boucle', async () => {
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw refus(400, ATTENTE_FINALE); });
    await ajouterParLeTiroir('Attendre');
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await avancer(3000);
    expect(api.modifier).toHaveBeenCalledTimes(1);

    expect(toasts.erreur).toEqual([`Enregistrement refusé — ${ATTENTE_FINALE}`]);
    expect(toasts.erreur.join('\n')).not.toContain('nouvel essai automatique');
    // L'indicateur ne dit ni « Modifié » (comme si ça allait venir) ni « Enregistré ».
    expect(barreDuHaut()).toContain('Refusé — à corriger');
    expect(barreDuHaut()).not.toContain('Modifié');
    // Et le refus reste À L'ÉCRAN tant qu'il dure.
    expect(alertes().join('\n')).toContain('Enregistrement refusé : rien n’est enregistré tant que ce n’est pas corrigé.');
    expect(alertes().join('\n')).toContain(ATTENTE_FINALE);

    // Deux minutes : le même parcours refusé n'est JAMAIS renvoyé.
    await avancer(120_000);
    expect(api.modifier).toHaveBeenCalledTimes(1);
  });

  it('pendant que le refus dure, une AUTRE modification repart en enregistrement — acceptée, tout est enregistré et le refus disparaît', async () => {
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementationOnce(async () => { throw refus(400, ATTENTE_FINALE); });
    await ajouterParLeTiroir('Attendre');
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await avancer(3000);
    expect(barreDuHaut()).toContain('Refusé — à corriger');

    await reecrire('Envoyer un texto', 'Texto réécrit');
    expect(barreDuHaut()).toContain('Modifié');
    await avancer(3000);
    expect(api.modifier).toHaveBeenCalledTimes(2);
    expect(JSON.stringify((api.modifier.mock.calls[1][1] as { steps: unknown }).steps)).toContain('Texto réécrit');
    expect(barreDuHaut()).toContain('Enregistré');
    expect(alertes()).toEqual([]);
  });

  it('… et si elle est refusée aussi : un envoi par modification, pas plus', async () => {
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw refus(400, ATTENTE_FINALE); });
    await ajouterParLeTiroir('Attendre');
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await avancer(3000);
    await reecrire('Envoyer un texto', 'Texto réécrit');
    await avancer(3000);
    await avancer(120_000);
    expect(api.modifier).toHaveBeenCalledTimes(2);
    expect(barreDuHaut()).toContain('Refusé — à corriger');
  });

  it('le serveur désigne l’étape (rang 1 du parcours envoyé) : sa carte est bordée de rouge, et « Ouvrir l’étape » ouvre son panneau', async () => {
    await ouvrir();
    vi.useFakeTimers();
    const message = 'Étape 2 (« Créer une tâche ») : « À faire dans (jours) » doit être au plus 365.';
    api.modifier.mockImplementation(async () => { throw refus(400, message, { etapes: [1] }); });
    await reecrire('Envoyer un texto', 'Autre texto');
    await avancer(3000);
    expect(alertes().join('\n')).toContain(message);
    expect(carteEtape('Créer une tâche')?.parentElement?.className).toContain('border-danger');
    expect(carteEtape('Envoyer un texto')?.parentElement?.className).not.toContain('border-danger');
    cliquer(boutonExact('Ouvrir l’étape'));
    await attendre(2);
    expect(panneauEtape()?.querySelector('h2')?.textContent).toBe('Créer une tâche');
  });

  it('casser une automatisation PUBLIÉE (422) : le refus seul, sans « pour le moment — nouvel essai automatique »', async () => {
    etat.regles = [regle({ is_active: true })];
    await ouvrir();
    vi.useFakeTimers();
    const message = 'Cette automatisation est publiée : cette modification l’empêcherait de fonctionner (« Créer une tâche » : « Titre de la tâche » est vide.). Corrigez-la, ou repassez-la en brouillon d’abord.';
    api.modifier.mockImplementation(async () => { throw refus(422, message, { code: 'publiee_cassee' }); });
    await reecrire('Envoyer un texto', 'Autre texto');
    await avancer(3000);
    await avancer(60_000);
    expect(api.modifier).toHaveBeenCalledTimes(1);
    expect(toasts.erreur).toEqual([`Enregistrement refusé — ${message}`]);
  });

  it('quitter l’éditeur pendant un refus : « Quitter sans enregistrer ? »', async () => {
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw refus(400, ATTENTE_FINALE); });
    await reecrire('Envoyer un texto', 'Autre texto');
    await avancer(3000);
    confirmerMock.mockImplementationOnce(async () => false);
    cliquer(bouton('Mes automatisations'));
    await attendre(12);
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect((confirmerMock.mock.calls[0][0] as { title: string }).title).toBe('Quitter sans enregistrer ?');
    expect(lieu()).toBe(`/automations/${ID}`);
  });

  it('en anglais', async () => {
    localStorage.setItem('lume-language', 'en');
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw refus(400, 'A journey holds at most 30 steps.'); });
    cliquer(carteEtape('Send a text message'));
    await attendre(2);
    saisir(container.querySelector('aside[aria-label="Edit step"] textarea'), 'Other text');
    cliquer(boutonExact('Save action') ?? boutonExact('Save'));
    await attendre(2);
    await avancer(3000);
    expect(toasts.erreur).toEqual(['Save refused — A journey holds at most 30 steps.']);
    expect(barreDuHaut()).toContain('Refused — to fix');
    expect(alertes().join('\n')).toContain('Save refused: nothing is saved until this is fixed.');
  });
});

// ─── Triage « éditeur », 12-enregistrement:86 ───────────────────

describe('débit dépassé (429) — l’enregistrement automatique réessaie vraiment, et l’indicateur ne reste pas sur « Enregistrement… »', () => {
  const tropVite = (retryApresMs?: number) => Object.assign(
    new Error('Too many requests. Please try again later.'), { status: 429, ...(retryApresMs ? { retryApresMs } : {}) },
  );
  async function renommer(nom: string) {
    const champNom = () => container.querySelector('input[aria-label="Nom de l’automatisation"]');
    if (!champNom()) cliquer(container.querySelector('header button .truncate')?.closest('button'));
    saisir(champNom(), nom);
  }
  const avancer = async (ms: number) => {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await attendre();
  };

  it('un 429, puis le serveur accepte : le nouvel essai part 1,5 s plus tard, et l’indicateur finit sur « Enregistré »', async () => {
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementationOnce(async () => { throw tropVite(); });
    await renommer('Relance devis v2');
    await avancer(3000);
    expect(api.modifier).toHaveBeenCalledTimes(1);
    expect(barreDuHaut()).toContain('Enregistrement…');
    await avancer(1400);
    expect(api.modifier).toHaveBeenCalledTimes(1);
    await avancer(200);
    expect(api.modifier).toHaveBeenCalledTimes(2);
    expect((api.modifier.mock.calls[1][1] as { name: string }).name).toBe('Relance devis v2');
    expect(barreDuHaut()).toContain('Enregistré');
    expect(barreDuHaut()).not.toContain('Enregistrement…');
    // Jamais l'erreur brute, ni aucun message tant que la reprise réussit.
    expect(toasts.erreur).toEqual([]);
  });

  it('le serveur indique quand réessayer (`Retry-After`) : l’essai attend ce délai', async () => {
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementationOnce(async () => { throw tropVite(5000); });
    await renommer('Relance devis v2');
    await avancer(3000);
    await avancer(4000);
    expect(api.modifier).toHaveBeenCalledTimes(1);
    await avancer(1100);
    expect(api.modifier).toHaveBeenCalledTimes(2);
    expect(barreDuHaut()).toContain('Enregistré');
  });

  it('trois 429 de suite : c’est dit en clair, avec « Réessayer » — qui renvoie tout de suite', async () => {
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw tropVite(); });
    await renommer('Relance devis v2');
    await avancer(3000);
    await avancer(1500);
    await avancer(4000);
    expect(api.modifier).toHaveBeenCalledTimes(3);
    expect(toasts.erreur).toEqual(['Trop de modifications d’un coup — on réessaie dans un instant.']);
    expect(toasts.erreur.join('\n')).not.toMatch(/Too many requests/i);
    // L'indicateur ne prétend ni « Enregistré » ni un enregistrement en cours.
    expect(barreDuHaut()).toContain('Modifié');
    expect(barreDuHaut()).not.toContain('Enregistrement…');

    // « Réessayer » : sans attendre le prochain essai automatique (6 s).
    api.modifier.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({ ...regle({ id }), ...patch }));
    const reessayer = toasts.actions.find((a) => a.label === 'Réessayer');
    expect(reessayer).toBeDefined();
    await act(async () => { reessayer?.onClick(); });
    await avancer(50);
    expect(api.modifier).toHaveBeenCalledTimes(4);
    expect(barreDuHaut()).toContain('Enregistré');
  });

  it('une modification faite pendant l’attente de la reprise : c’est ELLE qui part, pas la version périmée', async () => {
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementationOnce(async () => { throw tropVite(); });
    await renommer('Relance devis v2');
    await avancer(3000);
    expect(api.modifier).toHaveBeenCalledTimes(1);
    await renommer('Relance devis v3');
    await avancer(1500);
    // La reprise de « v2 » ne part pas : une modification plus récente a repris la main.
    expect(api.modifier).toHaveBeenCalledTimes(1);
    await avancer(1500);
    expect(api.modifier).toHaveBeenCalledTimes(2);
    expect((api.modifier.mock.calls[1][1] as { name: string }).name).toBe('Relance devis v3');
    expect(barreDuHaut()).toContain('Enregistré');
  });
});

// ─── Priorité — constat A-09 ────────────────────────────────────

describe('A-09 — l’éditeur ouvert et une écriture venue d’ailleurs (Lumi, un second onglet) ne s’écrasent plus en silence', () => {
  const V1 = '2026-09-01T12:00:00Z';
  /** Ce que `automationBuilderApi` lève quand le serveur refuse une écriture périmée. */
  const modifieeAilleurs = () => Object.assign(
    new Error('Cette automatisation a été modifiée ailleurs (par Lumi ou dans un autre onglet).'),
    { status: 409, code: 'modifiee_ailleurs' },
  );
  const alertes = () => Array.from(container.querySelectorAll('[role="alert"]')).map((a) => a.textContent ?? '');
  /** Chaque enregistrement réussi rend une NOUVELLE version, comme le serveur. */
  function serveurQuiVersionne() {
    let n = 1;
    api.modifier.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      n += 1;
      return { ...(etat.regles.find((r) => r.id === id) ?? regle({ id })), ...patch, updated_at: `V${n}` };
    });
  }
  const versionsEnvoyees = () => api.modifier.mock.calls.map((c) => c[2]);
  async function renommer(nom: string) {
    // Le nom s'édite sur place : un clic sur lui ouvre le champ (qui reste ouvert tant qu'on n'en sort pas).
    const champNom = () => container.querySelector('input[aria-label="Nom de l’automatisation"]');
    if (!champNom()) cliquer(container.querySelector('header button .truncate')?.closest('button'));
    saisir(champNom(), nom);
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
  }

  it('chaque enregistrement envoie la version LUE, puis celle que le serveur vient de rendre', async () => {
    serveurQuiVersionne();
    await ouvrir();
    vi.useFakeTimers();
    await renommer('Relance devis v2');
    await renommer('Relance devis v3');
    expect(versionsEnvoyees()).toEqual([V1, 'V2']);
  });

  it('refus « modifiée ailleurs » (409) : l’écran le dit, n’annonce aucun nouvel essai, et n’en fait aucun', async () => {
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw modifieeAilleurs(); });
    await renommer('Relance devis v2');
    expect(api.modifier).toHaveBeenCalledTimes(1);

    expect(alertes().join('\n')).toContain('Cette automatisation a été modifiée ailleurs (par Lumi ou dans un autre onglet).');
    expect(alertes().join('\n')).toContain('vos dernières modifications n’ont pas été enregistrées');
    expect(boutonExact('Recharger')).toBeDefined();
    expect(barreDuHaut()).toContain('Modifiée ailleurs');
    expect(barreDuHaut()).not.toContain('Enregistré');
    expect(toasts.erreur.join('\n')).not.toContain('nouvel essai automatique');

    await act(async () => { vi.advanceTimersByTime(120_000); });
    await attendre();
    expect(api.modifier).toHaveBeenCalledTimes(1);
  });

  it('« Recharger » prend la version en base : le canevas la montre, le bandeau part, et l’enregistrement suivant porte SA version', async () => {
    const DE_LUMI = 'Bonjour [client_first_name], votre facture est en retard.';
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw modifieeAilleurs(); });
    await renommer('Mon nom périmé');

    // Entre-temps, Lumi a réécrit le texto : c'est ce que la base contient.
    etat.regles = [regle({
      updated_at: 'V-lumi',
      steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: DE_LUMI } }, suivant: null }],
    })];
    serveurQuiVersionne();
    api.modifier.mockClear();
    cliquer(boutonExact('Recharger'));
    await attendre(12);

    expect(alertes()).toEqual([]);
    expect(carteEtape('Envoyer un texto')?.textContent).toContain('votre facture est en retard');
    expect(cartes()).toEqual(['Envoyer un texto']);
    expect(barreDuHaut()).toContain('Enregistré');
    // Le nom périmé n'a rien écrasé : aucune écriture n'est partie au rechargement.
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await attendre();
    expect(api.modifier).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Nom de l’automatisation"]')?.value).toBe('Relance devis');

    await renommer('Relance devis v2');
    expect(versionsEnvoyees()).toEqual(['V-lumi']);
  });

  it('deux écritures rapprochées (déclencheur, puis parcours) ne se refusent pas entre elles : une à la fois, chacune avec la version de la précédente', async () => {
    const enVol: Array<{ version: unknown; repondre: (v: string) => void }> = [];
    api.modifier.mockImplementation((id: string, patch: Record<string, unknown>, version: unknown) => new Promise((ok) => {
      enVol.push({ version, repondre: (v) => ok({ ...regle({ id }), ...patch, updated_at: v }) });
    }));
    await ouvrir();
    vi.useFakeTimers();
    // 1re écriture : le nom (enregistrement automatique). Elle reste en vol.
    await renommer('Relance devis v2');
    expect(enVol).toHaveLength(1);
    // 2e écriture pendant ce temps : un autre nom.
    await renommer('Relance devis v3');
    // Elle ATTEND la réponse de la première (sinon : même version, donc un 409 contre nous-mêmes).
    expect(enVol).toHaveLength(1);
    await act(async () => { enVol[0].repondre('V2'); });
    await attendre();
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(enVol.map((e) => e.version)).toEqual([V1, 'V2']);
  });

  it('publier touche la règle : l’enregistrement suivant porte la version rendue par la publication', async () => {
    serveurQuiVersionne();
    api.publier.mockImplementation(async () => 'V-publiee');
    await ouvrir();
    vi.useFakeTimers();
    cliquer(container.querySelector('button[role="switch"]'));
    await attendre(12);
    expect(api.publier).toHaveBeenCalledTimes(1);
    await renommer('Relance devis v2');
    expect(versionsEnvoyees()).toEqual(['V-publiee']);
  });

  it('Lumi garde la conversation dans la règle : l’enregistrement qui suit porte la version rendue par Lumi', async () => {
    serveurQuiVersionne();
    api.lumi.mockImplementation(async (_d: string, _l: string, contexte: { parcoursActuel?: { steps?: unknown[] } | null }) => ({
      nom: 'Relance devis', trigger_event: 'quote.sent', resume: 'Fait.', steps: contexte.parcoursActuel?.steps ?? [], autre: null, updated_at: 'V-conversation',
    }));
    await ouvrir();
    vi.useFakeTimers();
    saisir(container.querySelector('textarea[id$="-prompt"]'), 'change le message de l’automatisation');
    cliquer(boutonExact('Construire') ?? boutonExact('Envoyer'));
    await attendre(12);
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    // (Le déclencheur proposé par Lumi part d'abord, puis le parcours : la 1re écriture porte la version de Lumi.)
    expect(versionsEnvoyees()[0]).toBe('V-conversation');
  });

  describe('la fenêtre reprend le focus', () => {
    const revenir = async () => {
      await act(async () => { window.dispatchEvent(new Event('focus')); });
      await attendre(12);
    };

    it('la règle a changé en base et rien n’attend ici : elle est rechargée en silence', async () => {
      await ouvrir();
      expect(api.editeur).toHaveBeenCalledTimes(1);
      etat.regles = [regle({
        updated_at: 'V-lumi',
        steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Texte de Lumi' } }, suivant: null }],
      })];
      api.version.mockImplementation(async () => 'V-lumi');
      await revenir();
      expect(api.version).toHaveBeenCalledWith(ID);
      expect(api.editeur).toHaveBeenCalledTimes(2);
      expect(carteEtape('Envoyer un texto')?.textContent).toContain('Texte de Lumi');
      expect(confirmerMock).not.toHaveBeenCalled();
      expect(toasts.erreur).toEqual([]);
      expect(alertes()).toEqual([]);
    });

    it('même version en base : rien n’est rechargé', async () => {
      await ouvrir();
      api.version.mockImplementation(async () => V1);
      await revenir();
      expect(api.editeur).toHaveBeenCalledTimes(1);
    });

    it('une modification attend d’être enregistrée : on ne recharge PAS par-dessus (on ne lit même pas)', async () => {
      await ouvrir();
      vi.useFakeTimers();
      api.version.mockImplementation(async () => 'V-lumi');
      cliquer(bouton('Relance devis'));
      saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'En cours de frappe');
      await revenir();
      expect(api.version).not.toHaveBeenCalled();
      expect(api.editeur).toHaveBeenCalledTimes(1);
    });

    it('une saisie non enregistrée dans le panneau d’étape : pareil', async () => {
      await ouvrir();
      api.version.mockImplementation(async () => 'V-lumi');
      cliquer(carteEtape('Envoyer un texto'));
      await attendre(2);
      saisir(panneauEtape()?.querySelector('textarea'), 'Ma saisie en cours');
      await revenir();
      expect(api.editeur).toHaveBeenCalledTimes(1);
      expect(panneauEtape()?.querySelector('textarea')?.value).toBe('Ma saisie en cours');
    });

    it('panneau d’étape ouvert et intact : il suit la version rechargée', async () => {
      await ouvrir();
      cliquer(carteEtape('Envoyer un texto'));
      await attendre(2);
      etat.regles = [regle({
        updated_at: 'V-lumi',
        steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Texte de Lumi' } }, suivant: null }],
      })];
      api.version.mockImplementation(async () => 'V-lumi');
      await revenir();
      expect(panneauEtape()?.querySelector('textarea')?.value).toBe('Texte de Lumi');
    });
  });

  it('en anglais', async () => {
    localStorage.setItem('lume-language', 'en');
    await ouvrir();
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw Object.assign(new Error('This automation was changed elsewhere (by Lumi or in another tab).'), { status: 409, code: 'modifiee_ailleurs' }); });
    cliquer(bouton('Relance devis'));
    saisir(container.querySelector('input[aria-label="Automation name"]'), 'Quote follow-up v2');
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(alertes().join('\n')).toContain('This automation was changed elsewhere (by Lumi or in another tab).');
    expect(boutonExact('Reload')).toBeDefined();
    expect(barreDuHaut()).toContain('Changed elsewhere');
  });
});

// ─── Ligne 1 du triage « actions » ──────────────────────────────

describe('ligne 1 — une étape choisie dans le tiroir n’est écrite qu’une fois enregistrée dans son panneau', () => {
  it('automatisation PUBLIÉE : dix secondes après le choix, panneau ouvert, RIEN n’est parti au serveur', async () => {
    etat.regles = [regle({ is_active: true })];
    await ouvrir();
    vi.useFakeTimers();
    await ajouterParLeTiroir('Envoyer un texto');

    // Le panneau est ouvert sur l'étape, avec son texte de départ ; la carte est à sa place.
    expect(panneaux()).toEqual([PANNEAU_ETAPE]);
    expect(panneauEtape()?.querySelector('textarea')?.value).toBe('Bonjour [client_name], c’est [company_name]. Merci !');
    expect(cartes()).toEqual(['Envoyer un texto', 'Créer une tâche', 'Envoyer un texto']);

    await act(async () => { vi.advanceTimersByTime(10_000); });
    await attendre();
    expect(api.modifier).not.toHaveBeenCalled();
    // Le parcours enregistré n'a pas bougé : l'indicateur ne dit pas « Modifié ».
    expect(barreDuHaut()).toContain('Enregistré');
    expect(barreDuHaut()).not.toContain('Modifié');
  });

  it('« Enregistrer » dans le panneau : l’étape entre dans le parcours, et l’enregistrement automatique l’écrit', async () => {
    etat.regles = [regle({ is_active: true })];
    await ouvrir();
    vi.useFakeTimers();
    await ajouterParLeTiroir('Envoyer un texto');
    saisir(panneauEtape()?.querySelector('textarea'), 'Merci pour votre confiance, [client_first_name].');
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    expect(barreDuHaut()).toContain('Modifié');
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(api.modifier).toHaveBeenCalledTimes(1);
    expect(derniersSteps()).toEqual([
      { id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: 'e2' },
      { id: 'e2', type: 'action', nom: null, action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: 'e3' },
      { id: 'e3', type: 'action', action: { type: 'send_sms', config: { body: 'Merci pour votre confiance, [client_first_name].' } }, suivant: null },
    ]);
  });

  it('brouillon aussi : une attente choisie dans le tiroir attend son « Enregistrer »', async () => {
    await ouvrir();
    vi.useFakeTimers();
    await ajouterParLeTiroir('Attendre');
    expect(cartes()).toEqual(['Envoyer un texto', 'Créer une tâche', 'Attendre']);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await attendre();
    expect(api.modifier).not.toHaveBeenCalled();
  });

  it('insérée au MILIEU par un « + » : elle garde sa place à l’écran et dans ce qui est enregistré', async () => {
    await ouvrir();
    vi.useFakeTimers();
    // Le « + » entre le texto (e1) et la tâche (e2) : le 2e connecteur du canevas.
    cliquer(container.querySelectorAll('button[aria-label="Ajouter une étape ici"]')[1]);
    await attendre(2);
    cliquer(bouton('Ajouter une note', tiroirActions() ?? undefined));
    await attendre(2);
    expect(cartes()).toEqual(['Envoyer un texto', 'Ajouter une note', 'Créer une tâche']);
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    const steps = derniersSteps() ?? [];
    expect(steps.map((e) => [e.id, e.suivant])).toEqual([['e1', 'e3'], ['e2', null], ['e3', 'e2']]);
  });

  it('fermer le panneau d’une étape neuve : on le demande, puis elle n’est PAS ajoutée', async () => {
    await ouvrir();
    vi.useFakeTimers();
    await ajouterParLeTiroir('Envoyer un texto');
    confirmerMock.mockImplementationOnce(async () => false);
    cliquer(boutonExact('Annuler', panneauEtape() ?? undefined));
    await attendre();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(String((confirmerMock.mock.calls[0][0] as { message: string }).message)).toContain('ne sera pas ajoutée au parcours');
    // Refus : rien ne bouge.
    expect(panneaux()).toEqual([PANNEAU_ETAPE]);

    cliquer(boutonExact('Annuler', panneauEtape() ?? undefined));
    await attendre();
    expect(panneaux()).toEqual([]);
    expect(cartes()).toEqual(['Envoyer un texto', 'Créer une tâche']);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await attendre();
    expect(api.modifier).not.toHaveBeenCalled();
  });

  it('cliquer une autre carte pendant l’ajout : on demande avant d’abandonner l’étape', async () => {
    await ouvrir();
    await ajouterParLeTiroir('Envoyer un courriel');
    confirmerMock.mockImplementationOnce(async () => false);
    cliquer(carteEtape('Créer une tâche'));
    await attendre();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(String((confirmerMock.mock.calls[0][0] as { title: string }).title)).toBe('Abandonner l’étape en cours d’ajout ?');
    expect(cartes()).toContain('Envoyer un courriel');
    expect(panneauEtape()?.querySelector('h2')?.textContent).toBe('Envoyer un courriel');

    cliquer(carteEtape('Créer une tâche'));
    await attendre();
    expect(cartes()).toEqual(['Envoyer un texto', 'Créer une tâche']);
    expect(panneauEtape()?.querySelector('h2')?.textContent).toBe('Créer une tâche');
  });

  it('« Publier » pendant l’ajout : refusé avec la raison, sans confirmation ni appel au serveur', async () => {
    await ouvrir();
    await ajouterParLeTiroir('Envoyer un texto');
    cliquer(container.querySelector('button[role="switch"]'));
    await attendre();
    expect(toasts.erreur.join('\n')).toContain('Une étape est en cours d’ajout');
    expect(confirmerMock).not.toHaveBeenCalled();
    expect(api.publier).not.toHaveBeenCalled();
  });

  it('automatisation NEUVE (jamais enregistrée) : rien n’est créé en base avant « Enregistrer »', async () => {
    await ouvrir('/automations/nouvelle');
    vi.useFakeTimers();
    cliquer(bouton('Ajouter une première étape'));
    await attendre(2);
    cliquer(bouton('Envoyer un texto', tiroirActions() ?? undefined));
    await attendre(2);
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await attendre();
    expect(api.creer).not.toHaveBeenCalled();
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(api.creer).toHaveBeenCalledTimes(1);
    expect(lieu()).toBe('/automations/neuve-1');
  });

  it('en anglais', async () => {
    localStorage.setItem('lume-language', 'en');
    await ouvrir();
    cliquer(boutonExact('Add'));
    await attendre(2);
    cliquer(bouton('Send a text message', tiroirActions() ?? undefined));
    await attendre(2);
    cliquer(boutonExact('Cancel', container.querySelector('aside[aria-label="Edit step"]') ?? undefined));
    await attendre();
    expect(confirmerMock.mock.calls[0][0]).toMatchObject({
      title: 'Close without adding this step?',
      message: 'This step was not saved: it will not be added to the journey.',
      confirmLabel: 'Do not add it',
    });
  });
});
