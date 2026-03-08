begin;

create extension if not exists pgcrypto;

alter table public.jobs add column if not exists job_number text;
alter table public.jobs add column if not exists end_at timestamptz;
alter table public.jobs add column if not exists salesperson_id uuid;
alter table public.jobs add column if not exists requires_invoicing boolean not null default false;
alter table public.jobs add column if not exists billing_split boolean not null default false;
alter table public.jobs add column if not exists currency text not null default 'CAD';
alter table public.jobs add column if not exists total_cents integer not null default 0;
alter table public.jobs add column if not exists job_type text;

create table if not exists public.job_line_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  created_by uuid not null default auth.uid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null,
  qty numeric(10,2) not null default 1,
  unit_price_cents integer not null default 0,
  total_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_jobs_org_created_at on public.jobs (org_id, created_at desc);
create index if not exists idx_jobs_org_scheduled_at on public.jobs (org_id, scheduled_at);
create index if not exists idx_jobs_org_status on public.jobs (org_id, status);
create index if not exists idx_jobs_org_client_id on public.jobs (org_id, client_id);
create index if not exists idx_job_line_items_org_job on public.job_line_items (org_id, job_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'job_line_items_qty_positive'
      and conrelid = 'public.job_line_items'::regclass
  ) then
    alter table public.job_line_items
      add constraint job_line_items_qty_positive check (qty > 0);
  end if;
end $$;

drop trigger if exists trg_job_line_items_set_updated_at on public.job_line_items;
create trigger trg_job_line_items_set_updated_at
before update on public.job_line_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_job_line_items_enforce_scope on public.job_line_items;
create trigger trg_job_line_items_enforce_scope
before insert on public.job_line_items
for each row execute function public.crm_enforce_scope();

alter table public.job_line_items enable row level security;

drop policy if exists job_line_items_select_org on public.job_line_items;
drop policy if exists job_line_items_insert_org on public.job_line_items;
drop policy if exists job_line_items_update_org on public.job_line_items;
drop policy if exists job_line_items_delete_org on public.job_line_items;

create policy job_line_items_select_org on public.job_line_items
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy job_line_items_insert_org on public.job_line_items
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());

create policy job_line_items_update_org on public.job_line_items
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy job_line_items_delete_org on public.job_line_items
for delete to authenticated
using (public.has_org_membership(auth.uid(), org_id));

commit;
