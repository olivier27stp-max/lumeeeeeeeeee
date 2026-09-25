// @vitest-environment jsdom
/**
 * T13 (unitaire, jsdom) — FRONT : la page Automatisations et l'éditeur de
 * message, rendus avec React, l'API `automationRulesApi` mockée.
 *
 *   T13.1  chargement : roue, puis liste                                   vert
 *   T13.2  états vides : « Aucune automatisation » / « Aucun résultat »    vert
 *   T13.3  erreur de chargement : toast, page utilisable                   vert
 *   T13.4  toggle optimiste, rollback + toast si l'API rejette ; l'API
 *          réelle refuse un faux succès (0 ligne renvoyée par la RLS)       vert
 *   T13.5  (intégration) toggle réellement appliqué → couvert par T9.8, ROUGE F16
 *   T13.6  badge « 3 échec » avec title lisible                            vert
 *   T13.7  déclencheur et nom lisibles en français : `agreement.signed`
 *          et « Contract Signed » ne doivent pas s'afficher bruts       ROUGE (F22)
 *   T13.8  éditeur SMS : variable insérée, aperçu remplacé, enregistrement
 *          appelle updateRuleMessage(id, 'send_sms', texte) ; annuler      vert
 *          — et une variable inconnue doit être SIGNALÉE (le serveur la
 *          remplace par du vide, l'aperçu la montre telle quelle)      ROUGE (F22)
 *   T13.9  accessibilité : cliquet à 0 sur la page et les deux éditeurs    vert
 *   T13.10 pourquoi ça n'a pas marché : la raison d'un échec, en français,
 *          n'est affichée nulle part                                   ROUGE (F22)
 *   T13.11 langue des messages : bascule FR→EN appelle setAutomationLanguage vert
 *
 * Voir AUTOMATIONS_TEST_PLAN.md, T13, et AUTOMATIONS_AUDIT.md, A7.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Mocks (hissés) ─────────────────────────────────────────────
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock('../../../src/hooks/usePermissions', () => ({
  usePermissions: () => ({ permissions: null, role: 'owner', scope: 'company', userId: 'u-owner', teamId: null, departmentId: null, loading: false }),
}));
vi.mock('../../../src/lib/automationRulesApi', () => ({
  getAutomationRules: vi.fn(async () => []),
  toggleAutomationRule: vi.fn(async () => {}),
  getFailureCountsByRule: vi.fn(async () => ({})),
  getAutomationLanguage: vi.fn(async () => 'fr'),
  setAutomationLanguage: vi.fn(async () => {}),
  updateRuleMessage: vi.fn(async () => {}),
  getCompanyBranding: vi.fn(async () => ({ nom: 'A inc.', logo: null, couleur: null })),
  getRecentAutomationFailures: vi.fn(async () => []),
}));
// Réponse PostgREST configurable, pour éprouver l'API RÉELLE (T13.4).
const etatSupabase: { reponse: { data: unknown; error: unknown } } = { reponse: { data: [], error: null } };
vi.mock('../../../src/lib/supabase', () => {
  const chaine: any = new Proxy(function () {}, {
    get: (_t, prop) => {
      if (prop === 'then') return (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(etatSupabase.reponse).then(res, rej);
      return () => chaine;
    },
    apply: () => chaine,
  });
  return {
    supabase: {
      from: () => chaine,
      auth: {
        getUser: async () => ({ data: { user: null } }),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

import { toast } from 'sonner';
import * as api from '../../../src/lib/automationRulesApi';
import { LanguageProvider } from '../../../src/i18n';
import Automations from '../../../src/pages/Automations';
import { mesurerSource } from '../../../scripts/accessibilite-mesure.mjs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── Fixtures ───────────────────────────────────────────────────
const RULE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SMS_INITIAL = 'Bonjour [client_first_name], votre rendez-vous est confirmé.';

function regle(partiel: Partial<api.AutomationRule> = {}): api.AutomationRule {
  return {
    id: RULE_ID, org_id: 'org-a', name: 'Appointment Confirmation', description: 'Confirme la visite au client',
    trigger_event: 'appointment.created', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'send_sms', config: { body: SMS_INITIAL } }, { type: 'send_email', config: { subject: 'Confirmation', body: '<p>Bonjour [client_first_name]</p>' } }],
    is_active: true, is_preset: true, preset_key: 'appointment_confirmation', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...partiel,
  };
}

// ── Banc React ─────────────────────────────────────────────────
let conteneur: HTMLDivElement; let racine: Root | null = null;
const laisser = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function rendre() {
  conteneur = document.createElement('div'); document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => { racine!.render(<MemoryRouter><LanguageProvider><Automations /></LanguageProvider></MemoryRouter>); });
  await laisser(); await laisser();
  return conteneur;
}
const texteDe = (el: Element = conteneur) => el.textContent || '';
const bouton = (label: RegExp, el: ParentNode = conteneur) => Array.from(el.querySelectorAll('button')).find((b) => label.test(b.textContent || '') || label.test(b.getAttribute('aria-label') || ''));
async function cliquer(el: Element | undefined) { if (!el) throw new Error('élément introuvable'); await act(async () => { (el as HTMLElement).click(); }); await laisser(); }
async function saisir(el: HTMLTextAreaElement | HTMLInputElement, valeur: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => { setter.call(el, valeur); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
/** Déplie la ligne d'une règle (la ligne est un `tr role="button"`). */
async function deplier(id = RULE_ID) {
  const ligne = Array.from(conteneur.querySelectorAll('tr[role="button"]')).find((tr) => tr.querySelector('button[aria-pressed]'));
  await cliquer(ligne);
  expect(conteneur.querySelector('code')?.textContent).toBeTruthy();
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('lume-language', 'fr');
  vi.mocked(api.getAutomationRules).mockResolvedValue([regle()]);
  vi.mocked(api.getFailureCountsByRule).mockResolvedValue({});
  vi.mocked(api.getAutomationLanguage).mockResolvedValue('fr');
  etatSupabase.reponse = { data: [], error: null };
});
afterEach(async () => { if (racine) { await act(async () => racine!.unmount()); racine = null; } conteneur?.remove(); });

