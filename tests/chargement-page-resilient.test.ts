/**
 * « FAILED TO FETCH DYNAMICALLY IMPORTED MODULE »
 *
 * Signalé par Rafba le 2026-09-25 : « ça me dit ça des fois, c'est
 * décrissant » — parfois une demi-seconde, parfois BLOQUÉ (page
 * Automatisations).
 *
 * LA CAUSE. Chaque déploiement renomme les fichiers
 * (`Pipeline-DyImHw60.js` → `Pipeline-XXXX.js`). Un onglet ouvert AVANT le
 * déploiement garde en mémoire l'ancien nom : au premier clic vers une
 * page pas encore chargée, il demande un fichier qui n'existe plus. Un
 * réseau qui hoquette produit la même erreur.
 *
 * POURQUOI ÇA RESTAIT BLOQUÉ. « Réessayer » remettait seulement
 * `hasError` à false : React relançait le MÊME import, que le navigateur
 * avait mis en cache en échec. Il redemandait le fichier disparu, échouait
 * encore — on tournait en rond.
 *
 * Ces tests portent sur le contrat, pas l'apparence.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

/** Tous les fichiers de `src/`, chemins en barres obliques. */
function fichiers(dir: string, acc: string[] = []): string[] {
  for (const nom of readdirSync(resolve(RACINE, dir))) {
    const rel = join(dir, nom);
    if (statSync(resolve(RACINE, rel)).isDirectory()) fichiers(rel, acc);
    else if (/\.tsx?$/.test(nom)) acc.push(rel.split('\\').join('/'));
  }
  return acc;
}

