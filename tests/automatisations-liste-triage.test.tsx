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
  vi.mocked(api.getAutomationRules).mockResolvedValue([regle()]);
  echecsMock.mockResolvedValue([]);
  vi.mocked(api.getAutomationLanguage).mockResolvedValue('fr');
  statsMock.mockResolvedValue({ par_regle: {}, par_etape: null, texto_configure: true });
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
  it('lecture des échecs en panne : « À vérifier (?) », jamais « (0) » ni « tout roule » — et « Réessayer » relit', async () => {
    const r = regle({ name: 'En échec', is_active: true });
    vi.mocked(api.getAutomationRules).mockResolvedValue([r]);
    statsMock.mockRejectedValue(new Error('panne simulée'));
    await rendre();
    expect(onglet(/^À vérifier/)?.textContent).toBe('À vérifier (?)');
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
