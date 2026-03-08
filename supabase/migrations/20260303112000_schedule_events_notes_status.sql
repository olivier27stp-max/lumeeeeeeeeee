begin;

alter table public.schedule_events
  add column if not exists status text null,
  add column if not exists notes text null;

create index if not exists idx_schedule_events_org_status
  on public.schedule_events (org_id, status);

commit;
