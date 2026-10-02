// @vitest-environment jsdom
//
// LA LISTE DES AUTOMATISATIONS — les défauts du triage du 2026-10-01
// (`D:/lume-uiaudit/sorties/triage/liste.md`, 41 lignes trouvées au vrai navigateur).
//
// Un bloc par ligne du triage, nommé par sa spec Playwright (« fichier:ligne »). Chaque test rend la
// VRAIE page et rejoue le geste : il était rouge avant le correctif.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';

// ── Mocks (hissés) ─────────────────────────────────────────────
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const { echecsMock, statsMock, droits } = vi.hoisted(() => ({
  echecsMock: vi.fn(async (): Promise<any[]> => []),
  statsMock: vi.fn(async (): Promise<any> => ({ par_regle: {}, par_etape: null, texto_configure: true })),
  /** Le rôle et les droits de la personne connectée — changés par les tests de permissions. */
  droits: { role: 'owner' as string, permissions: null as Record<string, boolean> | null },
}));
vi.mock('../src/lib/automationStatsApi', async () => {
  const { versStatistiques } = await import('./aides/stats-automatisations');
  return {
    chargerStatistiquesBureau: async () => versStatistiques(await statsMock(), await echecsMock()),
    lirePeriodeChoisie: () => 7,
    retenirPeriode: () => undefined,
  };
});

vi.mock('../src/hooks/usePermissions', () => ({
  usePermissions: () => ({
    permissions: droits.permissions, role: droits.role, scope: 'company', userId: 'u-1',
    teamId: null, departmentId: null, managerId: null, loading: false,
  }),
}));

vi.mock('../src/lib/automationRulesApi', () => ({
  getAutomationRules: vi.fn(async () => []),
  getAutomationLanguage: vi.fn(async () => 'fr'),
  setAutomationLanguage: vi.fn(async () => undefined),
  updateRuleMessage: vi.fn(async () => undefined),
  toggleAutomationRule: vi.fn(async () => undefined),
  getCompanyBranding: vi.fn(async () => ({ nom: 'A inc.', logo: null, couleur: null })),
  avisActives: vi.fn(async () => true),
}));

vi.mock('../src/lib/automationBuilderApi', () => ({
  changerPublication: vi.fn(async () => undefined),
  changerPublicationEnLot: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, ok: true }))),
  chargerDossiers: vi.fn(async () => []),
  creerDossier: vi.fn(),
  supprimerDossier: vi.fn(async () => undefined),
  renommerDossier: vi.fn(),
  rangerDansDossier: vi.fn(),
  chargerBureauxCibles: vi.fn(async () => []),
  dupliquerAutomatisation: vi.fn(),
  supprimerAutomatisation: vi.fn(),
  restaurerAutomatisation: vi.fn(),
  supprimerDefinitivementAutomatisation: vi.fn(),
  fetchModelesAutomatisation: vi.fn(async () => []),
  utiliserModele: vi.fn(),
  copierVersBureaux: vi.fn(),
}));

