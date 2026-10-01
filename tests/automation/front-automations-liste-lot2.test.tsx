// @vitest-environment jsdom
/**
 * Audit UI Automatisations du 2026-10-01, LOT 2 — la page liste, montée pour
 * de vrai (même banc que `front-automations-ecran.test.tsx`).
 *
 * Un `describe` par constat (`D:/lume-uiaudit/sorties/liste/constats.jsonl`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Mocks (hissés) ─────────────────────────────────────────────
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

vi.mock('../../src/hooks/usePermissions', () => ({
  usePermissions: () => ({
    permissions: null, role: 'owner', scope: 'company', userId: 'u-owner',
    teamId: null, departmentId: null, managerId: null, loading: false,
  }),
}));

vi.mock('../../src/lib/automationRulesApi', () => ({
  getAutomationRules: vi.fn(async () => []),
  getRecentAutomationFailures: vi.fn(async () => []),
  getFailureCountsByRule: vi.fn(async () => ({})),
  getAutomationLanguage: vi.fn(async () => 'fr'),
  setAutomationLanguage: vi.fn(async () => undefined),
  updateRuleMessage: vi.fn(async () => undefined),
  toggleAutomationRule: vi.fn(async () => undefined),
  getCompanyBranding: vi.fn(async () => ({ nom: 'A inc.', logo: null, couleur: null })),
  avisActives: vi.fn(async () => true),
}));

vi.mock('../../src/lib/automationBuilderApi', () => ({
  chargerStatistiques: vi.fn(async () => ({ par_regle: {}, par_etape: null, texto_configure: true })),
  changerPublication: vi.fn(async () => undefined),
  changerPublicationEnLot: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, ok: true }))),
  chargerDossiers: vi.fn(async () => []),
  creerDossier: vi.fn(),
  supprimerDossier: vi.fn(),
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

vi.mock('../../src/lib/automationWebhooksApi', () => ({
  lireEtatPause: vi.fn(async () => ({ paused: false })),
  basculerPause: vi.fn(async () => ({ paused: false })),
}));
vi.mock('../../src/lib/reservationApi', () => ({ apercuClientsInactifs: vi.fn(async () => 0) }));
vi.mock('../../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));
vi.mock('../../src/lib/appelServeur', () => ({ appelServeur: vi.fn() }));

vi.mock('../../src/lib/supabase', () => {
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

import * as api from '../../src/lib/automationRulesApi';
import * as builder from '../../src/lib/automationBuilderApi';
import { LanguageProvider } from '../../src/i18n';
import Automations from '../../src/pages/Automations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Fixtures ───────────────────────────────────────────────────
let compteurRegles = 0;
function regle(partiel: Partial<api.AutomationRule> = {}): api.AutomationRule {
  compteurRegles += 1;
  return {
    id: `regle-${compteurRegles}`, org_id: 'org-a', name: 'Appointment Confirmation', description: null,
    trigger_event: 'appointment.created', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }],
    steps: null, is_active: true, is_preset: false, preset_key: null,
    folder_id: null, modele_id: null, deleted_at: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...partiel,
  } as api.AutomationRule;
}

// ── Banc React ─────────────────────────────────────────────────
let conteneur: HTMLDivElement;
let racine: Root | null = null;
const laisser = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
/** Où le routeur se trouve — pour prouver qu'un lien mène bien quelque part. */
let chemin = '';
function Temoin() {
  chemin = useLocation().pathname;
  return null;
}

async function rendre(langue: 'fr' | 'en' = 'fr') {
  localStorage.setItem('lume-language', langue);
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(<MemoryRouter initialEntries={['/automations']}><Temoin /><LanguageProvider><Automations /></LanguageProvider></MemoryRouter>);
  });
  await laisser(); await laisser();
  return conteneur;
}
const texte = () => conteneur.textContent || '';
// Dans la page entière : le menu « ⋮ » d'une ligne est rendu dans document.body.
const boutons = () => Array.from(document.body.querySelectorAll('button'));
const bouton = (motif: RegExp) => boutons().find((b) => motif.test((b.textContent || '').trim()) || motif.test(b.getAttribute('aria-label') || ''));
async function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('élément introuvable');
  await act(async () => { (el as HTMLElement).click(); });
  await laisser();
}
/** Les noms des lignes du tableau, dans l'ordre affiché. */
const ordre = () => Array.from(conteneur.querySelectorAll('tbody tr td:nth-child(2) button span span:first-child'))
  .map((s) => (s.textContent || '').trim());

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  compteurRegles = 0;
  vi.mocked(api.getAutomationRules).mockResolvedValue([regle()]);
  vi.mocked(api.getRecentAutomationFailures).mockResolvedValue([]);
  vi.mocked(api.getAutomationLanguage).mockResolvedValue('fr');
  vi.mocked(builder.chargerStatistiques).mockResolvedValue({ par_regle: {}, par_etape: null, texto_configure: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
  vi.mocked(console.error).mockRestore?.();
});

