/**
 * QA DU 2026-09-25 — la persistance des parcours.
 *
 * P1-3 et P1-8 sont le MÊME défaut, vu de deux façons :
 * « Enregistrement… » qui ne finit jamais, et la moitié d'un parcours
 * de 16 étapes qui disparaît.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');
const EDITEUR = 'src/pages/AutomationBuilderPage.tsx';

describe('P1-3 — « Enregistrement… » doit toujours finir', () => {
  const src = lire(EDITEUR);

  it('la confirmation ne dépend plus du drapeau d’annulation', () => {
    /*
     * LA CAUSE. L'effet d'autosauvegarde dépend de `steps` ET de
     * `etatSauvegarde`. Poser `en_cours` le relançait donc lui-même :
     * le nettoyage mettait `annule = true`, la réponse du serveur
     * revenait, et le `if (!annule)` l'ignorait. `a_jour` n'était
     * JAMAIS posé — l'indicateur restait bloqué alors que la mutation
     * avait réussi.
     */
    expect(src, 'a_jour ne doit plus être conditionné par !annule')
      .not.toMatch(/if \(!annule\) setEtatSauvegarde\('a_jour'\)/);
    expect(src, 'on confirme via la forme fonctionnelle, qui voit l’état réel')
      .toMatch(/setEtatSauvegarde\(\(actuel\) => \{[\s\S]{0,200}?'a_jour'/);
  });

  it('un échec ne laisse pas « en cours » non plus', () => {
    // Même raison : l'utilisateur doit toujours savoir où il en est.
    expect(src).toMatch(/setEtatSauvegarde\(\(actuel\) => \(actuel === 'en_cours' \? 'modifie' : actuel\)\)/);
  });
});

describe('P1-8 — un parcours long ne perd plus la moitié de ses étapes', () => {
  const src = lire(EDITEUR);

  it('un changement pendant l’envoi repart en « modifié », il n’est pas perdu', () => {
    /*
     * Chaque duplication modifiait `steps`, ce qui annulait la
     * sauvegarde en vol. Seules 8 des 16 étapes persistaient — sans
     * aucun message. On compare donc ce qu'on a ENVOYÉ à ce qui est à
     * l'écran au retour.
     */
    expect(src, 'on retient ce qui part').toMatch(/const envoye = JSON\.stringify\(steps\)/);
    expect(src, 'et on le compare au retour')
      .toMatch(/JSON\.stringify\(steps\) === envoye \? 'a_jour' : 'modifie'/);
  });

  it('la limite de 20 étapes est annoncée AVANT la perte', () => {
    /*
     * Le serveur refuse au-delà de 20 (`ETAPES_MAX`, validation.ts) :
     * un parcours plus long n'était jamais enregistré, et l'utilisateur
     * croyait avoir perdu son travail. Le rapport l'exige :
     * « si une limite volontaire existe, elle doit être affichée ET
     * bloquer avant la perte ».
     */
    expect(src).toMatch(/const ETAPES_MAX = 20/);
    const ajouts = [...src.matchAll(/if \(steps\.length >= ETAPES_MAX\)/g)];
    expect(ajouts.length, 'les DEUX chemins (ajout et duplication) doivent refuser')
      .toBe(2);
  });

  it('la limite du client suit celle du serveur', () => {
    // Deux chiffres différents = soit on refuse trop tôt, soit on laisse
    // passer ce que le serveur rejettera.
    expect(lire('server/lib/validation.ts')).toMatch(/const ETAPES_MAX = 20/);
  });
});
