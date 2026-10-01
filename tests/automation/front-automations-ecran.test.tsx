// @vitest-environment jsdom
/**
 * T13 (jsdom) — L'ÉCRAN ACTUEL des automatisations, monté pour de vrai.
 *
 * Remplace `tests/quarantaine/automation/front-automations.unit.test.tsx`,
 * écrit pour l'ANCIENNE page (liste par catégories, lignes `tr role="button"`
 * qui se dépliaient, interrupteur `aria-pressed`). L'écran a été refait façon
 * GoHighLevel : onglets Toutes / À vérifier / Modèles / Corbeille, dossiers,
 * interrupteur Brouillon/Publiée (`role="switch"`), file de bascule, éditeur
 * plein écran. 15 des 24 anciens tests échouaient parce qu'ils cherchaient
 * des éléments qui n'existent plus — pas parce que le produit était cassé.
 *
 * Chaque comportement de l'ancien fichier, et où il vit maintenant :
 *
 *   T13.1  chargement : roue, puis tableau              → Automations.tsx (§ 6)
 *   T13.2  états vides                                  → message commun « Aucune automatisation »,
 *          « Voir les modèles », « Aucune erreur — tout roule ».
 *          « Aucun résultat » + compteur « 0 résultat » : n'existe plus dans
 *          l'écran actuel (remplacé par le message vide commun et la
 *          pagination « 1 sur 1 »).
 *   T13.3  erreur de chargement                         → toast + page utilisable ; échecs et
 *          statistiques illisibles n'empêchent pas la liste.
 *   T13.4  bascule optimiste + retour arrière           → InterrupteurPublication + fileBascule,
 *          via `changerPublication` (route serveur M8). Le refus d'un faux
 *          succès RLS (0 ligne renvoyée) a quitté le navigateur : il vit dans
 *          `server/lib/automations-publication.ts` (testé ici directement),
 *          et le client relaie le message du serveur au lieu d'un toast vert.
 *   T13.5  (intégration) bascule réellement appliquée   → hors de ce fichier (T9.8, contre une base).
 *   T13.6  badge d'échec                                → « N échec(s) dans les 7 derniers jours »
 *          dans la cellule Nom + compteur de l'onglet « À vérifier (N) ».
 *          Le badge « 3 échec » avec `title` n'existe plus (remplacé par ce
 *          texte visible, lu depuis `getRecentAutomationFailures`).
 *   T13.7  déclencheur et nom lisibles en français     → sous-titre de la cellule Nom
 *          (catalogue d'abord, TRIGGER_DISPLAY ensuite) ; F22 CORRIGÉ.
 *   T13.8  éditeur de message (texto, courriel)        → MessageEditor, déplié par
 *          « Voir les messages de … » — seulement pour une règle au format
 *          d'origine (`actions`). Une règle bâtie dans l'éditeur (`steps`)
 *          montre un aperçu en LECTURE SEULE + « Modifier dans l'éditeur ».
 *          Variable inconnue signalée : F22 CORRIGÉ dans MessageEditor.
 *          (Le panneau d'étape de l'éditeur plein écran la signale aussi
 *          depuis le 2026-10-01 : voir front-automations-panneau-etape.test.tsx.)
 *   T13.9  accessibilité                                → cliquet à 0 sur TOUS les fichiers de
 *          l'écran (4 pages + src/components/automations/*), plus un contrôle
 *          sur le DOM rendu.
 *   T13.10 raison lisible d'un échec                    → `raisonLisible` dans la cellule Nom
 *          et dans le panneau « › » ; F22 CORRIGÉ.
 *   T13.11 langue des messages FR → EN                  → sélecteur « Messages en FR | EN ».
 *          Le toast d'échec montre désormais la RAISON du serveur ; le texte
 *          fixe « Impossible de changer la langue » n'est plus qu'un repli.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync, readdirSync } from 'node:fs';
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

// Le bandeau « Tout arrêter » : en marche.
vi.mock('../../src/lib/automationWebhooksApi', () => ({
  lireEtatPause: vi.fn(async () => ({ paused: false })),
  basculerPause: vi.fn(async () => ({ paused: false })),
}));
vi.mock('../../src/lib/reservationApi', () => ({ apercuClientsInactifs: vi.fn(async () => 0) }));
vi.mock('../../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));

// Pour le test de l'API RÉELLE (T13.4) : la réponse du serveur, simulée.
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

import { toast } from 'sonner';
import * as api from '../../src/lib/automationRulesApi';
import * as builder from '../../src/lib/automationBuilderApi';
import { appelServeur } from '../../src/lib/appelServeur';
import { LanguageProvider } from '../../src/i18n';
import Automations from '../../src/pages/Automations';
import { changerPublication as changerPublicationServeur } from '../../server/lib/automations-publication';
import { mesurerSource } from '../../scripts/accessibilite-mesure.mjs';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── Fixtures ───────────────────────────────────────────────────
const RULE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOM_FR = 'Confirmation de rendez-vous';
const SMS_INITIAL = 'Bonjour [client_first_name], votre rendez-vous est confirmé.';

function regle(partiel: Partial<api.AutomationRule> = {}): api.AutomationRule {
  return {
    id: RULE_ID, org_id: 'org-a', name: 'Appointment Confirmation', description: 'Confirme la visite au client',
    trigger_event: 'appointment.created', conditions: {}, delay_seconds: 0,
    actions: [
      { type: 'send_sms', config: { body: SMS_INITIAL } },
      { type: 'send_email', config: { subject: 'Confirmation', body: '<p>Bonjour [client_first_name]</p>' } },
    ],
    steps: null, is_active: true, is_preset: true, preset_key: 'appointment_confirmation',
    folder_id: null, modele_id: null, deleted_at: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    ...partiel,
  };
}

function echec(cause: string, n = 1): api.AutomationFailure {
  return {
    id: `l${n}`, automation_rule_id: RULE_ID, action_type: 'send_email',
    result_error: cause, entity_type: 'job', created_at: '2026-09-29T15:00:00Z',
  };
}

// ── Banc React ─────────────────────────────────────────────────
let conteneur: HTMLDivElement;
let racine: Root | null = null;
const laisser = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function rendre() {
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
const boutons = () => Array.from(conteneur.querySelectorAll('button'));
const bouton = (motif: RegExp) => boutons().find((b) => motif.test((b.textContent || '').trim()) || motif.test(b.getAttribute('aria-label') || ''));
const interrupteur = () => conteneur.querySelector('button[role="switch"]') as HTMLButtonElement;
const roue = () => conteneur.querySelector('.section-card .animate-spin');
async function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('élément introuvable');
  await act(async () => { (el as HTMLElement).click(); });
  await laisser();
}
async function saisir(el: HTMLTextAreaElement | HTMLInputElement, valeur: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => { setter.call(el, valeur); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await laisser();
}
/** Déplie les messages d'une règle (le chevron « Voir les messages de … »). */
async function deplierMessages(nom = NOM_FR) {
  await cliquer(bouton(new RegExp(`^Voir les messages de ${nom}$`)));
}
const zoneSms = () => conteneur.querySelector('textarea[aria-label="SMS envoyé au client"]') as HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('lume-language', 'fr');
  vi.mocked(api.getAutomationRules).mockResolvedValue([regle()]);
  vi.mocked(api.getRecentAutomationFailures).mockResolvedValue([]);
  vi.mocked(api.getAutomationLanguage).mockResolvedValue('fr');
  vi.mocked(api.setAutomationLanguage).mockResolvedValue(undefined);
  vi.mocked(api.updateRuleMessage).mockResolvedValue(undefined);
  vi.mocked(builder.changerPublication).mockResolvedValue(undefined);
  vi.mocked(builder.chargerStatistiques).mockResolvedValue({ par_regle: {}, par_etape: null, texto_configure: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
  vi.mocked(console.error).mockRestore?.();
});

