/**
 * CE QUI SE TÉLÉCHARGE AU PREMIER ÉCRAN.
 *
 * Le chunk d'entrée part avant que quoi que ce soit s'affiche : tout ce
 * qui y tombe est payé par CHAQUE visiteur, sur CHAQUE première visite,
 * y compris sur un téléphone en 4G dans un champ.
 *
 * Mesuré le 2026-09-25 sur la carte de sources : `NewJobModal` pesait
 * 197 Ko de l'entrée — le plus gros fichier applicatif — alors qu'il ne
 * s'affiche qu'après un clic. Il était dans l'entrée parce que
 * `JobModalController` est monté autour de TOUTE l'application et
 * l'importait statiquement. Gain mesuré après correction : l'entrée passe
 * de 407 à 334 Ko gzippés.
 *
 * Ce fichier empêche le retour en arrière. Il ne mesure pas des octets
 * (un seuil se périme et se contourne) mais la RÈGLE : un composant lourd
 * monté partout se charge à la demande.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

describe('les modales montées dans toute l’app se chargent à la demande', () => {
  const controleur = lire('src/contexts/JobModalController.tsx');

  it('`NewJobModal` est importé en lazy, pas en statique', () => {
    /*
     * Un `import NewJobModal from ...` en tête de ce fichier suffit à le
     * ramener dans l'entrée : le contrôleur enveloppe l'application
     * entière. Le type, lui, n'a aucun poids — `import type` est donc
     * permis et nécessaire.
     */
    expect(controleur, 'seul le TYPE peut être importé statiquement')
      .not.toMatch(/^import\s+NewJobModal/m);
    // `lazyResilient` depuis le 2026-09-25 : même chargement différé, mais
    // qui survit à un déploiement (voir chargement-page-resilient.test.ts).
    expect(controleur).toMatch(/lazyResilient\(\(\)\s*=>\s*import\('\.\.\/components\/NewJobModal'\)\)/);
  });

  it('il n’est RENDU qu’après une première ouverture', () => {
    /*
     * `lazy` ne suffit pas : React télécharge le module dès que le
     * composant est rendu. Rendu inconditionnellement, il serait chargé au
     * montage de l'app — donc au premier écran, ce qu'on voulait éviter.
     *
     * Vérifié dans un vrai navigateur sur le BUILD (pas en dev, où Vite
     * sert les modules un par un) : chunk absent avant le clic, présent
     * après, modal affiché, zéro erreur JS.
     */
    expect(controleur, 'un garde d’ouverture doit exister').toMatch(/dejaOuvert/);
    const rendu = controleur.slice(controleur.indexOf('<JobModalControllerContext.Provider'));
    expect(rendu, 'le rendu doit être conditionné').toMatch(/\{dejaOuvert\s*&&/);
    expect(rendu, 'un Suspense est requis autour d’un composant lazy').toMatch(/<Suspense/);
  });

  it('une fois ouvert, il reste monté', () => {
    /*
     * Le démonter à la fermeture couperait l'animation de sortie
     * (`AnimatePresence` a besoin du composant le temps qu'il disparaisse)
     * et referait un téléchargement à chaque réouverture.
     */
    expect(controleur).not.toMatch(/setDejaOuvert\(false\)/);
  });
});

describe('le préchargement du premier écran reste minimal', () => {
  it('vite.config ne précharge que `vendor`', () => {
    /*
     * CLAUDE.md : « Seul `vendor` doit être préchargé dans
     * dist/index.html — vérifier après tout changement de découpage. »
     * Un chunk lourd qui s'y glisse (c'est arrivé avec pdf et charts)
     * annule tout le bénéfice du découpage.
     */
    const config = lire('vite.config.ts');
    expect(config, 'les helpers Vite doivent aller dans vendor, pas dans un chunk lourd')
      .toMatch(/vite\/preload-helper/);
    expect(config).toMatch(/manualChunks/);
  });
});
