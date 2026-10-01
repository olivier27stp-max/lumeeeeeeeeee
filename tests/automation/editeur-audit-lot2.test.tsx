// @vitest-environment jsdom
//
// L'ÉDITEUR D'AUTOMATISATIONS — lot 2 de l'audit du 2026-10-01.
//
// On monte la VRAIE page `AutomationBuilderPage` derrière un vrai routeur, avec
// le VRAI catalogue, et on regarde ce que l'écran dit et ce qui part au
// serveur. Chaque bloc `describe` porte un constat de l'audit.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = '11111111-1111-1111-1111-111111111111';
const ID = 'aaaaaaaa-0000-4000-8000-000000000001';

type Regle = Record<string, unknown> & { id: string };

function regle(over: Record<string, unknown> = {}): Regle {
  return {
    id: ID, org_id: ORG, name: 'Relance devis', description: null,
    trigger_event: 'quote.sent', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }],
    steps: [
      { id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: 'e2' },
      { id: 'e2', type: 'action', nom: null, action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
    ],
    settings: null, is_active: false, is_preset: false, preset_key: null,
    folder_id: null, deleted_at: null, lumi_conversation: [],
    created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
    ...over,
  };
}

const etat = vi.hoisted(() => ({
  regles: [] as Array<Record<string, unknown> & { id: string }>,
  /** Les déclencheurs que le SERVEUR offre à ce bureau (filtrés par drapeau). */
  declencheursServeur: null as unknown[] | null,
}));
const api = vi.hoisted(() => ({
  editeur: vi.fn(),
  creer: vi.fn(),
  modifier: vi.fn(),
  publier: vi.fn(),
  stats: vi.fn(),
}));
const confirmerMock = vi.hoisted(() => vi.fn(async (_o: unknown) => true));
const toasts = vi.hoisted(() => ({ erreur: [] as string[], succes: [] as string[], info: [] as string[] }));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: (m: string) => { toasts.erreur.push(String(m)); },
    success: (m: string) => { toasts.succes.push(String(m)); },
    info: (m: string) => { toasts.info.push(String(m)); },
  }),
}));
vi.mock('../../src/lib/automationBuilderApi', () => ({
  chargerEditeur: (id: string | null) => api.editeur(id),
  creerAutomatisation: (b: unknown) => api.creer(b),
  modifierAutomatisation: (id: string, p: unknown) => api.modifier(id, p),
  genererParcoursAvecLumi: vi.fn(),
  chargerMembres: vi.fn(async () => []),
  chargerEtiquettes: vi.fn(async () => []),
  apercuAutomatisation: vi.fn(async () => ({ client: null, message: 'Aucun client', apercu: [] })),
  changerPublication: (id: string, a: boolean) => api.publier(id, a),
  chargerStatistiques: (id?: string) => api.stats(id),
  restaurerAutomatisation: vi.fn(),
}));
vi.mock('../../src/hooks/usePlanFeature', () => ({ usePlanFeature: () => ({ hasFeature: true, loading: false }) }));
vi.mock('../../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: false, loading: false }) }));
const AUCUN_CHAMP = vi.hoisted(() => [] as never[]);
vi.mock('../../src/components/champs/automatisations', async (orig) => ({
  ...(await orig<typeof import('../../src/components/champs/automatisations')>()),
  useChampsTous: () => AUCUN_CHAMP,
}));
vi.mock('../../src/lib/pipelineVentesApi', () => ({ fetchPipelines: vi.fn(async () => []), fetchStages: vi.fn(async () => []) }));
vi.mock('../../src/lib/servicesApi', () => ({ listPredefinedServices: vi.fn(async () => []) }));
vi.mock('../../src/lib/reservationApi', () => ({ apercuClientsInactifs: vi.fn(async () => 0) }));
vi.mock('../../src/components/ui/ConfirmDialog', () => ({
  confirmer: (o: unknown) => confirmerMock(o),
  default: () => null,
}));
vi.mock('../../src/components/automations/OngletJournaux', () => ({
  OngletJournaux: () => <p>journaux</p>,
  OngletHistorique: () => <p>historique</p>,
}));

import AutomationBuilderPage from '../../src/pages/AutomationBuilderPage';
import { LanguageProvider } from '../../src/i18n';
import { ACTIONS, DECLENCHEURS } from '../../src/lib/automationCatalogue';

function Lieu() {
  const l = useLocation();
  return <output data-testid="lieu">{l.pathname + l.search}</output>;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  etat.regles = [regle()];
  etat.declencheursServeur = null;
  api.editeur.mockReset();
  api.editeur.mockImplementation(async (id: string | null) => ({
    rule: etat.regles.find((r) => r.id === id) ?? null,
    // Le serveur n'offre pas les déclencheurs sous drapeau à un bureau qui ne l'a pas.
    catalogue: { declencheurs: etat.declencheursServeur ?? DECLENCHEURS.filter((d) => !d.drapeau), actions: ACTIONS },
    autres: [],
  }));
  api.creer.mockReset();
  api.creer.mockImplementation(async (b: Record<string, unknown>) => ({ ...regle({ id: 'neuve-1', steps: [] }), ...b }));
  api.modifier.mockReset();
  api.modifier.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({ ...regle({ id }), ...patch }));
  api.publier.mockReset();
  api.publier.mockImplementation(async () => undefined);
  api.stats.mockReset();
  api.stats.mockImplementation(async () => ({ par_regle: {}, par_etape: {} }));
  confirmerMock.mockReset();
  confirmerMock.mockImplementation(async () => true);
  toasts.erreur = []; toasts.succes = []; toasts.info = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.setItem('lume-language', 'fr');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function attendre(n = 8) {
  for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve(); });
}