vi.mock('../src/lib/automationWebhooksApi', () => ({
  lireEtatPause: vi.fn(async () => ({ paused: false })),
  basculerPause: vi.fn(async () => ({ paused: false })),
}));
vi.mock('../src/lib/reservationApi', () => ({ apercuClientsInactifs: vi.fn(async () => 0) }));
vi.mock('../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));
vi.mock('../src/lib/appelServeur', () => ({ appelServeur: vi.fn() }));

vi.mock('../src/lib/supabase', () => {
  const chaine: any = new Proxy(function () {}, {
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
        getSession: async () => ({ data: { session: { access_token: 'jeton-test' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

import * as api from '../src/lib/automationRulesApi';
import * as builder from '../src/lib/automationBuilderApi';
import { apercuClientsInactifs } from '../src/lib/reservationApi';
import { confirmer } from '../src/components/ui/ConfirmDialog';
import { toast } from 'sonner';
import { LanguageProvider } from '../src/i18n';
import Automations from '../src/pages/Automations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Fixtures ───────────────────────────────────────────────────
let compteurRegles = 0;
function regle(partiel: Partial<api.AutomationRule> = {}): api.AutomationRule {
  compteurRegles += 1;
  return {
    id: `regle-${compteurRegles}`, org_id: 'org-a', name: `Relance ${compteurRegles}`, description: null,
    trigger_event: 'appointment.created', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'send_sms', config: { body: 'Bonjour, votre rendez-vous est confirmé.' } }],
    steps: null, is_active: false, is_preset: false, preset_key: null,
    folder_id: null, modele_id: null, deleted_at: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...partiel,
  } as api.AutomationRule;
}

// ── Banc React ─────────────────────────────────────────────────
let conteneur: HTMLDivElement;
let racine: Root | null = null;
const laisser = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** Où le routeur se trouve (chemin et paramètres) — pour prouver qu'un lien ou un onglet y écrit. */
let adresse = '';
function Temoin() {
  const l = useLocation();
  adresse = `${l.pathname}${l.search}`;
  return null;
}

async function rendre(langue: 'fr' | 'en' = 'fr', entree = '/automations') {
  localStorage.setItem('lume-language', langue);
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(<MemoryRouter initialEntries={[entree]}><Temoin /><LanguageProvider><Automations /></LanguageProvider></MemoryRouter>);
  });
  await laisser(); await laisser();
  return conteneur;
}
const texte = () => (conteneur.textContent || '').replace(/\s+/g, ' ');
// Dans la page entière : le menu « ⋮ » d'une ligne est rendu dans document.body.
const boutons = () => Array.from(document.body.querySelectorAll('button'));
const bouton = (motif: RegExp) => boutons().find((b) => motif.test((b.textContent || '').replace(/\s+/g, ' ').trim()) || motif.test(b.getAttribute('aria-label') || ''));
const onglet = (motif: RegExp) => Array.from(conteneur.querySelectorAll('[role="tab"]')).find((b) => motif.test((b.textContent || '').trim())) as HTMLElement | undefined;
async function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('élément introuvable');
  await act(async () => { (el as HTMLElement).click(); });
  await laisser();
}
async function touche(el: Element | null | undefined, key: string, plus: KeyboardEventInit = {}) {
  if (!el) throw new Error('élément introuvable');
  let empeche = false;
  await act(async () => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...plus });
    el.dispatchEvent(e);
    empeche = e.defaultPrevented;
  });
  await laisser();
  return empeche;
}
const caseDe = (nom: RegExp) => Array.from(conteneur.querySelectorAll('input[type="checkbox"]')).find((c) => nom.test(c.getAttribute('aria-label') || '')) as HTMLInputElement | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  compteurRegles = 0;
  droits.role = 'owner';
  droits.permissions = null;
  adresse = '';
  // `mockReset` : une réponse « une fois » restée en file (test interrompu) ne fuit pas dans le test suivant.
  vi.mocked(api.getAutomationRules).mockReset().mockResolvedValue([regle()]);
  echecsMock.mockResolvedValue([]);
  vi.mocked(api.getAutomationLanguage).mockResolvedValue('fr');
  statsMock.mockReset().mockResolvedValue({ par_regle: {}, par_etape: null, texto_configure: true });
  vi.mocked(confirmer).mockResolvedValue(true);
  vi.mocked(apercuClientsInactifs).mockResolvedValue(0);
  vi.mocked(builder.chargerDossiers).mockResolvedValue([]);
  vi.mocked(builder.chargerBureauxCibles).mockResolvedValue([]);
  vi.mocked(builder.changerPublicationEnLot).mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, ok: true })) as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
  document.body.querySelectorAll('[role="menu"]').forEach((m) => m.remove());
  vi.mocked(console.error).mockRestore?.();
});

