-- Jobs: tags, ask-for-review flag, and individual user assignment
-- Idempotent — safe to run multiple times.
-- Apply with: npx tsx scripts/apply-sql.ts supabase/migrations/20260710000000_jobs_tags_review_assignee.sql

alter table public.jobs add column if not exists tags text[] not null default '{}';
alter table public.jobs add column if not exists ask_for_review boolean not null default false;
alter table public.jobs add column if not exists assigned_user_id uuid;

create index if not exists jobs_assigned_user_id_idx on public.jobs (assigned_user_id);
create index if not exists jobs_tags_idx on public.jobs using gin (tags);
