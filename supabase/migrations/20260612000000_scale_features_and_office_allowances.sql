-- ============================================================
-- MIGRATION: Scale gets full feature flags + per-plan office allowances
-- ------------------------------------------------------------
-- NOTE: the live `public.plans` table is managed BY HAND in the Supabase
-- dashboard (slugs, flags and seat columns were added there, not via
-- migrations). This file documents the change for version control — run the
-- same statements in the Supabase SQL editor to apply them to production.
-- Prices are stored in CENTS, like every other *_price_* column ($100 = 10000).
-- ============================================================

begin;

-- 1) Scale (pro) now includes the same gated features as Autopilot
update public.plans
set includes_ai      = true,
    includes_d2d     = true,
    includes_courses = true,
    includes_api     = true
where slug = 'pro';

-- 2) Office allowances — mirror of the seats_included / extra_seat_price_* pattern
alter table public.plans add column if not exists included_offices       integer;
alter table public.plans add column if not exists extra_office_price_usd  integer;
alter table public.plans add column if not exists extra_office_price_cad  integer;

-- Minimum: 1 office, no additional offices offered
update public.plans
set included_offices = 1, extra_office_price_usd = null,  extra_office_price_cad = null
where slug = 'starter';

-- Scale: 2 offices, +$100/additional office
update public.plans
set included_offices = 2, extra_office_price_usd = 10000, extra_office_price_cad = 10000
where slug = 'pro';

-- Autopilot: 5 offices, +$100/additional office
update public.plans
set included_offices = 5, extra_office_price_usd = 10000, extra_office_price_cad = 10000
where slug = 'autopilot';

commit;
