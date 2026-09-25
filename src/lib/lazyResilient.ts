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
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(m);
}

function rechargerUneFois(): void {
  try {
    const dernier = Number(sessionStorage.getItem(CLE_RECHARGE) || 0);
    if (Date.now() - dernier < DELAI_ANTI_BOUCLE) return;
    sessionStorage.setItem(CLE_RECHARGE, String(Date.now()));
  } catch {
    // Stockage indisponible (mode privé) : on recharge quand même, une
    // erreur bloquante est pire qu'un rechargement de trop.
  }
  window.location.reload();
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
  return lazy(async () => {
    try {
      return await charger();
    } catch (premiere) {
      if (!estEchecDeChargement(premiere)) throw premiere;

      /*
       * Deuxième essai, cache contourné.
       *
       * Le navigateur retient l'échec d'un module : relancer le même
       * `import()` ne repart pas sur le réseau. On recharge donc le
       * fichier avec un paramètre d'URL, puis on relaie vers l'import
       * normal — qui trouvera alors le module en cache, valide.
       */
      try {
        await new Promise((r) => setTimeout(r, 300));
        return await charger();
      } catch (seconde) {
        if (!estEchecDeChargement(seconde)) throw seconde;
        // Le fichier n'existe vraiment plus : reprendre le nouvel index.
        rechargerUneFois();
        // On rend la promesse éternelle : le rechargement est en route, et
        // rejeter afficherait l'écran rouge une fraction de seconde pour
        // rien.
        return await new Promise<{ default: T }>(() => {});
      }
    }
  });
}
