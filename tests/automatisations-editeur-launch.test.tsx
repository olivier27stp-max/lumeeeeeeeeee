// @vitest-environment jsdom
//
// L'ÉDITEUR D'AUTOMATISATIONS — mission de launch (audit du 2026-09-28).
//
// On monte la VRAIE page `AutomationBuilderPage` derrière un vrai routeur et
// on vérifie ce qui part au serveur. Chaque bloc `describe` porte un item.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = '11111111-1111-1111-1111-111111111111';
const ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function regle(over: Record<string, unknown> = {}) {
  return {
    id: ID, org_id: ORG, name: 'Relance devis', description: null,
    trigger_event: 'quote.sent', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }],
    steps: [
      { id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: null },
    ],
    settings: null, is_active: false, is_preset: false, preset_key: null,
    folder_id: null, deleted_at: null, lumi_conversation: [],
    created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
    ...over,
  };
}

const etat = { aLumi: true, regles: [] as any[] };
const api = {
  charger: vi.fn(async () => ({ rules: etat.regles, catalogue: { declencheurs: [], actions: [] } })),
  creer: vi.fn(async (_b: any) => regle({ id: 'neuve-1' }) as any),
  modifier: vi.fn(async (id: string, patch: any) => ({ ...regle({ id }), ...patch }) as any),
  apercu: vi.fn(async (_id: string) => ({ client: null, message: 'Aucun client', apercu: [] })),
  publier: vi.fn(async (_id: string, _a: boolean) => undefined),
  generer: vi.fn(),
  stats: vi.fn(async (_id?: string): Promise<any> => ({ par_regle: {}, par_etape: {} })),
};
const confirmerMock = vi.fn(async (_o: unknown) => true);
const toasts = { erreur: [] as string[], succes: [] as string[], info: [] as string[] };

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: (m: string) => { toasts.erreur.push(String(m)); },
    success: (m: string) => { toasts.succes.push(String(m)); },
    info: (m: string) => { toasts.info.push(String(m)); },
  }),
}));

vi.mock('../src/lib/automationBuilderApi', () => ({
  chargerAutomatisations: () => api.charger(),
  creerAutomatisation: (b: any) => api.creer(b),
  modifierAutomatisation: (id: string, p: any) => api.modifier(id, p),
  genererParcoursAvecLumi: (...a: any[]) => api.generer(...a),
  chargerMembres: vi.fn(async () => []),
  chargerEtiquettes: vi.fn(async () => []),
  apercuAutomatisation: (id: string) => api.apercu(id),
  changerPublication: (id: string, a: boolean) => api.publier(id, a),
  chargerStatistiques: (id?: string) => api.stats(id),
}));
vi.mock('../src/hooks/usePlanFeature', () => ({
  usePlanFeature: () => ({ hasFeature: etat.aLumi, loading: false }),
}));
vi.mock('../src/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ isEnabled: false, loading: false }),
}));
const AUCUN_CHAMP: never[] = [];
vi.mock('../src/components/champs/automatisations', async (orig) => ({
  ...(await orig<typeof import('../src/components/champs/automatisations')>()),
  useChampsTous: () => AUCUN_CHAMP,
}));
vi.mock('../src/lib/pipelineVentesApi', () => ({ fetchPipelines: vi.fn(async () => []), fetchStages: vi.fn(async () => []) }));
vi.mock('../src/lib/servicesApi', () => ({ listPredefinedServices: vi.fn(async () => []) }));
vi.mock('../src/lib/reservationApi', () => ({ apercuClientsInactifs: vi.fn(async () => 0) }));
vi.mock('../src/components/ui/ConfirmDialog', () => ({
  confirmer: (o: unknown) => confirmerMock(o),
  default: () => null,
}));
vi.mock('../src/components/automations/OngletJournaux', () => ({
  OngletJournaux: () => <p>journaux</p>,
  OngletHistorique: () => <p>historique</p>,
}));

import AutomationBuilderPage from '../src/pages/AutomationBuilderPage';
import { LanguageProvider, useTranslation } from '../src/i18n';

/** Change la langue de l'interface, comme le sélecteur de l'app. */
function ChangerLangue() {
  const { language, setLanguage } = useTranslation();
  return <button type="button" data-testid="langue" onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}>langue</button>;
}

