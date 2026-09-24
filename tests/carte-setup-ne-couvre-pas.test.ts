// @vitest-environment jsdom
//
// LA CARTE SETUP NE DOIT COUVRIR AUCUN BOUTON D'ACTION.
//
// C'est le même bug, trouvé trois fois, toujours de la même façon : une
// carte `fixed bottom-4 … right-4` se pose dans le coin bas-droit, pile où
// vivent les boutons qui comptent. Le clic part dans la carte. Rien
// n'échoue, rien ne s'affiche — l'action n'a simplement pas lieu.
//
//   · 2026-09-09 : /clients/new, /quotes/new, /settings/company, /finances
//     — « Save Client » expirait sur téléphone.
//   · 2026-09-24 : /automations — le menu « … » d'une ligne n'ouvrait rien,
//     donc aucune automatisation ne pouvait être modifiée, dupliquée ou
//     supprimée. Mesuré dans un vrai navigateur avec `elementFromPoint` au
//     centre du bouton : il renvoyait un bouton de la carte Setup.
//
// La carte ne s'affiche que sur les comptes NEUFS, ce qui explique que
// personne ne l'ait signalé : les comptes de test l'avaient déjà fermée.
//
// Ce fichier fige la liste. L'ajout d'une page à boutons d'action en bas à
// droite doit s'accompagner d'une ligne ici.

import { describe, it, expect } from 'vitest';
import { routeAvecBarreDAction } from '../src/components/SetupChecklist';

describe('les pages où la carte Setup doit s’effacer', () => {
  const COUVERTES = [
    ['/clients/new', 'formulaire : barre « Enregistrer » ancrée en bas'],
    ['/clients/abc/edit', 'idem, en modification'],
    ['/quotes/new', 'idem'],
    ['/settings/company', 'réglages : barre d’action en bas'],
    ['/settings', 'tous les réglages'],
    ['/finances', 'pagination en bas de page'],
    ['/checkout', 'le paiement ne souffre aucun recouvrement'],
    ['/automations', 'menu « … » de chaque ligne, en bas à droite'],
    ['/automations/reglages', 'sous-page des réglages'],
  ] as const;

  for (const [chemin, pourquoi] of COUVERTES) {
    it(`${chemin} — ${pourquoi}`, () => {
      expect(routeAvecBarreDAction(chemin)).toBe(true);
    });
  }

  it('les pages de lecture la gardent — c’est son utilité', () => {
    /*
     * Le but n'est pas de faire disparaître la carte partout : elle guide
     * les comptes neufs. On vérifie donc qu'elle survit là où elle ne gêne
     * personne, sinon la « correction » viderait la fonctionnalité.
     */
    for (const chemin of ['/', '/clients', '/jobs', '/calendar', '/day']) {
      expect(routeAvecBarreDAction(chemin), `${chemin} garde la carte`).toBe(false);
    }
  });
});
