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
describe('13-libelles-et-complements:143 — en anglais, une panne sans message du serveur est dite en anglais', () => {
  const dupliquerEnAnglais = async () => {
    await cliquer(bouton(/^Actions for Relance 1$/));
    await cliquer(Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((m) => m.textContent === 'Duplicate'));
    await laisser();
  };

  it('le repli du client (« Impossible de dupliquer l’automatisation. ») devient « Could not duplicate the automation. »', async () => {
    // Ce que `automationBuilderApi` lève quand la passerelle répond du HTML : son message de repli, en français.
    vi.mocked(builder.dupliquerAutomatisation).mockRejectedValue(new Error('Impossible de dupliquer l\'automatisation.'));
    await rendre('en');
    await dupliquerEnAnglais();
    expect(toast.error).toHaveBeenCalledWith('Could not duplicate the automation.');
  });

  it('en français, le message est inchangé ; un message précis du serveur est gardé tel quel dans les deux langues', async () => {
    vi.mocked(builder.dupliquerAutomatisation).mockRejectedValue(new Error('Impossible de dupliquer l\'automatisation.'));
    await rendre('fr');
    await cliquer(bouton(/^Actions pour Relance 1$/));
    await cliquer(Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((m) => m.textContent === 'Dupliquer'));
    await laisser();
    expect(toast.error).toHaveBeenCalledWith('Impossible de dupliquer l\'automatisation.');
  });

  it('aucun repli français du client de l’API utilisé par la liste ne reste sans traduction', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/pages/Automations.tsx', 'utf8');
    const client = readFileSync('src/lib/automationBuilderApi.ts', 'utf8');
    // Les fonctions du client que la page appelle, et le repli que chacune lève.
    const appelees = ['changerPublication', 'changerPublicationEnLot', 'dupliquerAutomatisation', 'supprimerAutomatisation',
      'restaurerAutomatisation', 'supprimerDefinitivementAutomatisation', 'chargerDossiers', 'creerDossier', 'renommerDossier',
      'supprimerDossier', 'modifierAutomatisation'];
    const sansTraduction: string[] = [];
    for (const f of appelees) {
      const corps = client.slice(client.indexOf(`export async function ${f}(`));
      const fin = corps.indexOf('\nexport ', 10);
      const repli = /erreurDe\(\w+, (['"])(.+?)\1\)/.exec(corps.slice(0, fin < 0 ? undefined : fin));
      expect(repli, `repli de ${f}`).not.toBeNull();
      const texte = repli![2].replace(/\\'/g, "'");
      if (!page.includes(`'${texte.replace(/'/g, "\\'")}': '`)) sansTraduction.push(`${f} : ${texte}`);
    }
    expect(sansTraduction).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('06-menu-actions:217 — recliquer « Dupliquer » pendant que la copie se crée n’en crée pas une seconde', () => {
  const choisirDupliquer = async () => {
    await cliquer(bouton(/^Actions pour Relance 1$/));
    await cliquer(Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((m) => m.textContent === 'Dupliquer'));
  };

  it('deux « Dupliquer » de suite : un seul appel au serveur ; le second dit que la copie est en cours', async () => {
    let liberer: (v: unknown) => void = () => undefined;
    vi.mocked(builder.dupliquerAutomatisation).mockReturnValue(new Promise((ok) => { liberer = ok; }) as never);
    await rendre();
    await choisirDupliquer();
    // La roue remplace « ⋮ », le bouton reste cliquable (il l'annonce : aria-busy) et le menu se rouvre.
    expect(bouton(/^Actions pour Relance 1$/)?.getAttribute('aria-busy')).toBe('true');
    await choisirDupliquer();
    expect(builder.dupliquerAutomatisation).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith('La copie est déjà en cours de création.', expect.anything());
    await act(async () => { liberer({ id: 'copie' }); });
    await laisser();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Copie créée — elle est en brouillon');
  });

  it('la copie finie (ou en échec), on peut dupliquer de nouveau', async () => {
    vi.mocked(builder.dupliquerAutomatisation).mockRejectedValueOnce(new Error('panne')).mockResolvedValue({ id: 'copie' } as never);
    await rendre();
    await choisirDupliquer();
    await laisser();
    expect(toast.error).toHaveBeenCalledWith('panne');
    await choisirDupliquer();
    await laisser();
    expect(builder.dupliquerAutomatisation).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledTimes(1);
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
describe('03-onglets-etats:86 et :96 — l’onglet ouvert est dans l’adresse', () => {
  const choisi = () => Array.from(conteneur.querySelectorAll('[role="tab"][aria-selected="true"]')).map((o) => (o.textContent || '').trim());

  it('ouvrir « Corbeille » l’écrit dans l’adresse : un rechargement (ou un lien copié) rouvre le même onglet', async () => {
    await rendre();
    expect(adresse).toBe('/automations');
    await cliquer(onglet(/^Corbeille/));
    expect(adresse).toBe('/automations?onglet=corbeille');
    expect(choisi()).toEqual(['Corbeille (0)']);
    // « Recharger » : la page repart de l'adresse.
    await act(async () => racine!.unmount());
    conteneur.remove();
    await rendre('fr', adresse);
    expect(choisi()).toEqual(['Corbeille (0)']);
  });

  it('arrivé par ?onglet=verifier, cliquer « Toutes » retire le paramètre', async () => {
    await rendre('fr', '/automations?onglet=verifier');
    expect(choisi()).toEqual(['À vérifier (0)']);
    await cliquer(onglet(/^Toutes/));
    expect(choisi()).toEqual(['Toutes']);
    expect(adresse).toBe('/automations');
  });

  it('chaque onglet a son adresse ; une valeur inconnue ouvre « Toutes »', async () => {
    await rendre('fr', '/automations?onglet=nimporte');
    expect(choisi()).toEqual(['Toutes']);
    await cliquer(onglet(/^Prêtes à publier/));
    expect(adresse).toBe('/automations?onglet=modeles');
    await cliquer(onglet(/^À vérifier/));
    expect(adresse).toBe('/automations?onglet=verifier');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('03-onglets-etats:266 — l’état vide propose lui-même de créer', () => {
  const vide = () => conteneur.querySelector('tbody td[colspan]') as HTMLElement;
  const boutonsDuVide = () => Array.from(vide().querySelectorAll('button')).map((b) => (b.textContent || '').trim());

  it('bureau sans aucune automatisation : « Aucune automatisation » + « Créer une automatisation », qui ouvre l’éditeur', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([]);
    await rendre();
    expect(vide().textContent).toContain('Aucune automatisation');
    expect(boutonsDuVide()).toEqual(['Créer une automatisation']);
    await cliquer(vide().querySelector('button'));
    expect(adresse).toBe('/automations/nouvelle');
  });

  it('« Toutes » vide mais des préréglages à publier : les deux suites sont offertes', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ is_preset: true, preset_key: 'google_review', is_active: false })]);
    await rendre();
    expect(boutonsDuVide()).toEqual(['Créer une automatisation', 'Voir les automatisations prêtes à publier']);
  });

  it('pas dans « Corbeille » ni « À vérifier », ni pour un rôle en lecture seule', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([]);
    await rendre();
    await cliquer(onglet(/^Corbeille/));
    expect(boutonsDuVide()).toEqual([]);
    await cliquer(onglet(/^À vérifier/));
    expect(boutonsDuVide()).toEqual([]);
    await act(async () => racine!.unmount());
    conteneur.remove();
    droits.role = 'technician';
    droits.permissions = { 'automations.read': true };
    await rendre();
    expect(vide().textContent).toContain('Aucune automatisation');
    expect(boutonsDuVide()).toEqual([]);
  });

  it('en anglais : « Create an automation »', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([]);
    await rendre('en');
    expect(boutonsDuVide()).toEqual(['Create an automation']);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('03-onglets-etats:277 — une recherche sans résultat le DIT, au lieu de « Aucune automatisation »', () => {
  const vide = () => conteneur.querySelector('tbody td[colspan]') as HTMLElement;
  const chercher = async (q: string) => {
    await act(async () => {
      const champ = conteneur.querySelector('#rech-automations') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(champ, q);
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await laisser();
  };

  it('« Aucun résultat pour « … » » et « Effacer la recherche », qui ramène la liste', async () => {
    await rendre();
    await chercher('zzz-aucune-ne-porte-ce-nom');
    expect(vide().textContent).toContain('Aucun résultat pour « zzz-aucune-ne-porte-ce-nom »');
    expect(vide().textContent).not.toContain('Aucune automatisation');
    // Le menu « Créer » n'a rien à faire là : il y a des automatisations, c'est la recherche qui ne trouve rien.
    expect(Array.from(vide().querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Effacer la recherche']);
    await cliquer(vide().querySelector('button'));
    expect(texte()).toContain('Relance 1');
    expect((conteneur.querySelector('#rech-automations') as HTMLInputElement).value).toBe('');
  });

  it('un filtre qui vide la liste : « Aucune automatisation ne correspond à ces filtres » et « Réinitialiser les filtres »', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Publiée', is_active: true })]);
    await rendre();
    await cliquer(bouton(/^Filtres avancés/));
    await act(async () => {
      const statut = conteneur.querySelector('#f-statut') as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(statut, 'brouillon');
      statut.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await laisser();
    expect(vide().textContent).toContain('Aucune automatisation ne correspond à ces filtres');
    await cliquer(Array.from(vide().querySelectorAll('button')).find((b) => b.textContent === 'Réinitialiser les filtres'));
    expect(texte()).toContain('Publiée');
    expect((conteneur.querySelector('#f-statut') as HTMLSelectElement).value).toBe('all');
  });

  it('en anglais, et dans la corbeille aussi', async () => {
    await rendre('en', '/automations?onglet=corbeille');
    await chercher('nothing');
    expect(vide().textContent).toContain('No results for “nothing”');
    expect(vide().textContent).not.toContain('The bin is empty');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('04-filtres-recherche-tri:160 — panneau fermé, le bouton « Filtres avancés » signale les filtres actifs', () => {
  const choisir = async (id: string, valeur: string) => {
    await act(async () => {
      const liste = conteneur.querySelector(id) as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(liste, valeur);
      liste.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await laisser();
  };
  const libelle = () => (bouton(/^Filtres avancés/)?.textContent || '').replace(/\s+/g, ' ').trim();

  it('aucun filtre : « Filtres avancés » ; un filtre : « (1) » ; deux : « (2) » — et il reste visible panneau fermé', async () => {
    await rendre();
    expect(libelle()).toBe('Filtres avancés');
    await cliquer(bouton(/^Filtres avancés/));
    await choisir('#f-statut', 'brouillon');
    expect(libelle()).toBe('Filtres avancés(1) filtre actif');
    await choisir('#f-categorie', 'Quotes');
    expect(libelle()).toBe('Filtres avancés(2) filtres actifs');
    await cliquer(bouton(/^Filtres avancés/));
    expect(conteneur.querySelector('#f-statut')).toBeNull();
    expect(libelle()).toBe('Filtres avancés(2) filtres actifs');
  });

  it('le tri n’est pas un filtre : il ne compte pas', async () => {
    await rendre();
    await cliquer(bouton(/^Filtres avancés/));
    await choisir('#f-tri-date', 'recent');
    expect(libelle()).toBe('Filtres avancés');
  });

  it('en anglais : « Advanced filters(1) active filter »', async () => {
    await rendre('en');
    await cliquer(bouton(/^Advanced filters/));
    await choisir('#f-statut', 'publiee');
    expect((bouton(/^Advanced filters/)?.textContent || '').trim()).toBe('Advanced filters(1) active filter');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('04-filtres-recherche-tri:99 et :106 — la recherche ignore les accents et les espaces autour', () => {
  const chercher = async (q: string) => {
    await act(async () => {
      const champ = conteneur.querySelector('#rech-automations') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(champ, q);
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await laisser();
  };
  const noms = () => Array.from(conteneur.querySelectorAll('tbody tr td:nth-child(2) span.font-medium')).map((n) => n.textContent);
  beforeEach(() => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Élan d’été' }), regle({ name: 'Relance' }), regle({ name: 'Rappel' })]);
  });

  it('« elan d\'ete » (sans accents, apostrophe droite) trouve « Élan d’été »', async () => {
    await rendre();
    await chercher("elan d'ete");
    expect(noms()).toEqual(['Élan d’été']);
    await chercher('ÉLAN D’ÉTÉ');
    expect(noms()).toEqual(['Élan d’été']);
  });

  it('des espaces autour du texte, ou en double au milieu, ne changent rien', async () => {
    await rendre();
    await chercher('  Relance  ');
    expect(noms()).toEqual(['Relance']);
    await chercher('elan   d’ete');
    expect(noms()).toEqual(['Élan d’été']);
    // Le champ, lui, garde ce qu'on a tapé.
    expect((conteneur.querySelector('#rech-automations') as HTMLInputElement).value).toBe('elan   d’ete');
  });

  it('un champ qui ne contient que des espaces ne filtre rien et n’est pas « une recherche sans résultat »', async () => {
    await rendre();
    await chercher('   ');
    expect(noms()).toEqual(['Élan d’été', 'Rappel', 'Relance']);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('04-filtres-recherche-tri:113 et :123 — on trouve ce qu’on voit, et on voit pourquoi une ligne est trouvée', () => {
  const chercher = async (q: string) => {
    await act(async () => {
      const champ = conteneur.querySelector('#rech-automations') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(champ, q);
      champ.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await laisser();
  };
  const noms = () => Array.from(conteneur.querySelectorAll('tbody tr td:nth-child(2) span.font-medium')).map((n) => n.textContent);
  const ligne = () => (conteneur.querySelector('tbody tr td:nth-child(2)')?.textContent || '');

  it('chercher « Facture payée » (écrit sous le nom) trouve la ligne', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([
      regle({ name: 'Merci', trigger_event: 'invoice.paid' }), regle({ name: 'Autre', trigger_event: 'lead.created' }),
    ]);
    await rendre();
    expect(texte()).toContain('Facture payée · Immédiat');
    await chercher('Facture payée');
    expect(noms()).toEqual(['Merci']);
    // Le délai aussi est écrit sous le nom.
    await chercher('immediat');
    expect(noms()).toEqual(['Autre', 'Merci']);
  });

  it('une ligne trouvée par sa description interne MONTRE l’extrait qui contient le mot', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([
      regle({ name: 'Sans rapport', description: 'Description interne motcache42, pour l’équipe.' }),
    ]);
    await rendre();
    // Sans recherche, la description n'encombre pas la liste.
    expect(ligne()).not.toContain('motcache42');
    await chercher('motcache42');
    expect(noms()).toEqual(['Sans rapport']);
    expect(ligne()).toContain('Description : Description interne motcache42, pour l’équipe.');
  });

  it('trouvée par son nom ou son sous-titre : pas d’extrait (on voit déjà pourquoi)', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([
      regle({ name: 'Relance de devis', description: 'Relance de devis, version longue.' }),
    ]);
    await rendre();
    await chercher('relance');
    expect(noms()).toEqual(['Relance de devis']);
    expect(ligne()).not.toContain('Description :');
  });

  it('une longue description est réduite à un extrait autour du mot', async () => {
    const longue = `${'Avant. '.repeat(30)}Le motrare ici. ${'Après. '.repeat(30)}`;
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Longue', description: longue })]);
    await rendre();
    await chercher('motrare');
    expect(ligne()).toContain('motrare');
    expect(ligne()).toMatch(/Description : … .*motrare.* …/);
    expect(ligne().length).toBeLessThan(260);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('05-lignes:119 — un déclencheur hors catalogue n’affiche pas sa clé technique', () => {
  it('« Déclencheur inconnu · Immédiat », jamais « e2e.declencheur_inconnu »', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Clé brute', trigger_event: 'e2e.declencheur_inconnu' })]);
    await rendre();
    expect(texte()).toContain('Déclencheur inconnu · Immédiat');
    expect(texte()).not.toContain('e2e.declencheur_inconnu');
  });

  it('en anglais : « Unknown trigger » ; un déclencheur connu garde son libellé', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([
      regle({ name: 'Raw key', trigger_event: 'e2e.declencheur_inconnu' }), regle({ name: 'Known', trigger_event: 'invoice.paid' }),
    ]);
    await rendre('en');
    expect(texte()).toContain('Unknown trigger · Immediate');
    expect(texte()).toContain('Invoice paid · Immediate');
    expect(texte()).not.toContain('e2e.declencheur_inconnu');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('04-filtres-recherche-tri:205 — une automatisation personnelle est rangée d’après son déclencheur', () => {
  const filtrer = async (categorie: string) => {
    if (!conteneur.querySelector('#f-categorie')) await cliquer(bouton(/^Filtres avancés/));
    await act(async () => {
      const liste = conteneur.querySelector('#f-categorie') as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(liste, categorie);
      liste.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await laisser();
    return Array.from(conteneur.querySelectorAll('tbody tr td:nth-child(2) span.font-medium')).map((n) => n.textContent);
  };

  it('créée sur « Devis envoyé », elle est sous « Devis » — plus sous « Suivi »', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Relance de devis maison', trigger_event: 'quote.sent' })]);
    await rendre();
    expect(await filtrer('Quotes')).toEqual(['Relance de devis maison']);
    expect(await filtrer('Follow-up')).toEqual([]);
  });

  it('chaque famille de déclencheur a sa catégorie ; une famille sans catégorie reste dans « Suivi »', async () => {
    const cas: Array<[string, string]> = [
      ['lead.created', 'Leads'], ['quote.approved', 'Quotes'], ['appointment.created', 'Jobs'], ['job.completed', 'Jobs'],
      ['agreement.signed', 'Jobs'], ['invoice.paid', 'Invoices'], ['payment.failed', 'Payments'], ['client.inactive', 'Client'],
      ['task.completed', 'Follow-up'], ['webhook.received', 'Follow-up'],
    ];
    vi.mocked(api.getAutomationRules).mockResolvedValue(cas.map(([t]) => regle({ name: `Sur ${t}`, trigger_event: t })));
    await rendre();
    await cliquer(bouton(/^Filtres avancés/));
    await act(async () => {
      const parPage = conteneur.querySelector('#par-page') as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(parPage, '50');
      parPage.dispatchEvent(new Event('change', { bubbles: true }));
    });
    let somme = 0;
    for (const categorie of ['Leads', 'Quotes', 'Jobs', 'Invoices', 'Payments', 'Follow-up', 'Reviews', 'Client']) {
      const attendues = cas.filter(([, c]) => c === categorie).map(([t]) => `Sur ${t}`).sort();
      const vues = (await filtrer(categorie)).map(String).sort();
      expect(vues, categorie).toEqual(attendues);
      somme += vues.length;
    }
    // Chaque automatisation est dans UNE catégorie : la somme redonne le tout.
    expect(somme).toBe(cas.length);
  });

  it('un préréglage garde SA catégorie, quel que soit son déclencheur', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([
      regle({ name: 'Avis Google', is_preset: true, is_active: true, preset_key: 'google_review', trigger_event: 'job.completed' }),
    ]);
    await rendre();
    expect((await filtrer('Reviews')).length).toBe(1);
    expect(await filtrer('Jobs')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('04-filtres-recherche-tri:264 et :413 — un seul tri affiché à la fois ; le 3e clic lève le tri', () => {
  const noms = () => Array.from(conteneur.querySelectorAll('tbody tr td:nth-child(2) span.font-medium')).map((n) => n.textContent);
  const entete = (libelle: string) => Array.from(conteneur.querySelectorAll('th')).find((t) => (t.textContent || '').trim() === libelle) as HTMLElement;
  const menuTrier = () => conteneur.querySelector('#f-tri-date') as HTMLSelectElement;
  const choisirTri = async (valeur: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(menuTrier(), valeur);
      menuTrier().dispatchEvent(new Event('change', { bubbles: true }));
    });
    await laisser();
  };
  beforeEach(() => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([
      regle({ name: 'A', created_at: '2025-01-01T15:00:00Z', is_active: true }),
      regle({ name: 'B', created_at: '2026-01-01T15:00:00Z' }),
    ]);
  });

  it('après un clic sur l’en-tête « Nom », « Trier » n’affiche plus « Créées le plus récemment »', async () => {
    await rendre();
    await cliquer(bouton(/^Filtres avancés/));
    await choisirTri('recent');
    expect(noms()).toEqual(['B', 'A']);
    await cliquer(entete('Nom').querySelector('button'));
    expect(noms()).toEqual(['A', 'B']);
    expect(menuTrier().value).toBe('defaut');
    expect(entete('Nom').getAttribute('aria-sort')).toBe('ascending');
  });

  it('choisir dans « Trier » lève le tri par colonne : un seul en-tête trié, ou aucun', async () => {
    await rendre();
    await cliquer(bouton(/^Filtres avancés/));
    await cliquer(entete('Nom').querySelector('button'));
    await cliquer(entete('Nom').querySelector('button'));
    expect(noms()).toEqual(['B', 'A']);
    await choisirTri('ancien');
    expect(noms()).toEqual(['A', 'B']);
    expect(conteneur.querySelectorAll('th[aria-sort="ascending"], th[aria-sort="descending"]').length).toBe(0);
  });

  it('aucun tri → croissant → décroissant → aucun tri (retour à l’ordre par défaut)', async () => {
    await rendre();
    const statut = () => entete('Statut');
    expect(statut().getAttribute('aria-sort')).toBe('none');
    await cliquer(statut().querySelector('button'));
    expect(statut().getAttribute('aria-sort')).toBe('ascending');
    expect(noms()).toEqual(['B', 'A']);
    await cliquer(statut().querySelector('button'));
    expect(statut().getAttribute('aria-sort')).toBe('descending');
    expect(noms()).toEqual(['A', 'B']);
    await cliquer(statut().querySelector('button'));
    expect(statut().getAttribute('aria-sort')).toBe('none');
    expect(noms()).toEqual(['A', 'B']);
    // Et le cycle repart.
    await cliquer(statut().querySelector('button'));
    expect(statut().getAttribute('aria-sort')).toBe('ascending');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('05-lignes:148 — l’avertissement d’avis mène aux réglages d’avis, pas à l’éditeur', () => {
  const avis = () => regle({ name: 'Demande d’avis', is_active: true, trigger_event: 'job.completed', actions: [{ type: 'request_review', config: {} }] as never });
  const AVERTISSEMENT = 'Les demandes d’avis sont désactivées : rien ne part. Activez-les dans Paramètres › Avis clients.';

  it('« Activez-les dans Paramètres › Avis clients. » est un LIEN vers /settings/reviews, hors du bouton du nom', async () => {
    vi.mocked(api.avisActives).mockResolvedValue(false);
    vi.mocked(api.getAutomationRules).mockResolvedValue([avis()]);
    await rendre();
    const cellule = conteneur.querySelector('tbody tr td:nth-child(2)') as HTMLElement;
    expect(cellule.textContent).toContain(AVERTISSEMENT);
    const lien = Array.from(cellule.querySelectorAll('a')).find((a) => a.textContent === 'Activez-les dans Paramètres › Avis clients.');
    expect(lien?.getAttribute('href')).toBe('/settings/reviews');
    // Avant : le texte était DANS le bouton du nom, qui ouvre l'éditeur.
    expect(lien?.closest('button')).toBeNull();
    expect(cellule.querySelector('button')?.textContent).not.toContain('Activez-les');
    await cliquer(lien);
    expect(adresse).toBe('/settings/reviews');
  });

  it('le bouton du nom ne porte que le nom et le sous-titre ; il ouvre toujours l’éditeur', async () => {
    vi.mocked(api.avisActives).mockResolvedValue(false);
    const r = avis();
    vi.mocked(api.getAutomationRules).mockResolvedValue([r]);
    statsMock.mockResolvedValue({ par_regle: { [r.id]: { echecs: 2 } }, texto_configure: true });
    await rendre();
    const nom = conteneur.querySelector('tbody tr td:nth-child(2) button') as HTMLElement;
    expect((nom.textContent || '').replace(/\s+/g, ' ').trim()).toBe('Demande d’avisJob terminé · Immédiat');
    // Les échecs restent sur la ligne, à côté.
    expect(conteneur.querySelector('tbody tr td:nth-child(2)')?.textContent).toContain('2 échec(s) dans les 7 derniers jours');
    await cliquer(nom);
    expect(adresse).toBe(`/automations/${r.id}`);
  });

  it('en anglais : « Turn them on in Settings › Customer reviews. »', async () => {
    vi.mocked(api.avisActives).mockResolvedValue(false);
    vi.mocked(api.getAutomationRules).mockResolvedValue([avis()]);
    await rendre('en');
    const lien = Array.from(conteneur.querySelectorAll('tbody a')).find((a) => /Turn them on/.test(a.textContent || ''));
    expect(lien?.textContent).toBe('Turn them on in Settings › Customer reviews.');
    expect(lien?.getAttribute('href')).toBe('/settings/reviews');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('05-lignes:409 — le panneau « Stats » mène aux Journaux par un lien', () => {
  it('« Le détail est dans l’onglet « Journaux » de l’automatisation. » : « Journaux » est un lien vers ses journaux', async () => {
    const r = regle();
    vi.mocked(api.getAutomationRules).mockResolvedValue([r]);
    await rendre();
    await cliquer(bouton(new RegExp(`^Statistiques de ${r.name}$`)));
    const phrase = Array.from(conteneur.querySelectorAll('tbody p')).find((p) => /Le détail est dans/.test(p.textContent || ''));
    expect(phrase?.textContent).toBe('Le détail est dans l’onglet « Journaux » de l’automatisation.');
    const lien = phrase?.querySelector('a');
    expect(lien?.textContent).toBe('Journaux');
    expect(lien?.getAttribute('href')).toBe(`/automations/activite?regle=${r.id}&vue=journaux`);
    await cliquer(lien);
    expect(adresse).toBe(`/automations/activite?regle=${r.id}&vue=journaux`);
  });

  it('en anglais : « Logs »', async () => {
    await rendre('en');
    await cliquer(bouton(/^Stats for Relance 1$/));
    const phrase = Array.from(conteneur.querySelectorAll('tbody p')).find((p) => /The detail is in/.test(p.textContent || ''));
    expect(phrase?.textContent).toBe('The detail is in the “Logs” tab of the automation.');
    expect(phrase?.querySelector('a')?.textContent).toBe('Logs');
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
describe('11-clavier:50 — les onglets se parcourent aux flèches', () => {
  const onglets = () => Array.from(conteneur.querySelectorAll('[role="tab"]')) as HTMLElement[];
  const actif = () => (document.activeElement?.textContent || '').trim();

  it('un seul arrêt de tabulation : l’onglet ouvert', async () => {
    await rendre();
    expect(onglets().map((o) => o.tabIndex)).toEqual([0, -1, -1, -1]);
    await cliquer(onglet(/^Corbeille/));
    expect(onglets().map((o) => o.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it('flèche droite : l’onglet suivant prend le focus ET s’ouvre ; en boucle ; flèche gauche revient', async () => {
    await rendre();
    onglet(/^Toutes/)!.focus();
    expect(await touche(document.activeElement, 'ArrowRight')).toBe(true);
    expect(actif()).toBe('À vérifier (0)');
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
    expect(adresse).toBe('/automations?onglet=verifier');
    await touche(document.activeElement, 'ArrowLeft');
    expect(actif()).toBe('Toutes');
    await touche(document.activeElement, 'ArrowLeft');
    expect(actif()).toBe('Corbeille (0)');
    await touche(document.activeElement, 'ArrowRight');
    expect(actif()).toBe('Toutes');
  });

  it('Début et Fin vont au premier et au dernier onglet ; les autres touches ne sont pas retenues', async () => {
    await rendre();
    onglet(/^Toutes/)!.focus();
    await touche(document.activeElement, 'End');
    expect(actif()).toBe('Corbeille (0)');
    await touche(document.activeElement, 'Home');
    expect(actif()).toBe('Toutes');
    expect(await touche(document.activeElement, 'a')).toBe(false);
    expect(await touche(document.activeElement, 'Tab')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('11-clavier:113 — après la saisie d’un dossier, le focus revient sur « Nouveau dossier »', () => {
  const champ = () => conteneur.querySelector('#nouveau-dossier') as HTMLInputElement | null;
  const ouvrirSaisie = async () => {
    const b = bouton(/^Nouveau dossier$/) as HTMLButtonElement;
    b.focus();
    await cliquer(b);
    expect(champ()).not.toBeNull();
  };

  it('Échap : le champ disparaît et le focus est sur « Nouveau dossier », pas sur le corps de la page', async () => {
    await rendre();
    await ouvrirSaisie();
    await touche(champ(), 'Escape');
    expect(champ()).toBeNull();
    expect(document.activeElement).toBe(bouton(/^Nouveau dossier$/));
  });

  it('« Annuler » aussi', async () => {
    await rendre();
    await ouvrirSaisie();
    await cliquer(bouton(/^Annuler$/));
    expect(document.activeElement).toBe(bouton(/^Nouveau dossier$/));
  });

  it('le dossier créé (Entrée) : le focus revient aussi au bouton', async () => {
    vi.mocked(builder.creerDossier).mockResolvedValue({ id: 'd9', name: 'Factures', position: 0, created_at: '' } as never);
    await rendre();
    await ouvrirSaisie();
    await act(async () => {
      const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      poser.call(champ(), 'Factures');
      champ()!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await touche(champ(), 'Enter');
    await laisser();
    expect(builder.creerDossier).toHaveBeenCalledWith('Factures');
    expect(champ()).toBeNull();
    expect(document.activeElement).toBe(bouton(/^Nouveau dossier$/));
  });

  it('au premier affichage, le bouton ne vole pas le focus', async () => {
    await rendre();
    expect(document.activeElement).toBe(document.body);
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
