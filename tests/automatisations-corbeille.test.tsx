// @vitest-environment jsdom
//
// LA CORBEILLE DES AUTOMATISATIONS — sur le VRAI écran.
//
// L'onglet « Corbeille » existait depuis la refonte et affichait toujours
// zéro : la suppression était définitive, la ligne disparaissait pour de
// bon. Ce fichier tient la garde sur ce qui remplace ça.
//
// On monte la VRAIE page avec de vraies règles, et on vérifie ce qui est
// À L'ÉCRAN — pas ce que la base contient. Une base juste ne dit rien de
// l'affichage : la règle supprimée peut très bien rester dans « Toutes ».
//
// Les trois fautes qu'on empêche, toutes silencieuses :
//   · une règle supprimée qui reste listée dans les autres onglets ;
//   · une règle supprimée qui MASQUE sa jumelle vivante (dédoublonnage
//     par `preset_key` fait avant le tri de la corbeille) ;
//   · un interrupteur « publier » actif sur une règle que le moteur
//     ignore — il s'allumerait sans rien changer.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = '11111111-1111-1111-1111-111111111111';

/** Une règle minimale — seuls les champs que la page lit vraiment. */
function regle(over: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    org_id: ORG,
    name: 'Relance devis',
    description: null,
    trigger_event: 'quote.sent',
    delay_seconds: 0,
    is_active: false,
    is_preset: false,
    preset_key: null,
    folder_id: null,
    deleted_at: null,
    steps: [],
    actions: [],
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    ...over,
  };
}

let reglesServies: any[] = [];
const restaurerMock = vi.fn(async (_id: string) => regle());
const supprimerMock = vi.fn(async (_id: string) => undefined);
const toggleMock = vi.fn(async (_id: string, _actif: boolean) => undefined);

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
  chargerAutomatisations: vi.fn(async () => ({ declencheurs: [], actions: [] })),
  creerAutomatisation: vi.fn(async () => regle()),
  dupliquerAutomatisation: vi.fn(async () => regle()),
  supprimerAutomatisation: (...a: any[]) => supprimerMock(a[0]),
  restaurerAutomatisation: (...a: any[]) => restaurerMock(a[0]),
  chargerDossiers: vi.fn(async () => []),
  creerDossier: vi.fn(async () => ({ id: 'd1', name: 'X', position: 0, created_at: '' })),
  supprimerDossier: vi.fn(async () => undefined),
  rangerDansDossier: vi.fn(async () => undefined),
  chargerBureauxCibles: vi.fn(async () => []),
}));

// La confirmation de suppression : on répond « oui » sans boîte de dialogue.
vi.mock('../src/components/ui/ConfirmDialog', () => ({
  confirmer: vi.fn(async () => true),
  default: () => null,
}));

