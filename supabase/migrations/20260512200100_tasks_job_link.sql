-- ============================================================
-- Tasks ↔ Jobs linkage (AUDIT_FEATURES_2026_05_12.md)
-- Adds a typed job_id FK on tasks so we can query "all tasks for
-- this job" cheaply and cascade-clear when a job is deleted.
-- The pre-existing linked_entity_{type,id} pair remains for
-- generic links (client, lead, quote, invoice); job_id is the
-- canonical, indexed shortcut.
-- ============================================================

alter table public.tasks
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

create index if not exists tasks_job_id_idx
  on public.tasks (job_id)
  where job_id is not null and deleted_at is null;
