begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- 1) Core helpers
-- ------------------------------------------------------------------
create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.org_id = p_org
      and lower(coalesce(m.role, '')) in ('owner', 'admin')
  );
$$;

revoke all on function public.has_org_admin_role(uuid, uuid) from public;
grant execute on function public.has_org_admin_role(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 2) Drop duplicate FKs (keep one canonical FK per relation)
-- ------------------------------------------------------------------
alter table if exists public.clients drop constraint if exists clients_org_fk;
alter table if exists public.jobs drop constraint if exists jobs_client_fk;
alter table if exists public.payment_provider_secrets drop constraint if exists payment_provider_secrets_org_fk;
alter table if exists public.payment_provider_settings drop constraint if exists payment_provider_settings_org_fk;

-- ------------------------------------------------------------------
-- 3) Leads normalization (status/stage + authorship coherence)
-- ------------------------------------------------------------------
alter table if exists public.leads
  add column if not exists stage text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists address text,
  add column if not exists client_id uuid;

alter table if exists public.leads drop constraint if exists leads_status_check;
alter table if exists public.leads drop constraint if exists leads_stage_check;

alter table if exists public.leads alter column status set default 'qualified';
alter table if exists public.leads alter column stage set default 'qualified';

update public.leads
set status = case lower(coalesce(status, ''))
  when 'new' then 'qualified'
  when 'lead' then 'qualified'
  when 'proposal' then 'quote_sent'
  when 'negotiation' then 'contacted'
  when 'won' then 'closed'
  when 'closed' then 'closed'
  when 'qualified' then 'qualified'
  when 'contacted' then 'contacted'
  when 'quote_sent' then 'quote_sent'
  when 'lost' then 'lost'
  else 'qualified'
end
where status is null
   or lower(coalesce(status, '')) not in (
     'new', 'lead', 'proposal', 'negotiation', 'won', 'closed',
     'qualified', 'contacted', 'quote_sent', 'lost'
   );

update public.leads
set stage = case lower(coalesce(stage, status, 'qualified'))
  when 'new' then 'qualified'
  when 'lead' then 'qualified'
  when 'proposal' then 'quote_sent'
  when 'negotiation' then 'contacted'
  when 'won' then 'closed'
  when 'closed' then 'closed'
  when 'qualified' then 'qualified'
  when 'contacted' then 'contacted'
  when 'quote_sent' then 'quote_sent'
  when 'lost' then 'lost'
  else 'qualified'
end
where stage is null
   or lower(coalesce(stage, '')) not in ('qualified', 'contacted', 'quote_sent', 'closed', 'lost');

update public.leads
set created_by = coalesce(created_by, user_id, auth.uid()),
    user_id = coalesce(user_id, created_by, auth.uid())
where created_by is null or user_id is null;

alter table if exists public.leads
  add constraint leads_status_check
  check (lower(status) in (
    'new', 'lead', 'proposal', 'negotiation', 'won', 'closed',
    'qualified', 'contacted', 'quote_sent', 'lost'
  ));

alter table if exists public.leads
  add constraint leads_stage_check
  check (stage in ('qualified', 'contacted', 'quote_sent', 'closed', 'lost'));

create index if not exists idx_leads_org_deleted_at on public.leads(org_id, deleted_at);
create index if not exists idx_leads_org_stage on public.leads(org_id, stage);
create index if not exists idx_leads_org_client_id on public.leads(org_id, client_id);

-- ------------------------------------------------------------------
-- 4) Jobs coherence (make client_id nullable for lead-first workflow)
-- ------------------------------------------------------------------
alter table if exists public.jobs
  alter column client_id drop not null;

alter table if exists public.jobs
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists completed_at timestamptz;

update public.jobs
set status = case lower(coalesce(status, 'draft'))
  when 'scheduled' then 'scheduled'
  when 'in_progress' then 'in_progress'
  when 'in progress' then 'in_progress'
  when 'completed' then 'completed'
  when 'closed' then 'completed'
  when 'done' then 'completed'
  when 'cancelled' then 'cancelled'
  when 'canceled' then 'cancelled'
  when 'lost' then 'cancelled'
  when 'new' then 'draft'
  when 'unscheduled' then 'draft'
  when 'late' then 'scheduled'
  when 'action_required' then 'draft'
  when 'requires_invoicing' then 'completed'
  else 'draft'
