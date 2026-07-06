-- ════════════════════════════════════════════════════════════════
-- Job profitability foundation
-- Adds the two missing cost inputs so the app can compute a REAL
-- profit & loss per job (instead of the fake "100% margin"):
--   • team_members.hourly_rate_cents — labour cost is derived from
--     time_entries (hours worked on a job) × this rate.
--   • jobs.expenses_cents — materials / subcontracting entered per job.
-- Profit = total_cents − labour − expenses (− commissions, later).
-- ════════════════════════════════════════════════════════════════

alter table public.team_members
  add column if not exists hourly_rate_cents integer not null default 0;

alter table public.jobs
  add column if not exists expenses_cents integer not null default 0;

comment on column public.team_members.hourly_rate_cents is
  'Employee hourly labour cost in cents; used to derive job labour cost from time_entries.';
comment on column public.jobs.expenses_cents is
  'Materials / subcontracting cost for the job in cents (manual entry).';
