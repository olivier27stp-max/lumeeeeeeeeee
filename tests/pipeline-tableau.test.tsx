// @vitest-environment jsdom
//
// La liste des pipelines, en tableau.
//
// Ce que ces tests protègent : le tableau a REMPLACÉ une liste de cartes qui
// savait renommer un pipeline et régler qui le voit. Un tableau plus fidèle
// à la capture mais qui perd ces deux gestes serait une régression, pas une
// refonte — le dépliage est donc testé comme le reste.
//
// Et deux garde-fous qui coûtent cher s'ils sautent : le pipeline par défaut
// ne s'offre pas à la suppression (les nouveaux leads n'auraient nulle part
// où atterrir), et une suppression passe toujours par une confirmation.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const supprimerMock = vi.fn(async () => {});
const confirmerMock = vi.fn(async (..._a: any[]) => true);

vi.mock('../src/lib/pipelineVentesApi', () => ({
  supprimerPipeline: (...a: any[]) => supprimerMock(...(a as [])),
}));

vi.mock('../src/components/ui/ConfirmDialog', () => ({
  confirmer: (...a: any[]) => confirmerMock(...(a as [])),
}));

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import PipelinesTableau from '../src/components/pipeline/PipelinesTableau';

const PIPELINES = [
  { id: 'p-1', name: 'Résidentiel', is_default: true, updated_at: '2026-09-20T14:30:00Z', nb_etapes: 6 },
  { id: 'p-2', name: 'Commercial', is_default: false, updated_at: '2026-09-22T09:00:00Z', nb_etapes: 4 },
];

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(props: Partial<React.ComponentProps<typeof PipelinesTableau>> = {}) {
  const complet = {
    pipelines: PIPELINES,
    pipelineActif: 'p-1',
    onChangement: vi.fn(),
    onOuvrir: vi.fn(),
    onDefaut: vi.fn(),
    detail: (p: any) => <div data-detail={p.id}>détail de {p.name}</div>,
    ...props,
  };
  await act(async () => {
    racine.render(<PipelinesTableau {...(complet as any)} />);
  });
  return complet;
}

/**
 * Un clic déclenche un `setState` : sans `act`, React ne l'a pas encore
 * rendu quand l'assertion suivante lit le DOM, et le test échoue sur un
 * écran qui, lui, marche.
 */
async function clic(el: Element | null | undefined) {
  if (!el) throw new Error('élément absent');
  await act(async () => { (el as HTMLElement).click(); });
}

/** Le « ⋮ » de la ligne portant ce nom. */
function menuDe(nom: string): HTMLButtonElement {
  const b = conteneur.querySelector<HTMLButtonElement>(`button[aria-label="Actions pour ${nom}"]`);
  if (!b) throw new Error(`menu introuvable pour ${nom}`);
  return b;
}

function optionsDuMenu(): string[] {
  return [...conteneur.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim() ?? '');
}

beforeEach(() => {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  vi.clearAllMocks();
  confirmerMock.mockResolvedValue(true);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
});

describe('colonnes', () => {
  it('affiche les en-têtes du tableau', async () => {
    await rendre();
    const entetes = [...conteneur.querySelectorAll('th')].map((e) => e.textContent?.trim());
    expect(entetes).toEqual(['#', 'Nom du pipeline', 'Étapes', 'Modifié le', 'Actions']);
  });

  it('numérote les lignes et montre le nombre d\'étapes de chacune', async () => {
    await rendre();
    const lignes = conteneur.querySelectorAll('tbody tr');
    expect(lignes).toHaveLength(2);

    const cellules1 = [...lignes[0].querySelectorAll('td')].map((c) => c.textContent?.trim());
    expect(cellules1[0]).toBe('1');
    expect(cellules1[1]).toContain('Résidentiel');
    expect(cellules1[2]).toBe('6');

    const cellules2 = [...lignes[1].querySelectorAll('td')].map((c) => c.textContent?.trim());
    expect(cellules2[0]).toBe('2');
    expect(cellules2[2]).toBe('4');
  });

  it('écrit un tiret plutôt qu\'un zéro quand le compte manque', async () => {
    // Un « 0 étape » affirme qu'il n'y en a aucune ; ici on ne sait pas.
    await rendre({
      pipelines: [{ id: 'p-9', name: 'Sans compte', is_default: false }] as any,
    });
    const cellules = [...conteneur.querySelectorAll('tbody td')].map((c) => c.textContent?.trim());
    expect(cellules[2]).toBe('—');
    expect(cellules[3]).toBe('—');
  });

  it('signale le pipeline par défaut', async () => {
    await rendre();
    const premiere = conteneur.querySelectorAll('tbody tr')[0];
    expect(premiere.textContent).toContain('Par défaut');
    expect(conteneur.querySelectorAll('tbody tr')[1].textContent).not.toContain('Par défaut');
  });
});