// ═══════════════════════════════════════════════════════════════
describe('T13.1 — chargement', () => {
  it('affiche la roue tant que les règles ne sont pas arrivées, puis la liste', async () => {
    let livrer!: (r: api.AutomationRule[]) => void;
    vi.mocked(api.getAutomationRules).mockReturnValue(new Promise((r) => { livrer = r; }));
    await rendre();
    expect(conteneur.querySelector('.animate-spin')).not.toBeNull();
    expect(conteneur.querySelector('table')).toBeNull();
    await act(async () => { livrer([regle()]); }); await laisser();
    expect(conteneur.querySelector('.animate-spin')).toBeNull();
    expect(conteneur.querySelector('table')).not.toBeNull();
    expect(texteDe()).toContain('Confirmation de rendez-vous');
  });
});

describe('T13.2 — états vides', () => {
  it('sans règle : « Aucune automatisation pour le moment »', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([]);
    await rendre();
    expect(texteDe()).toContain('Aucune automatisation pour le moment');
    expect(conteneur.querySelector('table')).toBeNull();
  });
  it('recherche sans résultat : « Aucun résultat », et le compteur passe à 0', async () => {
    await rendre();
    await saisir(conteneur.querySelector('input[type="text"]') as HTMLInputElement, 'zzz-introuvable');
    await laisser();
    expect(texteDe()).toContain('Aucun résultat');
    expect(texteDe()).toMatch(/0 résultat/);
  });
});

