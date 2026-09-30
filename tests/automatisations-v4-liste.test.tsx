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
  chargerAutomatisations: vi.fn(async () => ({ rules: [], catalogue: { declencheurs: [], actions: [] } })),
  creerAutomatisation: (b: unknown) => creerMock(b),
  dupliquerAutomatisation: vi.fn(async () => regle()),
  supprimerAutomatisation: vi.fn(async () => undefined),
  restaurerAutomatisation: vi.fn(async () => regle()),
  chargerDossiers: vi.fn(async () => []),
  creerDossier: vi.fn(async () => ({ id: 'd1', name: 'X', position: 0, created_at: '' })),
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

async function rendre() {
  await act(async () => {
    root.render(
      <MemoryRouter>
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