function Lieu() {
  const l = useLocation();
  return <output data-testid="lieu">{l.pathname + l.search}</output>;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  etat.aLumi = true;
  etat.regles = [regle()];
  api.charger.mockClear();
  api.creer.mockReset();
  api.creer.mockImplementation(async () => regle({ id: 'neuve-1', steps: [] }) as any);
  api.modifier.mockClear();
  api.apercu.mockClear();
  api.publier.mockClear();
  api.stats.mockReset();
  api.stats.mockImplementation(async () => ({ par_regle: {}, par_etape: {} }));
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

async function attendre(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve(); });
}

async function ouvrir(chemin: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[chemin]}>
        <LanguageProvider>
          <Routes>
            <Route path="/automations/:id" element={<><AutomationBuilderPage /><Lieu /><ChangerLangue /></>} />
            <Route path="/automations" element={<Lieu />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  await attendre();
}

function bouton(texte: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(texte));
}

function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('rien à cliquer');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

const lieu = () => container.querySelector('[data-testid="lieu"]')?.textContent ?? '';

// ─── « Partir de zéro » / « Construire avec Lumi » ─────────────

describe('rien n’est créé en base avant la première vraie sauvegarde', () => {
  it('ouvrir /automations/nouvelle ne crée rien', async () => {
    await ouvrir('/automations/nouvelle');
    expect(container.textContent).toContain('Nouvelle automatisation');
    expect(api.creer).not.toHaveBeenCalled();
    expect(api.modifier).not.toHaveBeenCalled();
  });

  it('sans Autopilot, l’écran de vente de Lumi s’affiche et rien n’est créé', async () => {
    etat.aLumi = false;
    await ouvrir('/automations/nouvelle?lumi=1');
    expect(container.textContent).toContain('Construire avec Lumi — inclus dans Autopilot');
    expect(api.creer).not.toHaveBeenCalled();
  });

  it('la première vraie sauvegarde crée UNE fois, même avec deux écritures simultanées', async () => {
    let finir: (v: any) => void = () => {};
    api.creer.mockImplementationOnce(() => new Promise((r) => { finir = r; }));
    await ouvrir('/automations/nouvelle?lumi=1');

    // 1re écriture : on choisit un déclencheur.
    cliquer(bouton('Choisir le déclencheur'));
    cliquer(bouton('Facture envoyée'));
    await attendre();
    // 2e écriture pendant que la création est en vol.
    cliquer(bouton('Choisir le déclencheur'));
    cliquer(bouton('Job terminé'));
    await attendre();
    expect(api.creer).toHaveBeenCalledTimes(1);
    expect(api.creer.mock.calls[0][0]).toMatchObject({ trigger_event: 'invoice.sent', is_active: false });

    await act(async () => { finir(regle({ id: 'neuve-1', trigger_event: 'invoice.sent', steps: [] })); });
    await attendre();
    expect(api.creer).toHaveBeenCalledTimes(1);
    expect(api.modifier).toHaveBeenCalledWith('neuve-1', expect.objectContaining({ trigger_event: 'job.completed' }));
    // L'adresse devient celle de la règle créée, sans recharger l'écran.
    expect(lieu()).toBe('/automations/neuve-1?lumi=1');
    expect(api.charger).toHaveBeenCalledTimes(1);
  });
});

// ─── Bloc 5 : statistiques par étape ────────────────────────────

/** La carte d'étape du canevas dont le titre contient `texte`. */
function carte(texte: string) {
  return Array.from(container.querySelectorAll('button[aria-current], button'))
    .find((b) => b.textContent?.includes(texte) && b.closest('.w-\\[260px\\]'));
}

describe('statistiques — onglet « Statistiques » d’une étape', () => {
  it('affiche les passages réels de l’étape, les sautées comptées à part', async () => {
    api.stats.mockImplementation(async () => ({
      par_regle: {},
      par_etape: { e1: { envoyes: 3, sautes: 2, echecs: 1, en_attente: 4 } },
    }));
    await ouvrir(`/automations/${ID}`);
    await attendre();
    expect(api.stats).toHaveBeenCalledWith(ID);
    cliquer(carte('Envoyer un texto'));
    cliquer(bouton('Statistiques'));
    const texte = container.textContent ?? '';
    expect(texte).not.toContain('Aucun passage encore');
    expect(texte).toMatch(/Réussis\s*3/);
    expect(texte).toMatch(/Sautés\s*2/);
    expect(texte).toMatch(/Échoués\s*1/);
    expect(texte).toMatch(/En attente\s*4/);
  });
});

// ─── Bloc 5 : l'écriture du déclencheur proposé par Lumi ────────

