// @vitest-environment jsdom
//
// VAGUE 4 — l'éditeur d'automatisations (audit V2, 11-interface.md §9).
//
// On monte la VRAIE page `AutomationBuilderPage` derrière un vrai routeur et
// on vérifie ce qui part au serveur. Chaque bloc `describe` porte un défaut.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ORG = '11111111-1111-1111-1111-111111111111';
const ID = 'aaaaaaaa-0000-4000-8000-000000000001';

function regle(over: Record<string, unknown> = {}) {
  return {
    id: ID, org_id: ORG, name: 'Relance devis', description: null,
    trigger_event: 'quote.sent', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'send_sms', config: { body: 'Bonjour' } }],
    steps: [
      { id: 'e1', type: 'action', nom: null, action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name]' } }, suivant: null },
    ],
    settings: null, is_active: false, is_preset: false, preset_key: null,
    folder_id: null, deleted_at: null, lumi_conversation: [],
    created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z',
    ...over,
  };
}

const etat = { aLumi: true, regles: [] as any[] };
const api = {
  charger: vi.fn(async () => ({ rules: etat.regles, catalogue: { declencheurs: [], actions: [] } })),
  creer: vi.fn(async (_b: any) => regle({ id: 'neuve-1' }) as any),
  modifier: vi.fn(async (id: string, patch: any) => ({ ...regle({ id }), ...patch }) as any),
  apercu: vi.fn(async (_id: string) => ({ client: null, message: 'Aucun client', apercu: [] })),
  publier: vi.fn(async (_id: string, _a: boolean) => undefined),
  generer: vi.fn(),
  stats: vi.fn(async (_id?: string): Promise<any> => ({ par_regle: {}, par_etape: {} })),
};
const confirmerMock = vi.fn(async (_o: unknown) => true);
const toasts = { erreur: [] as string[], succes: [] as string[], info: [] as string[] };

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: (m: string) => { toasts.erreur.push(String(m)); },
    success: (m: string) => { toasts.succes.push(String(m)); },
    info: (m: string) => { toasts.info.push(String(m)); },
  }),
}));

vi.mock('../src/lib/automationBuilderApi', () => ({
  chargerAutomatisations: () => api.charger(),
  creerAutomatisation: (b: any) => api.creer(b),
  modifierAutomatisation: (id: string, p: any) => api.modifier(id, p),
  genererParcoursAvecLumi: (...a: any[]) => api.generer(...a),
  chargerMembres: vi.fn(async () => []),
  chargerEtiquettes: vi.fn(async () => []),
  apercuAutomatisation: (id: string) => api.apercu(id),
  changerPublication: (id: string, a: boolean) => api.publier(id, a),
  chargerStatistiques: (id?: string) => api.stats(id),
}));
vi.mock('../src/hooks/usePlanFeature', () => ({
  usePlanFeature: () => ({ hasFeature: etat.aLumi, loading: false }),
}));
vi.mock('../src/hooks/useModuleAccess', () => ({
  useModuleAccess: () => ({ isEnabled: false, loading: false }),
}));
const AUCUN_CHAMP: never[] = [];
vi.mock('../src/components/champs/automatisations', async (orig) => ({
  ...(await orig<typeof import('../src/components/champs/automatisations')>()),
  useChampsTous: () => AUCUN_CHAMP,
}));
vi.mock('../src/lib/pipelineVentesApi', () => ({ fetchPipelines: vi.fn(async () => []), fetchStages: vi.fn(async () => []) }));
vi.mock('../src/lib/servicesApi', () => ({ listPredefinedServices: vi.fn(async () => []) }));
vi.mock('../src/lib/reservationApi', () => ({ apercuClientsInactifs: vi.fn(async () => 0) }));
vi.mock('../src/components/ui/ConfirmDialog', () => ({
  confirmer: (o: unknown) => confirmerMock(o),
  default: () => null,
}));
vi.mock('../src/components/automations/OngletJournaux', () => ({
  OngletJournaux: () => <p>journaux</p>,
  OngletHistorique: () => <p>historique</p>,
}));

import AutomationBuilderPage from '../src/pages/AutomationBuilderPage';
import { LanguageProvider, useTranslation } from '../src/i18n';