describe('toutes les pages se chargent de façon résiliente', () => {
  it('plus AUCUN React.lazy nu dans src/', () => {
    /*
     * Le cœur du correctif : un `React.lazy` nu laisse l'échec remonter
     * jusqu'à l'écran rouge. `lazyResilient` réessaie, puis reprend le
     * nouvel index.html si le fichier a vraiment disparu.
     *
     * On vérifie TOUT `src/` — pas seulement App.tsx : le bogue touchait
     * aussi les routes publiques, les routes par jeton et le modal de job.
     */
    const fautifs = fichiers('src').filter((f) => {
      if (f.endsWith('src/lib/lazyResilient.ts')) return false; // il définit l'outil
      return /(?<!Resilient)\blazy\(\(\)\s*=>\s*import\(/.test(lire(f));
    });
    expect(fautifs, 'ces fichiers laisseraient l’écran rouge après un déploiement')
      .toEqual([]);
  });

  it('les 4 fichiers de chargement différé utilisent l’outil', () => {
    for (const f of [
      'src/App.tsx',
      'src/routes/PublicRoutes.tsx',
      'src/routes/TokenRoutes.tsx',
      'src/contexts/JobModalController.tsx',
    ]) {
      expect(lire(f), `${f} doit charger ses pages de façon résiliente`)
        .toMatch(/lazyResilient\(\(\) => import\(/);
    }
  });

  it('le nombre de pages protégées ne régresse pas', () => {
    // 120 chargements différés au 2026-09-25. Un ajout est bienvenu ; une
    // BAISSE voudrait dire qu'on est revenu au lazy nu quelque part.
    const total = ['src/App.tsx', 'src/routes/PublicRoutes.tsx',
      'src/routes/TokenRoutes.tsx', 'src/contexts/JobModalController.tsx']
      .reduce((n, f) => n + (lire(f).match(/lazyResilient\(\(\) => import\(/g) ?? []).length, 0);
    expect(total).toBeGreaterThanOrEqual(120);
  });
});

describe('l’outil de chargement', () => {
  const outil = lire('src/lib/lazyResilient.ts');

  it('réessaie AVANT d’abandonner', () => {
    // Un réseau qui hoquette doit se rattraper tout seul, sans recharger
    // la page : recharger pour un hoquet serait brutal.
    expect(outil).toMatch(/return await chargerVerifie\(\);[\s\S]*?return await chargerVerifie\(\);/);
  });

  it('ne recharge QUE sur un échec de chargement', () => {
    /*
     * Une vraie erreur de rendu (bogue applicatif) doit remonter à
     * l'ErrorBoundary. La masquer par un rechargement cacherait un vrai
     * défaut et ferait clignoter l'app.
     */
    expect(outil).toMatch(/if \(!estEchecDeChargement\(premiere\)\) throw premiere;/);
    expect(outil).toMatch(/if \(!estEchecDeChargement\(seconde\)\) throw seconde;/);
  });

  it('un seul rechargement par 30 s — pas de boucle', () => {
    // Sans ce garde, une panne réelle du serveur ferait recharger l'app
    // sans fin : un écran qui clignote est pire qu'une erreur lisible.
    expect(outil).toMatch(/DELAI_ANTI_BOUCLE = 30_000/);
    expect(outil).toMatch(/Date\.now\(\) - dernier < DELAI_ANTI_BOUCLE/);
  });
});

describe('l’écran d’erreur ne reste plus bloqué', () => {
  const eb = lire('src/components/ErrorBoundary.tsx');

  it('changer de page réarme la barrière', () => {
    /*
     * Cette barrière enveloppe TOUTES les routes et rien ne remettait
     * `hasError` à false : naviguer ailleurs montrait encore l'écran rouge
     * de la page précédente. C'est le « bloqué » signalé sur
     * Automatisations.
     */
    expect(eb).toMatch(/componentDidUpdate\(\)/);
    expect(eb).toMatch(/window\.location\.href !== this\.state\.url/);
  });

  it('« Réessayer » RECHARGE quand le fichier manque', () => {
    /*
     * Pour cette erreur-là, remettre `hasError` à false relance le même
     * import mis en cache en échec : on tourne en rond. Seul un
     * rechargement reprend le nouvel index.html.
     */
    const i = eb.indexOf('handleReset');
    const bloc = eb.slice(i, i + 600);
    expect(bloc).toMatch(/dynamically imported module/);
    expect(bloc).toMatch(/window\.location\.reload\(\)/);
  });
});

describe('le spinner infini — défaut observé en prod le 2026-09-25', () => {
  const outil = lire('src/lib/lazyResilient.ts');
  const main = lire('src/main.tsx');

  /*
   * CE QUI S'EST PASSÉ. La première version du correctif a été vérifiée
   * en bloquant le fichier au navigateur : plus d'écran rouge, tant
   * mieux. Mais la page restait sur « Chargement de l'espace… » POUR
   * TOUJOURS — un spinner infini, pire que l'erreur qu'on remplaçait :
   * l'utilisateur n'a même plus de bouton.
   *
   * La chaîne : `vite:preloadError` rechargeait dès le PRÉchargement et
   * posait la clé anti-boucle ; 300 ms plus tard le vrai `import()`
   * échouait à son tour, `rechargerUneFois()` était refusé par ce même
   * garde… et rendait quand même une promesse éternelle, en croyant
   * qu'un rechargement était en route.
   */

  it('quand le rechargement est REFUSÉ, l’erreur remonte — pas de promesse éternelle', () => {
    // Le garde doit POUVOIR dire non, et l'appelant doit l'écouter.
    expect(outil, 'rechargerUneFois doit signaler son refus')
      .toMatch(/function rechargerUneFois\(\): boolean/);
    expect(outil, 'un refus du garde doit rendre la main à l’ErrorBoundary')
      .toMatch(/if \(!rechargerUneFois\(\)\) \{[\s\S]{0,900}?throw new Error\(/);
  });

});

describe('ce que l’utilisateur LIT quand ça échoue pour de bon', () => {
  const outil = lire('src/lib/lazyResilient.ts');

  it('le message est en français, pas l’erreur brute du navigateur', () => {
    /*
     * Observé en prod le 2026-09-25 : l'écran affichait
     * « Cannot read properties of undefined (reading 'default') » —
     * en anglais, et incompréhensible. Le mandat l'interdit :
     * jamais d'erreur technique brute à l'utilisateur.
     */
    expect(outil).toMatch(/Cette page n’a pas pu être chargée/);
  });

  it('le deuxième essai repart VRAIMENT sur le réseau', () => {
    /*
     * Le commentaire promettait un contournement du cache que le code
     * ne faisait pas : le navigateur reservait l'échec mémorisé et le
     * fichier n'était demandé QU'UNE fois. Un réessai qui ne touche
     * pas le réseau ne réessaie rien.
     */
    expect(outil, 'il faut forcer le tour du réseau')
      .toMatch(/cache: 'reload'/);
    expect(outil, 'et l’appeler avant le second import')
      .toMatch(/await reveillerLeReseau\(\);\s*return await chargerVerifie\(\);/);
  });
});

describe('l’écran d’erreur parle français', () => {
  const eb = lire('src/components/ErrorBoundary.tsx');
  const main = lire('src/main.tsx');

  it('le repli sans `labels` n’est plus l’anglais en dur', () => {
    /*
     * Les barrières de SECTION ne passent pas de `labels` : elles
     * tombaient sur « Something went wrong », en anglais, au milieu
     * d'une app entièrement en français. C'est l'écran que Rafba a vu
     * le 2026-09-25.
     */
    expect(eb, 'le repli doit proposer le français')
      .toMatch(/Une erreur est survenue/);
    expect(eb, 'et choisir selon la langue enregistrée')
      .toMatch(/lireLangueEnregistree\(\) === 'en'/);
  });

  it('la langue du NAVIGATEUR est ignorée, comme partout (#500)', () => {
    /*
     * #500 a tranché : français d'office, `navigator.language` ignoré.
     * Ces deux écrans étaient restés en dehors de la décision — un
     * client québécois dont le navigateur est en anglais basculait en
     * anglais au pire moment.
     */
    // On retire les commentaires avant de chercher : ils CITENT
    // `navigator.language` pour expliquer pourquoi on ne s'en sert plus,
    // et un test qui lit les commentaires ne prouve rien.
    const sansCommentaires = (src: string) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const [nom, src] of [['ErrorBoundary', eb], ['main.tsx', main]] as const) {
      expect(sansCommentaires(src), `${nom} ne doit pas déduire la langue du navigateur`)
        .not.toMatch(/navigator\.language/);
    }
  });

  it('le préchargement n’ANNULE pas l’erreur (sinon l’import rend undefined → « reading default »)', () => {
    // Vite : `return importDeLaPage().catch(gererErreur)` — annulé, l'erreur
    // n'est pas relancée et l'import se résout à undefined (écran rouge
    // partout après un déploiement, 2026-09-25).
    const i = main.indexOf("addEventListener('vite:preloadError'");
    const bloc = main.slice(i, i + 300);
    expect(bloc).not.toMatch(/preventDefault\(\)/);
  });

  it('un import qui rend « rien » est traité comme un échec de chargement', () => {
    const outil = lire('src/lib/lazyResilient.ts');
    expect(outil).toContain("if (!m || !m.default) throw new Error(");
    expect(outil).toMatch(/return await chargerVerifie\(\);[\s\S]*return await chargerVerifie\(\);/);
  });
});
