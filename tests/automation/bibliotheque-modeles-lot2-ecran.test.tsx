// @vitest-environment jsdom
/**
 * Bibliothèque de modèles — constats de l'audit UI du 2026-10-01 (lot 2),
 * prouvés sur la VRAIE fenêtre rendue en jsdom ; seule l'API est simulée, et
 * elle sert le vrai catalogue du serveur.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const api = vi.hoisted(() => ({
  lire: vi.fn(),
  utiliser: vi.fn(),
}));
vi.mock('../../src/i18n', () => ({ useTranslation: () => ({ t: { common: { close: 'Fermer' } }, language: 'fr' }) }));
vi.mock('../../src/lib/automationBuilderApi', () => ({
  fetchModelesAutomatisation: api.lire,
  utiliserModele: api.utiliser,
}));

import BibliothequeModeles from '../../src/components/automations/BibliothequeModeles';
import { MODELES_AUTOMATISATION } from '../../server/lib/automationTemplates';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLDivElement;
const attendre = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  api.lire.mockReset().mockResolvedValue(MODELES_AUTOMATISATION);
  api.utiliser.mockReset();
});
afterEach(() => { act(() => racine?.unmount()); conteneur?.remove(); racine = null; });

async function monter(fr = true) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => { racine!.render(<BibliothequeModeles open fr={fr} onClose={() => {}} onCree={() => {}} onErreur={() => {}} />); });
  await attendre();
}

const fenetre = () => document.querySelector('[role="dialog"]') as HTMLElement;
const bouton = (re: RegExp) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent ?? '').trim()) || re.test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement;
/** Un vrai clic pose d'abord le focus sur le bouton : jsdom ne le fait pas tout seul. */
const cliquer = (b: HTMLElement) => act(() => { b.focus(); b.click(); });

describe('modeles-04 — le focus suit l’aperçu', () => {
  it('à l’ouverture de l’aperçu, le focus est sur le titre du modèle, dans la fenêtre', async () => {
    await monter();
    cliquer(bouton(/Prospect — Bienvenue/));
    const actif = document.activeElement as HTMLElement;
    expect(actif).not.toBe(document.body);
    expect(fenetre().contains(actif)).toBe(true);
    expect(actif.tagName).toBe('H3');
    expect(actif.textContent).toBe('Prospect — Bienvenue');
    expect(actif.getAttribute('tabindex')).toBe('-1');
  });

  it('« Retour » rend le focus à la carte du modèle qu’on regardait', async () => {
    await monter();
    cliquer(bouton(/Prospect — Bienvenue/));
    cliquer(bouton(/^Retour$/));
    const actif = document.activeElement as HTMLElement;
    expect(actif.tagName).toBe('BUTTON');
    expect(actif.textContent).toContain('Prospect — Bienvenue');
  });

  it('en vue liste aussi, le focus revient sur la ligne du modèle', async () => {
    await monter();
    cliquer(bouton(/^Liste$/));
    cliquer(bouton(/Contrat signé/));
    expect((document.activeElement as HTMLElement).tagName).toBe('H3');
    cliquer(bouton(/^Retour$/));
    expect((document.activeElement as HTMLElement).textContent).toContain('Contrat signé');
  });
});

const caseDe = (re: RegExp) => {
  const etiquette = [...document.querySelectorAll('label')].find((l) => re.test(l.textContent ?? ''));
  return etiquette ? document.getElementById(etiquette.htmlFor) as HTMLInputElement : null;
};
const compteur = () => (document.querySelector('[aria-live="polite"]')?.textContent ?? '').trim();

describe('modeles-05 — une catégorie cochée reste visible', () => {
  it('« Pipeline / leads » cochée puis « Afficher moins » : la case reste là, cochée', async () => {
    await monter();
    expect(caseDe(/Pipeline \/ leads/)).toBeNull(); // dans la seconde partie de la liste
    cliquer(bouton(/^Afficher plus$/));
    cliquer(caseDe(/Pipeline \/ leads/)!); // présente : la liste est dépliée
    const n = MODELES_AUTOMATISATION.filter((m) => m.categorie === 'pipeline').length;
    expect(compteur()).toBe(`Affichage de ${n} modèles`);

    cliquer(bouton(/^Afficher moins$/));
    expect(compteur()).toBe(`Affichage de ${n} modèles`); // le filtre tient toujours
    const restee = caseDe(/Pipeline \/ leads/);
    expect(restee, 'la case qui filtre encore a disparu').not.toBeNull();
    expect(restee!.checked).toBe(true);
    // L'autre catégorie de la seconde partie, non cochée, est bien repliée.
    expect(caseDe(/Relance \/ réactivation de clients/)).toBeNull();

    // Décochée, elle n'a plus de raison de rester : la liste repliée revient à ses cinq cases.
    cliquer(restee!);
    expect(caseDe(/Pipeline \/ leads/)).toBeNull();
    expect(compteur()).toBe(`Affichage de ${MODELES_AUTOMATISATION.length} modèles`);
  });
});
