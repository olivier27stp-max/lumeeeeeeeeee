begin;

create extension if not exists pgcrypto;

-- Contacts as source-of-truth.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid null,
  full_name text null,
  email text null,
  phone text null,
  address_line1 text null,
  address_line2 text null,
  city text null,
  province text null,
  postal_code text null,
  country text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contacts_org_id on public.contacts(org_id);
create index if not exists idx_contacts_org_email on public.contacts(org_id, lower(email));
create index if not exists idx_contacts_org_phone on public.contacts(org_id, phone);

alter table public.leads add column if not exists contact_id uuid;
alter table public.clients add column if not exists contact_id uuid;
alter table public.jobs add column if not exists client_id uuid;
alter table public.pipeline_deals add column if not exists client_id uuid;
alter table public.pipeline_deals add column if not exists job_id uuid;
alter table public.pipeline_deals add column if not exists stage text;
alter table public.pipeline_deals add column if not exists title text;
alter table public.pipeline_deals add column if not exists notes text;
alter table public.pipeline_deals add column if not exists value numeric not null default 0;
alter table public.pipeline_deals add column if not exists created_at timestamptz not null default now();
alter table public.pipeline_deals add column if not exists updated_at timestamptz not null default now();

update public.pipeline_deals
set stage = coalesce(stage, 'Qualified'),
    title = coalesce(title, concat('Deal ', left(id::text, 8)));

-- Backfill lead/client contact_id safely.
do $do$
declare
  r record;
  v_contact_id uuid;
begin
  for r in
    select id, org_id, first_name, last_name, email, phone
    from public.leads
    where contact_id is null
  loop
    insert into public.contacts (org_id, full_name, email, phone)
    values (
      r.org_id,
      nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
      nullif(trim(r.email), ''),
      nullif(trim(r.phone), '')
    )
    returning id into v_contact_id;

    update public.leads set contact_id = v_contact_id where id = r.id;
  end loop;

  for r in
    select id, org_id, first_name, last_name, email, phone
    from public.clients
    where contact_id is null
  loop
    insert into public.contacts (org_id, full_name, email, phone)
    values (
      r.org_id,
      nullif(trim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
      nullif(trim(r.email), ''),
      nullif(trim(r.phone), '')
    )
    returning id into v_contact_id;

    update public.clients set contact_id = v_contact_id where id = r.id;
  end loop;
end;
$do$;

alter table public.leads drop constraint if exists leads_contact_id_fkey;
alter table public.leads
  add constraint leads_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete set null;

alter table public.clients drop constraint if exists clients_contact_id_fkey;
alter table public.clients
  add constraint clients_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete set null;

alter table public.jobs drop constraint if exists jobs_client_id_fkey;
alter table public.jobs
  add constraint jobs_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

alter table public.pipeline_deals drop constraint if exists pipeline_deals_lead_id_fkey;
alter table public.pipeline_deals
  add constraint pipeline_deals_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete cascade;

alter table public.pipeline_deals drop constraint if exists pipeline_deals_client_id_fkey;
alter table public.pipeline_deals
  add constraint pipeline_deals_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

alter table public.pipeline_deals drop constraint if exists pipeline_deals_job_id_fkey;
alter table public.pipeline_deals
  add constraint pipeline_deals_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete cascade;

-- Allow client-origin deals.
alter table public.pipeline_deals alter column lead_id drop not null;

-- Helper to create minimal client row safely across schema drift.
create or replace function public.create_minimal_client_for_deal(
  p_org_id uuid,
  p_created_by uuid,
  p_contact_id uuid,
  p_full_name text,
  p_email text,
  p_phone text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_first_name text := coalesce(nullif(split_part(coalesce(p_full_name, ''), ' ', 1), ''), 'Unknown');
  v_last_name text := coalesce(nullif(trim(substr(coalesce(p_full_name, ''), length(split_part(coalesce(p_full_name, ''), ' ', 1)) + 1)), ''), 'Client');
  cols text[] := array[]::text[];
  vals text[] := array[]::text[];
  sql text;
  v_client_id uuid;
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='org_id') then
    cols := cols || 'org_id';
    vals := vals || quote_literal(p_org_id::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='created_by') then
    cols := cols || 'created_by';
    vals := vals || quote_literal(p_created_by::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='first_name') then
    cols := cols || 'first_name';
    vals := vals || quote_literal(v_first_name);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='last_name') then
    cols := cols || 'last_name';
    vals := vals || quote_literal(v_last_name);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='email') then
    cols := cols || 'email';
    vals := vals || quote_literal(nullif(trim(p_email), ''));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='phone') then
    cols := cols || 'phone';
    vals := vals || quote_literal(nullif(trim(p_phone), ''));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='status') then
    cols := cols || 'status';
    vals := vals || quote_literal('active');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='contact_id') then
    cols := cols || 'contact_id';
    vals := vals || quote_literal(p_contact_id::text) || '::uuid';
  end if;

  sql := format(
    'insert into public.clients (%s) values (%s) returning id',
    array_to_string(cols, ','),
    array_to_string(vals, ',')
  );
  execute sql into v_client_id;
  return v_client_id;