// ═══════════════════════════════════════════════════════════════
describe('liste-13 — sans tri choisi, la liste suit l’ordre alphabétique des noms AFFICHÉS', () => {
  /** Tel que le serveur les rend : triés sur le nom STOCKÉ (anglais pour les préréglages). */
  const servies = () => [
    regle({ name: 'Appointment Confirmation' }),
    regle({ name: 'Client Anniversary' }),
    regle({ name: 'Contract Signed' }),
    regle({ name: 'Cross-Sell — 30 Days' }),
    regle({ name: 'Deposit Follow-Up — 2 Days' }),
    regle({ name: 'Quote Follow-Up — 14 Days' }),
    regle({ name: 'Quote Follow-Up — 3 Days' }),
    regle({ name: 'Élan printanier' }),
  ];

  it('en français : l’ordre est celui des noms traduits (accents rangés avec leur lettre, 3 jours avant 14 jours)', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue(servies());
    await rendre('fr');
    expect(ordre()).toEqual([
      'Anniversaire client',
      'Confirmation de rendez-vous',
      'Contrat signé',
      'Élan printanier',
      'Suivi de dépôt — 2 jours',
      'Suivi de devis — 3 jours',
      'Suivi de devis — 14 jours',
      'Vente croisée — 30 jours',
    ]);
  });

  it('en anglais : même règle, sur les noms anglais', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue(servies());
    await rendre('en');
    expect(ordre()).toEqual([
      'Appointment Confirmation',
      'Client Anniversary',
      'Contract Signed',
      'Cross-Sell — 30 Days',
      'Deposit Follow-Up — 2 Days',
      'Élan printanier',
      'Quote Follow-Up — 3 Days',
      'Quote Follow-Up — 14 Days',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('liste-10 — l’aperçu d’un parcours à étapes montre ce que le client lira', () => {
  const parcours = () => regle({
    name: 'Zoé',
    steps: [
      { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texto [client_first_name]' } }, suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'send_email', config: { subject: 'Merci [client_first_name]', body: '<p>Bonjour [client_name], facture [invoice_number]</p>' } }, suivant: null },
    ],
  } as Partial<api.AutomationRule>);

  it('texto : la variable est remplacée par un exemple, comme dans « Le client lira : … »', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([parcours()]);
    await rendre();
    await cliquer(bouton(/^Voir les messages de Zoé$/));
    expect(texte()).toContain('Texto Marie');
    expect(texte()).not.toContain('[client_first_name]');
  });

  it('courriel : objet et corps aussi', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([parcours()]);
    await rendre();
    await cliquer(bouton(/^Voir les messages de Zoé$/));
    expect(texte()).toContain('Merci Marie');
    expect(texte()).toContain('Bonjour Marie Tremblay, facture FAC-1042');
    expect(texte()).not.toMatch(/\[client_name\]|\[invoice_number\]/);
  });

  it('une variable inconnue reste visible telle quelle (elle partirait vide : on ne la maquille pas)', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({
      name: 'Zoé',
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [prenom]' } }, suivant: null }],
    } as Partial<api.AutomationRule>)]);
    await rendre();
    await cliquer(bouton(/^Voir les messages de Zoé$/));
    expect(texte()).toContain('Bonjour [prenom]');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('liste-07 — un seul menu ouvert à la fois (« Créer » et « ⋮ »)', () => {
  const menus = () => Array.from(document.body.querySelectorAll('[role="menu"]'));
  const items = () => Array.from(document.body.querySelectorAll('[role="menuitem"]')).map((b) => (b.textContent || '').trim());

  it('menu « ⋮ » ouvert, clic sur « Créer » : le menu de la ligne se referme, seul « Créer » reste', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Alpha' })]);
    await rendre();
    await cliquer(bouton(/^Actions pour Alpha$/));
    expect(menus()).toHaveLength(1);
    await cliquer(bouton(/^Créer$/));
    expect(menus(), 'deux menus ouverts en même temps').toHaveLength(1);
    expect(items().some((t) => t.startsWith('Partir de zéro'))).toBe(true);
    expect(items()).not.toContain('Dupliquer');
    expect(bouton(/^Actions pour Alpha$/)!.getAttribute('aria-expanded')).toBe('false');
  });

  it('menu « Créer » ouvert, clic sur « ⋮ » : « Créer » se referme, seul le menu de la ligne reste', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Alpha' })]);
    await rendre();
    await cliquer(bouton(/^Créer$/));
    expect(menus()).toHaveLength(1);
    await cliquer(bouton(/^Actions pour Alpha$/));
    expect(menus(), 'deux menus ouverts en même temps').toHaveLength(1);
    expect(items()).toContain('Dupliquer');
    expect(items().some((t) => t.startsWith('Partir de zéro'))).toBe(false);
    expect(bouton(/^Créer$/)!.getAttribute('aria-expanded')).toBe('false');
  });

  it('Échap ferme encore celui qui est ouvert, et rend le focus à son bouton (liste-06, déjà couvert au lot 1)', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Alpha' })]);
    await rendre();
    await cliquer(bouton(/^Actions pour Alpha$/));
    await cliquer(bouton(/^Créer$/));
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await laisser();
    expect(menus()).toHaveLength(0);
    expect(document.activeElement).toBe(bouton(/^Créer$/));
  });
});

// ═══════════════════════════════════════════════════════════════
describe('liste-03 — la sous-navigation est faite de liens, et annonce la section courante', () => {
  const nav = () => conteneur.querySelector('nav[aria-label="Sections"]') as HTMLElement;
  const lien = (motif: RegExp) => Array.from(nav().querySelectorAll('a')).find((a) => motif.test((a.textContent || '').trim()));

  it('« Vue d’ensemble » et « Réglages globaux » sont des liens (nouvel onglet, Ctrl+clic, clic milieu)', async () => {
    await rendre();
    expect(lien(/^Vue d’ensemble/)?.getAttribute('href')).toBe('/automations/apercu');
    expect(lien(/^Réglages globaux$/)?.getAttribute('href')).toBe('/automations/reglages');
    expect(nav().querySelectorAll('button'), 'plus aucun bouton dans la sous-navigation').toHaveLength(0);
  });

  it('la section courante est annoncée : aria-current="page" sur « Automatisations », et sur elle seule', async () => {
    await rendre();
    const courants = Array.from(nav().querySelectorAll('[aria-current="page"]'));
    expect(courants).toHaveLength(1);
    expect((courants[0].textContent || '').trim()).toBe('Automatisations');
    expect(courants[0].getAttribute('href')).toBe('/automations');
  });

  it('un clic simple navigue toujours dans l’application', async () => {
    await rendre();
    expect(chemin).toBe('/automations');
    await cliquer(lien(/^Réglages globaux$/));
    expect(chemin).toBe('/automations/reglages');
  });

  it('« Vue d’ensemble » mène à l’aperçu', async () => {
    await rendre();
    await cliquer(lien(/^Vue d’ensemble/));
    expect(chemin).toBe('/automations/apercu');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('liste-04 — ce que la couleur disait seule est exposé aux lecteurs d’écran', () => {
  const groupeLangue = () => conteneur.querySelector('[role="group"][aria-label="Langue des messages"]') as HTMLElement | null;
  const presse = (motif: RegExp) => bouton(motif)?.getAttribute('aria-pressed');

  it('« FR » et « EN » sont regroupés sous « Langue des messages », la langue active est `aria-pressed`', async () => {
    await rendre();
    expect(groupeLangue(), 'un groupe nommé').not.toBeNull();
    expect(Array.from(groupeLangue()!.querySelectorAll('button')).map((b) => (b.textContent || '').trim())).toEqual(['FR', 'EN']);
    expect(presse(/^FR$/)).toBe('true');
    expect(presse(/^EN$/)).toBe('false');
    await cliquer(bouton(/^EN$/));
    expect(presse(/^FR$/)).toBe('false');
    expect(presse(/^EN$/)).toBe('true');
  });

  it('langue inconnue : aucune des deux n’est annoncée comme active', async () => {
    vi.mocked(api.getAutomationLanguage).mockRejectedValue(new Error('500'));
    await rendre();
    expect(presse(/^FR$/)).toBe('false');
    expect(presse(/^EN$/)).toBe('false');
  });

  it('en anglais, le groupe s’appelle « Message language »', async () => {
    await rendre('en');
    expect(conteneur.querySelector('[role="group"][aria-label="Message language"]')).not.toBeNull();
  });

  it('chaque en-tête de colonne a un nom — le dernier (actions) aussi, caché à l’œil', async () => {
    await rendre();
    const entetes = Array.from(conteneur.querySelectorAll('thead th'));
    const noms = entetes.map((th) => (th.textContent || '').trim() || th.querySelector('input')?.getAttribute('aria-label') || '');
    expect(noms.filter((n) => !n), `en-têtes sans nom : ${JSON.stringify(noms)}`).toHaveLength(0);
    const dernier = entetes[entetes.length - 1];
    expect((dernier.textContent || '').trim()).toBe('Actions');
    expect(dernier.querySelector('.sr-only'), 'visuellement caché : la colonne reste sans titre à l’écran').not.toBeNull();
  });

  it('les onglets sont reliés à leur panneau, qui porte le nom de l’onglet actif', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Alpha' })]);
    await rendre();
    const actif = () => conteneur.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement;
    const panneau = () => conteneur.querySelector('[role="tabpanel"]') as HTMLElement | null;
    expect(panneau(), 'aucun panneau d’onglet').not.toBeNull();
    expect(panneau()!.querySelector('table'), 'le tableau est DANS le panneau').not.toBeNull();
    for (const onglet of Array.from(conteneur.querySelectorAll('[role="tab"]'))) {
      expect(onglet.id, 'chaque onglet a un id').toBeTruthy();
      expect(onglet.getAttribute('aria-controls')).toBe(panneau()!.id);
    }
    // Un id de `useId()` contient « : » : getElementById, pas un sélecteur CSS.
    expect(document.getElementById(panneau()!.getAttribute('aria-labelledby') || '')).toBe(actif());
    expect((actif().textContent || '').trim()).toBe('Toutes');

    await cliquer(bouton(/^Corbeille \(0\)$/));
    expect((actif().textContent || '').trim()).toBe('Corbeille (0)');
    expect(document.getElementById(panneau()!.getAttribute('aria-labelledby') || '')).toBe(actif());
  });
});

// ═══════════════════════════════════════════════════════════════
describe('liste-09 — le même départ porte le même nom dans l’en-tête et dans le menu', () => {
  const nomsDuDepartLumi = async (ouvrirMenu: RegExp) => {
    const enTete = boutons().find((b) => !b.closest('[role="menu"]') && /Lumi|AI/.test(b.textContent || ''));
    await cliquer(bouton(ouvrirMenu));
    const item = Array.from(document.body.querySelectorAll('[role="menuitem"] span span:first-child'))
      .map((s) => (s.textContent || '').trim()).find((t) => /Lumi|AI/.test(t));
    return { enTete: (enTete?.textContent || '').trim(), item };
  };

  it('en anglais : « Build with Lumi » aux deux endroits (plus de « Build using AI »)', async () => {
    await rendre('en');
    const noms = await nomsDuDepartLumi(/^Create workflow$/);
    expect(noms.item).toBe('Build with Lumi');
    expect(noms.enTete).toBe('Build with Lumi');
    expect(texte()).not.toContain('Build using AI');
  });

  it('en français : « Construire avec Lumi » aux deux endroits', async () => {
    await rendre('fr');
    const noms = await nomsDuDepartLumi(/^Créer$/);
    expect(noms).toEqual({ enTete: 'Construire avec Lumi', item: 'Construire avec Lumi' });
  });
});

// ═══════════════════════════════════════════════════════════════
describe('liste-11 / modeles-09 — un seul mot pour le même envoi : « Texto »', () => {
  /** Sur le même écran : une règle à l'ancien format, et un parcours à étapes. */
  const deuxFormats = () => [
    regle({ name: 'Ancien format', actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }] }),
    regle({
      name: 'Parcours',
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour' } }, suivant: null }],
    } as Partial<api.AutomationRule>),
  ];
  const intitules = () => Array.from(conteneur.querySelectorAll('p.uppercase')).map((p) => (p.textContent || '').trim());

  it('en français : l’éditeur de l’ancien format dit « Texto envoyé au client », comme l’aperçu d’un parcours et le bandeau', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue(deuxFormats());
    vi.mocked(builder.chargerStatistiques).mockResolvedValue({ par_regle: {}, par_etape: null, texto_configure: false });
    await rendre('fr');
    expect(texte()).toContain('Les étapes texto sont sautées');

    await cliquer(bouton(/^Voir les messages de Ancien format$/));
    expect(intitules()).toEqual(['Texto envoyé au client']);
    expect(conteneur.querySelector('textarea')?.getAttribute('aria-label')).toBe('Texto envoyé au client');

    await cliquer(bouton(/^Voir les messages de Parcours$/));
    expect(intitules()).toEqual(['Texto envoyé au client']);
    expect(texte()).not.toContain('SMS envoyé au client');
  });

  it('en anglais : « Text sent to client » dans les deux formats', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue(deuxFormats());
    await rendre('en');
    await cliquer(bouton(/^View messages of Ancien format$/));
    expect(intitules()).toEqual(['Text sent to client']);
    expect(conteneur.querySelector('textarea')?.getAttribute('aria-label')).toBe('Text sent to client');
    await cliquer(bouton(/^View messages of Parcours$/));
    expect(intitules()).toEqual(['Text sent to client']);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('liste-14 — la bulle « Aide et support » ne recouvre plus « 10 / page »', () => {
  it('la pagination réserve à sa droite la place de la bulle flottante (décalage + largeur)', async () => {
    // jsdom ne met rien en page : on compare les réserves DÉCLARÉES. La bulle
    // est `fixed right-N w-M` (unités Tailwind de 4 px) ; quelle que soit la
    // marge de la page, un retrait droit ≥ N + M garde le sélecteur hors d'elle.
    const bulle = readFileSync(resolve(process.cwd(), 'src/components/SupportFAB.tsx'), 'utf8')
      .match(/'fixed right-(\d+) z-50 w-(\d+) /);
    expect(bulle, 'les classes de position de la bulle ont changé : revoir ce test').not.toBeNull();
    const empreinte = (Number(bulle![1]) + Number(bulle![2])) * 4;
    expect(empreinte).toBe(68);

    await rendre();
    const barre = document.getElementById('par-page')!.parentElement as HTMLElement;
    const retrait = barre.className.match(/(?:^|\s)pr-(\d+)(?:\s|$)/);
    expect(retrait, `aucun retrait droit propre à la pagination : « ${barre.className} »`).not.toBeNull();
    expect(Number(retrait![1]) * 4).toBeGreaterThanOrEqual(empreinte);
    // Le sélecteur reste le dernier élément de la barre, aligné à droite.
    expect(barre.lastElementChild?.id).toBe('par-page');
    expect(barre.className).toContain('justify-end');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('liste-05 — langue du bureau illisible : l’écran ne prétend pas la connaître', () => {
  const surligne = (b: HTMLElement | undefined) => /\bbg-text-primary\b/.test(b?.className ?? '');
  const AVEU = 'Langue actuelle inconnue';

  it('lecture en échec : ni « FR » ni « EN » n’est surligné, et l’écran le dit', async () => {
    vi.mocked(api.getAutomationLanguage).mockRejectedValue(new Error('500'));
    await rendre();
    expect(surligne(bouton(/^FR$/)), '« FR » est affirmé alors qu’on ne sait pas').toBe(false);
    expect(surligne(bouton(/^EN$/))).toBe(false);
    expect(texte()).toContain(AVEU);
  });

  it('pendant la lecture : rien n’est surligné, et rien n’est encore dit', async () => {
    let livrer!: (l: 'fr' | 'en') => void;
    vi.mocked(api.getAutomationLanguage).mockReturnValue(new Promise((r) => { livrer = r; }));
    await rendre();
    expect(surligne(bouton(/^FR$/))).toBe(false);
    expect(surligne(bouton(/^EN$/))).toBe(false);
    expect(texte()).not.toContain(AVEU);
    await act(async () => { livrer('en'); });
    await laisser();
    expect(surligne(bouton(/^EN$/)), 'la langue lue est surlignée').toBe(true);
    expect(surligne(bouton(/^FR$/))).toBe(false);
    expect(texte()).not.toContain(AVEU);
  });

  it('après un échec, choisir une langue l’enregistre : elle est alors connue, l’aveu disparaît', async () => {
    vi.mocked(api.getAutomationLanguage).mockRejectedValue(new Error('500'));
    await rendre();
    await cliquer(bouton(/^FR$/));
    expect(api.setAutomationLanguage).toHaveBeenCalledWith('fr');
    expect(surligne(bouton(/^FR$/))).toBe(true);
    expect(texte()).not.toContain(AVEU);
  });

  it('après un échec, un enregistrement refusé ramène à « inconnue », pas à « FR »', async () => {
    vi.mocked(api.getAutomationLanguage).mockRejectedValue(new Error('500'));
    vi.mocked(api.setAutomationLanguage).mockRejectedValue(new Error('Seul un administrateur peut changer la langue des messages.'));
    await rendre();
    await cliquer(bouton(/^EN$/));
    expect(surligne(bouton(/^FR$/))).toBe(false);
    expect(surligne(bouton(/^EN$/))).toBe(false);
    expect(texte()).toContain(AVEU);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('tablette — l’interrupteur et le menu « ⋮ » restent à l’écran', () => {
  /*
   * Mesuré sur lumecrm.net le 2026-10-01 (WebKit, iPad) : en paysage (1024 px)
   * comme en portrait (768 px), le tableau gardait une largeur minimale de
   * 980 px dans une zone de 706 px, puis 482 px. L'interrupteur publier /
   * brouillon, la flèche des messages et le menu « ⋮ » étaient HORS ÉCRAN ; en
   * portrait on ne voyait plus que la colonne « Nom ».
   *
   * jsdom ne met rien en page : on vérifie ce qui décide de la mise en page —
   * plus de largeur minimale de bureau, et des colonnes secondaires qui se
   * replient par palier, en-tête et cellules ENSEMBLE (une cellule de trop
   * décalerait toute la ligne).
   */
  const colonnes = () => {
    const enTetes = Array.from(conteneur.querySelectorAll('thead th')) as HTMLElement[];
    const cellules = Array.from(conteneur.querySelectorAll('tbody tr')[0].querySelectorAll('td')) as HTMLElement[];
    return { enTetes, cellules };
  };
  /** Le palier à partir duquel une colonne s'affiche : '' = toujours. */
  const palier = (el: HTMLElement) => {
    const c = el.className;
    if (!/\bhidden\b/.test(c)) return '';
    return /\b(sm|md|lg|xl|2xl):table-cell\b/.exec(c)?.[1] ?? 'jamais';
  };

  it('le tableau n’impose plus une largeur de bureau', async () => {
    await rendre();
    const table = conteneur.querySelector('table') as HTMLElement;
    expect(table.className).not.toContain('min-w-[980px]');
    // Sous 768 px l'app n'est pas offerte (porte mobile) : 440 px tiennent dans la zone d'un iPad en portrait (482 px).
    const mini = Number(/min-w-\[(\d+)px\]/.exec(table.className)?.[1] ?? 0);
    expect(mini).toBeLessThanOrEqual(480);
  });

  it('toujours visibles : case, nom, statut, statistiques, actions', async () => {
    await rendre();
    const { enTetes } = colonnes();
    const toujours = enTetes.filter((th) => palier(th) === '').map((th) => (th.textContent || '').trim() || (th.querySelector('input') ? 'case' : ''));
    expect(toujours).toEqual(['case', 'Nom', 'Statut', 'Stats', 'Actions']);
  });

  it('les compteurs apparaissent à partir de 1024 px, les dates à partir de 1280 px', async () => {
    await rendre();
    const { enTetes } = colonnes();
    const parNom = Object.fromEntries(enTetes.map((th) => [(th.textContent || '').trim(), palier(th)]));
    expect(parNom['Total déclenché']).toBe('lg');
    expect(parNom['En cours']).toBe('lg');
    expect(parNom['Modifiée le']).toBe('xl');
    expect(parNom['Créée le']).toBe('xl');
  });

  it('chaque cellule suit le palier de son en-tête : aucune ligne décalée', async () => {
    await rendre();
    const { enTetes, cellules } = colonnes();
    expect(cellules.length).toBe(enTetes.length);
    expect(cellules.map(palier)).toEqual(enTetes.map(palier));
  });

  it('la cellule des actions porte l’interrupteur, les messages et le menu, et ne se replie jamais', async () => {
    await rendre();
    const { cellules } = colonnes();
    const actions = cellules[cellules.length - 1];
    expect(palier(actions)).toBe('');
    const noms = Array.from(actions.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') || '');
    expect(noms.some((n) => /^(Publier|Repasser) /.test(n))).toBe(true);
    expect(noms.some((n) => /^Voir les messages de /.test(n))).toBe(true);
    expect(noms.some((n) => /^Actions pour /.test(n))).toBe(true);
  });
});
