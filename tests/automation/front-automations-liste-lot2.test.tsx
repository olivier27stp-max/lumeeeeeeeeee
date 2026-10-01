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
import { MemoryRouter } from 'react-router-dom';

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

async function rendre(langue: 'fr' | 'en' = 'fr') {
  localStorage.setItem('lume-language', langue);
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(<MemoryRouter><LanguageProvider><Automations /></LanguageProvider></MemoryRouter>);
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
