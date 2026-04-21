-- ═══════════════════════════════════════════════════════════════
-- Migration: Drop Director Panel module (Phase 4.1 audit cleanup)
-- Date: 2026-06-26
-- Reason: Director Panel removed entirely per user decision
--   (reference: memory/audit_reports/ai_backend_removal.md).
--   Frontend + backend code removed in the same commit.
--   No down migration: git history serves as rollback.
--
-- Tables dropped (14 total):
--   director_creative_directions
--   director_edges
--   director_flow_links
--   director_flows
--   director_generations
--   director_nodes
--   director_run_steps
--   director_runs
--   director_style_dna
--   director_templates
--   director_training_jobs
--   director_usage_events
--   org_credit_balances      (Director-only per audit)
--   org_credit_transactions  (Director-only per audit)
--
-- Preserved (user decision): ai_* and agent_* tables.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- Drop director_* tables (CASCADE to drop dependent FKs/policies)
DROP TABLE IF EXISTS public.director_run_steps       CASCADE;
DROP TABLE IF EXISTS public.director_runs            CASCADE;
DROP TABLE IF EXISTS public.director_generations     CASCADE;
DROP TABLE IF EXISTS public.director_edges           CASCADE;
DROP TABLE IF EXISTS public.director_nodes           CASCADE;
DROP TABLE IF EXISTS public.director_flow_links      CASCADE;
DROP TABLE IF EXISTS public.director_flows           CASCADE;
DROP TABLE IF EXISTS public.director_templates       CASCADE;
DROP TABLE IF EXISTS public.director_creative_directions CASCADE;
DROP TABLE IF EXISTS public.director_style_dna       CASCADE;
DROP TABLE IF EXISTS public.director_training_jobs   CASCADE;
DROP TABLE IF EXISTS public.director_usage_events    CASCADE;

-- Drop org credit tables (Director-only per audit)
DROP TABLE IF EXISTS public.org_credit_transactions  CASCADE;
DROP TABLE IF EXISTS public.org_credit_balances      CASCADE;

COMMIT;
