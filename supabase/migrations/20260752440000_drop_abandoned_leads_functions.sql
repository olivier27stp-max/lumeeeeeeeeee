-- ============================================================================
-- Nettoyage : drop de 3 fonctions abandonnées référençant leads (2026-08-02)
-- ============================================================================
-- Définies en mars (20260321000000), jamais mises à jour. La table leads a été
-- supprimée en juillet (20260705000000) => cassées depuis, et personne ne les a
-- réparées (preuve d'abandon : le roadmap actif aurait été corrigé). Vérifiées :
-- 0 appel code, 0 appelant en base, 0 trigger. search_fts est en outre remplacée
-- par search_global.
-- ============================================================================

begin;
drop function if exists public.rpc_ceo_dashboard(uuid);
drop function if exists public.rpc_database_stats(uuid);
drop function if exists public.search_fts(uuid, text, text, integer, integer);
commit;
