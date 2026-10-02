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
  /** Le forfait du bureau inclut-il Lumi (`includes_ai`) ? Sans lui : la carte « inclus dans Autopilot ». */
  lumi: true,
}));
const api = vi.hoisted(() => ({
  editeur: vi.fn(),
  creer: vi.fn(),
  modifier: vi.fn(),
  publier: vi.fn(),
  stats: vi.fn(),
  lumi: vi.fn(),
  version: vi.fn(),
  pause: vi.fn(),
  /** La langue dans laquelle le bureau ENVOIE ses messages (`company_settings.default_language`). */
  langue: vi.fn(),
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
vi.mock('../../../src/lib/automationRulesApi', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/automationRulesApi')>()),
  getAutomationLanguage: () => api.langue(),
}));
vi.mock('../../../src/lib/automationWebhooksApi', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/automationWebhooksApi')>()),
  lireEtatPause: () => api.pause(),
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
vi.mock('../../../src/hooks/usePlanFeature', () => ({ usePlanFeature: () => ({ hasFeature: etat.lumi, loading: false }) }));
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
import { actionsDuParcours } from '../../../src/lib/publicationAutomatisation';

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
  etat.lumi = true;
  api.editeur.mockReset();
  api.editeur.mockImplementation(async (id: string | null) => ({
    rule: etat.regles.find((r) => r.id === id) ?? null,
    catalogue: { declencheurs: DECLENCHEURS.filter((d) => !d.drapeau), actions: ACTIONS },
    autres: [],
  }));
  api.langue.mockReset();
  api.langue.mockImplementation(async () => 'fr');
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
  api.pause.mockReset();
  api.pause.mockImplementation(async () => ({ paused: false, pausedAt: null }));
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
            <Route path="/settings/billing" element={<Lieu />} />
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

// ─── Triage « actions », ligne 5 (= déclencheurs 06:149) ────────

describe('ligne 5 — « Date atteinte » sur un champ du pipeline : ce que le tiroir laisse ajouter se publie', () => {
  const DATE_PIPELINE = 'cccccccc-0000-4000-8000-0000000000d1';
  const DATE_CLIENT = 'cccccccc-0000-4000-8000-0000000000d2';
  const champ = (id: string, objet: string, label: string) => ({
    id, object_type: objet, folder_id: null, key: label.toLowerCase().replace(/\W+/g, '_'), label, placeholder: null, help_text: null,
    field_type: 'date', config: {}, is_required: false, position: 0, archived_at: null, options: [],
  });
  const surLeChamp = (idChamp: string) => regle({
    trigger_event: 'date.reached', conditions: { champ_id: idChamp, jours_avant: 7 },
    steps: [
      { id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: 'e2' },
      { id: 'e2', type: 'action', nom: null, action: { type: 'assigner_deal', config: {} }, suivant: null },
    ],
  });
  beforeEach(() => {
    etat.champs = [champ(DATE_PIPELINE, 'deal', 'Fermeture prévue'), champ(DATE_CLIENT, 'client', 'Fin de garantie')];
  });

  it('champ du PIPELINE : le canevas n’affiche aucun bandeau rouge, et « Publier » propose la confirmation', async () => {
    etat.regles = [surLeChamp(DATE_PIPELINE)];
    await ouvrir();
    expect(container.textContent).not.toMatch(/chose[s]? à corriger avant de publier/);
    expect(container.textContent).not.toContain('ne peut pas suivre ce déclencheur');
    expect(carteEtape('Assigner l’opportunité')?.parentElement?.className).not.toContain('border-danger');
    // Le tiroir l'offre toujours (c'était déjà le cas) : les trois disent la même chose.
    cliquer(boutonExact('Ajouter'));
    await attendre(2);
    expect(bouton('Assigner l’opportunité', tiroirActions() ?? undefined)?.disabled).toBe(false);
    cliquer(tiroirActions()?.querySelector('button[aria-label="Fermer"]'));
    await attendre(2);

    cliquer(container.querySelector('button[role="switch"]'));
    await attendre(12);
    expect(toasts.erreur).toEqual([]);
    expect((confirmerMock.mock.calls[0][0] as { title: string }).title).toBe('Publier cette automatisation ?');
    expect(api.publier).toHaveBeenCalledWith(ID, true);
  });

  it('champ du CLIENT : l’action sur l’opportunité est signalée sur le canevas, et « Publier » est refusé', async () => {
    etat.regles = [surLeChamp(DATE_CLIENT)];
    await ouvrir();
    expect(container.textContent).toContain('1 chose à corriger avant de publier');
    expect(bouton('« Assigner l’opportunité » ne peut pas suivre ce déclencheur.')).toBeDefined();
    cliquer(container.querySelector('button[role="switch"]'));
    await attendre(12);
    expect(toasts.erreur.join('\n')).toContain('« Assigner l’opportunité » ne peut pas suivre ce déclencheur.');
    expect(api.publier).not.toHaveBeenCalled();
  });
});

// ─── Triage « actions », ligne 6 (= déclencheurs 06:191) ────────

describe('ligne 6 — tiroir « Actions » d’une automatisation « Appel reçu de l’extérieur »', () => {
  it('les six actions liées à un devis, une facture, un rendez-vous ou une opportunité sont grisées, avec la raison', async () => {
    etat.regles = [regle({ trigger_event: 'webhook.received', conditions: {} })];
    await ouvrir();
    cliquer(boutonExact('Ajouter'));
    await attendre(2);
    const grisees = boutons(tiroirActions() ?? undefined)
      .filter((b) => b.textContent?.includes('Ne va pas avec ce déclencheur'))
      .map((b) => b.querySelector('.font-medium')?.textContent);
    expect(grisees).toEqual([
      'Changer le statut du rendez-vous', 'Déplacer l’opportunité', 'Modifier l’opportunité', 'Assigner l’opportunité',
      'Envoyer la facture', 'Envoyer le devis',
    ]);
    // Le reste se choisit comme avant.
    expect(bouton('Envoyer un texto', tiroirActions() ?? undefined)?.textContent).not.toContain('Ne va pas avec ce déclencheur');
  });
});

// ─── Triage « éditeur », EDT-166 ────────────────────────────────

describe('EDT-166 — « Précédent » du navigateur : ce qui ne peut pas s’enregistrer en partant se demande AVANT', () => {
  const marque = () => (window.history.state as Record<string, unknown> | null)?.lumeGardeEditeur === true;
  /** Le « Précédent » du navigateur : l'entrée en double est consommée, la page ne change pas encore. */
  const precedent = async () => {
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    await attendre();
  };
  const question = () => confirmerMock.mock.calls.at(-1)?.[0] as { title: string; message: string; confirmLabel: string } | undefined;
  /** Une règle dont une étape est incomplète (tâche sans titre), puis une modification : « 1 étape(s) à compléter ». */
  async function ouvrirAvecEtapeIncomplete() {
    etat.regles = [regle({
      steps: [
        { id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', nom: null, action: { type: 'create_task', config: { title: '' } }, suivant: null },
      ],
    })];
    await ouvrir();
    cliquer(container.querySelector('header button .truncate')?.closest('button'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v2');
    await attendre();
    expect(barreDuHaut()).toContain('1 étape(s) à compléter');
  }

  beforeEach(() => { window.history.replaceState(null, ''); });

  it('une étape incomplète : « Précédent » pose la question — « Annuler » garde l’éditeur et le travail', async () => {
    await ouvrirAvecEtapeIncomplete();
    expect(marque()).toBe(true);
    confirmerMock.mockImplementationOnce(async () => false);
    await precedent();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(question()?.title).toBe('Quitter sans enregistrer ?');
    expect(question()?.message).toBe('Une étape est incomplète, donc le parcours n’a pas pu être enregistré. Si vous quittez maintenant, ces modifications seront perdues.');
    // Refusé : la garde est reposée, l'éditeur et sa saisie sont toujours là.
    expect(marque()).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Nom de l’automatisation"]')?.value).toBe('Relance devis v2');
    expect(toasts.erreur).toEqual([]);
  });

  it('… « Quitter » : on recule pour de bon, sans toast d’après coup ni tentative d’enregistrement', async () => {
    await ouvrirAvecEtapeIncomplete();
    const reculer = vi.spyOn(window.history, 'back');
    await precedent();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    // Le premier recul est celui de l'utilisateur ; le second, le nôtre : on quitte vraiment.
    expect(reculer).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
    root = createRoot(container);
    expect(toasts.erreur.join('\n')).not.toContain('quittée sans enregistrer');
    expect(api.modifier).not.toHaveBeenCalled();
    reculer.mockRestore();
  });

  it('une saisie en cours dans un panneau d’étape : même question, avec sa raison', async () => {
    await ouvrir();
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    expect(marque()).toBe(false);
    saisir(panneauEtape()?.querySelector('textarea'), 'En cours de frappe');
    await attendre(2);
    expect(marque()).toBe(true);
    confirmerMock.mockImplementationOnce(async () => false);
    await precedent();
    expect(question()?.message).toBe('Une étape est en cours de modification et n’a pas été enregistrée. Si vous quittez maintenant, ce que vous y avez saisi sera perdu.');
    expect(panneauEtape()?.querySelector('textarea')?.value).toBe('En cours de frappe');
  });

  it('une étape choisie dans le tiroir, pas encore enregistrée : même garde', async () => {
    await ouvrir();
    await ajouterParLeTiroir('Envoyer un texto');
    expect(marque()).toBe(true);
    confirmerMock.mockImplementationOnce(async () => false);
    await precedent();
    expect(question()?.title).toBe('Quitter sans enregistrer ?');
    expect(cartes()).toContain('Envoyer un texto');
  });

  it('rien à perdre (tout est enregistré, ou enregistrable en partant) : aucune entrée en double, aucune question', async () => {
    await ouvrir();
    expect(marque()).toBe(false);
    cliquer(container.querySelector('header button .truncate')?.closest('button'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v2');
    await attendre();
    // « Modifié » : le départ enregistre (A-04) — pas besoin de retenir.
    expect(marque()).toBe(false);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    await attendre();
    expect(confirmerMock).not.toHaveBeenCalled();
  });

  it('en anglais', async () => {
    localStorage.setItem('lume-language', 'en');
    await ouvrir();
    cliquer(carteEtape('Send a text message'));
    await attendre(2);
    saisir(container.querySelector('aside[aria-label="Edit step"] textarea'), 'Typing');
    await attendre(2);
    confirmerMock.mockImplementationOnce(async () => false);
    await precedent();
    expect(question()).toMatchObject({ title: 'Leave without saving?', confirmLabel: 'Leave' });
    expect(question()?.message).toBe('A step is being edited and has not been saved. If you leave now, what you entered there is lost.');
  });
});

// ─── Triage « éditeur », S-32 ───────────────────────────────────

describe('S-32 — la pause globale du bureau (« Tout arrêter ») se voit dans l’éditeur', () => {
  const bandeau = () => container.querySelector('[role="status"]')?.textContent ?? null;

  it('bureau en pause, automatisation publiée : un bandeau dit qu’elle n’envoie rien, et où lever la pause', async () => {
    etat.regles = [regle({ is_active: true })];
    api.pause.mockImplementation(async () => ({ paused: true, pausedAt: '2026-10-01T12:00:00Z' }));
    await ouvrir();
    expect(bandeau()).toContain('Vos automatisations sont en pause.');
    expect(bandeau()).toContain('Cette automatisation est publiée, mais elle n’envoie rien tant que la pause dure. La pause se lève depuis « Mes automatisations ».');
    // Sur tous les onglets, pas seulement « Parcours ».
    cliquer(boutons().find((b) => b.getAttribute('role') === 'tab' && b.textContent === 'Journaux'));
    await attendre(2);
    expect(bandeau()).toContain('Vos automatisations sont en pause.');
  });

  it('bureau en pause, brouillon : le bandeau prévient avant de publier', async () => {
    api.pause.mockImplementation(async () => ({ paused: true, pausedAt: '2026-10-01T12:00:00Z' }));
    await ouvrir();
    expect(bandeau()).toContain('Même publiée, cette automatisation n’enverra rien tant que la pause dure.');
  });

  it('bureau en marche : aucun bandeau', async () => {
    etat.regles = [regle({ is_active: true })];
    await ouvrir();
    expect(bandeau()).toBeNull();
    expect(container.textContent).not.toContain('en pause');
  });

  it('la pause est levée ailleurs : au retour sur la fenêtre, le bandeau part', async () => {
    api.pause.mockImplementation(async () => ({ paused: true, pausedAt: '2026-10-01T12:00:00Z' }));
    await ouvrir();
    expect(bandeau()).not.toBeNull();
    api.pause.mockImplementation(async () => ({ paused: false, pausedAt: null }));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await attendre();
    expect(bandeau()).toBeNull();
  });

  it('l’état de la pause est illisible : l’éditeur s’ouvre quand même, sans bandeau inventé', async () => {
    api.pause.mockImplementation(async () => { throw new Error('panne'); });
    await ouvrir();
    expect(bandeau()).toBeNull();
    expect(cartes()).toEqual(['Envoyer un texto', 'Créer une tâche']);
  });

  it('en anglais', async () => {
    localStorage.setItem('lume-language', 'en');
    etat.regles = [regle({ is_active: true })];
    api.pause.mockImplementation(async () => ({ paused: true, pausedAt: '2026-10-01T12:00:00Z' }));
    await ouvrir();
    expect(bandeau()).toContain('Your automations are paused.');
    expect(bandeau()).toContain('This automation is published, but it sends nothing while the pause lasts.');
  });
});

// ─── Triage « éditeur », S-12 ───────────────────────────────────

describe('S-12 — ce qui quitte le parcours est annoncé, et quitte vraiment la base', () => {
  const texto = (id: string, body: string, suivant: string | null) => ({ id, type: 'action', nom: null, action: { type: 'send_sms', config: { body } }, suivant });
  const troisTextos = () => [texto('e1', 'Texto ALPHA', 'e2'), texto('e2', 'Texto BRAVO', 'e3'), texto('e3', 'Texto CHARLIE', null)];
  const avecBranches = () => [
    texto('e1', 'Texto ALPHA', 'e2'),
    { id: 'e2', type: 'si', conditions: { statut: 'envoye' }, alors: 'e3', sinon: 'e4' },
    texto('e3', 'Texto OUI', 'e5'),
    texto('e4', 'Texto NON', null),
    texto('e5', 'Texto APRÈS OUI', null),
  ];
  const question = () => confirmerMock.mock.calls.at(-1)?.[0] as { title: string; message: string; confirmLabel: string };
  const avancer = async (ms: number) => {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await attendre();
  };
  /** Les textes des cartes « texto » à l'écran, dans l'ordre. */
  const textes = () => boutons()
    .filter((b) => b.parentElement?.className.includes('w-[260px]') && b.parentElement?.className.includes('relative') && !b.getAttribute('aria-label'))
    .map((b) => b.querySelector('.truncate')?.textContent ?? '');

  it('« Arrêter ici » au milieu : on demande d’abord, en disant combien d’étapes partent — refusé, rien ne bouge', async () => {
    etat.regles = [regle({ steps: troisTextos() })];
    await ouvrir();
    // Le « + » entre le 1er et le 2e texto.
    cliquer(container.querySelectorAll('button[aria-label="Ajouter une étape ici"]')[1]);
    await attendre(2);
    confirmerMock.mockImplementationOnce(async () => false);
    cliquer(bouton('Arrêter ici', tiroirActions() ?? undefined));
    await attendre();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(question().title).toBe('Arrêter ici et retirer la suite ?');
    expect(question().message).toBe('Le parcours s’arrêtera à cet endroit : les 2 étapes qui suivent ne seront plus jamais atteintes et seront retirées du parcours.');
    // Refusé : le parcours est entier, et le tiroir est resté ouvert pour choisir autre chose.
    expect(textes()).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);
    expect(panneaux()).toEqual(['Actions']);
  });

  it('… accepté puis enregistré : la suite est retirée du parcours ET de ce qui part en base (aucune étape orpheline)', async () => {
    etat.regles = [regle({ steps: troisTextos() })];
    await ouvrir();
    vi.useFakeTimers();
    cliquer(container.querySelectorAll('button[aria-label="Ajouter une étape ici"]')[1]);
    await attendre(2);
    cliquer(bouton('Arrêter ici', tiroirActions() ?? undefined));
    await attendre();
    expect(cartes()).toEqual(['Envoyer un texto', 'Arrêter ici']);
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await avancer(3000);
    expect(derniersSteps()).toEqual([
      texto('e1', 'Texto ALPHA', 'e4'),
      { id: 'e4', type: 'arreter' },
    ]);
  });

  it('« Arrêter ici » à la FIN : rien ne part, donc aucune question', async () => {
    etat.regles = [regle({ steps: troisTextos() })];
    await ouvrir();
    await ajouterParLeTiroir('Arrêter ici');
    expect(confirmerMock).not.toHaveBeenCalled();
    expect(cartes()).toEqual(['Envoyer un texto', 'Envoyer un texto', 'Envoyer un texto', 'Arrêter ici']);
  });

  it('supprimer une condition : le dialogue dit que la branche « si non » part avec elle, et elle part vraiment', async () => {
    etat.regles = [regle({ steps: avecBranches() })];
    await ouvrir();
    vi.useFakeTimers();
    expect(textes()).toContain('Texto NON');
    cliquer(container.querySelector('button[aria-label="Options de l’étape Si…"]'));
    cliquer(bouton('Supprimer l’étape'));
    await attendre();
    expect(question().title).toBe('Supprimer cette étape ?');
    expect(question().message).toBe('La branche « si oui » reste dans le parcours et se rebranche. La branche « si non » (1 étape) sera retirée avec la condition.');

    // À l'écran : la branche « si oui » a pris la suite ; « Texto NON » n'y est plus.
    expect(textes()).toEqual(['Texto ALPHA', 'Texto OUI', 'Texto APRÈS OUI']);
    await avancer(3000);
    const enBase = derniersSteps() ?? [];
    // En base : exactement ce qui est à l'écran — aucune étape reliée à rien.
    expect(JSON.stringify(enBase)).not.toContain('Texto NON');
    expect(enBase.map((e) => [e.id, e.suivant])).toEqual([['e1', 'e3'], ['e3', 'e5'], ['e5', null]]);
  });

  it('supprimer une étape ordinaire : le dialogue d’avant (tout se rebranche), rien d’autre ne part', async () => {
    etat.regles = [regle({ steps: troisTextos() })];
    await ouvrir();
    vi.useFakeTimers();
    cliquer(container.querySelectorAll('button[aria-label="Options de l’étape Envoyer un texto"]')[1]);
    cliquer(bouton('Supprimer l’action'));
    await attendre();
    expect(question().message).toBe('Ce qui venait après reste dans le parcours et se rebranche tout seul.');
    await avancer(3000);
    expect((derniersSteps() ?? []).map((e) => [e.id, e.suivant])).toEqual([['e1', 'e3'], ['e3', null]]);
  });

  it('en anglais', async () => {
    localStorage.setItem('lume-language', 'en');
    etat.regles = [regle({ steps: avecBranches() })];
    await ouvrir();
    cliquer(container.querySelector('button[aria-label="Options for If…"]'));
    cliquer(bouton('Delete step'));
    await attendre();
    expect(question().message).toBe('The “if yes” branch stays in the journey and reconnects. The “if no” branch (1 step) will be removed with the condition.');
  });
});

// ─── Triage « éditeur », S-03 ───────────────────────────────────

describe('S-03 — sur une automatisation PUBLIÉE, Lumi ne remplace pas le parcours en ligne sans question', () => {
  const lumiPropose = () => api.lumi.mockImplementation(async () => ({
    nom: 'Relance devis', trigger_event: 'quote.sent', resume: 'Relance de devis : un texto après 2 jours.', autre: null,
    steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texto de LUMI' } }, suivant: null }],
  }));
  async function demander() {
    saisir(container.querySelector('textarea[id$="-prompt"]'), 'refais ma relance de devis en un seul texto');
    cliquer(boutonExact('Construire') ?? boutonExact('Envoyer'));
    await attendre(12);
  }
  const avancer = async (ms: number) => {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await attendre();
  };

  it('la proposition est montrée dans une question ; refusée, le parcours en ligne ne change pas et RIEN n’est enregistré', async () => {
    etat.regles = [regle({ is_active: true })];
    lumiPropose();
    confirmerMock.mockImplementationOnce(async () => false);
    await ouvrir();
    vi.useFakeTimers();
    await demander();

    expect(confirmerMock).toHaveBeenCalledTimes(1);
    const question = confirmerMock.mock.calls[0][0] as { title: string; message: string; confirmLabel: string };
    expect(question.title).toBe('Appliquer les changements de Lumi ?');
    expect(question.message).toContain('Cette automatisation est en ligne : appliquer les changements de Lumi ?');
    expect(question.message).toContain('Relance de devis : un texto après 2 jours.');
    expect(question.confirmLabel).toBe('Appliquer');

    // Refusé : le canevas garde le parcours en ligne, et l'enregistrement automatique n'a rien à écrire.
    expect(cartes()).toEqual(['Envoyer un texto', 'Créer une tâche']);
    expect(container.textContent).not.toContain('Texto de LUMI');
    await avancer(10_000);
    expect(api.modifier).not.toHaveBeenCalled();
    expect(toasts.info.join('\n')).toContain('Changements de Lumi non appliqués : le parcours en ligne est inchangé.');
    expect(toasts.succes.join('\n')).not.toContain('Lumi a construit le parcours');
    // Le fil garde la trace de la proposition — et dit qu'elle n'a pas été appliquée.
    expect(container.textContent).toContain('— Non appliqué : le parcours en ligne est inchangé.');
  });

  it('acceptée : le parcours est remplacé, et le message ne dit pas « en pause »', async () => {
    etat.regles = [regle({ is_active: true })];
    lumiPropose();
    await ouvrir();
    vi.useFakeTimers();
    await demander();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(cartes()).toEqual(['Envoyer un texto']);
    expect(toasts.succes.join('\n')).toContain('Changements de Lumi appliqués — l’automatisation est en ligne');
    expect(toasts.succes.join('\n')).not.toContain('en pause');
    await avancer(3000);
    expect(JSON.stringify(derniersSteps())).toContain('Texto de LUMI');
  });

  it('sur un BROUILLON : aucune question, comme avant', async () => {
    lumiPropose();
    await ouvrir();
    await demander();
    expect(confirmerMock).not.toHaveBeenCalled();
    expect(cartes()).toEqual(['Envoyer un texto']);
    expect(toasts.succes.join('\n')).toContain('Lumi a construit le parcours — en pause, à publier quand tu es prêt.');
  });

  it('en anglais', async () => {
    localStorage.setItem('lume-language', 'en');
    etat.regles = [regle({ is_active: true })];
    lumiPropose();
    confirmerMock.mockImplementationOnce(async () => false);
    await ouvrir();
    saisir(container.querySelector('textarea[id$="-prompt"]'), 'rebuild my quote follow-up as one text');
    cliquer(boutonExact('Build') ?? boutonExact('Send'));
    await attendre(12);
    expect(confirmerMock.mock.calls[0][0]).toMatchObject({ title: 'Apply Lumi’s changes?', confirmLabel: 'Apply' });
    expect(String((confirmerMock.mock.calls[0][0] as { message: string }).message)).toContain('This automation is live: apply Lumi’s changes?');
    expect(toasts.info.join('\n')).toContain('Lumi’s changes were not applied: the live journey is unchanged.');
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
    // Le parcours enregistré n'a pas bougé : l'indicateur ne dit pas « Modifié » — il dit que
    // l'étape en cours d'ajout n'est pas enregistrée (remarque d'usage (b) : avant, « Enregistré »).
    expect(barreDuHaut()).toContain('Étape non enregistrée');
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

// ─── Triage « déclencheurs », 06-publication-declencheur:109 ────

describe('06:109 — « Date atteinte » sur un champ date SUPPRIMÉ : l’interrupteur refuse de publier, et dit quoi corriger', () => {
  const DATE_CLIENT = 'cccccccc-0000-4000-8000-0000000000d2';
  const SUPPRIME = 'cccccccc-0000-4000-8000-0000000000ff';
  const REFUS = '« Date atteinte » : le champ surveillé a été supprimé. Choisissez-en un autre, sinon l’automatisation ne partirait jamais.';
  const champDate = (id: string, label: string) => ({
    id, object_type: 'client', folder_id: null, key: label.toLowerCase().replace(/\W+/g, '_'), label, placeholder: null, help_text: null,
    field_type: 'date', config: {}, is_required: false, position: 0, archived_at: null, options: [],
  });
  const surLeChamp = (idChamp: string) => regle({
    trigger_event: 'date.reached', conditions: { champ_id: idChamp, jours_avant: 7 },
    steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'create_notification', config: { title: 'Fin de contrat' } }, suivant: null }],
  });
  beforeEach(() => { etat.champs = [champDate(DATE_CLIENT, 'Fin de garantie')]; });

  it('le champ n’est plus dans le bureau : bandeau rouge, clic sur l’interrupteur → refus en toast, AUCUNE question « Publier ? », rien n’est envoyé', async () => {
    etat.regles = [surLeChamp(SUPPRIME)];
    await ouvrir();
    expect(container.textContent).toContain('champ supprimé');
    expect(container.textContent).toContain('1 chose à corriger avant de publier');
    expect(container.textContent).toContain(REFUS);
    cliquer(container.querySelector('button[role="switch"]'));
    await attendre(12);
    expect(toasts.erreur.join('\n')).toContain(REFUS);
    expect(confirmerMock).not.toHaveBeenCalled();
    expect(api.publier).not.toHaveBeenCalled();
  });

  it('le champ existe : aucun bandeau, la question « Publier cette automatisation ? » est posée', async () => {
    etat.regles = [surLeChamp(DATE_CLIENT)];
    await ouvrir();
    expect(container.textContent).not.toContain('le champ surveillé a été supprimé');
    cliquer(container.querySelector('button[role="switch"]'));
    await attendre(12);
    expect(toasts.erreur).toEqual([]);
    expect((confirmerMock.mock.calls[0][0] as { title: string }).title).toBe('Publier cette automatisation ?');
  });

  it('la liste des champs n’est pas (encore) là : l’éditeur n’accuse pas — c’est le serveur, qui lit la base, qui tranche', async () => {
    etat.champs = [];
    etat.regles = [surLeChamp(SUPPRIME)];
    await ouvrir();
    expect(container.textContent).not.toContain('le champ surveillé a été supprimé');
  });
});

// ─── Ajustement de la ligne 2 (commit 539be241) ─────────────────

describe('ligne 2 (ajustement) — le panneau montre dans son champ principal le texte que le bureau ENVOIE', () => {
  const FR = 'Rabais de 10 % jusqu’au 1er mai.';
  const EN = '10% off until May 1st.';
  const bilingue = () => regle({
    trigger_event: 'quote.sent',
    steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: FR, body_en: EN } }, suivant: null }],
  });
  const principal = () => panneauEtape()?.querySelector<HTMLTextAreaElement>('textarea')?.value;

  it('bureau qui envoie en français : le champ principal montre le français', async () => {
    etat.regles = [bilingue()];
    await ouvrir();
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    expect(principal()).toBe(FR);
    expect(panneauEtape()?.textContent).toContain('Version anglaise — utilisée seulement si vos messages partent en anglais');
  });

  it('bureau qui envoie en ANGLAIS : le champ principal montre l’anglais ; corriger et enregistrer ne laisse qu’un texte, celui qui part', async () => {
    api.langue.mockImplementation(async () => 'en');
    etat.regles = [bilingue()];
    await ouvrir();
    // La carte du canevas montre, elle aussi, le texte qui part.
    expect(carteEtape('Envoyer un texto')?.textContent).toContain(EN);
    expect(carteEtape('Envoyer un texto')?.textContent).not.toContain(FR);
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    expect(principal()).toBe(EN);
    expect(panneauEtape()?.textContent).toContain('Version française — utilisée seulement si vos messages partent en français');
    vi.useFakeTimers();
    saisir(panneauEtape()?.querySelector('textarea'), '20% off until June 1st.');
    cliquer(bouton('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(((derniersSteps() ?? [])[0] as { action: { config: Record<string, string> } }).action.config).toEqual({ body: '20% off until June 1st.' });
  });

  it('la langue du bureau est illisible (panne) : le panneau garde le français, sans planter', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.langue.mockImplementation(async () => { throw new Error('panne'); });
    etat.regles = [bilingue()];
    await ouvrir();
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    expect(principal()).toBe(FR);
  });
});

// ─── P2-13 (QA du 2026-09-25) — quitter l'éditeur ne perd rien ──
// Les deux cas de tests/qa-2026-09-25-p2-fin.test.ts lisaient le SOURCE de
// `quitterEditeur`. Les mêmes promesses, éprouvées sur la vraie page.

describe('P2-13 — quitter l’éditeur ne perd rien (comportement de la vraie page)', () => {
  const avancer = async (ms: number) => {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await attendre();
  };
  async function reecrire(texte: string) {
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    saisir(panneauEtape()?.querySelector('textarea'), texte);
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
  }
  const texteEcrit = (appel: number) => ((api.modifier.mock.calls[appel]?.[1] as { steps?: Array<{ action?: { config?: { body?: string } } }> })?.steps ?? [])[0]?.action?.config?.body;
  /** Fermer l'onglet : le navigateur demande-t-il confirmation ? */
  const fermetureRetenue = () => {
    const e = new Event('beforeunload', { cancelable: true });
    act(() => { window.dispatchEvent(e); });
    return e.defaultPrevented;
  };

  it('des étapes complètes sont ENREGISTRÉES avant de partir — même dans les 3 s d’attente de l’enregistrement automatique, sans question', async () => {
    await ouvrir();
    vi.useFakeTimers();
    await reecrire('Texto réécrit juste avant de partir');
    expect(api.modifier).not.toHaveBeenCalled();
    cliquer(bouton('Mes automatisations'));
    await attendre(12);
    expect(api.modifier).toHaveBeenCalledTimes(1);
    expect(texteEcrit(0)).toBe('Texto réécrit juste avant de partir');
    expect(confirmerMock).not.toHaveBeenCalled();
    expect(lieu()).toBe('/automations');
  });

  it('« modifié, pas encore enregistré » retient la fermeture de l’onglet ; à jour, rien ne la retient', async () => {
    await ouvrir();
    vi.useFakeTimers();
    expect(fermetureRetenue()).toBe(false);
    await reecrire('Texto réécrit');
    expect(fermetureRetenue()).toBe(true);
    await avancer(3000);
    expect(api.modifier).toHaveBeenCalledTimes(1);
    expect(fermetureRetenue()).toBe(false);
  });

  it('« en cours d’enregistrement » compte aussi comme travail non enregistré : la fermeture de l’onglet est retenue tant que le serveur n’a pas répondu', async () => {
    let repondre: (v: unknown) => void = () => {};
    api.modifier.mockImplementationOnce(() => new Promise((ok) => { repondre = ok; }));
    await ouvrir();
    vi.useFakeTimers();
    await reecrire('Texto en cours d’envoi');
    await avancer(3000);
    expect(api.modifier).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Enregistrement');
    expect(fermetureRetenue()).toBe(true);
    await act(async () => { repondre({ ...regle(), updated_at: '2026-10-01T23:59:00Z' }); });
    await attendre(12);
    expect(fermetureRetenue()).toBe(false);
  });

  it('quitter PENDANT un enregistrement en cours : on ne part qu’une fois le travail écrit', async () => {
    let repondre: (v: unknown) => void = () => {};
    api.modifier.mockImplementationOnce(() => new Promise((ok) => { repondre = ok; }));
    await ouvrir();
    vi.useFakeTimers();
    await reecrire('Texto en cours d’envoi');
    await avancer(3000);
    cliquer(bouton('Mes automatisations'));
    await attendre(12);
    // L'envoi n'a pas abouti : on est toujours dans l'éditeur.
    expect(lieu()).toBe(`/automations/${ID}`);
    await act(async () => { repondre({ ...regle(), updated_at: '2026-10-01T23:59:00Z' }); });
    await attendre(20);
    expect(lieu()).toBe('/automations');
    expect(texteEcrit(api.modifier.mock.calls.length - 1)).toBe('Texto en cours d’envoi');
    expect(confirmerMock).not.toHaveBeenCalled();
  });
});

// ─── Lumi ↔ éditeur (constats de l'agent Lumi, D:/lume-final/notes/L-corrections.md) ───

describe('Lumi ↔ éditeur — ce que la route de génération répond est appliqué tel quel, ni plus ni moins', () => {
  const TEXTO_DE_LUMI = [
    { id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Texto de LUMI' } }, suivant: 'e2' },
    { id: 'e2', type: 'action', nom: null, action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
  ];
  /** Le nom à l'écran : le bouton de l'en-tête (un clic l'ouvre en champ de saisie). */
  const nomAffiche = () => container.querySelector('header button span.truncate')?.textContent
    ?? container.querySelector<HTMLInputElement>('input[aria-label="Nom de l’automatisation"]')?.value;
  async function renommer(nouveau: string) {
    cliquer(container.querySelector('header button span.truncate')?.parentElement);
    await attendre(2);
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), nouveau);
    await attendre(2);
  }
  async function demander(demande = 'change le message du texto') {
    saisir(container.querySelector('textarea[id$="-prompt"]'), demande);
    cliquer(boutonExact('Construire') ?? boutonExact('Envoyer'));
    await attendre(12);
  }
  const avancer = async (ms: number) => {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await attendre();
  };
  const dernierPatch = () => api.modifier.mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;

  describe('A-04 — « change le message » ne renomme pas l’automatisation', () => {
    it('`renomme: false` : le nom à l’écran reste celui de l’utilisateur, même si la réponse porte un autre nom', async () => {
      api.lumi.mockImplementation(async () => ({ nom: 'Relance de soumission en un texto', trigger_event: 'quote.sent', resume: 'Texto réécrit.', steps: TEXTO_DE_LUMI, autre: null, modifie: true, renomme: false }));
      await ouvrir();
      vi.useFakeTimers();
      await demander();
      expect(nomAffiche()).toBe('Relance devis');
      await avancer(3000);
      expect(dernierPatch()?.name).toBe('Relance devis');
      expect(JSON.stringify(dernierPatch()?.steps)).toContain('Texto de LUMI');
    });

    it('un nom tapé juste avant, pas encore enregistré : il survit — le serveur rend le nom EN BASE, qui ne l’écrase plus', async () => {
      api.lumi.mockImplementation(async () => ({ nom: 'Relance devis', trigger_event: 'quote.sent', resume: 'Texto réécrit.', steps: TEXTO_DE_LUMI, autre: null, modifie: true, renomme: false }));
      await ouvrir();
      vi.useFakeTimers();
      await renommer('Mon nom à moi');
      await demander();
      expect(nomAffiche()).toBe('Mon nom à moi');
      await avancer(3000);
      expect(dernierPatch()?.name).toBe('Mon nom à moi');
    });

    it('`renomme: true` (« appelle-la X ») : le nom suit', async () => {
      api.lumi.mockImplementation(async () => ({ nom: 'Relance VIP', trigger_event: 'quote.sent', resume: 'Renommée « Relance VIP ».', steps: regle().steps, autre: null, modifie: true, renomme: true }));
      await ouvrir();
      vi.useFakeTimers();
      await demander('appelle-la Relance VIP');
      expect(nomAffiche()).toBe('Relance VIP');
      await avancer(3000);
      expect(dernierPatch()?.name).toBe('Relance VIP');
    });

    it('une automatisation toute neuve, encore sans nom à elle : elle prend celui que Lumi lui donne', async () => {
      etat.regles = [regle({ name: 'Nouvelle automatisation', steps: [] })];
      api.lumi.mockImplementation(async () => ({ nom: 'Relance de devis', trigger_event: 'quote.sent', resume: 'Parcours construit.', steps: TEXTO_DE_LUMI, autre: null, modifie: true, renomme: false }));
      await ouvrir();
      vi.useFakeTimers();
      await demander('relance mes devis après deux jours');
      expect(nomAffiche()).toBe('Relance de devis');
    });
  });

  describe('`modifie: false` (une question, un refus, « active-la ») — l’éditeur n’enregistre RIEN', () => {
    const question = (plus: Record<string, unknown> = {}) => api.lumi.mockImplementation(async () => ({
      nom: 'Relance devis', trigger_event: 'quote.sent', resume: 'Le texto part dès que le devis est envoyé.', steps: regle().steps, autre: null,
      modifie: false, renomme: false, ...plus,
    }));

    it('la réponse rejoint le fil ; aucune écriture, ni tout de suite ni après le délai de l’enregistrement automatique', async () => {
      question();
      await ouvrir();
      vi.useFakeTimers();
      await demander('quand part le texto ?');
      expect(container.textContent).toContain('Le texto part dès que le devis est envoyé.');
      await avancer(3000);
      await avancer(60_000);
      expect(api.modifier).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain('Modifié');
    });

    it('pas de « Lumi a construit le parcours » : rien n’a été construit', async () => {
      question();
      await ouvrir();
      vi.useFakeTimers();
      await demander('quand part le texto ?');
      expect(toasts.succes).toEqual([]);
      expect(toasts.erreur).toEqual([]);
    });

    it('le canevas n’est pas touché : « Annuler » reste grisé (aucune étape d’historique pour rien)', async () => {
      question();
      await ouvrir();
      vi.useFakeTimers();
      await demander('quand part le texto ?');
      expect(container.querySelector<HTMLButtonElement>('button[aria-label="Annuler"]')?.disabled).toBe(true);
    });

    it('automatisation EN LIGNE : pas de « Appliquer les changements de Lumi ? » — il n’y a aucun changement', async () => {
      etat.regles = [regle({ is_active: true })];
      question();
      await ouvrir();
      vi.useFakeTimers();
      await demander('quand part le texto ?');
      expect(confirmerMock).not.toHaveBeenCalled();
      expect(toasts.info).toEqual([]);
    });

    it('garder le fil a touché la règle : la version rendue est notée, et la prochaine écriture de l’éditeur la renvoie (pas de faux « modifiée ailleurs »)', async () => {
      question({ updated_at: '2026-10-02T12:00:00.000001+00:00' });
      await ouvrir();
      vi.useFakeTimers();
      await demander('quand part le texto ?');
      cliquer(carteEtape('Envoyer un texto'));
      await attendre(2);
      saisir(panneauEtape()?.querySelector('textarea'), 'Texto corrigé à la main');
      cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
      await attendre(2);
      await avancer(3000);
      expect(api.modifier).toHaveBeenCalledTimes(1);
      expect(api.modifier.mock.calls[0][2]).toBe('2026-10-02T12:00:00.000001+00:00');
    });

    it('une réponse sans `modifie` (ancien serveur) reste une proposition : appliquée et enregistrée comme avant', async () => {
      api.lumi.mockImplementation(async () => ({ nom: 'Relance devis', trigger_event: 'quote.sent', resume: 'Texto réécrit.', steps: TEXTO_DE_LUMI, autre: null }));
      await ouvrir();
      vi.useFakeTimers();
      await demander();
      await avancer(3000);
      expect(JSON.stringify(dernierPatch()?.steps)).toContain('Texto de LUMI');
    });
  });

  describe('`publiee` — après « active-la » puis « oui » (ou « mets-la en pause »), l’état Publiée / Brouillon suit sans rechargement', () => {
    const interrupteur = () => container.querySelector<HTMLButtonElement>('button[role="switch"]');
    /** Lumi vient de demander « veux-tu que je la publie ? » : « oui » est une réponse, pas une première demande. */
    const FIL = [{ role: 'user', content: 'active-la' }, { role: 'assistant', content: 'Voici ce qui partira. Veux-tu que je la publie ?' }];
    const reponse = (publiee: boolean, resume: string) => api.lumi.mockImplementation(async () => ({
      nom: 'Relance devis', trigger_event: 'quote.sent', resume, steps: regle().steps, autre: null,
      modifie: false, renomme: false, publiee, updated_at: '2026-10-02T12:00:00.000001+00:00',
    }));

    it('brouillon → `publiee: true` : l’interrupteur passe à « publiée », sans que l’éditeur publie lui-même', async () => {
      etat.regles = [regle({ lumi_conversation: FIL })];
      reponse(true, 'C’est fait : « Relance devis » est publiée.');
      await ouvrir();
      vi.useFakeTimers();
      expect(interrupteur()?.getAttribute('aria-checked')).toBe('false');
      await demander('oui');
      expect(interrupteur()?.getAttribute('aria-checked')).toBe('true');
      expect(container.textContent).toContain('C’est fait : « Relance devis » est publiée.');
      // C'est le serveur qui a publié : l'éditeur n'envoie ni publication ni enregistrement.
      expect(api.publier).not.toHaveBeenCalled();
      await avancer(3000);
      expect(api.modifier).not.toHaveBeenCalled();
    });

    it('publiée → `publiee: false` (« mets-la en pause ») : l’interrupteur revient à « brouillon »', async () => {
      etat.regles = [regle({ is_active: true })];
      reponse(false, 'C’est fait : « Relance devis » est en brouillon, plus rien ne part.');
      await ouvrir();
      vi.useFakeTimers();
      expect(interrupteur()?.getAttribute('aria-checked')).toBe('true');
      await demander('mets-la en pause');
      expect(interrupteur()?.getAttribute('aria-checked')).toBe('false');
      expect(api.publier).not.toHaveBeenCalled();
    });

    it('une réponse sans `publiee` (une simple question) ne touche pas à l’état', async () => {
      etat.regles = [regle({ is_active: true })];
      api.lumi.mockImplementation(async () => ({ nom: 'Relance devis', trigger_event: 'quote.sent', resume: 'Elle est publiée.', steps: regle().steps, autre: null, modifie: false }));
      await ouvrir();
      vi.useFakeTimers();
      await demander('est-elle publiée ?');
      expect(interrupteur()?.getAttribute('aria-checked')).toBe('true');
    });

    it('après la publication par Lumi, une proposition de Lumi demande l’accord (elle est EN LIGNE maintenant)', async () => {
      etat.regles = [regle({ lumi_conversation: FIL })];
      reponse(true, 'C’est fait : « Relance devis » est publiée.');
      await ouvrir();
      vi.useFakeTimers();
      await demander('oui');
      api.lumi.mockImplementation(async () => ({ nom: 'Relance devis', trigger_event: 'quote.sent', resume: 'Texto réécrit.', steps: TEXTO_DE_LUMI, autre: null, modifie: true }));
      confirmerMock.mockImplementationOnce(async () => false);
      await demander();
      expect(confirmerMock).toHaveBeenCalledTimes(1);
      expect((confirmerMock.mock.calls[0][0] as { title: string }).title).toBe('Appliquer les changements de Lumi ?');
    });
  });
});

// ─── Régression de 6ce9a1cb (EDT-166), relevée par la session des specs — editeur/11:125 ───

describe('EDT-166 (régression) — l’entrée d’historique de la garde s’en va avec elle : UN seul « Précédent » ramène à la liste', () => {
  const marque = () => (window.history.state as Record<string, unknown> | null)?.lumeGardeEditeur === true;
  const ici = () => (window.history.state as { page?: string } | null)?.page;
  /** Le « Précédent » du navigateur. */
  const precedent = async () => {
    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 30));
    });
    await attendre();
  };
  /** Laisse aboutir un recul que la page a lancé elle-même. */
  const laisserAboutir = async () => {
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await attendre();
  };
  async function saisirDansLePanneau(texte: string) {
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    saisir(panneauEtape()?.querySelector('textarea'), texte);
    await attendre(2);
  }
  async function enregistrerLePanneau() {
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    await laisserAboutir();
  }

  // Un vrai chemin d'historique : la liste, puis l'éditeur ouvert depuis elle.
  beforeEach(() => {
    window.history.pushState({ page: 'liste' }, '');
    window.history.pushState({ page: 'editeur' }, '');
  });

  it('saisie dans un panneau → « Enregistrer » du panneau → UN « Précédent » : on est revenu à la liste', async () => {
    await ouvrir();
    await saisirDansLePanneau('Texto réécrit');
    // La garde est levée : une entrée en double, par-dessus celle de l'éditeur.
    expect(marque()).toBe(true);
    expect(ici()).toBe('editeur');
    await enregistrerLePanneau();
    // Plus rien à perdre : l'entrée en double est retirée — on est sur l'entrée de l'éditeur, sans marque.
    expect(marque()).toBe(false);
    expect(ici()).toBe('editeur');
    expect(confirmerMock).not.toHaveBeenCalled();
    await precedent();
    expect(ici()).toBe('liste');
    expect(confirmerMock).not.toHaveBeenCalled();
  });

  it('une étape ajoutée par le tiroir puis enregistrée : même chose', async () => {
    await ouvrir();
    await ajouterParLeTiroir('Envoyer un texto');
    expect(marque()).toBe(true);
    saisir(panneauEtape()?.querySelector('textarea'), 'Bonjour [client_first_name]');
    await attendre(2);
    await enregistrerLePanneau();
    expect(marque()).toBe(false);
    await precedent();
    expect(ici()).toBe('liste');
  });

  it('une étape incomplète, puis complétée : même chose', async () => {
    etat.regles = [regle({
      steps: [
        { id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', nom: null, action: { type: 'create_task', config: { title: '' } }, suivant: null },
      ],
    })];
    await ouvrir();
    cliquer(container.querySelector('header button .truncate')?.closest('button'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v2');
    await attendre();
    expect(marque()).toBe(true);
    cliquer(carteEtape('Créer une tâche'));
    await attendre(2);
    saisir(panneauEtape()?.querySelector('input[type="text"]:not([id$="-nom"])'), 'Rappeler [client_name]');
    await attendre(2);
    await enregistrerLePanneau();
    expect(marque()).toBe(false);
    await precedent();
    expect(ici()).toBe('liste');
    expect(confirmerMock).not.toHaveBeenCalled();
  });

  it('la garde retient toujours tant qu’il reste quelque chose à perdre : « Précédent » pose la question, « Annuler » garde l’éditeur', async () => {
    await ouvrir();
    await saisirDansLePanneau('En cours de frappe');
    confirmerMock.mockImplementationOnce(async () => false);
    await precedent();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect((confirmerMock.mock.calls[0][0] as { title: string }).title).toBe('Quitter sans enregistrer ?');
    // Refusé : on est toujours dans l'éditeur, sur l'entrée de la garde, la saisie intacte.
    expect(marque()).toBe(true);
    expect(ici()).toBe('editeur');
    expect(panneauEtape()?.querySelector('textarea')?.value).toBe('En cours de frappe');
  });

  it('… et « Quitter » ramène à la liste', async () => {
    await ouvrir();
    await saisirDansLePanneau('En cours de frappe');
    await precedent();
    await laisserAboutir();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(ici()).toBe('liste');
  });

  it('enregistrer, puis retaper aussitôt (avant que le retrait ait abouti) : la garde est de nouveau là, et retient', async () => {
    await ouvrir();
    await saisirDansLePanneau('Texto réécrit');
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    // Sans attendre : une nouvelle saisie dans la foulée.
    await saisirDansLePanneau('Deuxième saisie');
    await laisserAboutir();
    expect(marque()).toBe(true);
    confirmerMock.mockImplementationOnce(async () => false);
    await precedent();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(ici()).toBe('editeur');
  });
});

// ─── Triage « éditeur », S-14 (07-clavardage-lumi:461) ──────────

describe('S-14 — « Voir Autopilot » passe par la même garde que « Mes automatisations » et « Précédent »', () => {
  const INCOMPLETE = [
    { id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: 'e2' },
    { id: 'e2', type: 'action', nom: null, action: { type: 'create_task', config: { title: '' } }, suivant: null },
  ];
  /** Forfait sans Lumi, parcours qui porte une étape incomplète, et une modification : « 1 étape(s) à compléter ». */
  async function ouvrirSansLumiAvecTravailNonEnregistrable() {
    etat.lumi = false;
    etat.regles = [regle({ steps: INCOMPLETE })];
    await ouvrir('/automations/' + ID + '?lumi=1');
    cliquer(container.querySelector('header button .truncate')?.closest('button'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v2');
    await attendre();
    expect(barreDuHaut()).toContain('1 étape(s) à compléter');
    expect(bouton('Voir Autopilot')).toBeDefined();
  }

  it('une étape incomplète : « Voir Autopilot » pose « Quitter sans enregistrer ? » — « Annuler » garde l’éditeur et le travail', async () => {
    await ouvrirSansLumiAvecTravailNonEnregistrable();
    confirmerMock.mockImplementationOnce(async () => false);
    cliquer(bouton('Voir Autopilot'));
    await attendre(12);
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    const question = confirmerMock.mock.calls[0][0] as { title: string; message: string };
    expect(question.title).toBe('Quitter sans enregistrer ?');
    expect(question.message).toBe('Une étape est incomplète, donc le parcours n’a pas pu être enregistré. Si vous quittez maintenant, ces modifications seront perdues.');
    expect(lieu()).toContain(`/automations/${ID}`);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Nom de l’automatisation"]')?.value).toBe('Relance devis v2');
  });

  it('… « Quitter » : on part vers la facturation, sans toast d’après coup', async () => {
    await ouvrirSansLumiAvecTravailNonEnregistrable();
    cliquer(bouton('Voir Autopilot'));
    await attendre(12);
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(lieu()).toBe('/settings/billing');
    expect(toasts.erreur.join('\n')).not.toContain('quittée sans enregistrer');
  });

  it('rien à perdre : « Voir Autopilot » part sans question ; un travail enregistrable est ENREGISTRÉ avant de partir', async () => {
    etat.lumi = false;
    await ouvrir('/automations/' + ID + '?lumi=1');
    cliquer(container.querySelector('header button .truncate')?.closest('button'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v2');
    await attendre();
    cliquer(bouton('Voir Autopilot'));
    await attendre(12);
    expect(confirmerMock).not.toHaveBeenCalled();
    expect(api.modifier).toHaveBeenCalledTimes(1);
    expect((api.modifier.mock.calls[0][1] as { name?: string }).name).toBe('Relance devis v2');
    expect(lieu()).toBe('/settings/billing');
  });
});

// ─── Remarque d'usage (b) de la session des specs : une étape en cours d'ajout se VOIT comme telle ───

describe('étape en cours d’ajout (choisie dans le tiroir, pas encore enregistrée) : la carte et l’indicateur le disent', () => {
  const MENTION = 'En cours d’ajout — pas encore enregistrée';
  const carteEnAttente = () => Array.from(container.querySelectorAll('div.border-dashed')).find((d) => d.textContent?.includes(MENTION));

  it('pendant l’ajout : carte en pointillé avec sa mention, et l’indicateur dit « Étape non enregistrée » — pas « Enregistré »', async () => {
    await ouvrir();
    expect(barreDuHaut()).toContain('Enregistré');
    await ajouterParLeTiroir('Envoyer un texto');
    expect(carteEnAttente()).toBeDefined();
    expect(carteEnAttente()?.textContent).toContain('Envoyer un texto');
    // Une seule carte est en attente : les étapes du parcours gardent leur bordure pleine.
    expect(container.querySelectorAll('div.border-dashed.w-\\[260px\\]')).toHaveLength(1);
    expect(barreDuHaut()).toContain('Étape non enregistrée');
    expect(barreDuHaut()).not.toContain('Enregistré');
  });

  it('« Enregistrer » dans le panneau : c’est une étape comme les autres — plus de pointillé, plus de mention, l’indicateur reprend', async () => {
    await ouvrir();
    await ajouterParLeTiroir('Envoyer un texto');
    saisir(panneauEtape()?.querySelector('textarea'), 'Merci [client_first_name]');
    cliquer(boutonExact('Enregistrer', panneauEtape() ?? undefined));
    await attendre(2);
    expect(container.textContent).not.toContain(MENTION);
    expect(carteEnAttente()).toBeUndefined();
    expect(barreDuHaut()).not.toContain('Étape non enregistrée');
    expect(barreDuHaut()).toContain('Modifié');
  });

  it('ajout abandonné : la carte disparaît, l’indicateur revient à « Enregistré »', async () => {
    await ouvrir();
    await ajouterParLeTiroir('Envoyer un texto');
    cliquer(boutonExact('Annuler', panneauEtape() ?? undefined));
    await attendre(12);
    expect(container.textContent).not.toContain(MENTION);
    expect(barreDuHaut()).toContain('Enregistré');
  });

  it('en anglais', async () => {
    localStorage.setItem('lume-language', 'en');
    await ouvrir();
    cliquer(boutonExact('Add'));
    await attendre(2);
    cliquer(bouton('Send a text message', container.querySelector('aside[aria-label="Actions"]') ?? undefined));
    await attendre(2);
    expect(container.textContent).toContain('Being added — not saved yet');
    expect(barreDuHaut()).toContain('Step not saved');
  });
});

// ─── `actions` = reflet du parcours : la 2e automatisation créée par l'éditeur (carte des automatisations, 2026-10-02) ───

describe('la 2e automatisation que Lumi fait créer par l’éditeur porte dans `actions` le reflet COMPLET de son parcours', () => {
  const message = (id: string, body: string, suivant: string | null) => ({ id, type: 'action', action: { type: 'send_sms', config: { body } }, suivant });
  const AUTRE = [
    message('a1', 'Merci de votre réponse', 'a2'),
    { id: 'a2', type: 'attendre', delai_secondes: 86400, suivant: 'a3' },
    message('a3', 'Voici mon lien de réservation', 'a4'),
    { id: 'a4', type: 'attendre', delai_secondes: 172800, suivant: 'a5' },
    message('a5', 'Dernier rappel', null),
  ];
  const lumiProposeDeux = () => api.lumi.mockImplementation(async () => ({
    nom: 'Relance devis', trigger_event: 'quote.sent', resume: 'Relance.', steps: regle().steps, modifie: true,
    autre: { nom: 'Quand il répond', trigger_event: 'client.replied', resume: 'Trois messages.', steps: AUTRE },
  }));
  async function demander() {
    saisir(container.querySelector('textarea[id$="-prompt"]'), 'relance mon devis, et crée une autre chaîne quand il répond');
    cliquer(boutonExact('Construire') ?? boutonExact('Envoyer'));
    await attendre(12);
  }
  const corps = (actions: unknown) => (actions as Array<{ config: { body?: string } }>).map((a) => a.config.body);

  it('création : trois messages dans le parcours → trois dans `actions`, dans l’ordre de `actionsDuParcours` (avant : le premier seulement)', async () => {
    lumiProposeDeux();
    await ouvrir();
    await demander();
    expect(api.creer).toHaveBeenCalledTimes(1);
    const envoye = api.creer.mock.calls[0][0] as { actions: unknown; steps: unknown; is_active: boolean };
    expect(corps(envoye.actions)).toEqual(['Merci de votre réponse', 'Voici mon lien de réservation', 'Dernier rappel']);
    expect(envoye.actions).toEqual(actionsDuParcours(AUTRE));
    expect(envoye.steps).toEqual(AUTRE);
    expect(envoye.is_active).toBe(false);
  });

  it('mise à jour (Lumi la retouche au tour suivant) : le reflet complet aussi', async () => {
    lumiProposeDeux();
    await ouvrir();
    await demander();
    await demander();
    const autreId = (await api.creer.mock.results[0].value as { id: string }).id;
    const appel = api.modifier.mock.calls.find((c) => c[0] === autreId);
    expect(appel).toBeDefined();
    expect((appel?.[1] as { actions: unknown }).actions).toEqual(actionsDuParcours(AUTRE));
  });
});