/** Change la langue de l'interface, comme le sélecteur de l'app. */
function ChangerLangue() {
  const { language, setLanguage } = useTranslation();
  return <button type="button" data-testid="langue" onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}>langue</button>;
}

function Lieu() {
  const l = useLocation();
  return <output data-testid="lieu">{l.pathname + l.search}</output>;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  etat.aLumi = true;
  etat.regles = [regle()];
  api.charger.mockClear();
  api.creer.mockReset();
  api.creer.mockImplementation(async () => regle({ id: 'neuve-1', steps: [] }) as any);
  api.modifier.mockReset();
  api.modifier.mockImplementation(async (id: string, patch: any) => ({ ...regle({ id }), ...patch }) as any);
  api.apercu.mockClear();
  api.publier.mockClear();
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

async function attendre(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => { await Promise.resolve(); });
}

async function ouvrir(chemin: string) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[chemin]}>
        <LanguageProvider>
          <Routes>
            <Route path="/automations/:id" element={<><AutomationBuilderPage /><Lieu /><ChangerLangue /></>} />
            <Route path="/automations" element={<Lieu />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  await attendre();
}

function bouton(texte: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(texte));
}

function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('rien à cliquer');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

const lieu = () => container.querySelector('[data-testid="lieu"]')?.textContent ?? '';

/** Changer la valeur d'un champ comme l'utilisateur (setter natif). */
function saisir(el: Element | null | undefined, v: string) {
  if (!el) throw new Error('champ introuvable');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, v);
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}

/** Le bouton dont le texte est EXACTEMENT `texte`. */
function boutonExact(texte: string) {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === texte);
}

// ─── A-02 ───────────────────────────────────────────────────────

describe('A-02 — « Ajouter » ne touche pas une règle au format d’origine', () => {
  it('le bouton n’est pas offert : ajouter une étape abandonnerait les actions d’origine', async () => {
    etat.regles = [regle({
      steps: [],
      actions: [
        { type: 'send_sms', config: { body: 'Bonjour' } },
        { type: 'create_task', config: { title: 'Rappeler' } },
      ],
      is_active: true,
    })];
    await ouvrir(`/automations/${ID}`);
    expect(container.textContent).toContain('Parcours au format d’origine');
    expect(boutonExact('Ajouter')).toBeUndefined();
    expect(api.modifier).not.toHaveBeenCalled();
  });

  it('il reste offert sur un vrai parcours', async () => {
    await ouvrir(`/automations/${ID}`);
    expect(boutonExact('Ajouter')).toBeDefined();
  });
});

// ─── A-03 (écran) ───────────────────────────────────────────────

describe('A-03 — une automatisation publiée et cassée est dite comme telle', () => {
  it('le bandeau ne dit pas « avant de publier » : elle l’est déjà, et rien ne part correctement', async () => {
    etat.regles = [regle({
      trigger_event: 'invoice.sent', is_active: true,
      steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'envoyer_soumission', config: {} }, suivant: null }],
    })];
    await ouvrir(`/automations/${ID}`);
    const texte = container.textContent ?? '';
    expect(texte).not.toContain('à corriger avant de publier');
    expect(texte).toContain('Publiée mais cassée');
  });

  it('le refus du serveur au changement de déclencheur est affiché, et l’écran garde l’ancien', async () => {
    api.modifier.mockImplementation(async () => {
      throw new Error('Cette automatisation est publiée : cette modification l’empêcherait de fonctionner (…).');
    });
    etat.regles = [regle({ is_active: true })];
    await ouvrir(`/automations/${ID}`);
    cliquer(bouton('Quand'));
    await attendre();
    // Le tiroir ou le panneau du déclencheur : on passe par « Changer » au besoin.
    const changer = bouton('Changer');
    if (changer) cliquer(changer);
    await attendre();
    const choix = bouton('Nouveau prospect');
    expect(choix).toBeDefined();
    cliquer(choix);
    await attendre();
    expect(toasts.erreur.join('\n')).toContain('est publiée');
  });
});

// ─── A-04 ───────────────────────────────────────────────────────

/** Le bouton « retour » du navigateur : navigate(-1), hors de l'app. */
function RetourNavigateur() {
  const naviguer = useNavigate();
  return <button type="button" data-testid="retour-navigateur" onClick={() => naviguer(-1)}>retour</button>;
}