/** Changer la valeur d'un champ comme l'utilisateur (setter natif). */
function saisir(el: Element | null | undefined, v: string) {
  if (!el) throw new Error('champ introuvable');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('déclencheur proposé par Lumi : un échec d’écriture n’est plus avalé', () => {
  it('le dit, et l’écran revient au déclencheur enregistré en base', async () => {
    api.generer.mockImplementation(async () => ({
      steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: null }],
      nom: 'Relance facture', trigger_event: 'invoice.sent', resume: 'Relance après la facture.',
    }));
    api.modifier.mockImplementation(async (id: string, patch: any) => {
      if (patch.trigger_event) throw new Error('Votre rôle ne permet pas de modifier une automatisation.');
      return { ...regle({ id }), ...patch };
    });
    await ouvrir(`/automations/${ID}`);
    saisir(container.querySelector('textarea'), 'Relance mes factures envoyées après trois jours');
    cliquer(bouton('Construire'));
    await attendre(10);
    expect(toasts.erreur.join('\n')).toContain('Le déclencheur proposé par Lumi n’a pas pu être enregistré');
    // Le catalogue du test est vide : le libellé affiché est la clé brute.
    expect(container.textContent).toContain('quote.sent');
    expect(container.textContent).not.toContain('invoice.sent');
  });
});

// ─── Bloc 5 : changer de langue ne recharge plus l'éditeur ──────

describe('changer de langue en cours d’édition', () => {
  it('ne relit pas la base et garde ce qui n’est pas encore enregistré', async () => {
    await ouvrir(`/automations/${ID}`);
    expect(api.charger).toHaveBeenCalledTimes(1);
    // Une modification locale, pas encore enregistrée (l'enregistrement
    // automatique attend 3 s).
    cliquer(bouton('Relance devis'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Mon nom à moi');
    cliquer(container.querySelector('[data-testid="langue"]'));
    await attendre();
    expect(api.charger).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Automation name"]')?.value
      ?? container.textContent).toContain('Mon nom à moi');
  });
});

describe('« Aperçu » montre la version à jour', () => {
  it('enregistre d’abord ce qui attend (délai de la sauvegarde auto), puis lit l’aperçu', async () => {
    await ouvrir(`/automations/${ID}`);
    cliquer(bouton('Relance devis'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v2');
    api.modifier.mockClear();
    const ordre: string[] = [];
    api.modifier.mockImplementationOnce(async (id: string, patch: any) => { ordre.push('enregistrer'); return { ...regle({ id }), ...patch }; });
    api.apercu.mockImplementationOnce(async () => { ordre.push('apercu'); return { client: null, message: 'x', apercu: [] }; });
    cliquer(bouton('Aperçu'));
    await attendre();
    expect(ordre).toEqual(['enregistrer', 'apercu']);
    expect(api.modifier.mock.calls[0][1]).toMatchObject({ name: 'Relance devis v2' });
  });
});

describe('échec de chargement de l’éditeur', () => {
  it('dit « Impossible de charger » (pas « introuvable ») et « Réessayer » recharge', async () => {
    api.charger.mockImplementation(async () => { throw new Error('503'); });
    await ouvrir(`/automations/${ID}`);
    // Les 3 essais (1,5 s puis 3 s) passent avant le verdict.
    await act(async () => { await new Promise((r) => setTimeout(r, 4800)); });
    await attendre();
    expect(container.textContent).toContain('Impossible de charger cette automatisation');
    expect(container.textContent).not.toContain('introuvable');
    api.charger.mockImplementation(async () => ({ rules: etat.regles, catalogue: { declencheurs: [], actions: [] } }));
    cliquer(bouton('Réessayer'));
    await attendre();
    expect(container.textContent).toContain('Relance devis');
  }, 15_000);
});

describe('textes de suppression d’étape', () => {
  it('accents corrects, et les deux suppressions sont signalées comme dangereuses', () => {
    const src = require('node:fs').readFileSync('src/pages/AutomationBuilderPage.tsx', 'utf8') as string;
    expect(src).toContain('Supprimer cette étape ?');
    expect(src).toContain('Ce qui venait après reste dans le parcours');
    expect(src).not.toContain('Supprimer cette etape');
    const bloc = (debut: string) => src.slice(src.indexOf(debut), src.indexOf(debut) + 1600);
    expect(bloc('const supprimerEtape = useCallback')).toContain('danger: true');
    expect(bloc('const supprimerDepuis = useCallback')).toContain('danger: true');
  });
});
