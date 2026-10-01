// @vitest-environment jsdom
/**
 * « Déplacer l'opportunité → Une étape précise » : l'étape visée se CHOISIT.
 *
 * Audit du 2026-10-01 (constat majeur, observé à l'écran) : « L'étape visée »
 * était un champ de texte libre où il fallait taper l'identifiant technique
 * de l'étape (un uuid). Personne ne le connaît : l'action était inutilisable
 * à la main. C'est maintenant le menu des étapes du bureau ; la valeur
 * enregistrée reste l'identifiant.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../src/components/ui/ConfirmDialog', () => ({ confirmer: vi.fn(async () => true), default: () => null }));
vi.mock('../../src/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ isEnabled: false, loading: false }) }));
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
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

import PanneauEtape from '../../src/components/automations/PanneauEtape';
import type { Etape } from '../../src/lib/sequenceTypes';
import { trouverAction } from '../../src/lib/automationCatalogue';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ETAPES = [
  { id: '11111111-1111-4111-8111-111111111111', label: 'Ventes · Soumission envoyée' },
  { id: '22222222-2222-4222-8222-222222222222', label: 'Ventes · Négociation' },
];

let conteneur: HTMLDivElement;
let racine: Root | null = null;
const enregistre = vi.fn();

async function monter(config: Record<string, string>, etapesPipeline = ETAPES) {
  const etape: Etape = { id: 'e1', type: 'action', action: { type: 'move_deal_stage', config }, suivant: null };
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    racine!.render(
      <QueryClientProvider client={qc}>
        <PanneauEtape
          etape={etape} fr declencheur="deal.stage_entered" membres={[]} etiquettes={[]} etapesPipeline={etapesPipeline}
          onEnregistrer={enregistre} onSupprimer={() => {}} onFermer={() => {}}
        />
      </QueryClientProvider>,
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
/** Le contrôle lié au libellé « L'étape visée ». */
function champEtapeVisee(): HTMLElement | null {
  const libelle = Array.from(conteneur.querySelectorAll('label')).find((l) => (l.textContent || '').includes('L’étape visée'));
  // `useId` produit des identifiants avec « : » : on lit par id, sans sélecteur CSS.
  return libelle?.htmlFor ? document.getElementById(libelle.htmlFor) : null;
}
const bouton = (motif: RegExp) => Array.from(conteneur.querySelectorAll('button')).find((b) => motif.test((b.textContent || '').trim()));

afterEach(async () => {
  enregistre.mockClear();
  if (racine) { await act(async () => racine!.unmount()); racine = null; }
  conteneur?.remove();
});

describe('« L’étape visée » d’un déplacement d’opportunité', () => {
  it('le catalogue la déclare comme un choix d’étape, pas comme un texte', () => {
    const champ = trouverAction('move_deal_stage')?.champs.find((c) => c.cle === 'stage_id');
    expect(champ?.type).toBe('etape_pipeline');
    expect(champ?.obligatoire).toBe(true);
  });

  it('c’est un MENU des étapes du bureau, par leur nom', async () => {
    await monter({ cible: 'etape' });
    const champ = champEtapeVisee();
    expect(champ?.tagName).toBe('SELECT');
    const options = Array.from((champ as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(['— Choisir une étape —', 'Ventes · Soumission envoyée', 'Ventes · Négociation']);
  });

  it('une étape déjà choisie est réaffichée par son nom', async () => {
    await monter({ cible: 'etape', stage_id: ETAPES[1].id });
    const champ = champEtapeVisee() as HTMLSelectElement;
    expect(champ.value).toBe(ETAPES[1].id);
    expect(champ.selectedOptions[0].textContent).toBe('Ventes · Négociation');
  });

  it('choisir une étape puis enregistrer : c’est son identifiant qui est enregistré', async () => {
    await monter({ cible: 'etape' });
    const champ = champEtapeVisee() as HTMLSelectElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(champ, ETAPES[0].id);
      champ.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { bouton(/^Enregistrer$/)!.click(); });
    expect(enregistre).toHaveBeenCalledTimes(1);
    const enregistree = enregistre.mock.calls[0][0] as Etape & { action: { config: Record<string, string> } };
    expect(enregistree.action.config.stage_id).toBe(ETAPES[0].id);
  });

  it('rien de choisi : on ne peut pas enregistrer, et le panneau dit quoi manque', async () => {
    await monter({ cible: 'etape' });
    expect(conteneur.textContent).toContain('« L’étape visée » est vide.');
    expect((bouton(/^Enregistrer$/) as HTMLButtonElement).disabled).toBe(true);
  });

  it('aucun pipeline dans le bureau : le panneau le dit et dit où en créer', async () => {
    await monter({ cible: 'etape' }, []);
    expect(conteneur.textContent).toContain('Aucune étape de pipeline. Créez-en dans Pipeline de ventes.');
  });

  it('une cible « Gagné » n’a pas besoin d’étape : le menu n’apparaît pas', async () => {
    await monter({ cible: 'gagne' });
    expect(champEtapeVisee()).toBeNull();
  });
});