async function ouvrir(chemin: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[chemin]}>
        <LanguageProvider>
          <Routes>
            <Route path="/automations/:id" element={<><AutomationBuilderPage /><Lieu /></>} />
            <Route path="/automations" element={<Lieu />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  await attendre();
}

const boutons = () => Array.from(container.querySelectorAll('button'));
const bouton = (texte: string) => boutons().find((b) => b.textContent?.includes(texte));
const boutonExact = (texte: string) => boutons().find((b) => b.textContent?.trim() === texte);
function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('rien à cliquer');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
const lieu = () => container.querySelector('[data-testid="lieu"]')?.textContent ?? '';
/** La carte « Quand » du canevas. */
const carteQuand = () => boutons().find((b) => /^(Quand|When)/.test(b.textContent ?? '') && b.className.includes('w-[260px]'));
/** L'indicateur d'enregistrement, dans la barre du haut. */
const barreDuHaut = () => container.querySelector('header')?.textContent ?? '';
const panneaux = () => Array.from(container.querySelectorAll('aside')).map((a) => a.getAttribute('aria-label'));

/** Ouvre le tiroir « Déclencheurs » : par la carte, puis « Changer de déclencheur… » si la carte ouvre les réglages. */
async function ouvrirTiroirDeclencheurs() {
  cliquer(carteQuand());
  await attendre(2);
  const changer = bouton('Changer de déclencheur');
  if (changer) cliquer(changer);
  await attendre(2);
  expect(panneaux()).toContain('Déclencheurs');
}
async function choisirDeclencheur(titre: string) {
  await ouvrirTiroirDeclencheurs();
  const tiroir = container.querySelector('aside[aria-label="Déclencheurs"]');
  const choix = Array.from(tiroir?.querySelectorAll('button') ?? []).find((b) => b.textContent?.includes(titre));
  cliquer(choix);
  await attendre(2);
}

/** Des PATCH qui restent en vol jusqu'à ce que le test les libère. */
function retenirLesEnregistrements() {
  const enVol: Array<{ patch: Record<string, unknown>; repondre: () => void; refuser: (e: Error) => void }> = [];
  api.modifier.mockImplementation((id: string, patch: Record<string, unknown>) => new Promise((ok, ko) => {
    enVol.push({ patch, repondre: () => ok({ ...regle({ id }), ...patch }), refuser: ko });
  }));
  return enVol;
}

// ─── declencheurs-02 ────────────────────────────────────────────

