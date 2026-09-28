// @vitest-environment jsdom
//
// LA LISTE DES AUTOMATISATIONS — mission de launch (audit du 2026-09-28).
//
// On monte la VRAIE page `Automations` et on vérifie ce qui part au serveur
// et ce qui reste à l'écran. Chaque bloc `describe` porte un item de l'audit.

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
const naviguer = vi.fn();
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
  getRecentAutomationFailures: vi.fn(async () => []),
  getAutomationLanguage: vi.fn(async () => 'fr'),
  setAutomationLanguage: vi.fn(async () => undefined),
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
  statsMock.mockReset();
  statsMock.mockImplementation(async () => ({ par_regle: {}, par_etape: null }));
  naviguer.mockClear();
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

// ─── M8 ─────────────────────────────────────────────────────────

describe('M8 — la liste publie par la route serveur, qui peut refuser', () => {
  it('l’interrupteur appelle la route de publication, jamais l’écriture directe', async () => {
    reglesServies = [regle({ id: 'a', name: 'Relance A' })];
    await rendre();
    cliquer(interrupteur('Relance A'));
    await attendre();
    expect(publierMock).toHaveBeenCalledWith('a', true);
    expect(toggleMock).not.toHaveBeenCalled();
  });

  it('un refus affiche les problèmes nommés, et l’interrupteur revient à Brouillon', async () => {
    reglesServies = [regle({ id: 'a', name: 'Relance A' })];
    publierMock.mockImplementation(async () => {
      throw new Error('Publication refusée : Ajoutez au moins une étape : pour l’instant, cette automatisation ne fait rien.');
    });
    await rendre();
    cliquer(interrupteur('Relance A'));
    await attendre();
    expect(toasts.erreur.join('\n')).toContain('Ajoutez au moins une étape');
    expect(interrupteur('Relance A').getAttribute('aria-checked')).toBe('false');
  });

  it('le lot « Publier » passe par la route de lot et nomme chaque refus', async () => {
    reglesServies = [regle({ id: 'a', name: 'Relance A' }), regle({ id: 'b', name: 'Relance B' })];
    publierLotMock.mockImplementationOnce(async () => [
      { id: 'a', ok: true },
      { id: 'b', ok: false, erreur: 'Publication refusée : « Envoyer un courriel » : « Objet » est vide.' },
    ] as any);
    await rendre();
    cliquer(container.querySelector('input[aria-label="Tout cocher"]'));
    await attendre();
    cliquer(bouton('Publier'));
    await attendre();
    expect(publierLotMock).toHaveBeenCalledWith(['a', 'b'], true);
    expect(toggleMock).not.toHaveBeenCalled();
    expect(toasts.erreur.join('\n')).toContain('Relance B');
    expect(toasts.erreur.join('\n')).toContain('« Objet » est vide');
  });
});

// ─── Double clic « Créer » ──────────────────────────────────────

