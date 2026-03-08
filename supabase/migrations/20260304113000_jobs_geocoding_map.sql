begin;

alter table public.jobs
  add column if not exists latitude double precision null,
  add column if not exists longitude double precision null,
  add column if not exists geocoded_at timestamptz null,
  add column if not exists geocode_status text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_geocode_status_check'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_geocode_status_check
      check (geocode_status is null or geocode_status in ('ok', 'failed', 'pending'));
  end if;
end;
$$;

create index if not exists idx_jobs_org_lat_lng
  on public.jobs (org_id, latitude, longitude)
  where deleted_at is null;

create index if not exists idx_schedule_events_org_start_at
  on public.schedule_events (org_id, start_at);

commit;
