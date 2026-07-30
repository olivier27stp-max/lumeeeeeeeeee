-- ═══════════════════════════════════════════════════════════════
-- ⚠️  À COLLER DANS LE SQL EDITOR DE SUPABASE — SSRF ouverte
--
--     https://supabase.com/dashboard/project/bbzcuzqfgsdvjsymfwmr/sql/new
--
-- Coller tout ce fichier, cliquer RUN, puis vérifier la sortie (§3).
-- ═══════════════════════════════════════════════════════════════
--
-- ─── LE PROBLÈME (vérifié exploitable, pas théorique) ───────────
--
-- L'extension pg_net fait émettre à la base des requêtes HTTP sortantes.
-- Elle est exécutable par `anon`, c'est-à-dire SANS ÊTRE CONNECTÉ. Testé
-- en production le 2026-07-30 en empruntant réellement les rôles :
--
--     anon          → net.http_get       RÉUSSI
--     authenticated → net.http_get       RÉUSSI
--     anon          → net.http_post      RÉUSSI
--     anon          → net.worker_restart RÉUSSI
--
-- Ce que ça permet à un attaquant non authentifié :
--   • exfiltrer des données vers un serveur qu'il contrôle
--   • atteindre des services internes injoignables depuis Internet
--   • couper le worker réseau (worker_restart), donc les notifications
--     push et la libération des numéros SMS
--
-- ─── POURQUOI JE N'AI PAS PU L'APPLIQUER À TA PLACE ─────────────
--
-- Les fonctions `net.*` et le schéma appartiennent à `supabase_admin`.
-- Seul le propriétaire d'un privilège peut le révoquer. Trois voies
-- essayées, toutes s'exécutent comme `postgres` :
--   • connexion directe via le pooler   → REVOKE ignoré
--   • API Management /database/query    → REVOKE ignoré
--   • Supabase CLI (db query --linked)  → REVOKE ignoré
--
-- ⚠️  Le piège : un REVOKE lancé sans être propriétaire ne lève AUCUNE
-- erreur. Il « réussit » et ne change rien. C'est pourquoi le §3 ci-dessous
-- n'est pas optionnel — sans lui, on croit avoir corrigé alors que non.
--
-- Le SQL editor du dashboard s'exécute avec les droits requis.
--
-- ─── POURQUOI C'EST SANS RISQUE ─────────────────────────────────
--
-- Les deux seuls appelants de net.http_* sont :
--     fn_push_on_notification      (SECURITY DEFINER)
--     trigger_sms_number_release   (SECURITY DEFINER)
--
-- Une fonction SECURITY DEFINER s'exécute avec les droits de SON
-- propriétaire, jamais de l'appelant : elles continueront d'émettre leurs
-- requêtes normalement. Aucun appel direct à net.http_* dans src/ ni
-- server/. Le §3 le reconfirme après application.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. Fermer l'accès ─────────────────────────────────────────
--
-- Le REVOKE doit viser PUBLIC en plus des rôles nommés : l'ACL est
-- `=X/supabase_admin`, un grant au pseudo-rôle PUBLIC qui englobe `anon`
-- sans le nommer. Un revoke ciblé sur anon seul ne l'enlève pas.

revoke execute on all functions in schema net from public;
revoke execute on all functions in schema net from anon, authenticated;

-- Ceinture par-dessus la bretelle : sans USAGE sur le schéma, aucune
-- fonction n'y est atteignable même si un grant subsistait.
revoke usage on schema net from public;
revoke usage on schema net from anon, authenticated;


-- ── 2. Empêcher la réapparition ───────────────────────────────
--
-- Une mise à jour de l'extension ajoute des fonctions avec les grants par
-- défaut. Sans ceci, le correctif s'érode à la prochaine montée de version.

alter default privileges in schema net revoke execute on functions from public;
alter default privileges in schema net revoke execute on functions from anon, authenticated;


-- ── 3. VÉRIFIER — ne pas sauter cette étape ───────────────────

-- (a) Doit retourner 0.
select count(*) as fonctions_encore_ouvertes
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'net'
  and (has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute'));

-- (b) Doit retourner false, false.
select has_schema_privilege('anon', 'net', 'usage')         as anon_usage,
       has_schema_privilege('authenticated', 'net', 'usage') as authenticated_usage;

-- (c) Doit lister les deux fonctions avec security_definer = true.
--     Si elles y sont, push et SMS continuent de fonctionner.
select p.proname, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc ~* 'net\.http_'
order by p.proname;


-- ─── SI (a) RENVOIE ENCORE 12 ───────────────────────────────────
-- Le SQL editor n'a pas les droits du propriétaire non plus. Dans ce cas,
-- ouvrir un ticket au support Supabase : le grant PUBLIC sur `net` est un
-- défaut de leur provisionnement, pas une configuration du projet.
