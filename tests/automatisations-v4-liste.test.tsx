// @vitest-environment jsdom
//
// VAGUE 4 — la liste des automatisations (audit V2, 11-interface.md §9).
//
// On monte la VRAIE page `Automations` et on vérifie ce qui part au serveur
// et ce qui reste à l'écran. Chaque bloc `describe` porte un défaut.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = '11111111-1111-1111-1111-111111111111';

function regle(over: Record<string, unknown> = {}) {
  return {
    id: 'r-1', org_id: ORG, name: 'Relance devis', description: null,
    trigger_event: 'quote.sent', delay_seconds: 0, is_active: false, is_preset: false,
    preset_key: null, folder_id: null, deleted_at: null, steps: [], actions: [],
    conditions: {}, created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
    ...over,
  };
}

let reglesServies: any[] = [];
const toggleMock = vi.fn(async (_id: string, _actif: boolean) => undefined);
const publierMock = vi.fn(async (_id: string, _actif: boolean) => undefined);
const publierLotMock = vi.fn(async (ids: string[], _actif: boolean) => ids.map((id) => ({ id, ok: true })));
const creerMock = vi.fn(async (_b: unknown) => regle({ id: 'neuve' }));
const statsMock = vi.fn(async (): Promise<any> => ({ par_regle: {}, par_etape: null }));
const echecsMock = vi.fn(async (): Promise<any[]> => []);
const naviguer = vi.fn();
const langueMock = vi.fn(async (_l: 'fr' | 'en') => undefined);
const dossierMock = vi.fn(async (name: string) => ({ id: 'd1', name, position: 0, created_at: '' }));
const catalogueMock = vi.fn(async () => ({ rules: [], catalogue: { declencheurs: [], actions: [] } }));
const toasts = { erreur: [] as string[], succes: [] as string[] };

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: (m: string) => { toasts.erreur.push(String(m)); },
    success: (m: string) => { toasts.succes.push(String(m)); },
    info: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => naviguer,
}));

vi.mock('../src/lib/automationRulesApi', () => ({
  getAutomationRules: vi.fn(async () => reglesServies),
  toggleAutomationRule: (...a: any[]) => toggleMock(a[0], a[1]),
  getFailureCountsByRule: vi.fn(async () => ({})),
  getRecentAutomationFailures: () => echecsMock(),
  getAutomationLanguage: vi.fn(async () => 'fr'),
  setAutomationLanguage: (l: 'fr' | 'en') => langueMock(l),
  avisActives: vi.fn(async () => true),
}));

vi.mock('../src/lib/automationBuilderApi', () => ({
  chargerAutomatisations: () => catalogueMock(),
  creerAutomatisation: (b: unknown) => creerMock(b),
  dupliquerAutomatisation: vi.fn(async () => regle()),
  supprimerAutomatisation: vi.fn(async () => undefined),
  restaurerAutomatisation: vi.fn(async () => regle()),
  chargerDossiers: vi.fn(async () => []),
  creerDossier: (name: string) => dossierMock(name),
  supprimerDossier: vi.fn(async () => undefined),
  rangerDansDossier: vi.fn(async () => undefined),
  renommerDossier: vi.fn(async () => undefined),
  chargerBureauxCibles: vi.fn(async () => []),
  changerPublication: (id: string, actif: boolean) => publierMock(id, actif),
  changerPublicationEnLot: (ids: string[], actif: boolean) => publierLotMock(ids, actif),
  chargerStatistiques: () => statsMock(),
}));

vi.mock('../src/components/ui/ConfirmDialog', () => ({
  confirmer: vi.fn(async () => true),
  default: () => null,
}));
vi.mock('../src/components/PermissionGate', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../src/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ isEnabled: false, loading: false }),
}));

import Automations from '../src/pages/Automations';
import { LanguageProvider } from '../src/i18n';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  toggleMock.mockClear();
  publierMock.mockReset();
  publierMock.mockImplementation(async () => undefined);
  publierLotMock.mockClear();
  creerMock.mockClear();
  echecsMock.mockReset();
  echecsMock.mockImplementation(async () => []);
  statsMock.mockReset();
  statsMock.mockImplementation(async () => ({ par_regle: {}, par_etape: null }));
  naviguer.mockClear();
  langueMock.mockReset();
  langueMock.mockImplementation(async () => undefined);
  dossierMock.mockClear();
  catalogueMock.mockClear();
  toasts.erreur = [];
  toasts.succes = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem('lume-language', 'fr');
  localStorage.removeItem('lume-automations-par-page');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function rendre(chemin = '/automations') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[chemin]}>
        <LanguageProvider>
          <Automations />
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {});
}

async function attendre() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

function interrupteur(nom: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="switch"]'))
    .find((x) => x.getAttribute('aria-label')?.includes(nom));
  if (!b) throw new Error(`interrupteur « ${nom} » introuvable`);
  return b;
}

function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('rien à cliquer');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

function bouton(texte: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === texte
    || b.textContent?.includes(texte));
}

// ─── A-07 ───────────────────────────────────────────────────────

