/**
 * AUCUN RÉGLAGE MORT DANS L'ONGLET « RÉGLAGES ».
 *
 * Constat du 2026-09-25 : deux des cinq interrupteurs étaient morts.
 * Ils s'allumaient, s'enregistraient en base, et le moteur ne les
 * lisait JAMAIS — ils n'apparaissaient nulle part ailleurs que dans la
 * déclaration du type.
 *
 * Ce n'est pas théorique : une automatisation EN PROD (« Demander un
 * avis après job complété ») avait `reentree: true`. Quelqu'un a coché
 * en croyant changer quelque chose. Rien ne s'est produit.
 *
 * Un interrupteur qui ne fait rien coûte la confiance dans tous les
 * autres réglages de la page.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

const ECRAN = 'src/components/automations/OngletReglages.tsx';
const MOTEUR = 'server/lib/automationEngine.ts';

/** Les réglages que l'écran propose vraiment (un `onBascule` les écrit). */
function reglagesOfferts(): string[] {
  const src = lire(ECRAN);
  return [...new Set(
    [...src.matchAll(/appliquer\(\{\s*([a-z_]+)\s*:/g)].map((m) => m[1]),
  )];
}

describe('chaque réglage offert change vraiment quelque chose', () => {
  it('le moteur LIT chaque interrupteur que l’écran propose', () => {
    /*
     * On cherche l'usage, pas la simple mention : un champ cité dans la
     * déclaration du type ne prouve rien — c'est précisément ce qui
     * masquait les deux réglages morts.
     */
    /*
     * On retire les COMMENTAIRES et la déclaration du type avant de
     * chercher : un champ seulement cité dans une explication ou déclaré
     * dans une interface n'est pas lu. C'est exactement ce qui masquait
     * les deux réglages morts.
     */
    const moteur = lire(MOTEUR)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^\s*[a-z_]+\?:.*$/gm, '');

    const morts = reglagesOfferts()
      .filter((cle) => !new RegExp('[^a-z_]' + cle + '[^a-z_]').test(moteur));

    expect(
      morts,
      `ces interrupteurs s’allument et s’enregistrent, mais le moteur les ignore : ${morts.join(', ')}`,
    ).toEqual([]);
  });

  it('l’écran propose bien les réglages attendus', () => {
    // Garde-fou contre un test qui passerait parce qu'il ne trouve rien.
    const offerts = reglagesOfferts();
    expect(offerts.length).toBeGreaterThanOrEqual(3);
    expect(offerts).toContain('reentree');
  });
});

describe('« Laisser le client repasser »', () => {
  const moteur = lire(MOTEUR);

  it('agit sur la CLÉ d’anti-doublon, seul endroit qui bloque un repassage', () => {
    /*
     * L'index unique est partiel : il ne mord que sur les tâches
     * `pending`/`running`. Le réglage doit donc rendre la clé distincte
     * à chaque déclenchement, sans toucher à l'index lui-même.
     */
    expect(moteur).toMatch(/function buildExecutionKey\([\s\S]{0,200}reentree = false/);
    expect(moteur, 'la clé doit devenir unique quand le réglage est actif')
      .toMatch(/return reentree \? `\$\{base\}:/);
  });

  it('les DEUX points de planification le passent', () => {
    /*
     * Un seul des deux suffirait à rendre le réglage à moitié vrai :
     * l'envoi immédiat repasserait, celui reporté en heures calmes non.
     */
    const passages = [...moteur.matchAll(/buildExecutionKey\(rule\.id, event\.entityId, i, rule\.settings\?\.reentree === true\)/g)];
    expect(passages.length, 'les deux sites d’insertion doivent passer le réglage').toBe(2);
  });
});

describe('« Marquer comme lu » a été retiré', () => {
  it('l’interrupteur n’est plus propos\u00e9', () => {
    /*
     * Le problème qu'il prétendait régler n'existe pas : vérifié en
     * base, les conversations qui portent des non-lus finissent toutes
     * par un message ENTRANT. Les non-lus suivent ce que le client
     * écrit, pas ce que l'entreprise envoie.
     */
    expect(reglagesOfferts()).not.toContain('marquer_lu');
  });

  it('mais la clé reste ACCEPTÉE par le serveur', () => {
    /*
     * Le schéma est `.strict()` : retirer la clé ferait rejeter, à la
     * première modification, toute règle existante qui la porte encore.
     */
    expect(lire('server/lib/validation.ts')).toMatch(/marquer_lu: z\.boolean\(\)\.optional\(\)/);
  });
});
