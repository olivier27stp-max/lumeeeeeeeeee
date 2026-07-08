-- ============================================================
-- MIGRATION: Plan intro promo (recurring full price + 3-month intro discount)
-- ------------------------------------------------------------
-- NOTE: the live `public.plans` table is managed BY HAND in the Supabase
-- dashboard (slugs, flags, seat + stripe_* columns were added there, not via
-- migrations). This file documents the change for version control — run the
-- same statements in the Supabase SQL editor to apply them to production.
-- Prices are stored in CENTS, like every other *_price_* column ($150 = 15000).
--
-- WHY: today the base monthly/yearly_price_* columns hold the PROMO price, and
-- the promo is never applied at the Stripe layer. We invert this: base columns
-- become the FULL recurring price, and the 3-month intro discount is expressed
-- as intro_price_* + a persisted Stripe Coupon id. Keeping the base Stripe Price
-- at full price is REQUIRED so the webhook plan-matcher (payments.ts, matches by
-- price.unit_amount) stays correct across the intro -> full transition.
-- ============================================================

begin;

-- 1) Schema: intro promo config (nullable — NULL means "no intro promo")
alter table public.plans add column if not exists intro_months                     integer;
alter table public.plans add column if not exists intro_price_monthly_usd          integer;
alter table public.plans add column if not exists intro_price_monthly_cad          integer;
alter table public.plans add column if not exists intro_price_yearly_usd           integer;
alter table public.plans add column if not exists intro_price_yearly_cad           integer;

-- Persisted Stripe Coupon ids (mirrors the existing stripe_*_price_id_* pattern).
-- One coupon per interval x currency; created by scripts/sync-stripe-products-live.ts.
alter table public.plans add column if not exists stripe_intro_coupon_id_monthly_usd text;
alter table public.plans add column if not exists stripe_intro_coupon_id_monthly_cad text;
alter table public.plans add column if not exists stripe_intro_coupon_id_yearly_usd  text;
alter table public.plans add column if not exists stripe_intro_coupon_id_yearly_cad  text;

-- ============================================================
-- 2) BACKFILL — confirmed pricing (William, 2026-07-07). Review, then run in the
--    Supabase SQL editor against production.
-- ------------------------------------------------------------
-- Model (confirmed 2026-07-07): base monthly/yearly_price_* = FULL price. NO
-- monthly promo. Annual has a first-year 15% one-time discount on the single
-- annual invoice (coupon duration:'once'), stored as intro_price_yearly_cad =
-- the discounted first-year total. USD mirrors CAD full price with no USD intro
-- coupon (CAD-only launch). Yearly full = full_monthly * 0.85 * 12; first-year =
-- round(yearly_full * 0.85). Amounts in cents. Base columns still hold OLD promo.
-- ============================================================

-- Minimum (starter): full 150/mo; annual full 1530/yr; annual year-1 = 1300 (-15%)
update public.plans set
  intro_months            = 3,
  intro_price_yearly_cad  = 130000,     -- year-1 annual price (-15% one-time)
  intro_price_yearly_usd  = null,       -- CAD-only launch
  intro_price_monthly_usd = null, intro_price_monthly_cad = null,  -- no monthly promo
  monthly_price_usd = 15000,  monthly_price_cad = 15000,           -- FULL 150
  yearly_price_usd  = 153000, yearly_price_cad = 153000            -- FULL 1530
where slug = 'starter';

-- Scale (pro): full 340/mo; annual full 3468/yr; annual year-1 = 2948 (-15%)
update public.plans set
  intro_months            = 3,
  intro_price_yearly_cad  = 294800,
  intro_price_yearly_usd  = null,
  intro_price_monthly_usd = null, intro_price_monthly_cad = null,
  monthly_price_usd = 34000,  monthly_price_cad = 34000,           -- FULL 340
  yearly_price_usd  = 346800, yearly_price_cad = 346800            -- FULL 3468
where slug = 'pro';

-- Autopilot: full 495/mo; annual full 5049/yr; annual year-1 = 4292 (-15%)
update public.plans set
  intro_months            = 3,
  intro_price_yearly_cad  = 429200,
  intro_price_yearly_usd  = null,
  intro_price_monthly_usd = null, intro_price_monthly_cad = null,
  monthly_price_usd = 49500,  monthly_price_cad = 49500,           -- FULL 495
  yearly_price_usd  = 504900, yearly_price_cad = 504900            -- FULL 5049
where slug = 'autopilot';

commit;
