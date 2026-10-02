// @vitest-environment jsdom
//
// LA LANGUE DES MESSAGES — une seule source pour le sélecteur « FR / EN » de la liste et la carte des
// Réglages globaux (`06-reglages-globaux:116` : le sélecteur de la liste RESTE ; la ligne se ferme si les
// deux se suivent À L'ÉCRAN, dans les deux sens, sans recharger).
//
// Les deux VRAIES pages, dans le même routeur, sur une fausse base (`base.langue`) : on passe de l'une à
// l'autre par les liens de la sous-navigation, comme dans l'application — jamais par un remontage du test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

/** La base : la langue du bureau, et de quoi retenir ou faire échouer une écriture. */
const base = vi.hoisted(() => ({
  langue: 'fr' as 'fr' | 'en',
  lectures: 0,
  /** Une écriture retenue : la base ne change qu'à `liberer()`. */
  retenue: null as null | { liberer: () => void; refuser: (e: Error) => void },
  retenir: false,
}));

vi.mock('../src/lib/automationRulesApi', () => ({
  getAutomationRules: vi.fn(async () => []),
  getAutomationLanguage: vi.fn(async () => { base.lectures += 1; return base.langue; }),
  setAutomationLanguage: vi.fn((l: 'fr' | 'en') => {
    if (!base.retenir) { base.langue = l; return Promise.resolve(); }
    return new Promise<void>((ok, ko) => {
      base.retenue = { liberer: () => { base.langue = l; ok(); }, refuser: ko };
    });
  }),
  updateRuleMessage: vi.fn(),
  getCompanyBranding: vi.fn(async () => ({ nom: 'A inc.', logo: null, couleur: null })),
  avisActives: vi.fn(async () => true),
}));
vi.mock('../src/lib/automationStatsApi', () => ({
  chargerStatistiquesBureau: async () => ({ par_regle: {}, total: {}, par_jour: [], texto_configure: true, periode: { jours: 30 } }),
  lirePeriodeChoisie: () => 30,
  retenirPeriode: () => undefined,
}));
vi.mock('../src/hooks/usePermissions', () => ({
  usePermissions: () => ({ permissions: null, role: 'owner', scope: 'company', userId: 'u-1', teamId: null, departmentId: null, managerId: null, loading: false }),
}));
vi.mock('../src/lib/automationBuilderApi', () => ({
  changerPublication: vi.fn(), changerPublicationEnLot: vi.fn(), chargerDossiers: vi.fn(async () => []), creerDossier: vi.fn(),
  supprimerDossier: vi.fn(), renommerDossier: vi.fn(), rangerDansDossier: vi.fn(), chargerBureauxCibles: vi.fn(async () => []),
  dupliquerAutomatisation: vi.fn(), supprimerAutomatisation: vi.fn(), restaurerAutomatisation: vi.fn(),
  supprimerDefinitivementAutomatisation: vi.fn(), fetchModelesAutomatisation: vi.fn(async () => []), utiliserModele: vi.fn(), copierVersBureaux: vi.fn(),
}));
vi.mock('../src/lib/automationWebhooksApi', () => ({
  lireEtatPause: vi.fn(async () => ({ paused: false })), basculerPause: vi.fn(async () => ({ paused: false })),
  listerAdressesDAppel: vi.fn(async () => []), creerAdresseDAppel: vi.fn(), basculerAdresseDAppel: vi.fn(),
  regenererAdresseDAppel: vi.fn(), supprimerAdresseDAppel: vi.fn(),
}));
vi.mock('../src/components/automations/AdressesDAppel', () => ({ default: () => null }));
vi.mock('../src/lib/reservationApi', () => ({ apercuClientsInactifs: vi.fn(async () => 0) }));
vi.mock('../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));
vi.mock('../src/lib/appelServeur', () => ({ appelServeur: vi.fn() }));
vi.mock('../src/lib/supabase', () => {
  const chaine: any = new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(res) : () => chaine),
    apply: () => chaine,
  });
  return {
    supabase: {
      from: () => chaine,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getUser: async () => ({ data: { user: null } }),
        getSession: async () => ({ data: { session: { access_token: 'jeton-test' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

import * as api from '../src/lib/automationRulesApi';
import { toast } from 'sonner';
import { LanguageProvider } from '../src/i18n';
import { reinitialiserLangueMessages } from '../src/lib/langueMessages';
import Automations from '../src/pages/Automations';
import AutomationsReglages from '../src/pages/AutomationsReglages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root | null = null;
const laisser = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function ouvrir(entree: '/automations' | '/automations/reglages') {
  localStorage.setItem('lume-language', 'fr');
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(
      <MemoryRouter initialEntries={[entree]}>
        <LanguageProvider>
          <Routes>
            <Route path="/automations" element={<Automations />} />
            <Route path="/automations/reglages" element={<AutomationsReglages />} />
            <Route path="*" element={<p>autre page</p>} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  await laisser(); await laisser();
}
async function cliquer(el: Element | null | undefined) {
  if (!el) throw new Error('élément introuvable');
  await act(async () => { (el as HTMLElement).click(); });
  await laisser();
}
/** Les liens de la sous-navigation : on change d'écran SANS remonter l'application. */
const lien = (href: string) => conteneur.querySelector(`nav[aria-label="Sections"] a[href="${href}"]`);
const versReglages = async () => { await cliquer(lien('/automations/reglages')); await laisser(); };
const versListe = async () => { await cliquer(lien('/automations')); await laisser(); };
/** Le sélecteur de la liste : quelle langue est enfoncée (`aria-pressed`). */
const selecteur = () => Object.fromEntries(
  Array.from(conteneur.querySelectorAll('[role="group"][aria-label="Langue des messages"] button')).map((b) => [b.textContent, b.getAttribute('aria-pressed')]),
);
const boutonLangue = (l: 'FR' | 'EN') => Array.from(conteneur.querySelectorAll('[role="group"][aria-label="Langue des messages"] button')).find((b) => b.textContent === l);
/** La carte des Réglages globaux. */
const carte = () => conteneur.querySelector('[data-testid="langue-des-messages"]')?.textContent ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  base.langue = 'fr';
  base.lectures = 0;
  base.retenue = null;
  base.retenir = false;
  reinitialiserLangueMessages();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
  vi.mocked(console.error).mockRestore?.();
});

describe('06-reglages-globaux:116 — la liste et la carte des Réglages globaux disent la même langue, sans recharger', () => {
  it('sens 1 — changée par le sélecteur de la LISTE : la carte dit « English »', async () => {
    await ouvrir('/automations');
    expect(selecteur()).toEqual({ FR: 'true', EN: 'false' });
    await cliquer(boutonLangue('EN'));
    expect(base.langue).toBe('en');
    expect(toast.success).toHaveBeenCalledWith('Messages en anglais');
    await versReglages();
    expect(carte()).toBe('English');
    // Et retour à la liste : toujours EN.
    await versListe();
    expect(selecteur()).toEqual({ FR: 'false', EN: 'true' });
  });

  it('sens 2 — changée par le chemin de la CARTE (Paramètres › Entreprise écrit la base) : le sélecteur de la liste suit', async () => {
    await ouvrir('/automations/reglages');
    expect(carte()).toBe('Français');
    // « Changer dans les réglages » mène à Paramètres › Entreprise, qui écrit la langue du bureau.
    base.langue = 'en';
    await versListe();
    expect(selecteur()).toEqual({ FR: 'false', EN: 'true' });
    // La carte, rouverte, la dit aussi.
    await versReglages();
    expect(carte()).toBe('English');
  });

  it('écriture LENTE — « EN » puis les Réglages globaux aussitôt : la carte dit déjà « English », sans relire une base en retard', async () => {
    await ouvrir('/automations');
    base.retenir = true;
    const lecturesAvant = base.lectures;
    await cliquer(boutonLangue('EN'));
    // L'écriture n'est PAS arrivée en base…
    expect(base.langue).toBe('fr');
    expect(selecteur()).toEqual({ FR: 'false', EN: 'true' });
    await versReglages();
    // …et la carte ne relit pas la base (elle y lirait « Français », et le dirait jusqu'au rechargement).
    expect(base.lectures).toBe(lecturesAvant);
    expect(carte()).toBe('English');
    await act(async () => { base.retenue!.liberer(); });
    await laisser();
    expect(base.langue).toBe('en');
    expect(carte()).toBe('English');
  });

  it('écriture REFUSÉE pendant qu’on regarde la carte : la carte revient à « Français », et la liste aussi', async () => {
    await ouvrir('/automations');
    base.retenir = true;
    await cliquer(boutonLangue('EN'));
    await versReglages();
    expect(carte()).toBe('English');
    await act(async () => { base.retenue!.refuser(new Error('Seul un administrateur peut changer la langue des messages. Rien n’a été modifié.')); });
    await laisser();
    expect(carte()).toBe('Français');
    await versListe();
    expect(selecteur()).toEqual({ FR: 'true', EN: 'false' });
    expect(base.langue).toBe('fr');
  });

  it('lecture en panne : ni la liste ni la carte n’affirment une langue ; chacune le journalise sous SON nom', async () => {
    vi.mocked(api.getAutomationLanguage).mockRejectedValue(new Error('panne'));
    await ouvrir('/automations');
    expect(selecteur()).toEqual({ FR: 'false', EN: 'false' });
    expect(conteneur.textContent).toContain('Langue actuelle inconnue');
    await versReglages();
    expect(carte()).toBeNull();
    expect(conteneur.textContent).toContain('Impossible de lire la langue pour le moment.');
    const journaux = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(journaux).toContain('[automations] langue des messages illisible');
    expect(journaux).toContain('[automations/reglages] langue des messages illisible');
  });
});
