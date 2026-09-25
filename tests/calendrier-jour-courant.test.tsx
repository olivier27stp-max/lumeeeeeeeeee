// @vitest-environment jsdom
//
// Le jour d'aujourd'hui, dans le calendrier rendu.
//
// Le défaut : la colonne du jour portait un fond à 2 % d'opacité. Comme
// `--color-primary` est NOIR dans le thème clair, ça donnait du noir à 2 % —
// invisible. La pastille de date, elle, utilisait un beige fixe (#d8d0c2),
// illisible en thème sombre.
//
// Rien de tout ça n'apparaît dans une requête à la base : les bonnes dates
// étaient calculées, le bon jour était marqué `today`. Seul le rendu le dit.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/contexts/LanguageContext', () => ({
  useLanguage: () => ({ language: 'fr', t: {} }),
}));

let conteneur: HTMLDivElement;

beforeEach(() => {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
});

afterEach(() => {
  conteneur.remove();
  vi.restoreAllMocks();
});

/** Rend la vue mois et renvoie la case du jour, repérée par son numéro. */
async function rendreMois() {
  const { default: MonthlyDispatchView } = await import('../src/components/dispatch-monthly/MonthlyDispatchView');
  const racine = createRoot(conteneur);
  await act(async () => {
    racine.render(
      React.createElement(MonthlyDispatchView, {
        date: new Date(),
        events: [],
        teams: [],
        onDayClick: () => {},
        onEventClick: () => {},
      }),
    );
  });
  return racine;
}

describe('la case du jour se distingue des autres', () => {
  it('porte un contour, pas seulement un voile', async () => {
    // Le voile seul (2 % de noir) ne se voyait pas. Le contour, si.
    const racine = await rendreMois();
    const marquees = conteneur.querySelectorAll('[class*="ring-primary"]');
    expect(marquees.length, 'la case du jour doit être cernée').toBeGreaterThan(0);
    await act(async () => racine.unmount());
  });

  it('n’utilise plus le beige fixe, illisible en thème sombre', async () => {
    // #d8d0c2 est une couleur de marque (bouton « Nouvelle job ») : elle n'a
    // rien à faire dans un repère qui doit suivre le thème.
    const racine = await rendreMois();
    expect(conteneur.innerHTML).not.toContain('d8d0c2');
    await act(async () => racine.unmount());
  });

  it('le voile du jour est assez dense pour se voir', async () => {
    // 2 % était invisible ; on exige au moins 5 %.
    const racine = await rendreMois();
    const avecVoile = conteneur.querySelector('[class*="bg-primary/["]');
    expect(avecVoile, 'le jour doit porter un voile').not.toBeNull();
    const classes = avecVoile!.className;
    const m = /bg-primary\/\[0\.(\d+)\]/.exec(classes);
    expect(m, `classe inattendue : ${classes}`).not.toBeNull();
    expect(Number(`0.${m![1]}`)).toBeGreaterThanOrEqual(0.05);
    await act(async () => racine.unmount());
  });

  it('la pastille de date est en couleur du thème, texte contrasté', async () => {
    // `bg-primary` + `text-primary-foreground` : noir sur blanc en thème
    // clair, blanc sur noir en sombre. Le beige fixe ne s'inversait pas.
    const racine = await rendreMois();
    const pastille = conteneur.querySelector('[class*="bg-primary"][class*="text-primary-foreground"]');
    expect(pastille, 'la date du jour doit être une pastille pleine').not.toBeNull();
    await act(async () => racine.unmount());
  });
});
