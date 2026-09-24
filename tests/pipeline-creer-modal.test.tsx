// @vitest-environment jsdom
//
// Le modal « Créer un pipeline ».
//
// Ce que ces tests protègent : un pipeline qu'on ne peut pas TERMINER casse
// le taux de closing, le badge « Job à créer » et la raison de perte. Les
// étapes gagnée et perdue sont donc proposées d'emblée, et la base les
// rajoute si l'utilisateur les retire — l'écran ne doit jamais le laisser
// croire résolu autrement.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const creerMock = vi.fn(async () => 'p-neuf');

vi.mock('../src/lib/pipelineVentesApi', () => ({
  creerPipelineSurMesure: (...a: any[]) => creerMock(...(a as [])),
}));

vi.mock('../src/i18n', () => ({
  useTranslation: () => ({ language: 'fr', t: { common: { close: 'Fermer' } } }),
}));

import CreerPipelineModal from '../src/components/pipeline/CreerPipelineModal';

let conteneur: HTMLDivElement;
let racine: ReturnType<typeof createRoot>;

async function rendre(onCree = vi.fn()) {
  await act(async () => {
    racine.render(
      <CreerPipelineModal ouvert onFermer={vi.fn()} onCree={onCree} />,
    );
  });
}

/** React ignore une écriture directe de `value` : il faut son setter natif. */
function saisir(el: HTMLInputElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, valeur);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function champNomme(motif: RegExp): HTMLInputElement | undefined {
  return [...document.querySelectorAll('input')]
    .find((i) => motif.test(i.getAttribute('aria-label') ?? '')) as HTMLInputElement | undefined;
}

function boutonNomme(motif: RegExp): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')]
    .find((b) => motif.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  creerMock.mockClear().mockResolvedValue('p-neuf');
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});

afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
  document.body.innerHTML = '';
});

describe('créer un pipeline', () => {
  it('propose un parcours complet au départ, gagné et perdu compris', async () => {
    await rendre();
    // Les noms d'étapes vivent dans la `value` des champs, pas dans le
    // texte de la page : un `textContent` ne les voit pas.
    const noms = [...document.querySelectorAll('input')]
      .filter((i) => /Nom de l/.test(i.getAttribute('aria-label') ?? ''))
      .map((i) => (i as HTMLInputElement).value);
    // Un écran vide obligerait à deviner ce qu'est un pipeline.
    expect(noms).toContain('Nouveau lead');
    expect(noms).toContain('Gagné');
    expect(noms).toContain('Perdu');
  });

  it('refuse de créer tant que le nom est vide', async () => {
    await rendre();
    const creer = [...document.querySelectorAll('button')]
      .find((b) => b.getAttribute('type') === 'submit') as HTMLButtonElement;
    expect(creer.disabled).toBe(true);
  });

  it('envoie le nom et les étapes avec leurs probabilités', async () => {
    await rendre();
    const nom = [...document.querySelectorAll('input')]
      .find((i) => i.type === 'text' && !i.getAttribute('aria-label')) as HTMLInputElement;
    await act(async () => { saisir(nom, 'Contrats saisonniers'); });

    const creer = [...document.querySelectorAll('button')]
      .find((b) => b.getAttribute('type') === 'submit') as HTMLButtonElement;
    await act(async () => { creer.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(creerMock).toHaveBeenCalledTimes(1);
    const [nomEnvoye, etapes] = creerMock.mock.calls[0] as any[];
    expect(nomEnvoye).toBe('Contrats saisonniers');
    expect(etapes.length).toBeGreaterThanOrEqual(5);
    // Gagné vaut 100 %, perdu 0 % : des faits, pas des estimations.
    expect(etapes.find((e: any) => e.kind === 'won').probability).toBe(100);
    expect(etapes.find((e: any) => e.kind === 'lost').probability).toBe(0);
  });

  it("n'envoie pas les étapes laissées sans nom", async () => {
    await rendre();
    const nom = [...document.querySelectorAll('input')]
      .find((i) => i.type === 'text' && !i.getAttribute('aria-label')) as HTMLInputElement;
    await act(async () => { saisir(nom, 'Test'); });

    // Ajouter une ligne et la laisser vide : elle ne doit pas partir.
    await act(async () => { boutonNomme(/Ajouter une étape/)!.click(); });
    const avant = [...document.querySelectorAll('input')].filter((i) => /Nom de l/.test(i.getAttribute('aria-label') ?? '')).length;
    expect(avant).toBeGreaterThan(5);

    const creer = [...document.querySelectorAll('button')]
      .find((b) => b.getAttribute('type') === 'submit') as HTMLButtonElement;
    await act(async () => { creer.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const [, etapes] = creerMock.mock.calls[0] as any[];
    expect(etapes.every((e: any) => e.nom_fr.trim() !== '')).toBe(true);
  });

  it('la probabilité se fige quand on passe une étape en gagné', async () => {
    await rendre();
    const sel = [...document.querySelectorAll('select')][0] as HTMLSelectElement;
    await act(async () => {
      sel.value = 'won';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const proba = champNomme(/Probabilité de l'étape 1/);
    expect(proba?.value).toBe('100');
    // Non modifiable : ce n'est pas une estimation.
    expect(proba?.disabled).toBe(true);
  });

  it('dit que les étapes terminales seront ajoutées si elles manquent', async () => {
    await rendre();
    expect(document.body.textContent).toContain('elles sont ajoutées');
  });
});
