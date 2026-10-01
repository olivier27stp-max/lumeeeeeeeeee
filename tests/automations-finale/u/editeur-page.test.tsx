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
}));
const confirmerMock = vi.hoisted(() => vi.fn(async (_o: unknown) => true));
const toasts = vi.hoisted(() => ({ erreur: [] as string[], succes: [] as string[], info: [] as string[] }));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: (m: string) => { toasts.erreur.push(String(m)); },
    success: (m: string) => { toasts.succes.push(String(m)); },
    info: (m: string) => { toasts.info.push(String(m)); },
  }),
}));
vi.mock('../../../src/lib/automationBuilderApi', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/automationBuilderApi')>()),
  chargerEditeur: (id: string | null) => api.editeur(id),
  creerAutomatisation: (b: unknown) => api.creer(b),
  modifierAutomatisation: (id: string, p: unknown) => api.modifier(id, p),
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
  confirmerMock.mockReset();
  confirmerMock.mockImplementation(async () => true);
  toasts.erreur = []; toasts.succes = []; toasts.info = [];
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