describe('declencheurs-02 — deux choix de déclencheur rapprochés : le DERNIER clic reste', () => {
  it('jamais deux enregistrements en parallèle, et la carte finit sur le dernier choix', async () => {
    const enVol = retenirLesEnregistrements();
    await ouvrir(`/automations/${ID}`);

    await choisirDeclencheur('Facture envoyée');
    await choisirDeclencheur('Job terminé');
    // Le premier enregistrement n'a pas encore répondu : le second attend son tour.
    expect(enVol.map((e) => e.patch.trigger_event)).toEqual(['invoice.sent']);

    // Les réponses arrivent — la plus récente d'abord quand il y en a deux en
    // vol (c'est ce désordre qui faisait gagner l'AVANT-dernier clic).
    const repondues = new Set<unknown>();
    for (let tour = 0; tour < 4; tour++) {
      const suivante = [...enVol].reverse().find((e) => !repondues.has(e));
      if (!suivante) break;
      repondues.add(suivante);
      await act(async () => { suivante.repondre(); });
      await attendre();
    }

    // Au serveur : le dernier PATCH porte le dernier choix.
    expect(enVol.map((e) => e.patch.trigger_event)).toEqual(['invoice.sent', 'job.completed']);
    // À l'écran : idem.
    expect(carteQuand()?.textContent).toContain('Job terminé');
    expect(carteQuand()?.textContent).not.toContain('Facture envoyée');
  });

  it('aller-retour (A → B → A) pendant l’envoi de B : la base revient bien à A', async () => {
    const enVol = retenirLesEnregistrements();
    await ouvrir(`/automations/${ID}`);
    await choisirDeclencheur('Facture envoyée');
    await choisirDeclencheur('Devis envoyé');
    await act(async () => { enVol[0].repondre(); });
    await attendre();
    expect(enVol.map((e) => e.patch.trigger_event)).toEqual(['invoice.sent', 'quote.sent']);
    await act(async () => { enVol[1].repondre(); });
    await attendre();
    expect(carteQuand()?.textContent).toContain('Devis envoyé');
    expect(barreDuHaut()).toContain('Enregistré');
  });
});

// ─── declencheurs-03 ────────────────────────────────────────────

describe('declencheurs-03 — pendant que le changement de déclencheur s’enregistre, l’écran le dit', () => {
  it('la carte montre tout de suite le nouveau choix, et l’indicateur dit « Enregistrement… »', async () => {
    const enVol = retenirLesEnregistrements();
    await ouvrir(`/automations/${ID}`);
    expect(barreDuHaut()).toContain('Enregistré');

    await choisirDeclencheur('Facture envoyée');
    expect(enVol).toHaveLength(1);
    expect(carteQuand()?.textContent).toContain('Facture envoyée');
    expect(carteQuand()?.textContent).not.toContain('Devis envoyé');
    expect(barreDuHaut()).toContain('Enregistrement…');
    expect(barreDuHaut()).not.toContain('Enregistré');

    await act(async () => { enVol[0].repondre(); });
    await attendre();
    expect(carteQuand()?.textContent).toContain('Facture envoyée');
    expect(barreDuHaut()).toContain('Enregistré');
    expect(barreDuHaut()).not.toContain('Enregistrement…');
  });

  it('un clic sur la carte pendant l’envoi ouvre les réglages du NOUVEAU déclencheur, pas de l’ancien', async () => {
    retenirLesEnregistrements();
    await ouvrir(`/automations/${ID}`);
    await choisirDeclencheur('Devis ouvert par le client');
    cliquer(carteQuand());
    await attendre(2);
    const reglages = container.querySelector('aside[aria-label="Réglages du déclencheur"]');
    expect(reglages?.textContent).toContain('Devis ouvert par le client');
    expect(reglages?.textContent).toContain('Quand déclencher');
  });

  it('« Enregistrer » dans ce panneau attend la réponse du changement en vol (pas de course entre les deux)', async () => {
    const enVol = retenirLesEnregistrements();
    await ouvrir(`/automations/${ID}`);
    await choisirDeclencheur('Devis ouvert par le client');
    cliquer(carteQuand());
    await attendre(2);
    cliquer(boutonExact('Enregistrer'));
    await attendre();
    expect(enVol).toHaveLength(1);
    await act(async () => { enVol[0].repondre(); });
    await attendre();
    expect(enVol).toHaveLength(2);
    expect(enVol[1].patch).toMatchObject({ conditions: { ouverture: 'premiere' } });
    expect(enVol[1].patch.trigger_event).toBeUndefined();
  });

  it('enregistrement refusé : la carte revient à l’ancien déclencheur, et le refus est dit', async () => {
    const enVol = retenirLesEnregistrements();
    await ouvrir(`/automations/${ID}`);
    await choisirDeclencheur('Facture envoyée');
    expect(carteQuand()?.textContent).toContain('Facture envoyée');
    await act(async () => { enVol[0].refuser(new Error('Votre rôle ne permet pas de modifier une automatisation.')); });
    await attendre();
    expect(toasts.erreur.join('\n')).toContain('Votre rôle ne permet pas de modifier une automatisation.');
    expect(carteQuand()?.textContent).toContain('Devis envoyé');
    expect(carteQuand()?.textContent).not.toContain('Facture envoyée');
    expect(barreDuHaut()).toContain('Enregistré');
  });

  it('deux choix, le second refusé : la carte revient au dernier déclencheur CONFIRMÉ par le serveur', async () => {
    const enVol = retenirLesEnregistrements();
    await ouvrir(`/automations/${ID}`);
    await choisirDeclencheur('Facture envoyée');
    await choisirDeclencheur('Job terminé');
    await act(async () => { enVol[0].repondre(); });
    await attendre();
    await act(async () => { enVol[1].refuser(new Error('Serveur occupé')); });
    await attendre();
    expect(carteQuand()?.textContent).toContain('Facture envoyée');
    expect(toasts.erreur.join('\n')).toContain('Serveur occupé');
  });
});