end;
$fn$;

-- Helper to create minimal job row safely across schema drift.
create or replace function public.create_minimal_job_for_deal(
  p_org_id uuid,
  p_created_by uuid,
  p_client_id uuid,
  p_title text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  cols text[] := array[]::text[];
  vals text[] := array[]::text[];
  sql text;
  v_job_id uuid;
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='org_id') then
    cols := cols || 'org_id';
    vals := vals || quote_literal(p_org_id::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='created_by') then
    cols := cols || 'created_by';
    vals := vals || quote_literal(p_created_by::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='client_id') then
    cols := cols || 'client_id';
    vals := vals || quote_literal(p_client_id::text) || '::uuid';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='title') then
    cols := cols || 'title';
    vals := vals || quote_literal(coalesce(nullif(trim(p_title), ''), 'New Deal Job'));
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='property_address') then
    cols := cols || 'property_address';
    vals := vals || quote_literal('-');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='status') then
    cols := cols || 'status';
    vals := vals || quote_literal('scheduled');
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='total_cents') then
    cols := cols || 'total_cents';
    vals := vals || '0';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='total_amount') then
    cols := cols || 'total_amount';
    vals := vals || '0';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='currency') then
    cols := cols || 'currency';
    vals := vals || quote_literal('CAD');
  end if;

  sql := format(
    'insert into public.jobs (%s) values (%s) returning id',
    array_to_string(cols, ','),
    array_to_string(vals, ',')
  );
  execute sql into v_job_id;
  return v_job_id;
end;
$fn$;

-- Backfill missing job_id/client_id on existing deals.
do $do$
declare
  r record;
  v_org_id uuid;
  v_created_by uuid;
  v_client_id uuid;
  v_job_id uuid;
  v_contact_id uuid;
  v_full_name text;
  v_email text;
  v_phone text;
begin
  for r in
    select id, org_id, created_by, lead_id, client_id, job_id, title
    from public.pipeline_deals
    where job_id is null
  loop
    v_org_id := coalesce(r.org_id, public.current_org_id());
    v_created_by := coalesce(r.created_by, auth.uid());
    v_client_id := r.client_id;

    if v_client_id is null and r.lead_id is not null then
      select l.converted_to_client_id, l.contact_id, concat_ws(' ', l.first_name, l.last_name), l.email, l.phone
      into v_client_id, v_contact_id, v_full_name, v_email, v_phone
      from public.leads l
      where l.id = r.lead_id;

      if v_client_id is null then
        v_client_id := public.create_minimal_client_for_deal(v_org_id, v_created_by, v_contact_id, v_full_name, v_email, v_phone);
        update public.leads set converted_to_client_id = v_client_id where id = r.lead_id;
      end if;

      update public.pipeline_deals set client_id = v_client_id where id = r.id;
    end if;

    if v_client_id is null then
      v_client_id := public.create_minimal_client_for_deal(v_org_id, v_created_by, null, 'Unknown Client', null, null);
      update public.pipeline_deals set client_id = v_client_id where id = r.id;
    end if;

    v_job_id := public.create_minimal_job_for_deal(v_org_id, v_created_by, v_client_id, coalesce(r.title, 'New Deal Job'));
    update public.pipeline_deals set job_id = v_job_id where id = r.id;
  end loop;
end;
$do$;

alter table public.pipeline_deals alter column job_id set not null;