// ═══════════════════════════════════════════════════════════════
describe('T13.1 — chargement', () => {
  it('affiche la roue tant que les règles ne sont pas arrivées, puis le tableau', async () => {
    let livrer!: (r: api.AutomationRule[]) => void;
    vi.mocked(api.getAutomationRules).mockReturnValue(new Promise((r) => { livrer = r; }));
    await rendre();
    expect(roue(), 'la roue tourne pendant le chargement').not.toBeNull();
    expect(conteneur.querySelector('table')).toBeNull();
    await act(async () => { livrer([regle()]); });
    await laisser();
    expect(roue()).toBeNull();
    expect(conteneur.querySelector('table')).not.toBeNull();
    expect(texte()).toContain(NOM_FR);
    expect(texte()).toContain('Mes automatisations');
  });
});

describe('T13.2 — états vides', () => {
  it('sans règle : « Aucune automatisation », sans bouton vers des modèles qui n’existent pas', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([]);
    await rendre();
    expect(texte()).toContain('Aucune automatisation');
    expect(bouton(/^Voir les modèles$/)).toBeUndefined();
  });

  it('seulement des modèles en brouillon : « Toutes » est vide mais propose « Voir les modèles », qui ouvre l’onglet', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ is_active: false })]);
    await rendre();
    expect(texte()).toContain('Aucune automatisation');
    expect(texte()).not.toContain(NOM_FR);
    await cliquer(bouton(/^Voir les modèles$/));
    const ongletModeles = conteneur.querySelector('[role="tab"][aria-selected="true"]');
    expect(ongletModeles?.textContent).toMatch(/Modèles \(1\)/);
    expect(texte()).toContain(NOM_FR);
  });

  it('recherche sans résultat : le message vide commun (« Aucun résultat » n’existe plus)', async () => {
    await rendre();
    await saisir(conteneur.querySelector('#rech-automations') as HTMLInputElement, 'zzz-introuvable');
    expect(texte()).toContain('Aucune automatisation');
    expect(texte()).not.toContain(NOM_FR);
    expect(texte()).toMatch(/sur 1/);
  });

  it('« À vérifier » sans échec : « Aucune erreur — tout roule »', async () => {
    await rendre();
    await cliquer(bouton(/^À vérifier \(0\)$/));
    expect(texte()).toContain('Aucune erreur — tout roule');
  });
});