// ─── EDITEUR-04 ─────────────────────────────────────────────────

/** La carte d'une étape du canevas (son bouton principal). */
const carteEtape = (texte: string) => boutons().find((b) => b.textContent?.includes(texte) && b.parentElement?.className.includes('w-[260px]'));
const PANNEAU_ETAPE = 'Modifier l’étape';
const PANNEAU_DECLENCHEUR = 'Réglages du déclencheur';

describe('EDITEUR-04 — un seul panneau à droite à la fois', () => {
  it('la carte « Quand » cliquée pendant qu’une étape est ouverte : les réglages du déclencheur REMPLACENT le panneau d’étape', async () => {
    await ouvrir(`/automations/${ID}`);
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    expect(panneaux()).toEqual([PANNEAU_ETAPE]);
    cliquer(carteQuand());
    await attendre(2);
    expect(panneaux()).toEqual([PANNEAU_DECLENCHEUR]);
    // Rien n'était modifié : aucune question posée.
    expect(confirmerMock).not.toHaveBeenCalled();
    // Plus qu'un seul « Enregistrer » à l'écran.
    expect(boutons().filter((b) => b.textContent?.trim() === 'Enregistrer')).toHaveLength(1);
  });

  it('une étape cliquée pendant que les réglages du déclencheur sont ouverts : le panneau d’étape les remplace', async () => {
    await ouvrir(`/automations/${ID}`);
    cliquer(carteQuand());
    await attendre(2);
    expect(panneaux()).toEqual([PANNEAU_DECLENCHEUR]);
    cliquer(carteEtape('Créer une tâche'));
    await attendre(2);
    expect(panneaux()).toEqual([PANNEAU_ETAPE]);
    expect(confirmerMock).not.toHaveBeenCalled();
  });

  it('étape modifiée sans enregistrer : « Quand » demande avant de jeter la saisie — refus = rien ne bouge', async () => {
    await ouvrir(`/automations/${ID}`);
    cliquer(carteEtape('Envoyer un texto'));
    await attendre(2);
    saisir(container.querySelector(`aside[aria-label="${PANNEAU_ETAPE}"] input[type="text"]`), 'Texto de relance');
    confirmerMock.mockImplementationOnce(async () => false);
    cliquer(carteQuand());
    await attendre();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(String((confirmerMock.mock.calls[0][0] as { message: string }).message)).toContain('ne sont pas enregistrées');
    expect(panneaux()).toEqual([PANNEAU_ETAPE]);
    expect(container.querySelector<HTMLInputElement>(`aside[aria-label="${PANNEAU_ETAPE}"] input[type="text"]`)?.value).toBe('Texto de relance');

    // Accepté : le déclencheur prend la place.
    cliquer(carteQuand());
    await attendre();
    expect(confirmerMock).toHaveBeenCalledTimes(2);
    expect(panneaux()).toEqual([PANNEAU_DECLENCHEUR]);
  });

  it('réglages du déclencheur modifiés sans enregistrer : ouvrir une étape demande aussi', async () => {
    await ouvrir(`/automations/${ID}`);
    cliquer(carteQuand());
    await attendre(2);
    saisir(container.querySelector(`aside[aria-label="${PANNEAU_DECLENCHEUR}"] input[type="text"]`), 'VIP');
    confirmerMock.mockImplementationOnce(async () => false);
    cliquer(carteEtape('Envoyer un texto'));
    await attendre();
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(String((confirmerMock.mock.calls[0][0] as { message: string }).message)).toContain('réglages du déclencheur');
    expect(panneaux()).toEqual([PANNEAU_DECLENCHEUR]);

    cliquer(carteEtape('Envoyer un texto'));
    await attendre();
    expect(panneaux()).toEqual([PANNEAU_ETAPE]);
  });

  it('« + » pendant que les réglages du déclencheur sont ouverts : le tiroir « Actions » s’ouvre (il ne se passait rien)', async () => {
    await ouvrir(`/automations/${ID}`);
    cliquer(carteQuand());
    await attendre(2);
    cliquer(container.querySelector('button[aria-label="Ajouter une étape ici"]'));
    await attendre(2);
    expect(panneaux()).toEqual(['Actions']);
  });

  it('« Publier » refusé à cause d’une étape : elle s’ouvre SEULE, même si les réglages du déclencheur étaient ouverts', async () => {
    etat.regles = [regle({
      steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'create_task', config: { title: '' } }, suivant: null }],
    })];
    await ouvrir(`/automations/${ID}`);
    cliquer(carteQuand());
    await attendre(2);
    expect(panneaux()).toEqual([PANNEAU_DECLENCHEUR]);
    cliquer(container.querySelector('button[role="switch"]'));
    await attendre();
    expect(toasts.erreur.join('\n')).toContain('Titre de la tâche');
    expect(panneaux()).toEqual([PANNEAU_ETAPE]);
  });
});

