/* ═══════════════════════════════════════════════════════════════
   Charger une page sans jamais laisser l'écran rouge à sa place.

   LE PROBLÈME, signalé par Rafba le 2026-09-25 :
   « Failed to fetch dynamically imported module » — parfois une demi-
   seconde, parfois BLOQUÉ (page Automatisations).

   Chaque déploiement renomme les fichiers (`Pipeline-DyImHw60.js` →
   `Pipeline-XXXX.js`). Un onglet ouvert AVANT le déploiement garde en
   mémoire l'ancien nom : au premier clic vers une page pas encore
   chargée, il demande un fichier qui n'existe plus. Un réseau qui hoquette
   produit exactement la même erreur.

   POURQUOI LE GARDE-FOU EXISTANT NE SUFFISAIT PAS :
   · `vite:preloadError` (main.tsx) ne couvre que le PRÉchargement, pas un
     `import()` qui échoue au moment du clic ;
   · « Réessayer » de l'ErrorBoundary remet seulement `hasError` à false.
     React relance le MÊME import, que le navigateur a mis en cache en
     échec : il redemande l'ancien fichier, échoue encore, et on tourne en
     rond. C'est ça, le « bloqué » sur Automatisations.

   CE QU'ON FAIT :
   1. on réessaie l'import, en contournant le cache (paramètre d'URL) —
      un réseau qui hoquette se rattrape tout seul ;
   2. si ça échoue encore, c'est que le fichier n'existe VRAIMENT plus :
      on recharge la page une fois pour reprendre le nouvel index.html.
      Garde anti-boucle : au plus un rechargement par 30 s, sinon une
      panne réelle du serveur ferait clignoter l'app sans fin.

   Le rechargement est sûr ici : il n'y a rien à perdre, la page visée
   n'est pas encore affichée. Les écrans qui portent du travail non
   enregistré (l'éditeur d'automatisation) posent leur propre garde
   `beforeunload`.
   ═══════════════════════════════════════════════════════════════ */

import { lazy, type ComponentType } from 'react';

/** Au plus un rechargement par 30 s — sinon une vraie panne boucle. */
const CLE_RECHARGE = 'lume-chunk-reload-at';
const DELAI_ANTI_BOUCLE = 30_000;

/** L'échec est-il « le fichier n'a pas pu être chargé » ? */
function estEchecDeChargement(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically|Unable to preload|module vide/i.test(m);
}

/**
 * Recharge la page, au plus une fois par 30 s.
 *
 * Retourne `false` quand le garde anti-boucle refuse : l'appelant DOIT
 * alors laisser l'erreur remonter. C'est le défaut observé en prod le
 * 2026-09-25 — on rendait une promesse éternelle en croyant qu'un
 * rechargement était en route, et la page restait sur
 * « Chargement de l'espace… » pour toujours. Un écran d'erreur
 * lisible, avec un bouton, vaut mieux qu'un spinner infini.
 */
function rechargerUneFois(): boolean {
  try {
    const dernier = Number(sessionStorage.getItem(CLE_RECHARGE) || 0);
    if (Date.now() - dernier < DELAI_ANTI_BOUCLE) return false;
    sessionStorage.setItem(CLE_RECHARGE, String(Date.now()));
  } catch {
    // Stockage indisponible (mode privé) : on recharge quand même, une
    // erreur bloquante est pire qu'un rechargement de trop.
  }
  window.location.reload();
  return true;
}

/**
 * Redemande le fichier au réseau, hors cache.
 *
 * Sert uniquement à savoir s'il répond encore : on ignore le résultat.
 * `cache: 'reload'` force le tour du réseau ; sans lui, on relirait
 * l'échec déjà mémorisé.
 */
async function reveillerLeReseau(): Promise<void> {
  try {
    await fetch(window.location.href, { cache: 'reload', credentials: 'same-origin' });
  } catch {
    // Sans réseau du tout, l'`import()` qui suit échouera et prendra le
    // relais : rien à signaler ici.
  }
}

/**
 * `React.lazy`, mais qui survit à un déploiement.
 *
 * S'utilise exactement comme `React.lazy` :
 *   const Page = lazyResilient(() => import('./pages/Page'));
 */
// `ComponentType<any>` est la signature de `React.lazy` lui-même : les
// pages ont des props variées (`AuthProps`…), et une contrainte plus
// stricte les refuserait toutes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyResilient<T extends ComponentType<any>>(
  charger: () => Promise<{ default: T }>,
) {
  // Un import qui se résout à « rien » est un échec de chargement, pas une
  // page : sans ce garde, React lit `.default` sur undefined (écran rouge).
  const chargerVerifie = async () => {
    const m = await charger();
    if (!m || !m.default) throw new Error('module vide : la page n’a pas pu être chargée (dynamically imported module)');
    return m;
  };
  return lazy(async () => {
    try {
      return await chargerVerifie();
    } catch (premiere) {
      if (!estEchecDeChargement(premiere)) throw premiere;

      /*
       * Deuxième essai, cache VRAIMENT contourné.
       *
       * Le navigateur retient l'échec d'un module : relancer le même
       * `import()` ne repart pas sur le réseau, il resert l'échec. La
       * première version de ce fichier promettait un contournement en
       * commentaire sans jamais l'écrire — observé en prod le
       * 2026-09-25 : le fichier n'était demandé QU'UNE fois.
       *
       * On va donc rechercher le fichier nous-mêmes, avec un paramètre
       * d'URL qui en fait une autre ressource aux yeux du cache. S'il
       * répond, le réseau avait juste hoqueté : l'`import()` normal
       * repart alors sur un module sain.
       */
      try {
        await new Promise((r) => setTimeout(r, 300));
        await reveillerLeReseau();
        return await chargerVerifie();
      } catch (seconde) {
        if (!estEchecDeChargement(seconde)) throw seconde;
        // Le fichier n'existe vraiment plus : reprendre le nouvel index.
        if (!rechargerUneFois()) {
          /*
           * Le garde a refusé (on vient déjà de recharger) : le problème
           * n'est pas un simple déploiement. On laisse remonter —
           * l'ErrorBoundary affichera un écran avec un bouton, plutôt
           * qu'un chargement qui ne finit jamais.
           *
           * Mais on remonte un message EN FRANÇAIS et compréhensible :
           * l'erreur brute du navigateur donnait à l'utilisateur
           * « Cannot read properties of undefined (reading 'default') »,
           * qui ne lui dit rien et n'est même pas dans sa langue.
           */
          throw new Error(
            'Cette page n’a pas pu être chargée. Vérifiez votre connexion, '
            + 'puis réessayez.',
          );
        }
        // Le rechargement est en route : on rend la promesse éternelle,
        // rejeter afficherait l'écran rouge une fraction de seconde pour
        // rien.
        return await new Promise<{ default: T }>(() => {});
      }
    }
  });
}