describe('actions de ligne', () => {
  it('le menu du pipeline par défaut n\'offre ni suppression ni « définir par défaut »', async () => {
    await rendre();
    await clic(menuDe('Résidentiel'));
    const options = optionsDuMenu();
    expect(options).toContain('Voir le board');
    expect(options).toContain('Renommer et partager');
    expect(options).not.toContain('Supprimer');
    expect(options).not.toContain('Définir par défaut');
  });

  it('un pipeline ordinaire peut être supprimé ou promu', async () => {
    await rendre();
    await clic(menuDe('Commercial'));
    const options = optionsDuMenu();
    expect(options).toContain('Définir par défaut');
    expect(options).toContain('Supprimer');
  });

  it('« Définir par défaut » remonte au parent, qui porte la confirmation', async () => {
    const props = await rendre();
    await clic(menuDe('Commercial'));
    await clic([...conteneur.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.includes('Définir par défaut')));
    expect(props.onDefaut).toHaveBeenCalledWith('p-2');
  });

  it('une suppression demande confirmation avant d\'appeler la base', async () => {
    const props = await rendre();
    await clic(menuDe('Commercial'));
    await clic([...conteneur.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === 'Supprimer'));
    expect(confirmerMock).toHaveBeenCalledTimes(1);
    expect(confirmerMock.mock.calls[0][0]).toMatchObject({ danger: true });
    expect(supprimerMock).toHaveBeenCalledWith('p-2');
    expect(props.onChangement).toHaveBeenCalled();
  });

  it('un refus de confirmation ne supprime rien', async () => {
    confirmerMock.mockResolvedValue(false);
    const props = await rendre();
    await clic(menuDe('Commercial'));
    await clic([...conteneur.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent === 'Supprimer'));
    expect(supprimerMock).not.toHaveBeenCalled();
    expect(props.onChangement).not.toHaveBeenCalled();
  });

  it('cliquer le nom ouvre le board sur ce pipeline', async () => {
    const props = await rendre();
    const lien = [...conteneur.querySelectorAll('tbody button')].find((b) => b.textContent?.trim() === 'Commercial');
    await clic(lien);
    expect(props.onOuvrir).toHaveBeenCalledWith('p-2');
  });
});

describe('dépliage — ce que le tableau ne doit pas perdre', () => {
  it('le détail est replié au départ', async () => {
    await rendre();
    expect(conteneur.querySelector('[data-detail]')).toBeNull();
  });

  it('le chevron déplie le renommage et le partage de CE pipeline', async () => {
    await rendre();
    await clic(conteneur.querySelector('button[aria-label="Réglages de Commercial"]'));
    const detail = conteneur.querySelector('[data-detail]');
    expect(detail?.getAttribute('data-detail')).toBe('p-2');
    expect(detail?.textContent).toContain('Commercial');
  });

  it('un seul détail à la fois, et le chevron le referme', async () => {
    await rendre();
    await clic(conteneur.querySelector('button[aria-label="Réglages de Commercial"]'));
    await clic(conteneur.querySelector('button[aria-label="Réglages de Résidentiel"]'));
    expect(conteneur.querySelectorAll('[data-detail]')).toHaveLength(1);
    expect(conteneur.querySelector('[data-detail]')?.getAttribute('data-detail')).toBe('p-1');

    await clic(conteneur.querySelector('button[aria-label="Réglages de Résidentiel"]'));
    expect(conteneur.querySelector('[data-detail]')).toBeNull();
  });

  it('« Renommer et partager » du menu déplie la même chose', async () => {
    await rendre();
    await clic(menuDe('Commercial'));
    await clic([...conteneur.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent?.includes('Renommer')));
    expect(conteneur.querySelector('[data-detail]')?.getAttribute('data-detail')).toBe('p-2');
  });
});

describe('recherche et pagination', () => {
  it('pas de champ de recherche sous quatre pipelines', async () => {
    await rendre();
    expect(conteneur.querySelector('input[type="search"]')).toBeNull();
  });

  it('la recherche filtre les lignes', async () => {
    const beaucoup = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((n, i) => ({
      id: `p-${i}`, name: n, is_default: i === 0, nb_etapes: 3,
    }));
    await rendre({ pipelines: beaucoup as any });

    const champ = conteneur.querySelector<HTMLInputElement>('input[type="search"]');
    expect(champ).not.toBeNull();

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(champ, 'brav');
      champ!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const lignes = conteneur.querySelectorAll('tbody tr');
    expect(lignes).toHaveLength(1);
    expect(lignes[0].textContent).toContain('Bravo');
  });

  it('dit quand rien ne correspond', async () => {
    const beaucoup = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((n, i) => ({
      id: `p-${i}`, name: n, is_default: false, nb_etapes: 3,
    }));
    await rendre({ pipelines: beaucoup as any });
    const champ = conteneur.querySelector<HTMLInputElement>('input[type="search"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(champ, 'zzz');
      champ!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(conteneur.textContent).toContain('Aucun pipeline ne correspond');
  });

  it('pas de pagination tant qu\'une seule page suffit', async () => {
    await rendre();
    expect(conteneur.textContent).not.toContain('Page 1');
  });

  it('pagine au-delà de vingt pipelines', async () => {
    const vingtcinq = Array.from({ length: 25 }, (_, i) => ({
      id: `p-${i}`, name: `Pipeline ${i}`, is_default: i === 0, nb_etapes: 3,
    }));
    await rendre({ pipelines: vingtcinq as any });

    expect(conteneur.querySelectorAll('tbody tr')).toHaveLength(20);
    expect(conteneur.textContent).toContain('Page 1 sur 2');

    const suivant = [...conteneur.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Suivant');
    await clic(suivant);

    expect(conteneur.querySelectorAll('tbody tr')).toHaveLength(5);
    // La numérotation continue : la 21e ligne s'appelle 21, pas 1.
    expect(conteneur.querySelector('tbody td')?.textContent?.trim()).toBe('21');
  });
});