// ─── actions-07 (côté écran) ────────────────────────────────────

/** Changer la valeur d'un champ comme l'utilisateur (setter natif). */
function saisir(el: Element | null | undefined, v: string) {
  if (!el) throw new Error('champ introuvable');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('actions-07 — l’automatisation a été supprimée pendant que l’éditeur est ouvert', () => {
  /** Ce que `automationBuilderApi` lève quand le serveur répond 404. */
  const introuvable = () => Object.assign(new Error('Automatisation introuvable.'), { status: 404 });

  it('l’enregistrement automatique reçoit 404 : l’écran le dit, offre « Mes automatisations », et ne réessaie plus', async () => {
    await ouvrir(`/automations/${ID}`);
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw introuvable(); });
    cliquer(bouton('Relance devis'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v2');
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(api.modifier).toHaveBeenCalledTimes(1);

    expect(container.textContent).toContain('Cette automatisation n’existe plus.');
    // Plus de canevas ni d'interrupteur : rien à modifier, rien à publier.
    expect(carteQuand()).toBeUndefined();
    expect(container.querySelector('[role="switch"]')).toBeNull();
    // Pas la promesse d'un nouvel essai qui ne peut jamais réussir.
    expect(toasts.erreur.join('\n')).not.toContain('nouvel essai automatique');

    await act(async () => { vi.advanceTimersByTime(120_000); });
    await attendre();
    expect(api.modifier).toHaveBeenCalledTimes(1);

    cliquer(boutonExact('Mes automatisations'));
    await attendre();
    expect(lieu()).toBe('/automations');
    // Partir ne retente pas non plus l'enregistrement.
    expect(api.modifier).toHaveBeenCalledTimes(1);
  });

  it('un changement de déclencheur reçoit 404 : même écran', async () => {
    await ouvrir(`/automations/${ID}`);
    api.modifier.mockImplementation(async () => { throw introuvable(); });
    await choisirDeclencheur('Facture envoyée');
    await attendre();
    expect(container.textContent).toContain('Cette automatisation n’existe plus.');
    expect(boutonExact('Mes automatisations')).toBeDefined();
  });

  it('la publication reçoit 404 : même écran', async () => {
    await ouvrir(`/automations/${ID}`);
    api.publier.mockImplementation(async () => { throw introuvable(); });
    cliquer(container.querySelector('button[role="switch"]'));
    await attendre(12);
    expect(container.textContent).toContain('Cette automatisation n’existe plus.');
  });

  it('en anglais', async () => {
    localStorage.setItem('lume-language', 'en');
    await ouvrir(`/automations/${ID}`);
    api.modifier.mockImplementation(async () => { throw introuvable(); });
    cliquer(carteQuand());
    await attendre(2);
    cliquer(bouton('Change trigger'));
    await attendre(2);
    cliquer(bouton('Invoice sent'));
    await attendre();
    expect(container.textContent).toContain('This automation no longer exists.');
    expect(boutonExact('My automations')).toBeDefined();
  });

  it('une panne passagère (500) n’est PAS prise pour une suppression : l’éditeur reste, et réessaie', async () => {
    await ouvrir(`/automations/${ID}`);
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw Object.assign(new Error('Erreur serveur'), { status: 500 }); });
    cliquer(bouton('Relance devis'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v3');
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(container.textContent).not.toContain('n’existe plus');
    expect(toasts.erreur.join('\n')).toContain('nouvel essai automatique');
    await act(async () => { vi.advanceTimersByTime(6000); });
    await attendre();
    expect(api.modifier).toHaveBeenCalledTimes(2);
  });
});
