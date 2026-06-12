-- ============================================================
-- MIGRATION: per-subscription extra-office billing columns
-- ------------------------------------------------------------
-- Mirrors the extra_seats / stripe_seat_item_id pattern already used for
-- seat billing. Tracks how many EXTRA offices an org has bought beyond the
-- plan's included_offices, plus the Stripe subscription item that bills them.
-- NOTE: the live DB is managed by hand in the Supabase dashboard — run the
-- same statements in the SQL editor to apply them to production.
-- ============================================================

begin;

alter table public.subscriptions
  add column if not exists extra_offices         integer not null default 0,
  add column if not exists stripe_office_item_id text;

commit;
