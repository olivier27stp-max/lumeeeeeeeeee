-- ═══════════════════════════════════════════════════════════════
-- URGENT — la vue tasks_active contournait la RLS en production.
--
-- CONSTAT DU 2026-09-06, 20 h 40
-- La CI « RLS cross-tenant isolation » a rougi : un anonyme lit
-- tasks_active, un membre y voit les tâches d'autres organisations.
-- Cause : 20260906140000_tasks_planifiables.sql a fait
-- `create or replace view public.tasks_active as …` SANS
-- `with (security_invoker = true)`. CREATE OR REPLACE VIEW réinitialise
-- les options : la vue est repassée en mode propriétaire (postgres),
-- qui ignore la RLS de la table tasks. Appliquée en prod vers 20 h 31.
--
-- Ce matin, les 14 vues du projet étaient en security_invoker (audit).
-- Une vue Supabase SANS cette option est une porte ouverte : elle lit
-- la table avec les droits de postgres, quel que soit l'appelant.
--
-- RÈGLE
-- Toute vue créée ou recréée sur une table org-scopée porte
-- `with (security_invoker = true)`. Le test tests/vues-security-invoker
-- garde désormais chaque `create … view` des migrations.
-- ═══════════════════════════════════════════════════════════════

begin;

alter view public.tasks_active set (security_invoker = true);

commit;
