// @vitest-environment jsdom
/**
 * LE PANNEAU DU DÉCLENCHEUR — corrections du triage « déclencheurs »
 * (2026-10-01), côté COMPOSANT : le vrai `PanneauDeclencheur`, monté seul.
 * Un bloc `describe` par ligne du triage.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: true, loading: false }) }));
vi.mock('../../../src/lib/reservationApi', () => ({ apercuClientsInactifs: async () => 3 }));
vi.mock('../../../src/lib/supabase', () => {
  const chaine: unknown = new Proxy(function () {}, {
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
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

import PanneauDeclencheur from '../../../src/components/automations/PanneauDeclencheur';
import { trouverDeclencheur } from '../../../src/lib/automationCatalogue';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Proprietes = Partial<React.ComponentProps<typeof PanneauDeclencheur>>;

let conteneur: HTMLDivElement;
let racine: Root | null = null;
/** Ce que « Enregistrer » a renvoyé au parent : les conditions. */
let enregistrees: Array<Record<string, unknown>> = [];
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

async function monter(cle: string, conditions: Record<string, unknown>, props: Proprietes = {}) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(
      <QueryClientProvider client={qc}>
        <PanneauDeclencheur
          declencheur={trouverDeclencheur(cle)!} conditions={conditions} fr champsDate={[{ id: 'd1', label: 'Fin de contrat' }]}
          onEnregistrer={(c) => { enregistrees.push(c); }} onFermer={() => {}}
          {...props}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => { enregistrees = []; });
