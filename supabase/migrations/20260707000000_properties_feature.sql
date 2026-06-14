-- ════════════════════════════════════════════════════════════════════
-- Properties feature
-- ────────────────────────────────────────────────────────────────────
-- A `property` is a service location that BELONGS TO a client. A client
-- can have many properties; each has a NAME + a (structured) ADDRESS.
-- Jobs, quotes and invoices must each be assigned to a property
-- (property_id NOT NULL).
--
-- Design notes:
--  * Address moves OFF the client at the product level (the client form no
--    longer collects it). The legacy clients.address* columns are kept
--    (dormant) so existing RPCs/search keep working; the one-time backfill
--    below seeds each client's primary property from them.
--  * property_id is filled automatically on INSERT by BEFORE-INSERT triggers
--    (from a linked job, else the client's primary property). This keeps
--    EVERY existing insert path working unchanged — the pipeline RPCs
--    (rpc_create_job_with_optional_schedule, create_minimal_job_for_deal,
--    create_job_from_intent, create_invoice_from_job, rpc_create_invoice_draft,
--    rpc_create_quote) and the server-side recurring engines. The UI passes
--    the user-selected property explicitly (overriding the default).
-- ════════════════════════════════════════════════════════════════════

begin;

-- ── 1. properties table ────────────────────────────────────────────
create table if not exists public.properties (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null,
  client_id     uuid not null references public.clients(id) on delete cascade,
  name          text not null,
  -- structured address, mirrors clients
  address       text,
  street_number text,
  street_name   text,
  city          text,
  province      text,
  postal_code   text,
  country       text,
  latitude      numeric,
  longitude     numeric,
  place_id      text,
  is_primary    boolean not null default false,
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists idx_properties_org_id      on public.properties (org_id);
create index if not exists idx_properties_client_id   on public.properties (client_id);
create index if not exists idx_properties_org_deleted on public.properties (org_id, deleted_at);
-- at most one primary (non-deleted) property per client
create unique index if not exists uq_properties_primary_per_client
  on public.properties (client_id) where is_primary = true and deleted_at is null;

-- standard triggers (match clients: set_updated_at + crm_enforce_scope)
drop trigger if exists trg_properties_set_updated_at on public.properties;
create trigger trg_properties_set_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

drop trigger if exists trg_properties_enforce_scope on public.properties;
create trigger trg_properties_enforce_scope
  before insert on public.properties
  for each row execute function public.crm_enforce_scope();

-- active view, matching clients_active / jobs_active convention
create or replace view public.properties_active as
  select * from public.properties where deleted_at is null;

-- ── 2. RLS (mirror clients: members read/write, admins delete) ──────
alter table public.properties enable row level security;

drop policy if exists properties_select on public.properties;
drop policy if exists properties_insert on public.properties;
drop policy if exists properties_update on public.properties;
drop policy if exists properties_delete on public.properties;

create policy properties_select on public.properties
  for select to authenticated
  using (public.has_org_membership((select auth.uid()), properties.org_id));

create policy properties_insert on public.properties
  for insert to authenticated
  with check (public.has_org_membership((select auth.uid()), properties.org_id));

create policy properties_update on public.properties
  for update to authenticated
  using  (public.has_org_membership((select auth.uid()), properties.org_id))
  with check (public.has_org_membership((select auth.uid()), properties.org_id));

create policy properties_delete on public.properties
  for delete to authenticated
  using  (public.has_org_membership((select auth.uid()), properties.org_id));

-- ── 3. helper: resolve a client's default property ─────────────────
-- Returns the primary property if any, else the oldest non-deleted one.
create or replace function public.resolve_primary_property(p_client_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.properties p
  where p.client_id = p_client_id
    and p.deleted_at is null
  order by p.is_primary desc, p.created_at asc
  limit 1
$$;

-- ── 4. backfill: one primary property per client (all clients) ─────
-- Includes soft-deleted clients so their jobs/quotes/invoices can still be
-- backfilled. created_by/org_id are passed explicitly (service-role context
-- has no auth.uid(), and crm_enforce_scope requires them non-null then).
insert into public.properties (
  org_id, client_id, name, is_primary, created_by,
  address, street_number, street_name, city, province, postal_code, country,
  latitude, longitude, place_id
)
select
  c.org_id,
  c.id,
  'Adresse principale',
  true,
  coalesce(c.created_by, gen_random_uuid()),
  c.address, c.street_number, c.street_name, c.city, c.province, c.postal_code, c.country,
  c.latitude, c.longitude, c.place_id
from public.clients c
-- guard against re-runs
where not exists (
  select 1 from public.properties p
  where p.client_id = c.id and p.is_primary = true and p.deleted_at is null
);

-- ── 5. add property_id to jobs / quotes / invoices ─────────────────
alter table public.jobs     add column if not exists property_id uuid;
alter table public.quotes   add column if not exists property_id uuid;
alter table public.invoices add column if not exists property_id uuid;

-- 5a. backfill each row to its client's primary property
update public.jobs j
   set property_id = public.resolve_primary_property(j.client_id)
 where j.property_id is null and j.client_id is not null;

update public.quotes q
   set property_id = public.resolve_primary_property(q.client_id)
 where q.property_id is null and q.client_id is not null;

update public.invoices i
   set property_id = public.resolve_primary_property(i.client_id)
 where i.property_id is null and i.client_id is not null;

-- 5b. orphan JOBS (NULL client, or client with no resolvable property): jobs
-- are the only entity made NOT NULL, so they must all get a property. Attach
-- orphans to a per-org "Adresse inconnue" placeholder property (client kept
-- soft-deleted/inactive so it never shows in lists). Runs ONLY if orphan jobs
-- exist — no placeholder otherwise. Avoids destructive deletes / FK surprises.
-- Quotes & invoices stay nullable (a quote can target a prospect with no
-- client yet), so they need no placeholder.
do $$
declare
  r        record;
  v_client uuid;
  v_prop   uuid;
begin
  for r in (
    select distinct org_id from public.jobs
    where property_id is null and org_id is not null
  ) loop
    insert into public.clients (org_id, created_by, first_name, last_name, status, deleted_at)
      values (r.org_id, gen_random_uuid(), 'Adresse', 'inconnue', 'inactive', now())
      returning id into v_client;

    insert into public.properties (org_id, client_id, name, is_primary, created_by)
      values (r.org_id, v_client, 'Adresse inconnue', true, gen_random_uuid())
      returning id into v_prop;

    update public.jobs set property_id = v_prop where org_id = r.org_id and property_id is null;

    raise notice 'Properties backfill: created placeholder property % for org % (orphan jobs)', v_prop, r.org_id;
  end loop;
end $$;

-- 5c. enforce NOT NULL on jobs only. Quotes/invoices remain nullable but are
-- auto-filled by the triggers below whenever a client/job exists.
alter table public.jobs alter column property_id set not null;

-- 5d. foreign keys (cascade so hard-deleting a client → properties →
-- its jobs/quotes/invoices all chain cleanly; the app uses soft-delete so
-- this only matters for true row deletes)
alter table public.jobs
  drop constraint if exists jobs_property_id_fkey,
  add  constraint jobs_property_id_fkey
       foreign key (property_id) references public.properties(id) on delete cascade;

alter table public.quotes
  drop constraint if exists quotes_property_id_fkey,
  add  constraint quotes_property_id_fkey
       foreign key (property_id) references public.properties(id) on delete cascade;

alter table public.invoices
  drop constraint if exists invoices_property_id_fkey,
  add  constraint invoices_property_id_fkey
       foreign key (property_id) references public.properties(id) on delete cascade;

-- 5e. indexes on the new FK columns
create index if not exists idx_jobs_property_id     on public.jobs (property_id);
create index if not exists idx_quotes_property_id   on public.quotes (property_id);
create index if not exists idx_invoices_property_id on public.invoices (property_id);

-- 5f. recreate jobs_active so it surfaces property_id (`select *` view
-- freezes its column list; jobsApi reads from jobs_active)
create or replace view public.jobs_active as
  select * from public.jobs where deleted_at is null;

-- ── 6. auto-fill triggers (the safety net for every insert path) ───
-- jobs: default property_id to the client's primary property when omitted.
create or replace function public.jobs_fill_property_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.property_id is null and new.client_id is not null then
    new.property_id := public.resolve_primary_property(new.client_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_fill_property_id on public.jobs;
create trigger trg_jobs_fill_property_id
  before insert on public.jobs
  for each row execute function public.jobs_fill_property_id();

-- quotes/invoices: default to the linked job's property, else the client's
-- primary property.
create or replace function public.fill_property_id_from_job_or_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.property_id is null and new.job_id is not null then
    select j.property_id into new.property_id from public.jobs j where j.id = new.job_id;
  end if;
  if new.property_id is null and new.client_id is not null then
    new.property_id := public.resolve_primary_property(new.client_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_quotes_fill_property_id on public.quotes;
create trigger trg_quotes_fill_property_id
  before insert on public.quotes
  for each row execute function public.fill_property_id_from_job_or_client();

drop trigger if exists trg_invoices_fill_property_id on public.invoices;
create trigger trg_invoices_fill_property_id
  before insert on public.invoices
  for each row execute function public.fill_property_id_from_job_or_client();

commit;

notify pgrst, 'reload schema';