end
where lower(coalesce(status, 'draft')) not in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')
   or lower(coalesce(status, 'draft')) in ('in progress', 'closed', 'done', 'canceled', 'lost', 'new', 'unscheduled', 'late', 'action_required', 'requires_invoicing');

alter table if exists public.jobs drop constraint if exists jobs_status_check;
alter table if exists public.jobs
  add constraint jobs_status_check
  check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'));

create index if not exists idx_jobs_org_deleted_at on public.jobs(org_id, deleted_at);
create index if not exists idx_jobs_org_client_id on public.jobs(org_id, client_id);
create index if not exists idx_jobs_org_lead_id on public.jobs(org_id, lead_id);

-- ------------------------------------------------------------------
-- 5) Pipeline deals coherence
-- ------------------------------------------------------------------
alter table if exists public.pipeline_deals
  alter column stage_id drop not null;

alter table if exists public.pipeline_deals
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists value numeric not null default 0;

update public.pipeline_deals
set stage = case
  when stage is null then 'Qualified'
  when stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost') then stage
  else 'Qualified'
end
where stage is null or stage not in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost');

alter table if exists public.pipeline_deals drop constraint if exists pipeline_deals_stage_check;
alter table if exists public.pipeline_deals
  add constraint pipeline_deals_stage_check
  check (stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost'));

-- Keep value and value_cents coherent where both exist.
create or replace function public.pipeline_deals_sync_values()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if to_jsonb(new) ? 'value' and to_jsonb(new) ? 'value_cents' then
    if new.value is null and new.value_cents is not null then
      new.value := new.value_cents::numeric / 100;
    elsif new.value_cents is null and new.value is not null then
      new.value_cents := round(new.value * 100)::integer;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pipeline_deals_sync_values on public.pipeline_deals;
create trigger trg_pipeline_deals_sync_values
before insert or update on public.pipeline_deals
for each row execute function public.pipeline_deals_sync_values();

create index if not exists idx_pipeline_deals_org_deleted_at on public.pipeline_deals(org_id, deleted_at);
create index if not exists idx_pipeline_deals_org_client_id on public.pipeline_deals(org_id, client_id);
create index if not exists idx_pipeline_deals_org_lead_id on public.pipeline_deals(org_id, lead_id);

-- ------------------------------------------------------------------
-- 6) job_intents soft-delete support (used by delete RPC)
-- ------------------------------------------------------------------
alter table if exists public.job_intents
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz;

create index if not exists idx_job_intents_org_deleted on public.job_intents(org_id, deleted_at);

-- ------------------------------------------------------------------
-- 7) tasks org-scoped (multi-tenant safety)
-- ------------------------------------------------------------------
alter table if exists public.tasks add column if not exists org_id uuid;
update public.tasks t
set org_id = l.org_id
from public.leads l
where t.org_id is null
  and t.lead_id = l.id;

update public.tasks
set org_id = public.current_org_id()
where org_id is null;

alter table if exists public.tasks alter column org_id set default public.current_org_id();
alter table if exists public.tasks alter column org_id set not null;

alter table if exists public.tasks drop constraint if exists tasks_org_id_fkey;
alter table if exists public.tasks
  add constraint tasks_org_id_fkey
  foreign key (org_id) references public.orgs(id);

alter table if exists public.tasks enable row level security;
drop policy if exists tasks_select_org on public.tasks;
drop policy if exists tasks_insert_org on public.tasks;
drop policy if exists tasks_update_org on public.tasks;
drop policy if exists tasks_delete_org on public.tasks;

create policy tasks_select_org on public.tasks
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy tasks_insert_org on public.tasks
for insert to authenticated
with check (
  public.has_org_membership(auth.uid(), org_id)
  and coalesce(user_id, auth.uid()) = auth.uid()
);

create policy tasks_update_org on public.tasks
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy tasks_delete_org on public.tasks
for delete to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

create index if not exists idx_tasks_org_due_date on public.tasks(org_id, due_date);
create index if not exists idx_tasks_org_deleted on public.tasks(org_id, completed);

