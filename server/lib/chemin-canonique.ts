/* ═══════════════════════════════════════════════════════════════
   Le chemin d'une requête d'API, ramené à UNE seule écriture.

   FAILLE (audit du 2026-10-01, confirmée sur lumecrm.net avec un compte
   technicien de test) : les gardes de l'application — permissions de la
   page Rôles, MFA, abonnement, forfait — comparent `req.path` à des
   tables de chemins EXACTS. Express, lui, route sans tenir compte de la
   casse ni de la barre finale. Donc :

       GET /api/automations/pause    → 403  Permission denied
       GET /api/automations/pause/   → 200  (aucune règle trouvée : on laisse passer)
       GET /API/automations/pause    → 200

   Une barre de plus, et un technicien passait toutes les permissions de
   toutes les routes protégées par ces tables.

   Plutôt que de corriger chaque garde, on réécrit le chemin AVANT elles :
   toutes voient alors la même écriture qu'Express routera.

     · les barres doublées sont réduites à une ;
     · la barre finale est retirée ;
     · un segment purement alphabétique (lettres, « - », « _ ») est mis en
       minuscules — c'est la forme de TOUS les segments fixes des routes.
       Un segment qui porte un chiffre (identifiant, jeton) est laissé tel
       quel : un jeton peut être sensible à la casse.

   Seule l'API est touchée (`/api…`) ; les pages, les fichiers et les
   liens publics gardent leur adresse. `req.originalUrl` n'est pas
   modifié : la signature d'un webhook qui porte l'adresse d'origine
   (Twilio) se vérifie comme avant.
   ═══════════════════════════════════════════════════════════════ */

import type { RequestHandler } from 'express';

/** Le chemin canonique d'une URL d'API (requête comprise). Rend l'URL telle quelle hors API. */
export function cheminCanonique(url: string): string {
  const coupe = url.indexOf('?');
  const chemin = coupe === -1 ? url : url.slice(0, coupe);
  const requete = coupe === -1 ? '' : url.slice(coupe);

  const sansDoubles = chemin.replace(/\/{2,}/g, '/');
  if (!/^\/api(\/|$)/i.test(sansDoubles)) return url;

  const segments = sansDoubles.split('/').map((s) => (/^[A-Za-z_-]+$/.test(s) ? s.toLowerCase() : s));
  let canonique = segments.join('/');
  if (canonique.length > 1) canonique = canonique.replace(/\/+$/, '');
  return canonique + requete;
}

/** À monter AVANT toute garde qui lit `req.path`. */
export function canoniserChemin(): RequestHandler {
  return (req, _res, next) => {
    const canonique = cheminCanonique(req.url);
    if (canonique !== req.url) req.url = canonique;
    next();
  };
}