// ═══════════════════════════════════════════════════════════════
describe('07-lot:188 — publier « Client inactif » EN LOT pose la même confirmation que l’interrupteur', () => {
  const inactifs = () => regle({ name: 'Clients inactifs', trigger_event: 'client.inactive', conditions: { mois: 6 } });

  it('le lot annonce combien de clients sont visés et demande « Activer « Client inactif » ? » avant de publier', async () => {
    const r = inactifs();
    vi.mocked(api.getAutomationRules).mockResolvedValue([r]);
    vi.mocked(apercuClientsInactifs).mockResolvedValue(12);
    await rendre();
    await cliquer(caseDe(/^Cocher Clients inactifs$/));
    await cliquer(bouton(/^Publier \(1\)$/));
    expect(apercuClientsInactifs).toHaveBeenCalledWith(6);
    expect(confirmer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirmer).mock.calls[0][0]).toMatchObject({
      title: 'Activer « Client inactif » ?',
      message: '12 clients correspondent aujourd’hui. Les messages partiront par petits lots, en journée.',
      confirmLabel: 'Activer',
    });
    expect(builder.changerPublicationEnLot).toHaveBeenCalledWith([r.id], true);
  });

  it('refuser la confirmation ne publie RIEN, et la sélection reste', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([inactifs(), regle({ name: 'Autre brouillon' })]);
    vi.mocked(confirmer).mockResolvedValue(false);
    await rendre();
    await cliquer(caseDe(/^Tout cocher$/));
    await cliquer(bouton(/^Publier \(2\)$/));
    expect(confirmer).toHaveBeenCalledTimes(1);
    // À plusieurs, le message nomme l'automatisation concernée.
    expect(String(vi.mocked(confirmer).mock.calls[0][0].message)).toMatch(/^Clients inactifs — 0 client correspond aujourd’hui\./);
    expect(builder.changerPublicationEnLot).not.toHaveBeenCalled();
    expect(texte()).toContain('2 sélectionnée(s)');
  });

  it('le texte d’exemple se confirme APRÈS, comme pour l’interrupteur ; sans « Client inactif », aucune question de plus', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Simple' })]);
    await rendre();
    await cliquer(caseDe(/^Cocher Simple$/));
    await cliquer(bouton(/^Publier \(1\)$/));
    expect(apercuClientsInactifs).not.toHaveBeenCalled();
    expect(confirmer).not.toHaveBeenCalled();
    expect(builder.changerPublicationEnLot).toHaveBeenCalledTimes(1);
  });

  it('dépublier en lot ne demande rien', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([{ ...inactifs(), is_active: true }]);
    await rendre();
    await cliquer(caseDe(/^Cocher Clients inactifs$/));
    await cliquer(bouton(/^Repasser en brouillon \(1\)$/));
    expect(confirmer).not.toHaveBeenCalled();
    expect(builder.changerPublicationEnLot).toHaveBeenCalledWith([expect.any(String)], false);
  });

  it('l’interrupteur de la ligne pose toujours la même question', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([inactifs()]);
    vi.mocked(apercuClientsInactifs).mockResolvedValue(1);
    await rendre();
    await cliquer(conteneur.querySelector('[role="switch"]'));
    expect(vi.mocked(confirmer).mock.calls[0][0]).toMatchObject({
      title: 'Activer « Client inactif » ?',
      message: '1 client correspond aujourd’hui. Les messages partiront par petits lots, en journée.',
    });
  });
});

