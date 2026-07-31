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
--   Le retirer exige un changement de CODE, pas seulement de donnees :
--   portal.ts:57 compare le jeton fourni a `client.portal_token` en temps
--   constant. Vider la colonne sans toucher au code CASSERAIT l'acces au
--   portail pour tout le monde. La sequence sure est :
--     1. (fait ici) remplir tous les hash ;
--     2. modifier portal.ts pour comparer hash contre hash, en temps constant ;
--     3. verifier qu'aucun acces portail ne passe plus par le repli en clair ;
--     4. seulement alors, vider `portal_token`.
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
