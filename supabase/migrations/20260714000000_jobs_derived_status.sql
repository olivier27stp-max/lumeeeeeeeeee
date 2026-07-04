-- ═══════════════════════════════════════════════════════════════════════════
-- Jobs: visit-based derived status (4-state system)
-- ═══════════════════════════════════════════════════════════════════════════
-- Exposes public.jobs_active.derived_status, computed from the visit set
-- (schedule_events) so the badge, filters and KPIs all agree:
--
--   'requires_invoicing' : job completed but still flagged requires_invoicing
--   'archived'           : job closed (completed / cancelled)
--   'upcoming'           : active job with at least one non-cancelled FUTURE visit
--   'late'               : active job whose only past visit(s) are NOT completed
--   'action_required'    : active job with no future visit and no past *incomplete*
--                          visit (all past visits completed, or no visit at all)
--
-- Visit status vocabulary: pending | confirmed | cancelled | completed.
-- Idempotent: CREATE OR REPLACE / CREATE INDEX IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- Speed up the correlated EXISTS lookups below.
create index if not exists idx_schedule_events_job_start_at
  on public.schedule_events (job_id, start_at)
  where deleted_at is null;

create or replace view public.jobs_active with (security_invoker = true) as
  select
    j.*,
    case
      when lower(coalesce(j.status, '')) = 'completed' and j.requires_invoicing
        then 'requires_invoicing'
      when lower(coalesce(j.status, '')) in ('completed', 'cancelled', 'canceled', 'archived')
        then 'archived'
      when exists (
        select 1 from public.schedule_events se
        where se.job_id = j.id
          and se.deleted_at is null
          and se.start_at >= now()
          and lower(coalesce(se.status, '')) <> 'cancelled'
      )
        then 'upcoming'
      when exists (
        select 1 from public.schedule_events se
        where se.job_id = j.id
          and se.deleted_at is null
          and se.start_at < now()
          and lower(coalesce(se.status, '')) not in ('completed', 'cancelled')
      )
        then 'late'
      else 'action_required'
    end as derived_status
  from public.jobs j
  where j.deleted_at is null;

-- Refresh PostgREST schema cache so the new column is queryable immediately.
notify pgrst, 'reload schema';