describe('A-07 — « Messages en FR/EN » dit le refus', () => {
  it('le serveur n’a rien modifié : la raison est affichée et le bouton revient', async () => {
    reglesServies = [regle()];
    langueMock.mockImplementation(async () => {
      throw new Error('Seul un administrateur peut changer la langue des messages. Rien n’a été modifié.');
    });
    await rendre();
    cliquer(bouton('EN'));
    await attendre();
    expect(toasts.succes.join(' | ')).not.toContain('Messages en anglais');
    expect(toasts.erreur.join(' | ')).toContain('Seul un administrateur');
    const en = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'EN');
    expect(en?.className).not.toContain('bg-text-primary');
  });
});

// ─── A-10 ───────────────────────────────────────────────────────

function saisir(el: Element | null | undefined, v: string) {
  if (!el) throw new Error('champ introuvable');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, v);
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('A-10 — double Entrée sur « Nouveau dossier » : un seul dossier, aucun faux refus', () => {
  it('la deuxième soumission est ignorée tant que la première est en vol', async () => {
    reglesServies = [regle()];
    let finir: () => void = () => {};
    dossierMock.mockImplementationOnce((name: string) => new Promise((r) => { finir = () => r({ id: 'd1', name, position: 0, created_at: '' }); }));
    await rendre();
    cliquer(bouton('Nouveau dossier'));
    const champ = container.querySelector<HTMLInputElement>('#nouveau-dossier');
    saisir(champ, 'Relances');
    act(() => { champ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    act(() => { champ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    cliquer(bouton('Créer'));
    await act(async () => { finir(); });
    await attendre();
    expect(dossierMock).toHaveBeenCalledTimes(1);
    expect(toasts.erreur).toEqual([]);
    expect(toasts.succes.join(' | ')).toContain('Relances');
  });
});

// ─── A-14 (liste) ───────────────────────────────────────────────

describe('A-14 — /automations?onglet=verifier ouvre l’onglet « À vérifier »', () => {
  it('l’onglet demandé par l’adresse est sélectionné', async () => {
    reglesServies = [regle()];
    await rendre('/automations?onglet=verifier');
    const actif = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(actif?.textContent).toContain('À vérifier');
  });

  it('une valeur inconnue retombe sur « Toutes »', async () => {
    reglesServies = [regle()];
    await rendre('/automations?onglet=nimporte');
    const actif = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(actif?.textContent).toContain('Toutes');
  });
});

// ─── A-16 (liste) ───────────────────────────────────────────────

describe('A-16 — un seul nom pour un déclencheur, celui du catalogue (comme l’éditeur)', () => {
  it('« Nouveau prospect », pas « Lead créé »', async () => {
    reglesServies = [regle({ trigger_event: 'lead.created', name: 'Bienvenue' })];
    await rendre();
    expect(container.textContent).toContain('Nouveau prospect');
    expect(container.textContent).not.toContain('Lead créé');
  });
});

// ─── A-17 ───────────────────────────────────────────────────────

/** Les noms des lignes du tableau, dans l'ordre affiché. */
function ordre(): string[] {
  return Array.from(container.querySelectorAll('tbody tr td:nth-child(2) button span span:first-child'))
    .map((s) => s.textContent?.trim() ?? '');
}

function entete(texte: string) {
  return Array.from(container.querySelectorAll('thead th button')).find((b) => b.textContent?.includes(texte));
}

describe('A-17 — les colonnes de la liste se trient', () => {
  it('Nom (A→Z puis Z→A), Créée le, Total déclenché ; l’en-tête dit le sens (aria-sort)', async () => {
    reglesServies = [
      regle({ id: 'b', name: 'Bravo', created_at: '2026-09-03T00:00:00Z', updated_at: '2026-09-03T00:00:00Z' }),
      regle({ id: 'a', name: 'Alpha', created_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' }),
      regle({ id: 'c', name: 'Charlie', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' }),
    ];
    statsMock.mockImplementation(async () => ({
      par_regle: { a: { declenches: 1, en_cours: 0 }, b: { declenches: 9, en_cours: 2 }, c: { declenches: 4, en_cours: 1 } },
      par_etape: null,
    }));
    await rendre();
    await attendre();
    cliquer(entete('Nom'));
    expect(ordre()).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(entete('Nom')?.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    cliquer(entete('Nom'));
    expect(ordre()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    expect(entete('Nom')?.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    cliquer(entete('Créée le'));
    expect(ordre()).toEqual(['Charlie', 'Bravo', 'Alpha']);
    cliquer(entete('Total déclenché'));
    expect(ordre()).toEqual(['Alpha', 'Charlie', 'Bravo']);
    expect(entete('Nom')?.closest('th')?.getAttribute('aria-sort')).toBe('none');
  });
});

// ─── PERF-1 ─────────────────────────────────────────────────────

describe('PERF-1 — la liste ne télécharge les règles qu’une fois', () => {
  it('pas de 2e lecture complète (catalogue jamais lu) : /api/automations/rules n’est pas appelé', async () => {
    reglesServies = [regle()];
    await rendre();
    await attendre();
    expect(container.textContent).toContain('Relance devis');
    expect(catalogueMock).not.toHaveBeenCalled();
  });
});