describe('T13.3 — erreur de chargement', () => {
  it('toast d’erreur en français, roue retirée, page utilisable (recherche, filtres, création)', async () => {
    vi.mocked(api.getAutomationRules).mockRejectedValue(new Error('boom'));
    await rendre();
    expect(toast.error).toHaveBeenCalledWith('Impossible de charger les automatisations');
    expect(roue()).toBeNull();
    expect(conteneur.querySelector('#rech-automations')).not.toBeNull();
    expect(bouton(/^Filtres avancés$/)).toBeDefined();
    expect(bouton(/^Créer$/)).toBeDefined();
  });

  it('les échecs illisibles n’empêchent pas la liste, et ne crient pas', async () => {
    vi.mocked(api.getRecentAutomationFailures).mockRejectedValue(new Error('rls'));
    await rendre();
    expect(conteneur.querySelector('table')).not.toBeNull();
    expect(texte()).toContain(NOM_FR);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('les statistiques illisibles : la liste reste, les colonnes chiffrées montrent « — » au lieu d’un faux 0', async () => {
    vi.mocked(builder.chargerStatistiques).mockRejectedValue(new Error('500'));
    await rendre();
    expect(texte()).toContain(NOM_FR);
    const cellules = Array.from(conteneur.querySelectorAll('tbody td')).map((td) => td.textContent?.trim());
    expect(cellules.filter((c) => c === '—').length).toBeGreaterThanOrEqual(2);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('T13.4 — bascule Brouillon / Publiée', () => {
  it('optimiste : l’interrupteur change AVANT la réponse du serveur, puis confirmé (toast, statut « Brouillon »)', async () => {
    let repondre!: () => void;
    vi.mocked(builder.changerPublication).mockReturnValue(new Promise<void>((r) => { repondre = r; }));
    await rendre();
    expect(interrupteur().getAttribute('aria-checked')).toBe('true');
    expect(interrupteur().getAttribute('aria-label')).toBe(`Repasser ${NOM_FR} en brouillon`);

    await cliquer(interrupteur());
    expect(builder.changerPublication).toHaveBeenCalledWith(RULE_ID, false);
    expect(interrupteur().getAttribute('aria-checked'), 'l’écran suit le clic tout de suite').toBe('false');
    expect(interrupteur().getAttribute('aria-busy'), 'la requête est en vol').toBe('true');
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => { repondre(); });
    await laisser();
    expect(interrupteur().getAttribute('aria-checked')).toBe('false');
    expect(interrupteur().getAttribute('aria-busy')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Repassée en brouillon', { id: `bascule-${RULE_ID}` });
    expect(texte()).toContain('Brouillon');
    // La ligne reste à sa place (sinon le clic suivant toucherait une AUTRE automatisation).
    expect(texte()).toContain(NOM_FR);
  });

  it('refusée par le serveur : retour à l’état confirmé, le toast porte la RAISON du serveur, jamais de toast vert', async () => {
    vi.mocked(builder.changerPublication).mockRejectedValue(new Error('Votre rôle ne permet pas de publier une automatisation.'));
    await rendre();
    await cliquer(interrupteur());
    await laisser();
    expect(interrupteur().getAttribute('aria-checked'), 'retour arrière').toBe('true');
    expect(toast.error).toHaveBeenCalledWith('Votre rôle ne permet pas de publier une automatisation.', expect.objectContaining({ id: `bascule-${RULE_ID}` }));
    expect(toast.success).not.toHaveBeenCalled();
    expect(texte()).toContain('Publiée');
  });

  it('martelée : 3 clics pendant qu’une requête est en vol = au plus 2 requêtes, et l’écran suit le DERNIER clic', async () => {
    const enVol: Array<() => void> = [];
    vi.mocked(builder.changerPublication).mockImplementation(() => new Promise<void>((r) => { enVol.push(r); }));
    await rendre();
    await cliquer(interrupteur()); // → brouillon
    await cliquer(interrupteur()); // → publiée
    await cliquer(interrupteur()); // → brouillon
    expect(interrupteur().getAttribute('aria-checked')).toBe('false');
    expect(builder.changerPublication).toHaveBeenCalledTimes(1);
    await act(async () => { enVol[0](); });
    await laisser();
    // Le serveur a confirmé « brouillon », qui est aussi le dernier voulu : rien de plus à envoyer.
    expect(builder.changerPublication).toHaveBeenCalledTimes(1);
    expect(interrupteur().getAttribute('aria-checked')).toBe('false');
  });

  it('une règle « Client inactif » demande confirmation avant de publier ; refusée, rien n’est envoyé', async () => {
    const { confirmer } = await import('../../src/components/ui/ConfirmDialog');
    vi.mocked(confirmer).mockResolvedValueOnce(false);
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ is_preset: false, is_active: false, trigger_event: 'client.inactive', name: 'Relance inactifs', preset_key: null })]);
    await rendre();
    await cliquer(interrupteur());
    expect(confirmer).toHaveBeenCalledTimes(1);
    expect(builder.changerPublication).not.toHaveBeenCalled();
    expect(interrupteur().getAttribute('aria-checked')).toBe('false');
  });

  it('le client relaie le refus du serveur (toggleAutomationRule → changerPublication réels) au lieu d’un faux succès', async () => {
    const reelRules = await vi.importActual<typeof api>('../../src/lib/automationRulesApi');
    const reelBuilder = await vi.importActual<typeof builder>('../../src/lib/automationBuilderApi');
    localStorage.setItem('lume-active-org', '11111111-2222-4333-8444-555555555555');
    vi.mocked(appelServeur).mockImplementation(async () => new Response(
      JSON.stringify({ error: 'Votre rôle ne permet pas de publier une automatisation.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    ));
    await expect(reelBuilder.changerPublication(RULE_ID, false)).rejects.toThrow('Votre rôle ne permet pas de publier une automatisation.');
    const [url, init] = vi.mocked(appelServeur).mock.calls[0];
    expect(url).toBe(`/api/automations/rules/${RULE_ID}/publication`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ actif: false });

    vi.mocked(appelServeur).mockImplementation(async () => new Response(JSON.stringify({ id: RULE_ID, is_active: false }), { status: 200 }));
    await expect(reelBuilder.changerPublication(RULE_ID, false)).resolves.toBeUndefined();

    // Le chemin des pages Réglages (Messagerie, Avis) : `toggleAutomationRule`
    // délègue à la MÊME route — plus d'écriture PostgREST directe — et laisse
    // remonter son refus.
    vi.mocked(builder.changerPublication).mockRejectedValueOnce(new Error('Votre rôle ne permet pas de publier une automatisation.'));
    await expect(reelRules.toggleAutomationRule(RULE_ID, true)).rejects.toThrow(/rôle ne permet pas/);
    expect(builder.changerPublication).toHaveBeenCalledWith(RULE_ID, true);
  });

  it('le serveur refuse un faux succès : 0 ligne renvoyée par la RLS, ou une ligne qui ne porte pas la valeur demandée', async () => {
    /** Un faux client PostgREST : lecture de la règle, puis l'update renvoie `lignes`. */
    const client = (lignes: unknown[]) => ({
      from: () => {
        const chaine: Record<string, unknown> = {};
        Object.assign(chaine, {
          select: () => chaine,
          eq: () => chaine,
          update: () => chaine,
          maybeSingle: async () => ({ data: { id: RULE_ID, name: 'R', trigger_event: 'quote.sent', conditions: {}, steps: null, actions: [], is_preset: false, is_active: true, deleted_at: null }, error: null }),
          then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: lignes, error: null }).then(ok),
        });
        return chaine;
      },
    });
    const vide = await changerPublicationServeur(client([]) as any, 'org', RULE_ID, false);
    expect(vide).toMatchObject({ ok: false, statut: 403 });
    const ignoree = await changerPublicationServeur(client([{ id: RULE_ID, name: 'R', is_active: true }]) as any, 'org', RULE_ID, false);
    expect(ignoree).toMatchObject({ ok: false, statut: 500 });
    expect((ignoree as { erreur: string }).erreur).toMatch(/pas été appliquée/);
    const bonne = await changerPublicationServeur(client([{ id: RULE_ID, name: 'R', is_active: false }]) as any, 'org', RULE_ID, false);
    expect(bonne).toMatchObject({ ok: true, is_active: false });
  });
});

describe('T13.6 — échecs visibles', () => {
  it('3 échecs sur 7 jours : « 3 échec(s) dans les 7 derniers jours » sur la ligne, et l’onglet « À vérifier (1) »', async () => {
    vi.mocked(api.getRecentAutomationFailures).mockResolvedValue([echec('boom', 1), echec('boom', 2), echec('boom', 3)]);
    await rendre();
    expect(texte()).toContain('3 échec(s) dans les 7 derniers jours');
    expect(bouton(/^À vérifier \(1\)$/)).toBeDefined();
    await cliquer(bouton(/^À vérifier \(1\)$/));
    expect(texte()).toContain(NOM_FR);
  });

  it('un échec d’une AUTRE règle ne compte pas pour celle-ci', async () => {
    vi.mocked(api.getRecentAutomationFailures).mockResolvedValue([{ ...echec('boom'), automation_rule_id: 'autre' }]);
    await rendre();
    expect(texte()).not.toMatch(/échec\(s\)/);
  });

  it('0 échec : aucune mention d’échec', async () => {
    await rendre();
    expect(texte()).not.toMatch(/échec/);
    expect(bouton(/^À vérifier \(0\)$/)).toBeDefined();
  });
});

describe('T13.7 — déclencheur et nom lisibles (F22 corrigé)', () => {
  it('`agreement.signed` et « Contract Signed » s’affichent en français', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ name: 'Contract Signed', preset_key: 'agreement_signed', trigger_event: 'agreement.signed' })]);
    await rendre();
    expect(texte()).not.toContain('agreement.signed');
    expect(texte()).not.toContain('Contract Signed');
    expect(texte()).toMatch(/Contrat signé/);
  });

  it('`appointment.created` : le libellé du CATALOGUE (celui de l’éditeur), jamais la clé', async () => {
    await rendre();
    expect(texte()).toContain(NOM_FR);
    expect(texte()).toContain('Rendez-vous planifié');
    expect(texte()).not.toContain('appointment.created');
  });

  it('un déclencheur hors catalogue (`client.archived`) a quand même un nom français', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({ is_preset: false, preset_key: null, name: 'Archivage', trigger_event: 'client.archived' })]);
    await rendre();
    expect(texte()).toContain('Client archivé');
    expect(texte()).not.toContain('client.archived');
  });
});

