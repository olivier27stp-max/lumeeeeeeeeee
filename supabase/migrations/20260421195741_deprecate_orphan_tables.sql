-- ============================================================================
-- Deprecate orphan + empty tables (30-day grace period).
-- Audit refs: E-003 (24 tables ORPHAN + EMPTY, zero code references).
-- Deprecation date: 2026-04-21
-- Scheduled DROP date: 2026-05-21 (30 days)
--
-- This migration ONLY adds COMMENT ON TABLE markers. No data is dropped.
-- A follow-up migration scheduled for 2026-05-21 will DROP the tables
-- that remain unused (verify via scripts/check-deprecated-access.mjs).
--
-- Compliance tables excluded from deprecation (V1 compliance framework
-- depends on them even if currently empty): consents, dsar_requests,
-- data_export_log, rate_limits, secret_rotation_log.
--
-- Views excluded (clients_active, leads_open, pipeline_deals_active,
-- schedule_events_active, v_*) — they contain live rows, probably
-- accessed via direct PostgREST without a wrapper. Documented under
-- E-004 (live but orphan in code) for separate follow-up.
-- ============================================================================

-- AI / Agent
comment on table public.agent_chat_sessions is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.ai_message_files is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.sales_ai_recommendations is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';

-- Audit / Permissions
comment on table public.archived_records is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.object_permissions is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';

-- Automations
comment on table public.automation_executions is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs (vs automation_execution_logs which IS used).';

-- CRM / Core
comment on table public.availabilities is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.budget_targets is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.client_link_backfill_ambiguous is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Migration scratch table, zero refs.';
comment on table public.currency_rates is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.entity_comments is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.entity_tags is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';

-- Notes / Boards
comment on table public.board_members is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';

-- Director Panel (module already removed in code)
comment on table public.director_creative_directions is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Director Panel module removed in commit b763793.';

-- Field Sales (unused variants)
comment on table public.field_pin_templates is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.field_rep_performance is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.field_schedule_slots is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';

-- Jobs (unused variants)
comment on table public.job_photos is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.job_signatures is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';
comment on table public.location_logs is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';

-- Sequences / Meta
comment on table public.invoice_sequences is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). 1 row but zero code refs.';
comment on table public.quote_sequences is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). 1 row but zero code refs.';
comment on table public.pipeline_stages is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). 12 rows but zero code refs.';
comment on table public.rate_limit_buckets is 'DEPRECATED 2026-04-21 — scheduled for DROP after 2026-05-21 (30d grace). Zero code refs, zero rows.';

-- ============================================================================
-- Verification (run weekly via scripts/check-deprecated-access.mjs):
--   select relname, n_live_tup from pg_class c
--    join pg_stat_user_tables s on c.oid = s.relid
--    where relname in ( ...list above... );
-- ============================================================================
