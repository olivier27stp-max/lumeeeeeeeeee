/**
 * Tout flux SSE ouvert doit être fermé (incident 2026-09-22).
 *
 * `ouvrirSse(res)` met la réponse en `text/event-stream` : tant que le serveur
 * n'appelle pas `res.end()`, le navigateur attend la suite. Symptôme côté
 * utilisateur : la roue tourne à l'infini et il faut RECHARGER LA PAGE pour
 * poser un deuxième message.
 *
 * C'est arrivé en ajoutant l'étage « aide » à `/api/lumi/chat` : le bloc
 * envoyait bien la réponse puis faisait un simple `return` au lieu de
 * `return res.end()`. Tous les autres étages sans modèle (raccourcis, actions
 * directes, caches) finissaient déjà correctement — celui-là était le seul
 * oubli, et rien ne l'attrapait.
 *
 * Test STATIQUE sur la source : `ouvrirSse` est privée au module, on ne peut
 * pas la piloter depuis un test unitaire. On vérifie donc que chaque bloc qui
 * l'appelle contient bien un `res.end()` avant de rendre la main.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(ici, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
const lignes = source.split(/\r?\n/);

/** Index (0-based) de chaque ligne qui ouvre un flux SSE. */
const ouvertures = lignes
  .map((l, i) => ({ l, i }))
  .filter(({ l }) => /ouvrirSse\(res\)/.test(l))
  .map(({ i }) => i);

describe('flux SSE de /api/lumi/chat', () => {
  it('le fichier ouvre bien des flux SSE (le test porte sur quelque chose)', () => {
    expect(ouvertures.length).toBeGreaterThan(5);
  });

  /**
   * Après une ouverture, on cherche un `res.end()` avant la fin du bloc.
   * La fenêtre doit être large : `executerTourSse` (l'étage agent) ouvre son
   * flux au début d'une fonction de ~130 lignes et ne le ferme qu'à la fin.
   * 200 lignes couvrent le plus long cas sans rendre le test complaisant —
   * mesuré : le bug réel (un `return` nu à 9 lignes de l'ouverture) est
   * attrapé par le second test, plus précis.
   */
  it('chaque flux ouvert est fermé par res.end()', () => {
    const manquants: number[] = [];
    for (const i of ouvertures) {
      const fenetre = lignes.slice(i, i + 200).join('\n');
      if (!/res\.end\(\)/.test(fenetre)) manquants.push(i + 1);
    }
    expect(
      manquants,
      `Flux SSE ouvert sans res.end() aux lignes : ${manquants.join(', ')}.\n`
      + 'Sans fermeture, la roue tourne à l\'infini côté navigateur et\n'
      + 'l\'utilisateur doit recharger la page pour poser un autre message.',
    ).toEqual([]);
  });

  it('aucun `return;` nu juste après un envoi SSE (il faut `return res.end()`)', () => {
    const fautifs: number[] = [];
    for (const i of ouvertures) {
      const fenetre = lignes.slice(i, i + 60);
      const finBloc = fenetre.findIndex((l) => /^\s*return\s*;\s*$/.test(l));
      const finPropre = fenetre.findIndex((l) => /return res\.end\(\)/.test(l));
      // Un `return;` nu qui arrive AVANT le premier `return res.end()` ferme le
      // bloc sans fermer le flux : c'est exactement le bug du 2026-09-22.
      if (finBloc !== -1 && (finPropre === -1 || finBloc < finPropre)) fautifs.push(i + 1 + finBloc);
    }
    expect(fautifs, `\`return;\` nu après un envoi SSE aux lignes : ${fautifs.join(', ')}`).toEqual([]);
  });
});
