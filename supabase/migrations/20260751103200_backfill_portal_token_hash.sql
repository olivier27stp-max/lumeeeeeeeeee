-- ============================================================================
-- Portail client : le hachage des jetons ne couvrait que 9 clients sur 56
-- ============================================================================
--
-- CONSTAT (audit 2026-07-31)
--   `clients.portal_token_hash` a ete ajoute pour ne plus dependre du jeton en
--   clair lors de l'authentification au portail. Mais le remplissage n'a jamais
--   ete complete : sur 56 clients possedant un jeton, **47 avaient un hash
--   NULL**. Seuls 9 etaient couverts.
--
--   server/routes/portal.ts:41 cherche d'abord par `portal_token_hash`. Pour ces
--   47 clients la recherche echouait, et le code retombait sur le repli
--   ligne 47-53, qui interroge `portal_token` EN CLAIR. Le durcissement etait
--   donc inoperant pour 84 % des clients, sans que rien ne le signale.
--
-- CE QUE FAIT CETTE MIGRATION
--   Remplit les hash manquants. La formule a ete VERIFIEE contre les 9 clients
--   qui possedaient deja les deux valeurs : sur les 9,
--   `portal_token_hash = encode(sha256(portal_token::bytea),'hex')` — 9
--   concordances, 0 divergence. Elle correspond exactement au calcul cote
--   serveur (`crypto.createHash('sha256').update(token).digest('hex')`,
--   portal.ts:34).
--
--   Applique en production le 2026-07-31 a 15:07 UTC.
--   Resultat verifie : 56 clients, 56 hash presents, 56 hash corrects.
--
-- ⚠️ CE N'EST QU'UNE MOITIE DU TRAVAIL
--   Le jeton EN CLAIR reste stocke pour les 56 clients. Tant qu'il y est, le
--   hachage n'apporte rien contre un acces en lecture a la base : c'est
--   precisement ce dont il devait proteger.
--
--   Sequence prevue, et son avancement reel :
--     1. ✅ FAIT — remplir tous les hash (56/56, formule verifiee) ;
--     2. ✅ FAIT — portal.ts cherche desormais PAR LE HASH uniquement. Le repli
--        par jeton en clair et timingSafeCompare() ont ete retires : retrouver
--        la ligne par son hash prouve deja la validite du jeton ;
--     3. ✅ FAIT — verifie en production avec un VRAI jeton, avant et apres
--        deploiement : HTTP 200 et client retourne dans les deux cas ; un faux
--        jeton reste refuse en 404 ;
--     4. ❌ BLOQUE — et pas par un oubli.
--
-- ⚠️ POURQUOI L'ETAPE 4 NE PEUT PAS ETRE FAITE MECANIQUEMENT
--
--   src/pages/ClientDetails.tsx:718-721 lit `portal_token` DANS LE NAVIGATEUR
--   pour construire le lien du portail :
--       const url = `${window.location.origin}/portal/${client.portal_token}`;
--   C'est le bouton « Copier le lien du portail ». Vider la colonne le ferait
--   disparaitre (il est conditionne par la presence du jeton) et supprimerait
--   la possibilite de partager un acces client.
--
--   Un hash est a sens unique : on ne peut PAS reconstruire le lien a partir de
--   lui. Cesser de stocker le clair exige donc un choix de conception, a
--   trancher par le proprietaire du produit :
--
--     a) NE RIEN FAIRE — accepter que le jeton reste en clair. Honnete, mais
--        alors le hachage n'apporte rien contre un acces en lecture a la base,
--        qui est exactement ce dont il devait proteger.
--     b) CHIFFRER le jeton au repos plutot que le hacher. Le projet sait deja
--        le faire : PII_ENCRYPTION_KEY et PAYMENTS_ENCRYPTION_KEY existent.
--        Le lien reste reconstructible cote serveur, la base seule ne suffit
--        plus a le lire.
--     c) REGENERER a la demande — le bouton demande au serveur un jeton neuf,
--        qui invalide le precedent. Le plus sur, mais les liens deja envoyes
--        cessent de fonctionner.
--
--   L'option (b) preserve le comportement actuel ; l'option (c) est la plus
--   stricte. Aucune ne se decide a la place du proprietaire.
--
--   ROLLBACK de cette migration : `update public.clients set portal_token_hash
--   = null where ...` — sans risque, le repli en clair reprend la main.
-- ============================================================================

update public.clients
   set portal_token_hash = encode(sha256(portal_token::bytea), 'hex')
 where portal_token is not null
   and portal_token_hash is null
   and deleted_at is null;

comment on column public.clients.portal_token_hash is
  'SHA-256 hexadecimal du jeton de portail. Doit etre rempli pour TOUS les '
  'clients ayant un jeton : sinon portal.ts retombe sur la comparaison du '
  'jeton en clair et le durcissement ne sert a rien.';
