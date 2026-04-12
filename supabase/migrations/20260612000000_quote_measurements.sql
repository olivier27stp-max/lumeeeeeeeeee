-- Quote Measurements — satellite measurement workspace data
-- Stores geometry, labels, values, and screenshot references per quote

begin;

create table if not exists public.quote_measurements (
  id                uuid        primary key default gen_random_uuid(),
  org_id            uuid        not null default public.current_org_id(),
  quote_id          uuid        not null references public.quotes(id) on delete cascade,
  measurement_type  text        not null check (measurement_type in ('line', 'path', 'polygon')),
  label             text        not null default '',
  unit              text        not null default 'ft',
  value             numeric     not null default 0,
  area_value        numeric     null,
  perimeter_value   numeric     null,
  geojson           jsonb       not null default '{}',
  screenshot_url    text        null,
  notes             text        null,
  color             text        not null default '#FF4444',
  sort_order        integer     not null default 0,
  created_by        uuid        not null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Indexes
create index if not exists idx_quote_measurements_quote on public.quote_measurements(quote_id);
create index if not exists idx_quote_measurements_org   on public.quote_measurements(org_id);

-- RLS
alter table public.quote_measurements enable row level security;

create policy "quote_measurements_select" on public.quote_measurements
  for select using (public.has_org_membership(auth.uid(), org_id));

create policy "quote_measurements_insert" on public.quote_measurements
  for insert with check (public.has_org_membership(auth.uid(), org_id));

create policy "quote_measurements_update" on public.quote_measurements
  for update using (public.has_org_membership(auth.uid(), org_id));

create policy "quote_measurements_delete" on public.quote_measurements
  for delete using (public.has_org_membership(auth.uid(), org_id));

-- Updated_at trigger
create or replace function public.quote_measurements_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_quote_measurements_updated_at
  before update on public.quote_measurements
  for each row execute function public.quote_measurements_updated_at();

-- Grant permissions
grant select, insert, update, delete on public.quote_measurements to authenticated;
grant select, insert, update, delete on public.quote_measurements to service_role;

commit;