// La page est derrière une PermissionGate ; le test porte sur la corbeille,
// pas sur les droits (couverts ailleurs). On laisse passer.
vi.mock('../src/components/PermissionGate', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Automations from '../src/pages/Automations';
import { LanguageProvider } from '../src/i18n';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  restaurerMock.mockClear();
  supprimerMock.mockClear();
  toggleMock.mockClear();
  // La langue par défaut de Lume est le FRANÇAIS (#500) : les libellés
  // attendus ci-dessous sont ceux que l'utilisateur voit vraiment.
  localStorage.setItem('lume-language', 'fr');
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

/** Tous les boutons dont le texte contient `t`. */
function boutons(t: string) {
  return Array.from(container.querySelectorAll('button')).filter((b) =>
    b.textContent?.includes(t),
  );
}

function cliquer(el: Element | undefined, quoi: string) {
  if (!el) throw new Error(`Rien à cliquer pour « ${quoi} »`);
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

/** Ouvre l'onglet dont le libellé contient `nom`. */
function ouvrirOnglet(nom: string) {
  const b = boutons(nom)[0];
  cliquer(b, `onglet ${nom}`);
}

describe('la corbeille montre ce qu’on y a mis', () => {
  it('une règle supprimée n’apparaît PAS dans « Toutes »', async () => {
    reglesServies = [
      regle({ id: 'vivante', name: 'Règle vivante' }),
      regle({ id: 'jetee', name: 'Règle jetée', deleted_at: '2026-09-24T10:00:00Z' }),
    ];
    await rendre();
    // « Toutes » est l'onglet par défaut.
    expect(container.textContent).toContain('Règle vivante');
    expect(container.textContent, 'une règle à la corbeille sort de la liste principale')
      .not.toContain('Règle jetée');
  });

  it('elle apparaît dans « Corbeille », avec le bon compte', async () => {
    reglesServies = [
      regle({ id: 'vivante', name: 'Règle vivante' }),
      regle({ id: 'jetee', name: 'Règle jetée', deleted_at: '2026-09-24T10:00:00Z' }),
    ];
    await rendre();
    ouvrirOnglet('Corbeille');
    await act(async () => {});
    expect(container.textContent).toContain('Règle jetée');
    expect(container.textContent, 'la vivante reste hors de la corbeille')
      .not.toContain('Règle vivante');
  });

  it('la corbeille vide le dit, au lieu d’une page blanche', async () => {
    reglesServies = [regle({ id: 'vivante', name: 'Règle vivante' })];
    await rendre();
    ouvrirOnglet('Corbeille');
    await act(async () => {});
    expect(container.textContent).toContain('La corbeille est vide');
  });
});

describe('le dédoublonnage ne doit pas manger une règle vivante', () => {
  it('une copie SUPPRIMÉE ne masque pas sa jumelle vivante', async () => {
    /*
     * D'anciennes migrations ont semé le même `preset_key` plusieurs fois ;
     * la page n'en garde qu'une. Si la supprimée arrive la première et
     * consomme la clé, la VIVANTE disparaît de l'écran — tout en continuant
     * de s'exécuter côté moteur. Invisible, et donc jamais corrigé.
     */
    reglesServies = [
      regle({ id: 'jetee', name: 'Copie jetée', preset_key: 'quote_followup',
              deleted_at: '2026-09-24T10:00:00Z' }),
      regle({ id: 'vivante', name: 'Copie vivante', preset_key: 'quote_followup' }),
    ];
    await rendre();
    expect(container.textContent, 'la jumelle vivante doit rester listée')
      .toContain('Copie vivante');
  });
});

describe('ce que la corbeille refuse de faire', () => {
  it('l’interrupteur « publier » est désarmé sur une règle supprimée', async () => {
    reglesServies = [regle({ id: 'jetee', name: 'Règle jetée', deleted_at: '2026-09-24T10:00:00Z' })];
    await rendre();
    ouvrirOnglet('Corbeille');
    await act(async () => {});
    const inter = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '').includes('Publier Règle jetée'),
    ) as HTMLButtonElement | undefined;
    expect(inter, 'l’interrupteur doit exister sur la ligne').toBeDefined();
    expect(inter!.disabled, 'le moteur ignore une règle supprimée : publier ne changerait rien')
      .toBe(true);
  });

  it('le statut affiché dit « Supprimée », pas « Brouillon »', async () => {
    reglesServies = [regle({ id: 'jetee', name: 'Règle jetée', deleted_at: '2026-09-24T10:00:00Z' })];
    await rendre();
    ouvrirOnglet('Corbeille');
    await act(async () => {});
    expect(container.textContent).toContain('Supprimée');
  });
});

describe('restaurer', () => {
  it('le menu d’une ligne supprimée propose « Restaurer » et appelle le serveur', async () => {
    reglesServies = [regle({ id: 'jetee', name: 'Règle jetée', deleted_at: '2026-09-24T10:00:00Z' })];
    await rendre();
    ouvrirOnglet('Corbeille');
    await act(async () => {});

    const menu = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '').includes('Actions pour Règle jetée'),
    );
    cliquer(menu, 'menu « … »');
    await act(async () => {});

    const restaurer = boutons('Restaurer')[0];
    expect(restaurer, 'le menu doit offrir « Restaurer »').toBeDefined();
    await act(async () => { restaurer.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    expect(restaurerMock).toHaveBeenCalledWith('jetee');
  });

  it('le menu d’une ligne supprimée n’offre NI « Modifier » NI « Supprimer »', async () => {
    /*
     * Modifier ou re-supprimer une règle déjà à la corbeille n'a aucun effet
     * visible : offrir le bouton, c'est promettre une action qui ne se passe
     * pas.
     */
    reglesServies = [regle({ id: 'jetee', name: 'Règle jetée', deleted_at: '2026-09-24T10:00:00Z' })];
    await rendre();
    ouvrirOnglet('Corbeille');
    await act(async () => {});

    const menu = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '').includes('Actions pour Règle jetée'),
    );
    cliquer(menu, 'menu « … »');
    await act(async () => {});

    const dansMenu = Array.from(container.querySelectorAll('[role="menuitem"]'))
      .map((e) => e.textContent || '');
    expect(dansMenu.join(' | ')).toContain('Restaurer');
    expect(dansMenu.some((t) => t.includes('Modifier')), 'pas de « Modifier »').toBe(false);
    expect(dansMenu.some((t) => t.includes('Supprimer')), 'pas de « Supprimer »').toBe(false);
  });
});