-- ------------------------------------------------------------------
-- 8) schedule_events time columns sync (start_time/end_time + start_at/end_at)
-- ------------------------------------------------------------------
create or replace function public.schedule_events_sync_time_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.start_at is null and new.start_time is not null then
    new.start_at := new.start_time;
  end if;
  if new.end_at is null and new.end_time is not null then
    new.end_at := new.end_time;
  end if;
  if new.start_time is null and new.start_at is not null then
    new.start_time := new.start_at;
  end if;
  if new.end_time is null and new.end_at is not null then
    new.end_time := new.end_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_schedule_events_sync_time_columns on public.schedule_events;
create trigger trg_schedule_events_sync_time_columns
before insert or update on public.schedule_events
for each row execute function public.schedule_events_sync_time_columns();

-- ------------------------------------------------------------------
-- 9) Backfill stable FK: jobs.client_id from deterministic references
-- ------------------------------------------------------------------
create table if not exists public.client_link_backfill_ambiguous (
  id bigserial primary key,
  org_id uuid not null,
  job_id uuid not null,
  reason text not null,
  client_name text null,
  client_email text null,
  candidate_client_ids jsonb not null,
  created_at timestamptz not null default now()
);

update public.jobs j
set client_id = l.converted_to_client_id
from public.leads l
where j.client_id is null
  and j.lead_id is not null
  and l.id = j.lead_id
  and l.org_id = j.org_id
  and l.converted_to_client_id is not null;

-- Optional email-based deterministic backfill if jobs.client_email exists.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'client_email'
  ) then
    execute $sql$
      with ranked as (
        select
          j.id as job_id,
          j.org_id,
          c.id as client_id,
          count(*) over (partition by j.id) as match_count
        from public.jobs j
        join public.clients c
          on c.org_id = j.org_id
         and c.deleted_at is null
         and lower(coalesce(c.email, '')) = lower(coalesce(j.client_email, ''))
        where j.client_id is null
          and coalesce(j.client_email, '') <> ''
      )
      update public.jobs j
      set client_id = r.client_id
      from ranked r
      where j.id = r.job_id
        and r.match_count = 1
    $sql$;
  end if;
end $$;

-- Name fallback only when exact and unique within org.
with client_names as (
  select
    c.id,
    c.org_id,
    lower(regexp_replace(trim(concat_ws(' ', coalesce(c.first_name, ''), coalesce(c.last_name, ''))), '\s+', ' ', 'g')) as normalized_name
  from public.clients c
  where c.deleted_at is null
),
job_names as (
  select
    j.id as job_id,
    j.org_id,
    lower(regexp_replace(trim(coalesce(j.client_name, '')), '\s+', ' ', 'g')) as normalized_name
  from public.jobs j
  where j.client_id is null
    and coalesce(j.client_name, '') <> ''
),
ranked as (
  select
    j.job_id,
    j.org_id,
    c.id as client_id,
    count(*) over (partition by j.job_id) as match_count
  from job_names j
  join client_names c
    on c.org_id = j.org_id
   and c.normalized_name = j.normalized_name
)
update public.jobs j
set client_id = r.client_id
from ranked r
where j.id = r.job_id
  and r.match_count = 1;

-- ------------------------------------------------------------------
-- 10) Canonical RPCs: remove overload ambiguity and unsafe dynamic SQL
-- ------------------------------------------------------------------
drop function if exists public.create_lead_and_deal(text, text, text, text, numeric, text, uuid);
drop function if exists public.create_lead_and_deal(text, text, text, text, text, numeric, text, uuid);

drop function if exists public.create_minimal_job_for_deal(uuid, uuid, uuid, text);
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
  v_job_id uuid;
begin
  insert into public.jobs (
    org_id,
    created_by,
    client_id,
    title,
    property_address,
    status
  )
  values (
    p_org_id,
    coalesce(p_created_by, auth.uid()),
    p_client_id,
    coalesce(nullif(trim(p_title), ''), 'New Deal Job'),
    '-',
    'draft'
  )
  returning id into v_job_id;

  return v_job_id;
end;
$fn$;

