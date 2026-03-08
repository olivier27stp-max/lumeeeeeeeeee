begin;

create extension if not exists pg_trgm;

create index if not exists idx_jobs_org_status_dashboard
  on public.jobs (org_id, status)
  where deleted_at is null;

create index if not exists idx_schedule_events_org_start_at_dashboard
  on public.schedule_events (org_id, start_at)
  where deleted_at is null;

create index if not exists idx_leads_org_status_dashboard
  on public.leads (org_id, status)
  where deleted_at is null;

create index if not exists idx_pipeline_deals_org_stage_dashboard
  on public.pipeline_deals (org_id, stage)
  where deleted_at is null;

create index if not exists idx_clients_name_trgm_dashboard
  on public.clients
  using gin (
    lower(
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(company, '')
    ) gin_trgm_ops
  );

commit;
