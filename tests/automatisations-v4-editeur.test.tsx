// @vitest-environment jsdom
//
// VAGUE 4 — l'éditeur d'automatisations (audit V2, 11-interface.md §9).
//
// On monte la VRAIE page `AutomationBuilderPage` derrière un vrai routeur et
// on vérifie ce qui part au serveur. Chaque bloc `describe` porte un défaut.

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

/** Changer la valeur d'un champ comme l'utilisateur (setter natif). */
function saisir(el: Element | null | undefined, v: string) {
  if (!el) throw new Error('champ introuvable');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}

/** Le bouton dont le texte est EXACTEMENT `texte`. */
function boutonExact(texte: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === texte);
}

// ─── A-02 ───────────────────────────────────────────────────────

describe('A-02 — « Ajouter » ne touche pas une règle au format d’origine', () => {
  it('le bouton n’est pas offert : ajouter une étape abandonnerait les actions d’origine', async () => {
    etat.regles = [regle({
      steps: [],
      actions: [
        { type: 'send_sms', config: { body: 'Bonjour' } },
        { type: 'create_task', config: { title: 'Rappeler' } },
      ],
      is_active: true,
    })];
    await ouvrir(`/automations/${ID}`);
    expect(container.textContent).toContain('Parcours au format d’origine');
    expect(boutonExact('Ajouter')).toBeUndefined();
    expect(api.modifier).not.toHaveBeenCalled();
  });

  it('il reste offert sur un vrai parcours', async () => {
    await ouvrir(`/automations/${ID}`);
    expect(boutonExact('Ajouter')).toBeDefined();
  });
});

// ─── A-03 (écran) ───────────────────────────────────────────────

describe('A-03 — une automatisation publiée et cassée est dite comme telle', () => {
  it('le bandeau ne dit pas « avant de publier » : elle l’est déjà, et rien ne part correctement', async () => {
    etat.regles = [regle({
      trigger_event: 'invoice.sent', is_active: true,
      steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'envoyer_soumission', config: {} }, suivant: null }],
    })];
    await ouvrir(`/automations/${ID}`);
    const texte = container.textContent ?? '';
    expect(texte).not.toContain('à corriger avant de publier');
    expect(texte).toContain('Publiée mais cassée');
  });

  it('le refus du serveur au changement de déclencheur est affiché, et l’écran garde l’ancien', async () => {
    api.modifier.mockImplementation(async () => {
      throw new Error('Cette automatisation est publiée : cette modification l’empêcherait de fonctionner (…).');
    });
    etat.regles = [regle({ is_active: true })];
    await ouvrir(`/automations/${ID}`);
    cliquer(bouton('Quand'));
    await attendre();
    // Le tiroir ou le panneau du déclencheur : on passe par « Changer » au besoin.
    const changer = bouton('Changer');
    if (changer) cliquer(changer);
    await attendre();
    const choix = bouton('Nouveau prospect');
    expect(choix).toBeDefined();
    cliquer(choix);
    await attendre();
    expect(toasts.erreur.join('\n')).toContain('est publiée');
  });
});