create or replace function public.create_lead_and_deal(
  p_full_name text,
  p_email text default null,
  p_address text default null,
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
  v_last_name text := coalesce(
    nullif(trim(substr(coalesce(p_full_name, ''), length(split_part(coalesce(p_full_name, ''), ' ', 1)) + 1)), ''),
    'Lead'
  );
  v_contact_id uuid;
  v_lead_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
begin
  if v_org_id is null then
    raise exception 'No organization context' using errcode = '42501';
  end if;

  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.has_org_membership(auth.uid(), v_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(auth.uid(), v_org_id) then
    raise exception 'Only owner/admin can create leads' using errcode = '42501';
  end if;

  insert into public.contacts (org_id, full_name, email, phone)
  values (
    v_org_id,
    nullif(trim(p_full_name), ''),
    nullif(trim(p_email), ''),
    nullif(trim(p_phone), '')
  )
  returning id into v_contact_id;

  insert into public.leads (
    org_id, created_by, user_id, first_name, last_name, email, address, phone, status, stage, contact_id
  )
  values (
    v_org_id,
    v_created_by,
    v_created_by,
    v_first_name,
    v_last_name,
    nullif(trim(p_email), ''),
    nullif(trim(p_address), ''),
    nullif(trim(p_phone), ''),
    'qualified',
    'qualified',
    v_contact_id
  )
  returning id into v_lead_id;

  v_job_id := public.create_minimal_job_for_deal(
    v_org_id,
    v_created_by,
    null,
    coalesce(nullif(trim(p_title), ''), trim(p_full_name) || ' deal')
  );

  insert into public.pipeline_deals (
    org_id, created_by, lead_id, client_id, job_id, stage, title, value, notes
  )
  values (
    v_org_id,
    v_created_by,
    v_lead_id,
    null,
    v_job_id,
    'Qualified',
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

revoke all on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) from public;
grant execute on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) to authenticated, service_role;
revoke all on function public.create_lead_and_deal(text, text, text, text, text, numeric, text, uuid) from public;
grant execute on function public.create_lead_and_deal(text, text, text, text, text, numeric, text, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 11) Canonical delete RPCs
-- ------------------------------------------------------------------
create or replace function public.soft_delete_lead(p_org_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_lead_count integer := 0;
  v_deal_count integer := 0;
  v_intent_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_lead_id is null then
    raise exception 'p_org_id and p_lead_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete leads' using errcode = '42501';
  end if;

  update public.leads
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where id = p_lead_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_lead_count = row_count;

  if v_lead_count = 0 then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  update public.pipeline_deals
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id
    and deleted_at is null;
  get diagnostics v_deal_count = row_count;

  update public.job_intents
  set deleted_at = now(),
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id
    and deleted_at is null;
  get diagnostics v_intent_count = row_count;

  return jsonb_build_object('lead', v_lead_count, 'deals', v_deal_count, 'job_intents', v_intent_count);
end;
$fn$;

create or replace function public.soft_delete_client(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_client_count integer := 0;
  v_jobs_count integer := 0;
  v_leads_count integer := 0;
  v_deals_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_client_id is null then
    raise exception 'p_org_id and p_client_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete clients' using errcode = '42501';
  end if;

  update public.clients
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where id = p_client_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_client_count = row_count;

  if v_client_count = 0 then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  update public.jobs
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and client_id = p_client_id
    and deleted_at is null;
  get diagnostics v_jobs_count = row_count;

  update public.leads
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and (converted_to_client_id = p_client_id or client_id = p_client_id)
    and deleted_at is null;
  get diagnostics v_leads_count = row_count;

  update public.pipeline_deals
  set deleted_at = now(),
      deleted_by = coalesce(deleted_by, v_uid),
      updated_at = now()
  where org_id = p_org_id
    and client_id = p_client_id
    and deleted_at is null;
  get diagnostics v_deals_count = row_count;

  return jsonb_build_object('client', v_client_count, 'jobs', v_jobs_count, 'leads', v_leads_count, 'pipeline_deals', v_deals_count);
end;
$fn$;

revoke all on function public.soft_delete_lead(uuid, uuid) from public;
revoke all on function public.soft_delete_client(uuid, uuid) from public;
grant execute on function public.soft_delete_lead(uuid, uuid) to authenticated, service_role;
grant execute on function public.soft_delete_client(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 12) Active views normalized for UI queries
-- ------------------------------------------------------------------
create or replace view public.leads_active as
select * from public.leads where deleted_at is null;

create or replace view public.clients_active as
select * from public.clients where deleted_at is null;

create or replace view public.jobs_active as
select * from public.jobs where deleted_at is null;

commit;