async function ouvrirAvecHistorique() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/automations', `/automations/${ID}`]} initialIndex={1}>
        <LanguageProvider>
          <Routes>
            <Route path="/automations/:id" element={<><AutomationBuilderPage /><RetourNavigateur /></>} />
            <Route path="/automations" element={<Lieu />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>,
    );
  });
  await attendre();
}

describe('A-04 — le bouton « retour » du navigateur ne perd pas le travail', () => {
  it('ce qui attendait l’enregistrement automatique part au départ', async () => {
    await ouvrirAvecHistorique();
    cliquer(bouton('Relance devis'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v3');
    api.modifier.mockClear();
    cliquer(container.querySelector('[data-testid="retour-navigateur"]'));
    await attendre();
    expect(lieu()).toBe('/automations');
    expect(api.modifier).toHaveBeenCalledWith(ID, expect.objectContaining({ name: 'Relance devis v3' }));
  });

  it('rien à enregistrer : aucune écriture au départ', async () => {
    await ouvrirAvecHistorique();
    cliquer(container.querySelector('[data-testid="retour-navigateur"]'));
    await attendre();
    expect(api.modifier).not.toHaveBeenCalled();
  });

  it('un échec au départ est dit', async () => {
    await ouvrirAvecHistorique();
    cliquer(bouton('Relance devis'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v4');
    api.modifier.mockImplementation(async () => { throw new Error('Serveur occupé'); });
    cliquer(container.querySelector('[data-testid="retour-navigateur"]'));
    await attendre();
    expect(toasts.erreur.join('\n')).toContain('n’ont pas pu être enregistrées');
  });
});

// ─── A-05 ───────────────────────────────────────────────────────

describe('A-05 — « Ajouter » (haut à droite) ajoute à la FIN du parcours', () => {
  it('pas au milieu, même quand l’ordre du tableau diffère de celui du parcours', async () => {
    // Parcours : Alpha → Alpha (copie) → si ; si oui → Delta → Bravo ; si non → Charlie.
    // La copie, créée après coup, est rangée en DERNIER dans le tableau.
    const sms = (body: string) => ({ type: 'send_sms', config: { body } });
    etat.regles = [regle({
      steps: [
        { id: 'e1', type: 'action', nom: 'Alpha', action: sms('a'), suivant: 'e6' },
        { id: 'e2', type: 'action', nom: 'Bravo', action: sms('b'), suivant: null },
        { id: 'e4', type: 'action', nom: 'Charlie', action: sms('c'), suivant: null },
        { id: 'e5', type: 'action', nom: 'Delta', action: sms('d'), suivant: 'e2' },
        { id: 'e3', type: 'si', conditions: { total_cents: { gt: 5000 } }, alors: 'e5', sinon: 'e4' },
        { id: 'e6', type: 'action', nom: 'Alpha (copie)', action: sms('a2'), suivant: 'e3' },
      ],
    })];
    await ouvrirAvecHistorique();
    cliquer(boutonExact('Ajouter'));
    cliquer(bouton('Créer une tâche'));
    await attendre();
    // Le départ enregistre ce qui attend (A-04) : on lit ce qui part au serveur.
    cliquer(container.querySelector('[data-testid="retour-navigateur"]'));
    await attendre();
    const envoye = api.modifier.mock.calls.at(-1)?.[1] as { steps: Array<Record<string, unknown>> };
    const par = new Map(envoye.steps.map((e) => [e.id as string, e]));
    const neuve = envoye.steps.find((e) => (e.action as { type?: string } | undefined)?.type === 'create_task');
    expect(neuve).toBeDefined();
    // La nouvelle étape suit Bravo (fin du chemin « si oui »), la copie pointe toujours vers la condition.
    expect(par.get('e2')?.suivant).toBe(neuve?.id);
    expect(par.get('e6')?.suivant).toBe('e3');
  });
});

// ─── A-12 ───────────────────────────────────────────────────────

describe('A-12 — un échec de l’enregistrement automatique est DIT, et les reprises s’espacent', () => {
  it('toast à la 1re panne, puis 2e essai après 6 s (pas toutes les 3 s)', async () => {
    await ouvrir(`/automations/${ID}`);
    vi.useFakeTimers();
    api.modifier.mockImplementation(async () => { throw new Error('Erreur serveur 500'); });
    cliquer(bouton('Relance devis'));
    saisir(container.querySelector('input[aria-label="Nom de l’automatisation"]'), 'Relance devis v5');
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(api.modifier).toHaveBeenCalledTimes(1);
    expect(toasts.erreur.join(' | ')).toContain('Erreur serveur 500');
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(api.modifier).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(3000); });
    await attendre();
    expect(api.modifier).toHaveBeenCalledTimes(2);
    // Au retour du serveur, l'enregistrement reprend et réussit.
    api.modifier.mockImplementation(async (id: string, patch: any) => ({ ...regle({ id }), ...patch }) as any);
    await act(async () => { vi.advanceTimersByTime(12_000); });
    await attendre();
    expect(api.modifier.mock.calls.at(-1)?.[1]).toMatchObject({ name: 'Relance devis v5' });
    expect(container.textContent).toContain('Enregistré');
  });
});

// ─── A-13 ───────────────────────────────────────────────────────

describe('A-13 — le menu d’une condition ne propose pas « Dupliquer l’action »', () => {
  it('pas d’entrée qui ne fait rien ; une action, elle, se duplique toujours', async () => {
    etat.regles = [regle({
      steps: [
        { id: 'e1', type: 'action', nom: 'Alpha', action: { type: 'send_sms', config: { body: 'a' } }, suivant: 'e2' },
        { id: 'e2', type: 'si', conditions: { total_cents: { gt: 5000 } }, alors: null, sinon: null },
      ],
    })];
    await ouvrir(`/automations/${ID}`);
    const options = Array.from(container.querySelectorAll('button[aria-label^="Options de l’étape"]'));
    expect(options).toHaveLength(2);
    cliquer(options[1]);
    expect(bouton('Dupliquer')).toBeUndefined();
    expect(bouton('Supprimer à partir d’ici')).toBeDefined();
    cliquer(container.querySelector('button[aria-label="Fermer le menu"]'));
    cliquer(options[0]);
    expect(bouton('Dupliquer l’action')).toBeDefined();
  });
});

// ─── A-15 (éditeur) ─────────────────────────────────────────────

describe('A-15 — éditeur : textes justes', () => {
  it('la confirmation de publication ne promet pas « de vrais messages » à une automatisation interne', async () => {
    etat.regles = [regle({
      steps: [{ id: 'e1', type: 'action', nom: null, action: { type: 'create_notification', config: { title: 'Nouveau devis' } }, suivant: null }],
    })];
    await ouvrir(`/automations/${ID}`);
    cliquer(container.querySelector('button[role="switch"]'));
    await attendre();
    expect(confirmerMock).toHaveBeenCalled();
    const message = String((confirmerMock.mock.calls[0][0] as { message: string }).message);
    expect(message).not.toContain('vrais messages à vos clients');
    expect(message).toContain('travail interne');
  });

  it('… mais le dit quand un message part au client', async () => {
    await ouvrir(`/automations/${ID}`);
    cliquer(container.querySelector('button[role="switch"]'));
    await attendre();
    const message = String((confirmerMock.mock.calls[0][0] as { message: string }).message);
    expect(message).toContain('vrais messages à vos clients');
  });

  it('l’aperçu nomme le destinataire (« Le propriétaire »), jamais la valeur brute', async () => {
    api.apercu.mockImplementationOnce(async () => ({
      client: null, message: 'x',
      apercu: [{ action: 'create_notification', nom: null, rendu: { title: 'Nouveau devis', destinataire: 'proprietaire' } }],
    }));
    await ouvrir(`/automations/${ID}`);
    cliquer(bouton('Aperçu'));
    await attendre();
    expect(container.textContent).toContain('Le propriétaire');
    expect(container.textContent).not.toMatch(/Pour qui\s*proprietaire/);
  });

  it('une étape technique (log_activity) est nommée, pas « Action »', async () => {
    etat.regles = [regle({
      steps: [],
      actions: [
        { type: 'send_sms', config: { body: 'Bonjour' } },
        { type: 'log_activity', config: { event_type: 'x' } },
      ],
    })];
    await ouvrir(`/automations/${ID}`);
    expect(container.textContent).toContain('Étape technique');
  });
});
