// @vitest-environment jsdom
/**
 * La fenêtre « Bibliothèque de modèles » (2026-09-30), rendue pour de vrai :
 * l'ouvrir ne fait que LIRE le catalogue ; recherche, filtre, tri, vue,
 * aperçu ; « Utiliser ce modèle » part une seule fois même sur un double clic.
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

function monter(props: Partial<Parameters<typeof BibliothequeModeles>[0]> = {}) {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const onCree = vi.fn();
  const onErreur = vi.fn();
  act(() => { racine!.render(<BibliothequeModeles open fr onClose={() => {}} onCree={onCree} onErreur={onErreur} {...props} />); });
  return { onCree, onErreur };
}

const texte = () => document.body.textContent ?? '';
const bouton = (re: RegExp) => [...document.querySelectorAll('button')].find((b) => re.test((b.textContent ?? '').trim()) || re.test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement;
const saisir = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v); // setter natif : React lit l'événement
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('Bibliothèque de modèles', () => {
  it('ouvrir la fenêtre ne fait que lire le catalogue', async () => {
    monter();
    await attendre();
    expect(api.lire).toHaveBeenCalledTimes(1);
    expect(api.utiliser).not.toHaveBeenCalled();
    expect(texte()).toContain(`Affichage de ${MODELES_AUTOMATISATION.length} modèles`);
  });

  it('recherche sans accents, filtre par catégorie, vide → réinitialiser', async () => {
    monter();
    await attendre();
    const recherche = document.querySelector('input[type="search"]') as HTMLInputElement;
    act(() => saisir(recherche, 'reengagement'));
    await attendre(260);
    expect(texte()).toContain('Réengagement — 90 jours');
    expect(texte()).not.toContain('Confirmation de rendez-vous');

    act(() => saisir(recherche, 'zzz introuvable'));
    await attendre(260);
    expect(texte()).toContain('Aucun modèle trouvé');
    act(() => bouton(/Réinitialiser les filtres/).click());
    await attendre(260);
    expect(texte()).toContain(`Affichage de ${MODELES_AUTOMATISATION.length} modèles`);

    const caseFacturation = [...document.querySelectorAll('label')].find((l) => /Facturation et paiements/.test(l.textContent ?? ''))!; // présente : catégorie non vide
    act(() => caseFacturation.click());
    await attendre();
    const n = MODELES_AUTOMATISATION.filter((m) => m.categorie === 'facturation').length;
    expect(texte()).toContain(`Affichage de ${n} modèles`);
  });

  it('bascule grille / liste', async () => {
    monter();
    await attendre();
    act(() => bouton(/^Liste$/).click());
    expect(document.querySelector('ul')).toBeTruthy();
    act(() => bouton(/^Grille$/).click());
    expect(document.querySelector('ul')).toBeFalsy();
  });

  it('aperçu puis « Utiliser ce modèle » : un seul appel, même sur un double clic', async () => {
    let fini: (v: unknown) => void = () => {};
    api.utiliser.mockReturnValue(new Promise((r) => { fini = r; }));
    const { onCree } = monter();
    await attendre();
    act(() => bouton(/Dépôt — demande et rappel/).click());
    expect(texte()).toContain('Déclencheur');
    expect(document.querySelector('mark')).toBeTruthy(); // variables en surbrillance
    const utiliser = bouton(/Utiliser ce modèle/);
    act(() => { utiliser.click(); utiliser.click(); });
    await attendre();
    expect(api.utiliser).toHaveBeenCalledTimes(1);
    expect(api.utiliser.mock.calls[0][0]).toBe('pack_depot');
    expect(bouton(/Utiliser ce modèle/).disabled).toBe(true);
    await act(async () => { fini({ id: 'r1' }); });
    expect(onCree).toHaveBeenCalledWith({ id: 'r1' });
  });

  it('erreur : message, la fenêtre reste ouverte et on peut réessayer', async () => {
    api.utiliser.mockRejectedValue(new Error('Votre rôle ne permet pas de créer une automatisation.'));
    const { onCree, onErreur } = monter();
    await attendre();
    act(() => bouton(/Dépôt — demande et rappel/).click());
    await act(async () => { bouton(/Utiliser ce modèle/).click(); });
    await attendre();
    expect(onErreur).toHaveBeenCalledWith('Votre rôle ne permet pas de créer une automatisation.');
    expect(onCree).not.toHaveBeenCalled();
    expect(bouton(/Utiliser ce modèle/).disabled).toBe(false);
  });

  it('retour de l’aperçu vers la liste', async () => {
    monter();
    await attendre();
    act(() => bouton(/Dépôt — demande et rappel/).click());
    act(() => bouton(/^Retour$/).click());
    expect(texte()).toContain('Tous les modèles');
  });
});