afterEach(async () => {
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

const texte = () => conteneur.textContent || '';
/** Le refus écrit dans le panneau (« » quand il n'y en a pas). Le bouton reste cliquable : c'est le clic qui ne part pas. */
const refus = () => conteneur.querySelector('[role="alert"]')?.textContent ?? '';
const bouton = (t: string) => Array.from(conteneur.querySelectorAll('button')).find((b) => b.textContent?.trim() === t);
const enregistrer = () => (bouton('Enregistrer') ?? bouton('Save'))!;
function cliquer(el: Element | undefined | null) {
  if (!el) throw new Error('rien à cliquer');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
function champ(libelle: string): HTMLInputElement {
  const etiquette = Array.from(conteneur.querySelectorAll('label')).find((l) => (l.textContent ?? '').startsWith(libelle));
  const el = etiquette?.getAttribute('for') ? conteneur.querySelector<HTMLInputElement>(`[id="${etiquette.getAttribute('for')}"]`) : null;
  if (!el) throw new Error(`champ « ${libelle} » introuvable`);
  return el;
}
function saisir(el: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, v);
  act(() => { el.dispatchEvent(new Event('input', { bubbles: true })); });
}

// ─── 03-panneau-declencheur:316 ─────────────────────────────────

describe('03:316 — « Devis ouvert par le client » : une plage de montants impossible, ou un montant négatif, est refusée dans le panneau', () => {
  const PLAGE = '« Montant minimum ($) » est plus grand que « Montant maximum ($) » : rien ne peut remplir les deux, l’automatisation ne partirait jamais.';

  it('minimum 5 000 $, maximum 100 $ : le refus est écrit dans le panneau, et « Enregistrer » n’envoie rien', async () => {
    await monter('quote.viewed', { ouverture: 'premiere' });
    expect(refus()).toBe('');
    saisir(champ('Montant minimum ($)'), '5000');
    expect(refus()).toBe('');
    saisir(champ('Montant maximum ($)'), '100');
    expect(refus()).not.toBe('');
    expect(refus()).toBe(`À corriger avant d’enregistrer :${PLAGE}`);
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('… corriger le maximum lève le refus : la plage part en NOMBRES', async () => {
    await monter('quote.viewed', { ouverture: 'premiere' });
    saisir(champ('Montant minimum ($)'), '5000');
    saisir(champ('Montant maximum ($)'), '100');
    saisir(champ('Montant maximum ($)'), '8000');
    expect(conteneur.querySelector('[role="alert"]')).toBeNull();
    cliquer(enregistrer());
    expect(enregistrees).toEqual([{ ouverture: 'premiere', montant__gte: 5000, montant__lte: 8000 }]);
  });

  it('un minimum de -5 $ : refusé (« au moins 0 »)', async () => {
    await monter('quote.viewed', { ouverture: 'premiere' });
    saisir(champ('Montant minimum ($)'), '-5');
    expect(refus()).not.toBe('');
    expect(texte()).toContain('« Montant minimum ($) » doit être au moins 0.');
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('minimum = maximum, un seul des deux, « 1250.50 », aucun : acceptés', async () => {
    await monter('quote.viewed', { ouverture: 'premiere' });
    saisir(champ('Montant minimum ($)'), '500');
    saisir(champ('Montant maximum ($)'), '500');
    expect(refus()).toBe('');
    saisir(champ('Montant maximum ($)'), '');
    saisir(champ('Montant minimum ($)'), '1250.50');
    expect(refus()).toBe('');
    cliquer(enregistrer());
    expect(enregistrees).toEqual([{ ouverture: 'premiere', montant__gte: 1250.5 }]);
  });

  it('une plage impossible DÉJÀ en base (posée avant cette règle) : le panneau la montre et la signale à l’ouverture', async () => {
    await monter('quote.viewed', { montant__gte: 5000, montant__lte: 100 });
    expect(champ('Montant minimum ($)').value).toBe('5000');
    expect(refus()).toBe(`À corriger avant d’enregistrer :${PLAGE}`);
  });

  it('en anglais', async () => {
    await monter('quote.viewed', {}, { fr: false });
    saisir(champ('Minimum amount ($)'), '5000');
    saisir(champ('Maximum amount ($)'), '100');
    expect(refus()).not.toBe('');
    expect(texte()).toContain('“Minimum amount ($)” is greater than “Maximum amount ($)”: nothing can meet both, the automation would never run.');
  });
});

// ─── 03-panneau-declencheur:581 ─────────────────────────────────

describe('03:581 — « Client inactif » : 0, 61 ou 2,5 mois sont refusés, avec les bornes', () => {
  const MOIS = 'Aucun job terminé depuis (mois)';

  it.each(['0', '61', '2.5', '-3'])('« %s » mois : « Enregistrer » est refusé, « entier, entre 1 et 60 » est dit, rien ne part', async (faux) => {
    await monter('client.inactive', { mois: 6, max_par_heure: 25 });
    saisir(champ(MOIS), faux);
    expect(refus()).not.toBe('');
    expect(texte()).toContain(`« ${MOIS} » doit être un nombre entier, entre 1 et 60.`);
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('1, 12 et 60 mois : acceptés ; 12 part en nombre', async () => {
    await monter('client.inactive', { mois: 6, max_par_heure: 25 });
    for (const v of ['1', '60', '12']) {
      saisir(champ(MOIS), v);
      expect(refus(), v).toBe('');
    }
    cliquer(enregistrer());
    expect(enregistrees).toEqual([{ mois: 12, max_par_heure: 25 }]);
  });

  it('« Au plus, par heure » : 0, 1001 et 2,5 refusés aussi', async () => {
    await monter('client.inactive', { mois: 6, max_par_heure: 25 });
    for (const faux of ['0', '1001', '2.5']) {
      saisir(champ('Au plus, par heure'), faux);
      expect(refus(), faux).not.toBe('');
      expect(texte(), faux).toContain('« Au plus, par heure » doit être un nombre entier, entre 1 et 1000.');
    }
  });

  it('le champ vidé reste l’avertissement d’avant (« ne partirait jamais »), pas un refus', async () => {
    await monter('client.inactive', { mois: 6, max_par_heure: 25 });
    saisir(champ(MOIS), '');
    expect(texte()).toContain(`Sans « ${MOIS} », l’automatisation ne partirait jamais.`);
    expect(conteneur.querySelector('[role="alert"]')).toBeNull();
  });
});

// ─── Règle générale (précision 2 du coordinateur) ───────────────

describe('« Combien de jours avant » : hors de -365..365 ou pas entier → refusé DANS le panneau, avant tout envoi', () => {
  const JOURS = 'Combien de jours avant';

  it.each(['9999', '-366', '3.5'])('« %s » : « Enregistrer » est refusé, « entre -365 et 365 » est dit', async (faux) => {
    await monter('date.reached', { champ_id: 'd1' });
    saisir(champ(JOURS), faux);
    expect(refus()).not.toBe('');
    expect(texte()).toContain(`« ${JOURS} » doit être un nombre entier, entre -365 et 365.`);
    cliquer(enregistrer());
    expect(enregistrees).toEqual([]);
  });

  it('0, -7 et 365 : acceptés', async () => {
    await monter('date.reached', { champ_id: 'd1' });
    for (const v of ['0', '365', '-7']) {
      saisir(champ(JOURS), v);
      expect(refus(), v).toBe('');
    }
    cliquer(enregistrer());
    expect(enregistrees).toEqual([{ champ_id: 'd1', jours_avant: -7 }]);
  });
});
