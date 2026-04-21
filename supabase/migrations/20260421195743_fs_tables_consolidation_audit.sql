-- ============================================================================
-- fs_* vs Clostra-origin table consolidation audit (issue C-005).
-- Audit date: 2026-04-21.
--
-- NO DATA MIGRATION. This file only adds COMMENT ON TABLE metadata so the
-- schema explicitly documents the source-of-truth decision for each
-- duplicated domain concept.
--
-- Resolution:
--   - Keep the Lume `fs_*` tables as SOURCE OF TRUTH (V1 hardening landed here
--     via migration 20260613000000_clostra_gamification_commissions.sql).
--   - Clostra-origin tables (`feed_posts`, `gps_points`, `badges`, …) are to be
--     removed AFTER the Clostra Next.js app is folded into Lume — see
--     memory/audit_reports/clostra_port_plan.md.
-- ============================================================================

-- Gamification
comment on table public.fs_badges is 'Source of truth (2026-04-21). Replaces Clostra.badges. Keep.';
comment on table public.fs_rep_badges is 'Source of truth (2026-04-21). Replaces Clostra.rep_badges. Keep.';
comment on table public.fs_rep_stat_snapshots is 'Source of truth (2026-04-21). Replaces Clostra.rep_stat_snapshots. Keep.';
comment on table public.fs_challenges is 'Source of truth (2026-04-21). Replaces Clostra.challenges. Keep.';
comment on table public.fs_challenge_participants is 'Source of truth (2026-04-21). Replaces Clostra.challenge_participants. Keep.';
comment on table public.fs_battles is 'Source of truth (2026-04-21). Replaces Clostra.battles. Keep.';

-- Feed
comment on table public.fs_feed_posts is 'Source of truth (2026-04-21). Replaces Clostra.feed_posts. Keep. Feed UI still to be ported from Clostra (see clostra_port_plan.md).';
comment on table public.fs_feed_reactions is 'Source of truth (2026-04-21). Replaces Clostra.feed_reactions. Keep.';
comment on table public.fs_feed_comments is 'Source of truth (2026-04-21). Replaces Clostra.feed_comments. Keep.';

-- Commissions
comment on table public.fs_commission_rules is 'Source of truth (2026-04-21). Replaces Clostra.commission_rules. Keep.';
comment on table public.fs_commission_entries is 'Source of truth (2026-04-21). Replaces Clostra.commission_entries. Keep.';

-- Sessions / GPS
comment on table public.fs_field_sessions is 'Source of truth (2026-04-21). Replaces Clostra.field_sessions. Keep.';
comment on table public.fs_gps_points is 'Source of truth (2026-04-21). Replaces Clostra.gps_points. Keep.';
comment on table public.fs_check_in_records is 'Source of truth (2026-04-21). Replaces Clostra.check_in_records. Keep.';

-- ============================================================================
-- Follow-up: once Clostra app is removed, drop the Clostra-origin mirrors in
-- the supabase_public schema (separate migration, not auto-generated).
-- ============================================================================