describe('double clic sur « Créer » : jamais deux automatisations', () => {
  /*
   * D'abord corrigé par un verrou sur la requête ; depuis que la liste ne
   * crée plus rien (« rien en base avant la première vraie sauvegarde »),
   * un double clic ne fait qu'ouvrir l'éditeur. La création unique est
   * gardée côté éditeur (automatisations-editeur-launch.test.tsx).
   */
  it('deux clics rapides sur « Construire avec Lumi » ne créent RIEN et ouvrent le brouillon', async () => {
    reglesServies = [];
    await rendre();
    const lumi = bouton('Construire avec Lumi');
    act(() => {
      lumi?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      lumi?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await attendre();
    expect(creerMock).not.toHaveBeenCalled();
    expect(naviguer).toHaveBeenCalledWith('/automations/nouvelle?lumi=1');
  });

  it('« Partir de zéro » ouvre le brouillon sans rien créer', async () => {
    reglesServies = [];
    await rendre();
    cliquer(bouton('Créer'));
    cliquer(bouton('Partir de zéro'));
    await attendre();
    expect(creerMock).not.toHaveBeenCalled();
    expect(naviguer).toHaveBeenCalledWith('/automations/nouvelle');
  });
});

// ─── M9 ─────────────────────────────────────────────────────────

function cocher(nom: string) {
  cliquer(container.querySelector(`input[aria-label="Cocher ${nom}"]`));
}

function saisirRecherche(v: string) {
  const champ = container.querySelector<HTMLInputElement>('#rech-automations');
  if (!champ) throw new Error('recherche introuvable');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(champ, v);
  act(() => { champ.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('M9 — le lot n’agit que sur ce qui est à l’écran', () => {
  it('cocher dans « Toutes » puis dans « Modèles » : « Publier » ne touche QUE la ligne visible', async () => {
    reglesServies = [
      regle({ id: 'a', name: 'Mienne A' }),
      regle({ id: 'b', name: 'Mienne B' }),
      regle({ id: 'm', name: 'Modèle M', is_preset: true, preset_key: 'lead_followup_1d' }),
    ];
    await rendre();
    cocher('Mienne A');
    cocher('Mienne B');
    cliquer(Array.from(container.querySelectorAll('button[role="tab"]')).find((b) => b.textContent?.includes('Modèles')));
    await attendre();
    cocher('Modèle M');
    await attendre();
    expect(container.textContent).toContain('1 sélectionnée(s)');
    // Le bouton annonce le nombre exact de ce qu'il va toucher.
    expect(bouton('Publier (')?.textContent).toContain('Publier (1)');
    cliquer(bouton('Publier ('));
    await attendre();
    expect(publierLotMock).toHaveBeenCalledWith(['m'], true);
  });

  it('changer de page ou chercher vide la sélection', async () => {
    reglesServies = Array.from({ length: 12 }, (_, i) => regle({ id: `r${i}`, name: `Auto ${String(i).padStart(2, '0')}` }));
    await rendre();
    cocher('Auto 00');
    expect(container.textContent).toContain('1 sélectionnée(s)');
    cliquer(bouton('Suivant'));
    await attendre();
    expect(container.textContent).not.toContain('sélectionnée(s)');

    cliquer(bouton('Précédent'));
    await attendre();
    cocher('Auto 01');
    expect(container.textContent).toContain('1 sélectionnée(s)');
    saisirRecherche('Auto');
    await attendre();
    expect(container.textContent).not.toContain('sélectionnée(s)');
  });
});

// ─── Bloc 5 : statistiques ──────────────────────────────────────

/** Le texte des cellules de la ligne de l'automatisation `nom`. */
function cellules(nom: string): string[] {
  const ligne = Array.from(container.querySelectorAll('tbody tr')).find((tr) => tr.textContent?.includes(nom));
  if (!ligne) throw new Error(`ligne « ${nom} » introuvable`);
  return Array.from(ligne.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '');
}

describe('statistiques — « Total déclenché » et « En cours » sur de vraies données', () => {
  it('les colonnes affichent les chiffres de la route agrégée, plus « — »', async () => {
    reglesServies = [regle({ id: 'a', name: 'Relance A' }), regle({ id: 'b', name: 'Relance B' })];
    statsMock.mockImplementation(async () => ({
      par_regle: { a: { declenches: 7, en_cours: 2, envoyes: 5, sautes: 1, echecs: 1 } },
      par_etape: null,
    }));
    await rendre();
    await attendre();
    // Colonnes : ☑ · Nom · Statut · Total déclenché · En cours · …
    expect(cellules('Relance A').slice(3, 5)).toEqual(['7', '2']);
    // Jamais déclenchée : un vrai zéro, pas un tiret.
    expect(cellules('Relance B').slice(3, 5)).toEqual(['0', '0']);
  });

  it('le détail › dit les envois, les étapes sautées (à part) et les échecs', async () => {
    reglesServies = [regle({ id: 'a', name: 'Relance A' })];
    statsMock.mockImplementation(async () => ({
      par_regle: { a: { declenches: 7, en_cours: 2, envoyes: 5, sautes: 1, echecs: 1 } },
      par_etape: null,
    }));
    await rendre();
    await attendre();
    cliquer(container.querySelector('button[aria-label="Statistiques de Relance A"]'));
    expect(container.textContent).toContain('5 envoi(s), 1 étape(s) sautée(s), 1 échec(s)');
  });
});
