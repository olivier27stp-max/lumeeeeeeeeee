-- ============================================================
-- Plan feature flags → single source of truth in the `plans` table
-- ------------------------------------------------------------
-- These 4 flags were being DERIVED in the frontend (from the plan slug) because
-- the columns didn't exist yet. This makes them real columns so the `plans`
-- table drives feature access (proper meta-table principle). The frontend
-- already reads `plan[flag] ?? <derived fallback>`, so once these exist the
-- stored value wins and the code fallback becomes moot.
--
-- ADD COLUMN IF NOT EXISTS only — never recreates/alters existing columns
-- (the plans table is partly hand-managed in the dashboard).
-- Safe to run multiple times.
-- ============================================================

alter table public.plans add column if not exists includes_automations   boolean not null default false;
alter table public.plans add column if not exists includes_timesheets     boolean not null default false;
alter table public.plans add column if not exists includes_request_forms  boolean not null default false;
alter table public.plans add column if not exists includes_marketplace    boolean not null default false;

-- Values match the confirmed plan structure:
--   Automations / Timesheets / Request forms  → Scale + Autopilot  (everything except Minimum)
--   Marketplace / integrations / webhooks      → Autopilot only
update public.plans
   set includes_automations   = (slug <> 'starter'),
       includes_timesheets    = (slug <> 'starter'),
       includes_request_forms = (slug <> 'starter'),
       includes_marketplace   = (slug = 'autopilot');

-- Sanity check (optional — comment out if running via a tool that dislikes SELECT):
-- select slug, seats_included, includes_sms, includes_courses, includes_d2d, includes_api,
--        includes_automations, includes_timesheets, includes_request_forms, includes_marketplace
--   from public.plans order by monthly_price_cad;
