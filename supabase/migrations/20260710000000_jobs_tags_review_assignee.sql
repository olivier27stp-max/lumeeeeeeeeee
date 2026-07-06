-- Jobs: ask-for-review flag and individual user assignment.
-- Tags were removed from jobs — they stay on clients (incl. leads) only.
-- Idempotent — safe to run multiple times.
-- Apply with: npx tsx scripts/apply-sql.ts supabase/migrations/20260710000000_jobs_tags_review_assignee.sql

alter table public.jobs add column if not exists ask_for_review boolean not null default false;
alter table public.jobs add column if not exists assigned_user_id uuid;

create index if not exists jobs_assigned_user_id_idx on public.jobs (assigned_user_id);

-- Cleanup in case an earlier version of this migration (which added jobs.tags) was applied.
drop index if exists jobs_tags_idx;
alter table public.jobs drop column if exists tags;