describe('T13.8 — éditeur de message dans la liste (règle au format d’origine)', () => {
  it('texto : variable insérée, aperçu remplacé, enregistrement via updateRuleMessage(id, "send_sms", texte), liste rechargée', async () => {
    await rendre();
    await deplierMessages();
    const zone = zoneSms();
    expect(zone.value).toBe(SMS_INITIAL);
    expect(texte()).toMatch(/Le client lira :/);
    const apercu = () => (conteneur.querySelector('span.italic') as HTMLElement).textContent || '';
    expect(apercu(), 'l’aperçu remplace la variable par un exemple').toBe('Bonjour Marie, votre rendez-vous est confirmé.');

    const enregistrer = () => bouton(/^Enregistrer$/) as HTMLButtonElement;
    expect(enregistrer().disabled, 'rien à enregistrer tant que le texte est inchangé').toBe(true);

    await cliquer(bouton(/^Votre entreprise$/));
    expect(zoneSms().value).toBe(`${SMS_INITIAL}[company_name]`);
    expect(apercu()).toBe('Bonjour Marie, votre rendez-vous est confirmé.Votre entreprise');
    expect(enregistrer().disabled).toBe(false);
    expect(texte()).toMatch(new RegExp(`${SMS_INITIAL.length + '[company_name]'.length} caractères`));

    const appelsAvant = vi.mocked(api.getAutomationRules).mock.calls.length;
    await cliquer(enregistrer());
    expect(api.updateRuleMessage).toHaveBeenCalledWith(RULE_ID, 'send_sms', `${SMS_INITIAL}[company_name]`);
    expect(toast.success).toHaveBeenCalledWith('Message enregistré');
    expect(vi.mocked(api.getAutomationRules).mock.calls.length, 'la liste est rechargée').toBeGreaterThan(appelsAvant);
  });

  it('annuler ramène le texte initial sans appel API', async () => {
    await rendre(); await deplierMessages();
    await saisir(zoneSms(), 'autre chose');
    await cliquer(bouton(/^Annuler$/));
    expect(zoneSms().value).toBe(SMS_INITIAL);
    expect(api.updateRuleMessage).not.toHaveBeenCalled();
  });

  it('enregistrement refusé : le message d’erreur est montré, le texte saisi est conservé', async () => {
    vi.mocked(api.updateRuleMessage).mockRejectedValue(new Error('Permission refusée'));
    await rendre(); await deplierMessages();
    await cliquer(bouton(/^Prénom du client$/));
    await cliquer(bouton(/^Enregistrer$/));
    expect(toast.error).toHaveBeenCalledWith('Permission refusée');
    expect(zoneSms().value).toBe(`${SMS_INITIAL}[client_first_name]`);
  });

  it('plus de 160 caractères : le nombre de SMS facturés est affiché', async () => {
    await rendre(); await deplierMessages();
    await saisir(zoneSms(), 'x'.repeat(200));
    expect(texte()).toMatch(/200 caractères\s*· 2 SMS/);
  });

  it('message vide : jamais enregistrable, et le bouton grisé dit pourquoi', async () => {
    await rendre(); await deplierMessages();
    await saisir(zoneSms(), '   ');
    expect((bouton(/^Enregistrer$/) as HTMLButtonElement).disabled).toBe(true);
    expect(texte()).toContain('Le message ne peut pas être vide.');
  });

  it('variable inconnue « [prenom] » SIGNALÉE (F22 corrigé) : le serveur l’enverrait vide', async () => {
    await rendre(); await deplierMessages();
    await saisir(zoneSms(), 'Bonjour [prenom], à demain.');
    expect(texte()).toContain('Variable inconnue : [prenom] — sera vide dans le message envoyé.');
  });

  it('variable connue écrite à la main : aucun avertissement (pas de fausse alerte)', async () => {
    await rendre(); await deplierMessages();
    await saisir(zoneSms(), 'Bonjour [client_first_name], facture [invoice_link].');
    expect(texte()).not.toMatch(/Variable inconnue/);
  });

  it('courriel : aperçu compact (objet, corps texte avec exemple), bouton « Modifier » présent', async () => {
    await rendre(); await deplierMessages();
    expect(texte()).toContain('Courriel envoyé au client');
    expect(texte()).toContain('Confirmation');
    expect(texte()).toContain('Bonjour Marie');
    expect(texte()).not.toContain('<p>');
    expect(bouton(/^Modifier$/)).toBeDefined();
  });

  it('règle bâtie dans l’éditeur (`steps`) : aperçu en LECTURE SEULE + « Modifier dans l’éditeur », jamais l’ancien texto fantôme', async () => {
    vi.mocked(api.getAutomationRules).mockResolvedValue([regle({
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_email', config: { subject: 'Merci', body: '<p>Bonjour [client_name]</p>' } }, suivant: null }],
    })]);
    await rendre(); await deplierMessages();
    expect(zoneSms(), 'pas d’édition sur place : elle écrirait dans `actions`, que le moteur ignore').toBeNull();
    expect(texte()).toContain('Courriel envoyé au client');
    expect(texte()).toContain('Merci');
    expect(texte()).not.toContain(SMS_INITIAL);
    expect(bouton(/^Modifier dans l’éditeur$/)).toBeDefined();
  });
});