// ═══════════════════════════════════════════════════════════════
describe('03-onglets-etats:229 et 10-volume:210 — « À vérifier » ne dit « tout roule » que s’il le SAIT', () => {
  it('lecture des échecs en panne : « À vérifier » sans compteur, jamais « (0) » ni « tout roule » — et « Réessayer » relit', async () => {
    const r = regle({ name: 'En échec', is_active: true });
    vi.mocked(api.getAutomationRules).mockResolvedValue([r]);
    statsMock.mockRejectedValue(new Error('panne simulée'));
    await rendre();
    expect(onglet(/^À vérifier/)?.textContent).toBe('À vérifier');
    await cliquer(onglet(/^À vérifier/));
    expect(texte()).not.toContain('tout roule');
    expect(conteneur.querySelector('tbody')?.textContent).toContain('Les échecs n’ont pas pu être lus : impossible de dire si tout va bien.');

    // La lecture revient : l'automatisation en échec est là.
    statsMock.mockResolvedValue({ par_regle: { [r.id]: { echecs: 1 } }, texto_configure: true });
    await cliquer(Array.from(conteneur.querySelectorAll('tbody button')).find((b) => b.textContent === 'Réessayer'));
    await laisser();
    expect(onglet(/^À vérifier/)?.textContent).toBe('À vérifier (1)');
    expect(conteneur.querySelector('tbody')?.textContent).toContain('En échec');
    expect(texte()).not.toContain('n’ont pas pu être lus');
  });

  it('en anglais, la panne ne dit pas non plus « all running smoothly »', async () => {
    statsMock.mockRejectedValue(new Error('panne simulée'));
    await rendre('en');
    await cliquer(onglet(/^Needs review/));
    expect(texte()).not.toContain('all running smoothly');
    expect(conteneur.querySelector('tbody')?.textContent).toContain('The failures could not be read');
  });

  it('échecs lus, aucun : « Aucune erreur — tout roule » (inchangé)', async () => {
    await rendre();
    await cliquer(onglet(/^À vérifier \(0\)$/));
    expect(conteneur.querySelector('tbody')?.textContent).toContain('Aucune erreur — tout roule');
  });

  it('une automatisation qui a échoué une fois reste dans l’onglet quand une autre a échoué 205 fois (comptes venus de la base, sans plafond)', async () => {
    const bruyante = regle({ name: 'A bruyante', is_active: true });
    const discrete = regle({ name: 'B discrète', is_active: true });
    vi.mocked(api.getAutomationRules).mockResolvedValue([bruyante, discrete]);
    statsMock.mockResolvedValue({ par_regle: { [bruyante.id]: { echecs: 205 }, [discrete.id]: { echecs: 1 } }, texto_configure: true });
    await rendre('fr', '/automations?onglet=verifier');
    expect(onglet(/^À vérifier/)?.textContent).toBe('À vérifier (2)');
    const noms = Array.from(conteneur.querySelectorAll('tbody tr td:nth-child(2) button span.font-medium')).map((n) => n.textContent);
    expect(noms).toEqual(['A bruyante', 'B discrète']);
    expect(texte()).toContain('205 échec(s) dans les 7 derniers jours');
    expect(texte()).toContain('1 échec(s) dans les 7 derniers jours');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('06-menu-actions:255 — le tableau reste à l’écran pendant un rechargement', () => {
  const dupliquerLaLigne = async () => {
    const b = bouton(/^Actions pour Relance 1$/) as HTMLButtonElement;
    b.focus();
    await cliquer(b);
    await cliquer(Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((m) => m.textContent === 'Dupliquer'));
    return b;
  };

  it('après « Dupliquer », le tableau n’est jamais retiré : la copie arrive dans la liste en place', async () => {
    const r = regle({ name: 'Relance 1' });
    vi.mocked(builder.dupliquerAutomatisation).mockResolvedValue({ id: 'copie' } as never);
    let liberer: (v: api.AutomationRule[]) => void = () => undefined;
    vi.mocked(api.getAutomationRules).mockResolvedValueOnce([r]).mockReturnValueOnce(new Promise((ok) => { liberer = ok; }));
    await rendre();
    let retire = false;
    const veille = new MutationObserver(() => { if (!conteneur.querySelector('table')) retire = true; });
    veille.observe(conteneur, { childList: true, subtree: true });
    await dupliquerLaLigne();
    // La relecture est en cours : avant, une roue remplaçait TOUT le tableau.
    expect(api.getAutomationRules).toHaveBeenCalledTimes(2);
    expect(conteneur.querySelector('table')).not.toBeNull();
    expect(texte()).toContain('Relance 1');
    await act(async () => { liberer([r, regle({ id: 'copie', name: 'Relance 1 (copie)' })]); });
    await laisser();
    veille.disconnect();
    expect(texte()).toContain('Relance 1 (copie)');
    expect(retire).toBe(false);
  });

  it('le focus revient au bouton « ⋮ » de la ligne (il n’a pas disparu), pas au corps de la page', async () => {
    vi.mocked(builder.dupliquerAutomatisation).mockResolvedValue({ id: 'copie' } as never);
    await rendre();
    const b = await dupliquerLaLigne();
    await laisser();
    expect(b.isConnected).toBe(true);
    expect(document.activeElement).toBe(b);
  });

  it('la PREMIÈRE lecture, elle, montre toujours la roue ; et « Réessayer » après une panne aussi', async () => {
    let liberer: (v: api.AutomationRule[]) => void = () => undefined;
    vi.mocked(api.getAutomationRules).mockRejectedValueOnce(new Error('panne')).mockReturnValueOnce(new Promise((ok) => { liberer = ok; }));
    await rendre();
    await cliquer(bouton(/^Réessayer$/));
    expect(conteneur.querySelector('.animate-spin')).not.toBeNull();
    await act(async () => { liberer([regle()]); });
    await laisser();
    expect(conteneur.querySelector('table')).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
describe('03-onglets-etats:130 — le chargement est ANNONCÉ (role="status"), pas une roue muette', () => {
  it('pendant la lecture : « Chargement… » dans un role="status" ; il disparaît quand la liste arrive', async () => {
    let liberer: (v: api.AutomationRule[]) => void = () => undefined;
    vi.mocked(api.getAutomationRules).mockReturnValue(new Promise((ok) => { liberer = ok; }));
    await rendre();
    const annonce = Array.from(conteneur.querySelectorAll('[role="status"]')).find((s) => /Chargement/.test(s.textContent || ''));
    expect(annonce?.textContent).toBe('Chargement…');
    expect(conteneur.querySelector('table')).toBeNull();
    await act(async () => { liberer([regle()]); });
    await laisser();
    expect(conteneur.querySelector('table')).not.toBeNull();
    expect(texte()).not.toContain('Chargement…');
  });

  it('en anglais : « Loading… »', async () => {
    vi.mocked(api.getAutomationRules).mockReturnValue(new Promise(() => undefined));
    await rendre('en');
    expect(Array.from(conteneur.querySelectorAll('[role="status"]')).map((s) => s.textContent)).toContain('Loading…');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('03-onglets-etats:143 — la liste s’affiche dès qu’elle est lue, sans attendre les chiffres', () => {
  const cellules = () => Array.from(conteneur.querySelectorAll('tbody tr:first-child td')).map((c) => (c.textContent || '').trim());

  it('statistiques lentes : le tableau et ses lignes sont là, les colonnes chiffrées disent « … »', async () => {
    let liberer: (v: unknown) => void = () => undefined;
    statsMock.mockReturnValue(new Promise((ok) => { liberer = ok; }));
    const r = regle({ name: 'Déjà lue' });
    vi.mocked(api.getAutomationRules).mockResolvedValue([r]);
    await rendre();
    // Avant : une roue à la place du tableau tant que les chiffres n'avaient pas répondu.
    expect(conteneur.querySelector('table')).not.toBeNull();
    expect(conteneur.querySelector('.animate-spin')).toBeNull();
    expect(texte()).toContain('Déjà lue');
    expect([cellules()[3], cellules()[4]]).toEqual(['…', '…']);
    expect(onglet(/^À vérifier/)?.textContent).toBe('À vérifier');
    expect(texte()).not.toContain('n’ont pas pu être lus');

    // Les chiffres arrivent : ils se posent dans leurs colonnes, sans recharger la liste.
    await act(async () => { liberer({ par_regle: { [r.id]: { declenches: 12, en_cours: 3 } }, texto_configure: true }); });
    await laisser();
    expect([cellules()[3], cellules()[4]]).toEqual(['12', '3']);
    expect(onglet(/^À vérifier/)?.textContent).toBe('À vérifier (0)');
    expect(api.getAutomationRules).toHaveBeenCalledTimes(1);
  });

  it('le panneau › ouvert avant l’arrivée des chiffres dit « Lecture des chiffres… », pas une panne', async () => {
    statsMock.mockReturnValue(new Promise(() => undefined));
    await rendre();
    await cliquer(bouton(/^Statistiques de Relance 1$/));
    expect(texte()).toContain('Lecture des chiffres…');
    expect(texte()).not.toContain('n’ont pas pu être lus');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('03-onglets-etats:184 — un compteur d’onglet ne s’affiche que s’il est connu', () => {
  const libelles = () => Array.from(conteneur.querySelectorAll('[role="tab"]')).map((o) => (o.textContent || '').trim());

  it('lecture des automatisations en panne : aucun « (0) » — la corbeille n’est peut-être pas vide', async () => {
    vi.mocked(api.getAutomationRules).mockRejectedValue(new Error('panne simulée'));
    await rendre();
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toContain('Impossible de charger les automatisations pour le moment.');
    expect(libelles()).toEqual(['Toutes', 'À vérifier', 'Prêtes à publier', 'Corbeille']);
  });

  it('pendant la première lecture non plus', async () => {
    vi.mocked(api.getAutomationRules).mockReturnValue(new Promise(() => undefined));
    await rendre();
    expect(libelles()).toEqual(['Toutes', 'À vérifier', 'Prêtes à publier', 'Corbeille']);
  });

  it('lecture réussie : les compteurs sont là, « Réessayer » après une panne les ramène', async () => {
    const jetee = regle({ name: 'Jetée', deleted_at: '2026-09-30T00:00:00Z' });
    vi.mocked(api.getAutomationRules).mockRejectedValueOnce(new Error('panne simulée')).mockResolvedValue([regle(), jetee]);
    await rendre();
    expect(libelles()).toContain('Corbeille');
    await cliquer(bouton(/^Réessayer$/));
    await laisser();
    expect(libelles()).toEqual(['Toutes', 'À vérifier (0)', 'Prêtes à publier (0)', 'Corbeille (1)']);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('11-clavier:178, :209, :161 — les menus « ⋮ » et « Créer » au clavier', () => {
  const menu = () => document.body.querySelector('[role="menu"]') as HTMLElement | null;
  const actif = () => (document.activeElement?.textContent || '').replace(/\s+/g, ' ').trim();
  const ouvrirActions = async () => {
    const b = bouton(/^Actions pour Relance 1$/) as HTMLButtonElement;
    b.focus();
    await cliquer(b);
    return b;
  };

  it('à l’ouverture du menu ⋮, le focus ENTRE dans le menu (rendu dans un portail, hors de l’ordre de tabulation)', async () => {
    await rendre();
    await ouvrirActions();
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(menu());
    expect(menu()?.getAttribute('aria-label')).toBe('Actions pour Relance 1');
  });

  it('Tab parcourt Modifier, Dupliquer, Déplacer dans un dossier, Supprimer ; Maj+Tab remonte', async () => {
    await rendre();
    await ouvrirActions();
    for (const attendu of ['Modifier', 'Dupliquer', 'Déplacer dans un dossier', 'Supprimer']) {
      expect(await touche(document.activeElement, 'Tab')).toBe(true);
      expect(actif()).toBe(attendu);
    }
    await touche(document.activeElement, 'Tab', { shiftKey: true });
    expect(actif()).toBe('Déplacer dans un dossier');
  });

  it('les flèches, Début et Fin circulent entre les entrées, en boucle', async () => {
    await rendre();
    await ouvrirActions();
    await touche(document.activeElement, 'ArrowDown');
    expect(actif()).toBe('Modifier');
    await touche(document.activeElement, 'ArrowUp');
    expect(actif()).toBe('Supprimer');
    await touche(document.activeElement, 'ArrowDown');
    expect(actif()).toBe('Modifier');
    await touche(document.activeElement, 'End');
    expect(actif()).toBe('Supprimer');
    await touche(document.activeElement, 'Home');
    expect(actif()).toBe('Modifier');
  });

  it('Tab après la dernière entrée REFERME le menu et rend le focus au bouton (le navigateur poursuit de là)', async () => {
    await rendre();
    const b = await ouvrirActions();
    await touche(document.activeElement, 'End');
    // Pas de preventDefault : la tabulation continue, depuis le bouton, vers ce qui le suit.
    expect(await touche(document.activeElement, 'Tab')).toBe(false);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(b);
    expect(b.getAttribute('aria-expanded')).toBe('false');
  });

  it('Maj+Tab avant la première entrée referme aussi, et reste sur le bouton', async () => {
    await rendre();
    const b = await ouvrirActions();
    expect(await touche(document.activeElement, 'Tab', { shiftKey: true })).toBe(true);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(b);
  });

  it('Échap referme et rend le focus au bouton, depuis une entrée', async () => {
    await rendre();
    const b = await ouvrirActions();
    await touche(document.activeElement, 'ArrowDown');
    await touche(document.activeElement, 'Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(b);
  });

  it('menu « Créer » : le focus y entre, la flèche bas va sur « Partir de zéro », Tab sur « Construire avec Lumi »', async () => {
    await rendre();
    const creer = bouton(/^Créer$/) as HTMLButtonElement;
    creer.focus();
    await cliquer(creer);
    expect(document.activeElement).toBe(menu());
    await touche(document.activeElement, 'ArrowDown');
    expect(actif()).toMatch(/^Partir de zéro/);
    await touche(document.activeElement, 'Tab');
    expect(actif()).toMatch(/^Construire avec Lumi/);
    await touche(document.activeElement, 'Tab', { shiftKey: true });
    expect(actif()).toMatch(/^Partir de zéro/);
    await touche(document.activeElement, 'End');
    await touche(document.activeElement, 'Tab');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(creer);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('12-permissions:86 et :102 — « voir » sans « modifier » : la liste en lecture seule', () => {
  const lectureSeule = () => { droits.role = 'technician'; droits.permissions = { 'automations.read': true }; };
  const RAISON = 'Votre rôle permet de voir les automatisations, pas de les modifier.';

  it('la liste s’affiche — pas « Accès restreint » — et dit qu’elle est en lecture seule', async () => {
    lectureSeule();
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Rappel de rendez-vous', is_active: true })]);
    await rendre();
    expect(texte()).not.toContain('Accès restreint');
    expect(conteneur.querySelector('h1')?.textContent).toBe('Mes automatisations');
    expect(texte()).toContain('Rappel de rendez-vous');
    expect(conteneur.querySelector('[role="note"]')?.textContent).toContain(`Lecture seule. ${RAISON}`);
  });

  it('aucun geste d’écriture n’est offert : ni Créer, ni Lumi, ni dossier, ni menu ⋮, ni « Tout arrêter »', async () => {
    lectureSeule();
    vi.mocked(builder.chargerDossiers).mockResolvedValue([{ id: 'd1', name: 'Factures', position: 0, created_at: '' }] as never);
    await rendre();
    for (const absent of [/^Créer$/, /^Construire avec Lumi$/, /^Nouveau dossier$/, /^Actions pour /, /^Tout arrêter$/, /^Renommer le dossier/, /^Supprimer le dossier/]) {
      expect(bouton(absent), String(absent)).toBeUndefined();
    }
    // Le dossier, lui, se consulte toujours.
    expect(bouton(/^Factures/)).toBeDefined();
  });

  it('l’interrupteur, les cases et la langue des messages restent lisibles, grisés avec la raison', async () => {
    lectureSeule();
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Rappel', is_active: true })]);
    await rendre();
    const interrupteur = conteneur.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(interrupteur.getAttribute('aria-checked')).toBe('true');
    expect(interrupteur.disabled).toBe(true);
    await cliquer(interrupteur);
    expect(builder.changerPublication).not.toHaveBeenCalled();
    for (const c of [caseDe(/^Tout cocher$/), caseDe(/^Cocher Rappel$/)]) {
      expect(c?.disabled).toBe(true);
      expect(c?.title).toBe(RAISON);
    }
    const langues = Array.from(conteneur.querySelectorAll('[role="group"] button')) as HTMLButtonElement[];
    expect(langues.map((b) => [b.textContent, b.disabled, b.title])).toEqual([['FR', true, RAISON], ['EN', true, RAISON]]);
    expect(langues[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('le nom n’ouvre pas l’éditeur (il exige le droit de modifier) ; les messages se lisent, sans champ ni « Enregistrer »', async () => {
    lectureSeule();
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Rappel' })]);
    await rendre();
    expect(conteneur.querySelector('tbody tr td:nth-child(2) button')).toBeNull();
    expect(conteneur.querySelector('tbody tr td:nth-child(2)')?.textContent).toContain('Rappel');
    await cliquer(bouton(/^Voir les messages de Rappel$/));
    expect(texte()).toContain('Texto envoyé au client');
    expect(texte()).toContain('Bonjour, votre rendez-vous est confirmé.');
    expect(conteneur.querySelector('tbody textarea, tbody input[type="text"]')).toBeNull();
    expect(bouton(/^Enregistrer$/)).toBeUndefined();
    expect(bouton(/Modifier dans l’éditeur/)).toBeUndefined();
  });

  it('la lecture des bureaux cibles (réservée à qui modifie) n’est pas lancée : plus de 403 en arrière-plan', async () => {
    lectureSeule();
    await rendre();
    expect(builder.chargerBureauxCibles).not.toHaveBeenCalled();
  });

  it('« Réglages globaux » (qui exige « modifier ») n’est pas dans la sous-navigation ; les autres liens y sont', async () => {
    lectureSeule();
    await rendre();
    const liens = Array.from(conteneur.querySelectorAll('nav[aria-label="Sections"] a')).map((a) => a.getAttribute('href'));
    expect(liens).toEqual(['/automations', '/automations/apercu', '/automations/activite']);
  });

  it('sans le droit de VOIR : « Accès restreint », et rien d’autre', async () => {
    droits.role = 'technician';
    droits.permissions = {};
    await rendre();
    expect(texte()).toContain('Accès restreint');
    expect(conteneur.querySelector('table')).toBeNull();
  });

  it('avec le droit de modifier, rien ne change : Créer, menu ⋮, interrupteur actif, nom cliquable', async () => {
    droits.role = 'technician';
    droits.permissions = { 'automations.read': true, 'automations.update': true };
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Rappel' })]);
    await rendre();
    expect(conteneur.querySelector('[role="note"]')).toBeNull();
    expect(bouton(/^Créer$/)).toBeDefined();
    expect(bouton(/^Actions pour Rappel$/)).toBeDefined();
    expect((conteneur.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(false);
    expect(conteneur.querySelector('tbody tr td:nth-child(2) button')).not.toBeNull();
    expect(builder.chargerBureauxCibles).toHaveBeenCalled();
    const liens = Array.from(conteneur.querySelectorAll('nav[aria-label="Sections"] a')).map((a) => a.getAttribute('href'));
    expect(liens).toContain('/automations/reglages');
  });
});
