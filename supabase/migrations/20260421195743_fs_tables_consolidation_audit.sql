-- ============================================================================
-- Field-sales tables consolidation audit (issue C-005 — REVISED 2026-04-21).
--
-- Original audit claimed 14 fs_* tables duplicating Clostra-origin tables.
-- Post-verification (Phase 4 execution): fs_* tables DO NOT EXIST in live DB.
-- They are defined in migration 20260613000000_clostra_gamification_commissions.sql
-- but that migration was never applied. The actual field-sales domain runs on
-- `field_*` tables (verified via PostgREST 2026-04-21).
--
-- This revised migration documents the REAL source-of-truth tables that exist
-- and carry data. Gamification/commissions/feed features from the Clostra plan
-- remain UNIMPLEMENTED at the data layer — tracked separately.
--
-- NO DATA MIGRATION. Only COMMENT ON TABLE metadata.
-- ============================================================================

-- Core field-sales (source of truth, has data)
comment on table public.field_daily_stats is 'Field-sales source of truth (2026-04-21). Daily aggregated stats per rep.';
comment on table public.field_house_events is 'Field-sales source of truth (2026-04-21). Door-to-door visit events (157 rows).';
comment on table public.field_house_profiles is 'Field-sales source of truth (2026-04-21). Household profiles built from D2D visits (97 rows).';
comment on table public.field_pin_entity_links is 'Field-sales source of truth (2026-04-21). Polymorphic links pins -> leads/clients/jobs.';
comment on table public.field_pins is 'Field-sales source of truth (2026-04-21). Map pins for territory management (80 rows).';
comment on table public.field_sales_reps is 'Field-sales source of truth (2026-04-21). Rep profiles (1 row).';
comment on table public.field_territories is 'Field-sales source of truth (2026-04-21). Territory definitions (8 rows).';

-- Empty but kept (schema ready)
comment on table public.field_pin_templates is 'Field-sales schema (2026-04-21). Templates for recurring pins, currently empty.';
comment on table public.field_rep_performance is 'Field-sales schema (2026-04-21). Rep performance metrics, currently empty.';
comment on table public.field_sales_team_members is 'Field-sales schema (2026-04-21). Team membership, currently empty.';
comment on table public.field_sales_teams is 'Field-sales schema (2026-04-21). Team definitions, currently empty.';
comment on table public.field_schedule_slots is 'Field-sales schema (2026-04-21). Rep schedule slots, currently empty.';
comment on table public.field_settings is 'Field-sales schema (2026-04-21). Per-org field-sales settings, currently empty.';
comment on table public.field_territory_assignments is 'Field-sales schema (2026-04-21). Rep <-> territory assignments, currently empty.';

-- ============================================================================
-- Unimplemented at the data layer (need decision):
--   - Gamification: badges, challenges, battles, feed (migration
--     20260613000000_clostra_gamification_commissions.sql defines fs_* tables
--     but was never applied). Options:
--       1. Apply the Clostra migration if gamification is a V1 feature.
--       2. Drop the migration file if gamification is deferred/cancelled.
--   - Commissions: same story (fs_commission_rules, fs_commission_entries).
--   - GPS tracking: fs_gps_points not created; current GPS breadcrumbs live in
--     `tracking_points` (80 rows) and `tracking_live_locations` instead.
--
-- Clostra Next.js app's own DB mirrors (feed_posts, badges, etc. in Clostra
-- project) remain separate. They will be removable after Clostra is folded
-- into Lume — see memory/audit_reports/clostra_port_plan.md.
-- ============================================================================
