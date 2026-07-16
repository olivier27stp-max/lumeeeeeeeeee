-- ============================================================
-- experience_level on memberships — lets the leaderboard classify reps as
-- "rookie" (first-year) vs "experienced" for category filtering.
-- Manually set by an admin. Default null = unclassified (counts as "all" only).
-- ============================================================

alter table public.memberships
  add column if not exists experience_level text
  check (experience_level in ('rookie', 'experienced'));