describe('les actions groupées — les cases à cocher commandent enfin quelque chose', () => {
  /** Coche la première ligne du tableau. */
  function cocherPremiere() {
    const c = Array.from(container.querySelectorAll('input[type="checkbox"]'))
      .find((e) => (e.getAttribute('aria-label') || '').startsWith('Cocher')) as HTMLInputElement;
    if (!c) throw new Error('aucune case de ligne');
    act(() => { c.click(); });
  }

  it('la barre n’apparaît QUE s’il y a une sélection', async () => {
    reglesServies = [regle({ id: 'v', name: 'Règle vivante' })];
    await rendre();
    expect(container.textContent).not.toContain('sélectionnée(s)');
    cocherPremiere();
    await act(async () => {});
    expect(container.textContent).toContain('1 sélectionnée(s)');
  });

  it('« Supprimer » en lot met bien chaque règle à la corbeille', async () => {
    reglesServies = [regle({ id: 'v', name: 'Règle vivante' })];
    await rendre();
    cocherPremiere();
    await act(async () => {});
    const btn = boutons('Supprimer').find((b) => !b.getAttribute('aria-label'));
    await act(async () => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {});
    expect(supprimerMock).toHaveBeenCalledWith('v');
  });

  it('un MODÈLE coché n’est jamais supprimé en lot', async () => {
    /*
     * Le menu d'une ligne refuse déjà de supprimer un modèle. Sans le même
     * garde dans le lot, « tout cocher » enverrait des suppressions vouées
     * à échouer, et la barre afficherait des erreurs sur des lignes que
     * personne n'a voulu toucher.
     */
    reglesServies = [regle({ id: 'm', name: 'Modèle', is_preset: true, is_active: false })];
    await rendre();
    ouvrirOnglet('Modèles');
    await act(async () => {});
    cocherPremiere();
    await act(async () => {});
    const btn = boutons('Supprimer').find((b) => !b.getAttribute('aria-label'));
    await act(async () => { btn!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => {});
    expect(supprimerMock, 'un modèle ne se supprime pas').not.toHaveBeenCalled();
  });

  it('dans la corbeille, le lot propose « Restaurer » et pas « Publier »', async () => {
    reglesServies = [regle({ id: 'jetee', name: 'Règle jetée', deleted_at: '2026-09-24T10:00:00Z' })];
    await rendre();
    ouvrirOnglet('Corbeille');
    await act(async () => {});
    cocherPremiere();
    await act(async () => {});
    expect(container.textContent).toContain('1 sélectionnée(s)');
    expect(boutons('Restaurer').length, '« Restaurer » offert').toBeGreaterThan(0);
    expect(boutons('Repasser en brouillon').length, 'publier n’a pas de sens ici').toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────
   Le SERVEUR — lu dans la source, faute de pouvoir l'exécuter ici.

   Ce qui suit vient d'un vrai échec mesuré contre staging, pas d'une
   intuition : supprimer une automatisation renvoyait 500 pour TOUT LE
   MONDE, et depuis longtemps.
   ───────────────────────────────────────────────────────────── */
describe('la route de suppression, côté serveur', () => {
  const routes = readFileSync(
    resolve(__dirname, '../server/routes/automation-rules.ts'), 'utf8',
  );

  it('annule les tâches planifiées avec le client SERVICE, jamais celui de la session', () => {
    /*
     * `automation_scheduled_tasks` n'accorde à `authenticated` que le
     * SELECT (catalogue de staging, 2026-09-24 : une seule policy, aucun
     * grant UPDATE). Avec `auth.client`, l'annulation échouait sur
     * « permission denied » et la route sortait en 500 AVANT la
     * suppression : mesuré dans un navigateur, la règle restait en place
     * et l'utilisateur voyait « Impossible d'annuler les envois prévus ».
     */
    const bloc = routes.slice(routes.indexOf("router.delete('/automations/rules/:id'"));
    const corps = bloc.slice(0, bloc.indexOf('\n});'));
    const debut = corps.indexOf("from('automation_scheduled_tasks')");
    expect(debut, 'la route doit annuler les envois déjà prévus').toBeGreaterThan(-1);

    // Ce qui précède immédiatement l'appel dit QUEL client écrit.
    const quiEcrit = corps.slice(Math.max(0, debut - 120), debut);
    expect(quiEcrit, 'le client de session n’a que le SELECT sur cette table')
      .not.toMatch(/auth\.client/);
    expect(quiEcrit, 'l’annulation doit passer par le client service')
      .toMatch(/getServiceClient\(\)|await service/);

    // Le client service ne passe pas par la RLS : l'org doit être filtrée
    // à la main, sinon on annulerait les tâches d'une autre entreprise.
    const maj = corps.slice(debut, debut + 400);
    expect(maj, 'le client service ne filtre rien tout seul').toMatch(/\.eq\('org_id'/);
  });

  it('supprime en DOUX : `deleted_at`, jamais un `.delete()`', () => {
    const bloc = routes.slice(routes.indexOf("router.delete('/automations/rules/:id'"));
    const corps = bloc.slice(0, bloc.indexOf('\n});'));
    expect(corps).toMatch(/deleted_at:/);
    expect(corps, 'une suppression dure rendrait la corbeille inutile')
      .not.toMatch(/from\('automation_rules'\)\s*\n?\s*\.delete\(\)/);
  });

  it('restaurer ramène en BROUILLON, jamais publiée', () => {
    const bloc = routes.slice(routes.indexOf("router.post('/automations/rules/:id/restaurer'"));
    const corps = bloc.slice(0, bloc.indexOf('\n});'));
    expect(corps).toMatch(/deleted_at:\s*null/);
    expect(corps, 'republier d’office ferait repartir des messages sans relecture')
      .toMatch(/is_active:\s*false/);
  });
});