describe('T13.9 — accessibilité', () => {
  const FICHIERS = [
    'src/pages/Automations.tsx',
    'src/pages/AutomationBuilderPage.tsx',
    'src/pages/AutomationsApercu.tsx',
    'src/pages/AutomationsReglages.tsx',
    ...readdirSync(resolve(process.cwd(), 'src/components/automations'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => `src/components/automations/${f}`),
  ];
  it.each(FICHIERS)('cliquet à 0 : %s', (fichier) => {
    const m = mesurerSource(readFileSync(resolve(process.cwd(), fichier), 'utf8')) as Record<string, number>;
    const fautes = Object.entries(m).filter(([, v]) => v > 0);
    expect(fautes, JSON.stringify(m)).toHaveLength(0);
  });

  it('dans le DOM rendu (liste + messages dépliés) : chaque bouton a un nom, chaque champ une étiquette', async () => {
    vi.mocked(api.getRecentAutomationFailures).mockResolvedValue([echec('SMTP not configured')]);
    await rendre();
    await deplierMessages();
    const sansNom = boutons().filter((b) => !((b.textContent || '').trim() || b.getAttribute('aria-label') || b.getAttribute('title')));
    expect(sansNom.map((b) => b.outerHTML.slice(0, 120))).toEqual([]);
    const champs = Array.from(conteneur.querySelectorAll('input, textarea, select'));
    const sansEtiquette = champs.filter((c) => !c.getAttribute('aria-label') && !(c.id && conteneur.querySelector(`label[for="${c.id}"]`)));
    expect(sansEtiquette.map((c) => c.outerHTML.slice(0, 120))).toEqual([]);
    expect(interrupteur().getAttribute('role')).toBe('switch');
  });
});

describe('T13.10 — pourquoi ça n’a pas marché (F22 corrigé)', () => {
  it('la cause du dernier échec est dite en français sur la ligne, jamais le texte technique anglais', async () => {
    vi.mocked(api.getRecentAutomationFailures).mockResolvedValue([
      echec('SMTP not configured', 1),
      echec('Frequency cap reached for +15145550101', 2),
    ]);
    await rendre();
    expect(texte()).not.toMatch(/SMTP not configured|Frequency cap|\+1514/);
    expect(texte()).toContain('2 échec(s) dans les 7 derniers jours — Courriel non configuré : impossible d’envoyer.');
  });

  it('le panneau « › » répète la cause : « Dernier échec : … »', async () => {
    vi.mocked(api.getRecentAutomationFailures).mockResolvedValue([echec('No recipient phone for client')]);
    await rendre();
    await cliquer(bouton(new RegExp(`^Statistiques de ${NOM_FR}$`)));
    expect(texte()).toContain('Dernier échec : Ce client n’a pas de numéro de téléphone.');
    expect(texte()).not.toContain('No recipient phone');
  });

  it('une cause inconnue : le compteur seul, plutôt qu’un jargon anglais', async () => {
    vi.mocked(api.getRecentAutomationFailures).mockResolvedValue([echec('ECONNRESET socket hang up')]);
    await rendre();
    expect(texte()).toContain('1 échec(s) dans les 7 derniers jours');
    expect(texte()).not.toContain('ECONNRESET');
  });
});

describe('T13.11 — langue des messages envoyés', () => {
  it('FR → EN : setAutomationLanguage("en") + toast, et EN devient l’onglet actif', async () => {
    await rendre();
    await cliquer(bouton(/^EN$/));
    expect(api.setAutomationLanguage).toHaveBeenCalledWith('en');
    expect(toast.success).toHaveBeenCalledWith('Messages en anglais');
    expect(bouton(/^EN$/)!.className).toMatch(/bg-text-primary/);
    expect(bouton(/^FR$/)!.className).not.toMatch(/bg-text-primary/);
  });

  it('refusé : retour arrière, et le toast dit la RAISON du serveur', async () => {
    vi.mocked(api.getAutomationLanguage).mockResolvedValue('en');
    vi.mocked(api.setAutomationLanguage).mockRejectedValue(new Error('Seul un administrateur peut changer la langue des messages.'));
    await rendre();
    await cliquer(bouton(/^FR$/));
    expect(api.setAutomationLanguage).toHaveBeenCalledWith('fr');
    expect(toast.error).toHaveBeenCalledWith('Seul un administrateur peut changer la langue des messages.');
    expect(bouton(/^EN$/)!.className, 'EN reste sélectionné').toMatch(/bg-text-primary/);
  });

  it('refusé sans message : repli « Impossible de changer la langue »', async () => {
    vi.mocked(api.setAutomationLanguage).mockRejectedValue(new Error(''));
    await rendre();
    await cliquer(bouton(/^EN$/));
    expect(toast.error).toHaveBeenCalledWith('Impossible de changer la langue');
    expect(bouton(/^FR$/)!.className).toMatch(/bg-text-primary/);
  });

  it('cliquer la langue déjà active n’appelle rien', async () => {
    await rendre();
    await cliquer(bouton(/^FR$/));
    expect(api.setAutomationLanguage).not.toHaveBeenCalled();
  });
});