describe('T13.3 — erreur de chargement', () => {
  it('toast d’erreur en français, roue retirée, page utilisable (filtres présents)', async () => {
    vi.mocked(api.getAutomationRules).mockRejectedValue(new Error('boom'));
    await rendre();
    expect(toast.error).toHaveBeenCalledWith('Impossible de charger les automatisations');
    expect(conteneur.querySelector('.animate-spin')).toBeNull();
    expect(conteneur.querySelector('select')).not.toBeNull();
  });
  it('les échecs qui ne se chargent pas n’empêchent pas la liste', async () => {
    vi.mocked(api.getFailureCountsByRule).mockRejectedValue(new Error('rls'));
    await rendre();
    expect(conteneur.querySelector('table')).not.toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('T13.4 — toggle', () => {
  it('optimiste puis confirmé : l’interrupteur passe inactif, toast succès, API appelée avec (id, false)', async () => {
    await rendre();
    const interrupteur = conteneur.querySelector('button[aria-pressed]') as HTMLButtonElement;
    expect(interrupteur.getAttribute('aria-pressed')).toBe('true');
    await cliquer(interrupteur);
    expect(api.toggleAutomationRule).toHaveBeenCalledWith(RULE_ID, false);
    expect((conteneur.querySelector('button[aria-pressed]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false');
    expect(toast.success).toHaveBeenCalledWith('Automatisation désactivée');
    expect(texteDe()).toMatch(/Inactives\s*1/);
  });
  it('rejeté par l’API : rollback à l’état initial + toast d’erreur', async () => {
    vi.mocked(api.toggleAutomationRule).mockRejectedValue(new Error('refusé'));
    await rendre();
    await cliquer(conteneur.querySelector('button[aria-pressed]') as HTMLButtonElement);
    expect((conteneur.querySelector('button[aria-pressed]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    expect(toast.error).toHaveBeenCalledWith('Erreur de mise à jour');
    expect(texteDe()).toMatch(/Actives\s*1/);
  });
  it('l’API réelle refuse un faux succès : 0 ligne renvoyée (RLS) ⇒ exception, pas de toast vert', async () => {
    // Chemin corrigé le 2026-09-23 : il manquait un niveau (../../ au lieu de
    // ../../../), tous les autres imports du fichier utilisant bien trois. Le
    // test échouait sur le chargement du module, pas sur ce qu'il vérifie.
    const reel = await vi.importActual<typeof api>('../../../src/lib/automationRulesApi');
    etatSupabase.reponse = { data: [], error: null };
    await expect(reel.toggleAutomationRule(RULE_ID, false)).rejects.toThrow(/not applied/);
    etatSupabase.reponse = { data: [{ is_active: true }], error: null }; // la ligne renvoyée ne porte pas la valeur demandée
    await expect(reel.toggleAutomationRule(RULE_ID, false)).rejects.toThrow(/not applied/);
    etatSupabase.reponse = { data: [{ is_active: false }], error: null };
    await expect(reel.toggleAutomationRule(RULE_ID, false)).resolves.toBeUndefined();
  });
});

describe('T13.6 — badge d’échec', () => {
  it('3 échecs sur 7 jours ⇒ badge « 3 échec » avec un title lisible', async () => {
    vi.mocked(api.getFailureCountsByRule).mockResolvedValue({ [RULE_ID]: 3 });
    await rendre();
    const badge = Array.from(conteneur.querySelectorAll('span')).find((s) => /^3 échec$/.test(s.textContent || ''));
    expect(badge).toBeDefined();
    expect(badge!.getAttribute('title')).toBe('3 échec(s) dans les 7 derniers jours');
  });
  it('0 échec ⇒ pas de badge', async () => {
    await rendre();
    expect(texteDe()).not.toMatch(/échec/);
  });
});

describe('T13.7 — déclencheur et nom lisibles', () => {
  it('ROUGE ATTENDU (F22) : `agreement.signed` s’affiche brut au lieu de « Contrat signé »', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Contract Signed', preset_key: 'agreement_signed', trigger_event: 'agreement.signed' })]);
    await rendre();
    const cellules = Array.from(conteneur.querySelectorAll('td')).map((td) => td.textContent?.trim());
    expect(cellules, 'la colonne Déclencheur montre la clé technique').not.toContain('agreement.signed');
    expect(texteDe()).toMatch(/Contrat signé/);
  });
  it('ROUGE ATTENDU (F22) : le nom semé en anglais « Contract Signed » n’est pas traduit dans l’interface française', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Contract Signed', preset_key: 'agreement_signed', trigger_event: 'agreement.signed' })]);
    await rendre();
    expect(texteDe()).not.toContain('Contract Signed');
  });
  it('témoin vert : « Appointment Confirmation » / `appointment.created` sont traduits', async () => {
    await rendre();
    expect(texteDe()).toContain('Confirmation de rendez-vous');
    expect(texteDe()).toContain('Rendez-vous créé');
    expect(texteDe()).not.toContain('appointment.created');
  });
});

describe('T13.8 — éditeur de message (SMS)', () => {
  it('insère une variable, montre l’aperçu remplacé, enregistre via updateRuleMessage(id, "send_sms", texte) et recharge', async () => {
    await rendre();
    await deplier();
    const zone = conteneur.querySelector('textarea[aria-label="SMS envoyé au client"]') as HTMLTextAreaElement;
    expect(zone.value).toBe(SMS_INITIAL);
    expect(texteDe()).toMatch(/Le client lira :/);
    const apercu = () => (conteneur.querySelector('span.italic') as HTMLElement).textContent || '';
    expect(apercu(), 'l’aperçu remplace la variable par un exemple').toBe('Bonjour Marie, votre rendez-vous est confirmé.');

    const enregistrer = bouton(/^Enregistrer$/)!;
    expect(enregistrer.disabled, 'rien à enregistrer tant que le texte est inchangé').toBe(true);

    await cliquer(bouton(/Votre entreprise/));
    expect(zone.value).toBe(`${SMS_INITIAL}[company_name]`);
    expect(enregistrer.disabled).toBe(false);
    expect(texteDe()).toMatch(/caractères/);

    const appelsAvant = vi.mocked(api.getAutomationRules).mock.calls.length;
    await cliquer(enregistrer);
    expect(api.updateRuleMessage).toHaveBeenCalledWith(RULE_ID, 'send_sms', `${SMS_INITIAL}[company_name]`);
    expect(toast.success).toHaveBeenCalledWith('Message enregistré');
    expect(vi.mocked(api.getAutomationRules).mock.calls.length, 'la liste est rechargée après enregistrement').toBeGreaterThan(appelsAvant);
  });

  it('annuler ramène le texte initial sans appel API', async () => {
    await rendre(); await deplier();
    const zone = conteneur.querySelector('textarea[aria-label="SMS envoyé au client"]') as HTMLTextAreaElement;
    await saisir(zone, 'autre chose'); await laisser();
    await cliquer(bouton(/^Annuler$/));
    expect((conteneur.querySelector('textarea[aria-label="SMS envoyé au client"]') as HTMLTextAreaElement).value).toBe(SMS_INITIAL);
    expect(api.updateRuleMessage).not.toHaveBeenCalled();
  });

  it('l’enregistrement rejeté affiche le message d’erreur, texte conservé', async () => {
    vi.mocked(api.updateRuleMessage).mockRejectedValue(new Error('Permission refusée'));
    await rendre(); await deplier();
    await cliquer(bouton(/Prénom du client/));
    await cliquer(bouton(/^Enregistrer$/));
    expect(toast.error).toHaveBeenCalledWith('Permission refusée');
    expect((conteneur.querySelector('textarea') as HTMLTextAreaElement).value).toBe(`${SMS_INITIAL}[client_first_name]`);
  });

  it('plus de 160 caractères : le nombre de SMS facturés est affiché', async () => {
    await rendre(); await deplier();
    await saisir(conteneur.querySelector('textarea') as HTMLTextAreaElement, 'x'.repeat(200)); await laisser();
    expect(texteDe()).toMatch(/200 caractères\s*· 2 SMS/);
  });

  it('ROUGE ATTENDU (F22) : une variable inconnue « [prenom] » n’est pas signalée — le serveur l’enverra vide, l’aperçu la montre telle quelle', async () => {
    await rendre(); await deplier();
    await saisir(conteneur.querySelector('textarea') as HTMLTextAreaElement, 'Bonjour [prenom], à demain.'); await laisser();
    // Aperçu : le serveur (resolveTemplate, server/lib/actions/index.ts:124) remplace toute
    // variable inconnue par '' — le client lira « Bonjour , à demain. ». L'éditeur doit le dire.
    expect(texteDe(), 'aucun avertissement « variable inconnue »').toMatch(/inconnue|n’existe pas|n'existe pas|sera vide/i);
  });

  it('courriel : aperçu compact avec objet et corps texte, bouton Modifier présent', async () => {
    await rendre(); await deplier();
    expect(texteDe()).toContain('Courriel envoyé au client');
    expect(texteDe()).toContain('Confirmation');
    expect(bouton(/^\s*Modifier\s*$/)).toBeDefined();
  });
});

describe('T13.9 — accessibilité (cliquet à 0 sur les composants de la page)', () => {
  it.each([
    'src/pages/Automations.tsx',
    'src/components/automations/MessageEditor.tsx',
    'src/components/automations/EmailPreviewEditor.tsx',
  ])('%s', (fichier) => {
    const m = mesurerSource(readFileSync(resolve(process.cwd(), fichier), 'utf8')) as Record<string, number>;
    const fautes = Object.entries(m).filter(([, v]) => v > 0);
    expect(fautes, JSON.stringify(m)).toHaveLength(0);
  });
});

describe('T13.10 — pourquoi ça n’a pas marché', () => {
  it('ROUGE ATTENDU (F22) : avec 2 échecs, aucune raison lisible n’est affichée nulle part (ni dans la ligne, ni dépliée)', async () => {
    vi.mocked(api.getFailureCountsByRule).mockResolvedValue({ [RULE_ID]: 2 });
    vi.mocked(api.getRecentAutomationFailures).mockResolvedValue([
      { id: 'l1', automation_rule_id: RULE_ID, action_type: 'send_sms', result_error: 'Frequency cap reached for +15145550101', created_at: '2026-09-13T15:00:00Z' } as any,
      { id: 'l2', automation_rule_id: RULE_ID, action_type: 'send_email', result_error: 'SMTP not configured', created_at: '2026-09-13T15:00:00Z' } as any,
    ]);
    await rendre(); await deplier();
    const texte = texteDe();
    expect(texte, 'le texte technique anglais ne doit jamais sortir tel quel').not.toMatch(/SMTP not configured|Frequency cap/);
    expect(texte, 'aucune explication en français de l’échec (la page ne lit que le compteur)').toMatch(/impossible d’envoyer|impossible d'envoyer|plafond|pas de numéro|courriel non configuré/i);
  });
});

describe('T13.11 — langue des messages envoyés', () => {
  it('bascule FR → EN : setAutomationLanguage("en") + toast ; rollback si l’API rejette', async () => {
    await rendre();
    await cliquer(bouton(/^EN$/));
    expect(api.setAutomationLanguage).toHaveBeenCalledWith('en');
    expect(toast.success).toHaveBeenCalledWith('Messages en anglais');
    vi.mocked(api.setAutomationLanguage).mockRejectedValue(new Error('x'));
    await cliquer(bouton(/^FR$/));
    expect(toast.error).toHaveBeenCalledWith('Impossible de changer la langue');
    // Rollback : EN reste sélectionné (classe de l'onglet actif).
    expect(bouton(/^EN$/)!.className).toMatch(/bg-text-primary/);
  });
});