alter table public.pipeline_deals drop constraint if exists pipeline_deals_stage_check;
alter table public.pipeline_deals
  add constraint pipeline_deals_stage_check
  check (stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost'));

alter table public.pipeline_deals drop constraint if exists pipeline_deals_origin_check;
alter table public.pipeline_deals
  add constraint pipeline_deals_origin_check
  check ((lead_id is not null) or (client_id is not null));

alter table public.pipeline_deals drop constraint if exists pipeline_deals_job_id_key;
alter table public.pipeline_deals
  add constraint pipeline_deals_job_id_key unique (job_id);

create index if not exists idx_pipeline_deals_stage on public.pipeline_deals(stage);
create index if not exists idx_pipeline_deals_lead_id on public.pipeline_deals(lead_id);
create index if not exists idx_pipeline_deals_client_id on public.pipeline_deals(client_id);
create index if not exists idx_pipeline_deals_job_id on public.pipeline_deals(job_id);

create index if not exists idx_leads_contact_id on public.leads(contact_id);
create index if not exists idx_clients_contact_id on public.clients(contact_id);
create index if not exists idx_jobs_client_id on public.jobs(client_id);
create index if not exists idx_schedule_events_job_id on public.schedule_events(job_id);
create unique index if not exists uq_schedule_kickoff_per_job on public.schedule_events(job_id, notes) where notes = 'Kickoff';

drop trigger if exists trg_contacts_set_updated_at on public.contacts;
create trigger trg_contacts_set_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists trg_pipeline_deals_set_updated_at on public.pipeline_deals;
create trigger trg_pipeline_deals_set_updated_at
before update on public.pipeline_deals
for each row execute function public.set_updated_at();

-- RPC: create_lead_and_deal
create or replace function public.create_lead_and_deal(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_title text default null,
  p_value numeric default 0,
  p_notes text default null,
  p_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_id uuid := coalesce(p_org_id, public.current_org_id());
  v_created_by uuid := auth.uid();
  v_first_name text := coalesce(nullif(split_part(coalesce(p_full_name, ''), ' ', 1), ''), 'Unknown');
  v_last_name text := coalesce(nullif(trim(substr(coalesce(p_full_name, ''), length(split_part(coalesce(p_full_name, ''), ' ', 1)) + 1)), ''), 'Lead');
  v_contact_id uuid;
  v_lead_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
begin
  insert into public.contacts (org_id, full_name, email, phone)
  values (v_org_id, nullif(trim(p_full_name), ''), nullif(trim(p_email), ''), nullif(trim(p_phone), ''))
  returning id into v_contact_id;

  insert into public.leads (
    org_id, created_by, first_name, last_name, email, phone, status, contact_id
  )
  values (
    v_org_id, v_created_by, v_first_name, v_last_name, nullif(trim(p_email), ''), nullif(trim(p_phone), ''), 'new', v_contact_id
  )
  returning id into v_lead_id;

  v_job_id := public.create_minimal_job_for_deal(v_org_id, v_created_by, null, coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal'));

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id, v_created_by, v_lead_id, null, v_job_id, 'Qualified',
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return jsonb_build_object(
    'deal_id', v_deal_id,
    'lead_id', v_lead_id,
    'job_id', v_job_id
  );
end;
$fn$;

-- RPC: create_client_and_deal
create or replace function public.create_client_and_deal(
  p_full_name text,
  p_email text default null,
  p_phone text default null,
  p_title text default null,
  p_value numeric default 0,
  p_notes text default null,
  p_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_id uuid := coalesce(p_org_id, public.current_org_id());
  v_created_by uuid := auth.uid();
  v_contact_id uuid;
  v_client_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
begin
  insert into public.contacts (org_id, full_name, email, phone)
  values (v_org_id, nullif(trim(p_full_name), ''), nullif(trim(p_email), ''), nullif(trim(p_phone), ''))
  returning id into v_contact_id;

  v_client_id := public.create_minimal_client_for_deal(
    v_org_id, v_created_by, v_contact_id, p_full_name, p_email, p_phone
  );

  v_job_id := public.create_minimal_job_for_deal(
    v_org_id, v_created_by, v_client_id, coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal')
  );

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id, v_created_by, null, v_client_id, v_job_id, 'Qualified',
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return jsonb_build_object(
    'deal_id', v_deal_id,
    'client_id', v_client_id,
    'job_id', v_job_id
  );
end;
$fn$;

-- RPC: set_deal_stage (pipeline source-of-truth)
create or replace function public.set_deal_stage(
  p_deal_id uuid,
  p_stage text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deal public.pipeline_deals%rowtype;
  v_stage text;
  v_client_id uuid;
  v_contact_id uuid;
  v_full_name text;
  v_email text;
  v_phone text;
begin
  v_stage := case
    when p_stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost') then p_stage
    else null
  end;
  if v_stage is null then
    raise exception 'Invalid stage';
  end if;

  select * into v_deal
  from public.pipeline_deals
  where id = p_deal_id
  for update;

  if v_deal.id is null then
    raise exception 'Deal not found';
  end if;

  update public.pipeline_deals
  set stage = v_stage,
      updated_at = now()
  where id = v_deal.id;

  if v_stage = 'Closed' then
    v_client_id := v_deal.client_id;

    if v_client_id is null and v_deal.lead_id is not null then
      select l.converted_to_client_id, l.contact_id, concat_ws(' ', l.first_name, l.last_name), l.email, l.phone
      into v_client_id, v_contact_id, v_full_name, v_email, v_phone
      from public.leads l
      where l.id = v_deal.lead_id;

      if v_client_id is null then
        v_client_id := public.create_minimal_client_for_deal(v_deal.org_id, coalesce(v_deal.created_by, auth.uid()), v_contact_id, v_full_name, v_email, v_phone);
        update public.leads
        set converted_to_client_id = v_client_id
        where id = v_deal.lead_id;
      end if;

      update public.pipeline_deals
      set client_id = v_client_id,
          updated_at = now()
      where id = v_deal.id;
    end if;

    if v_client_id is not null then
      update public.jobs
      set client_id = v_client_id,
          status = 'completed',
          updated_at = now()
      where id = v_deal.job_id;
    else
      update public.jobs
      set status = 'completed',
          updated_at = now()
      where id = v_deal.job_id;
    end if;

    insert into public.schedule_events (org_id, created_by, job_id, start_time, end_time, status, notes)
    select
      v_deal.org_id,
      auth.uid(),
      v_deal.job_id,
      now() + interval '1 day',
      now() + interval '1 day 1 hour',
      'scheduled',
      'Kickoff'
    where not exists (
      select 1
      from public.schedule_events se
      where se.job_id = v_deal.job_id
        and se.notes = 'Kickoff'
        and se.start_time >= now()
    );

  elsif v_stage = 'Lost' then
    update public.jobs
    set status = 'cancelled',
        updated_at = now()
    where id = v_deal.job_id;
  end if;

  return (
    select jsonb_build_object(
      'id', pd.id,
      'lead_id', pd.lead_id,
      'client_id', pd.client_id,
      'job_id', pd.job_id,
      'stage', pd.stage,
      'title', pd.title,
      'value', pd.value,
      'notes', pd.notes
    )
    from public.pipeline_deals pd
    where pd.id = p_deal_id
  );
end;
$fn$;

-- Compatibility wrapper used by existing UI.
create or replace function public.create_deal_with_job(
  p_lead_id uuid,
  p_title text,
  p_value numeric,
  p_stage text,
  p_notes text,
  p_pipeline_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_deal_id uuid;
  v_org_id uuid;
  v_created_by uuid;
  v_client_id uuid;
  v_job_id uuid;
begin
  select l.org_id, coalesce(l.created_by, auth.uid()), l.converted_to_client_id
    into v_org_id, v_created_by, v_client_id
  from public.leads l
  where l.id = p_lead_id;

  if v_org_id is null then
    raise exception 'Lead not found';
  end if;

  v_job_id := public.create_minimal_job_for_deal(v_org_id, v_created_by, v_client_id, coalesce(nullif(trim(p_title), ''), 'New Deal Job'));

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id, v_created_by, p_lead_id, v_client_id, v_job_id,
    case when p_stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost') then p_stage else 'Qualified' end,
    coalesce(nullif(trim(p_title), ''), 'New Deal'),
    coalesce(p_value, 0),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return v_deal_id;
end;
$fn$;

drop function if exists public.create_deal_with_job(uuid, text, numeric, text, text);

revoke all on function public.create_minimal_client_for_deal(uuid, uuid, uuid, text, text, text) from public;
grant execute on function public.create_minimal_client_for_deal(uuid, uuid, uuid, text, text, text) to authenticated, service_role;
revoke all on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) from public;
grant execute on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) to authenticated, service_role;
revoke all on function public.create_lead_and_deal(text, text, text, text, numeric, text, uuid) from public;
grant execute on function public.create_lead_and_deal(text, text, text, text, numeric, text, uuid) to authenticated, service_role;
revoke all on function public.create_client_and_deal(text, text, text, text, numeric, text, uuid) from public;
grant execute on function public.create_client_and_deal(text, text, text, text, numeric, text, uuid) to authenticated, service_role;
revoke all on function public.set_deal_stage(uuid, text) from public;
grant execute on function public.set_deal_stage(uuid, text) to authenticated, service_role;
revoke all on function public.create_deal_with_job(uuid, text, numeric, text, text, uuid) from public;
grant execute on function public.create_deal_with_job(uuid, text, numeric, text, text, uuid) to authenticated, service_role;

-- RLS for contacts (org-scoped if org_id exists).
alter table public.contacts enable row level security;

do $do$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='contacts' and policyname='contacts_select_org') then
    create policy contacts_select_org on public.contacts
    for select to authenticated
    using (org_id is null or public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='contacts' and policyname='contacts_insert_org') then
    create policy contacts_insert_org on public.contacts
    for insert to authenticated
    with check (org_id is null or public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='contacts' and policyname='contacts_update_org') then
    create policy contacts_update_org on public.contacts
    for update to authenticated
    using (org_id is null or public.has_org_membership(auth.uid(), org_id))
    with check (org_id is null or public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$do$;

create or replace view public.pipeline_deals_active as
select *
from public.pipeline_deals
where deleted_at is null;

create or replace view public.schedule_events_active as
select *
from public.schedule_events
where deleted_at is null;

commit;
