begin;

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------
-- Role helpers
-- -------------------------------------------------------------------
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

-- -------------------------------------------------------------------
-- Leads schema hardening (soft delete + stage split)
-- -------------------------------------------------------------------
alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists deleted_by uuid;
alter table public.leads add column if not exists stage text;

alter table public.leads alter column org_id set default public.current_org_id();
alter table public.leads alter column created_by set default auth.uid();

update public.leads
set stage = case lower(coalesce(stage, status, 'new'))
  when 'new' then 'new'
  when 'qualified' then 'qualified'
  when 'contacted' then 'quote_sent'
  when 'quote_sent' then 'quote_sent'
  when 'won' then 'closed'
  when 'closed' then 'closed'
  when 'lost' then 'lost'
  else 'new'
end
where stage is null
   or lower(stage) not in ('new', 'qualified', 'quote_sent', 'closed', 'lost');

alter table public.leads alter column stage set default 'new';

alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads
  add constraint leads_stage_check
  check (stage in ('new', 'qualified', 'quote_sent', 'closed', 'lost'));

create index if not exists leads_org_deleted_idx on public.leads(org_id, deleted_at);

-- -------------------------------------------------------------------
-- Jobs status normalization (separate from pipeline stage)
-- -------------------------------------------------------------------
alter table public.jobs alter column status set default 'draft';

update public.jobs
set status = case lower(coalesce(status, 'draft'))
  when 'scheduled' then 'scheduled'
  when 'in_progress' then 'in_progress'
  when 'completed' then 'completed'
  when 'cancelled' then 'cancelled'
  when 'canceled' then 'cancelled'
  when 'closed' then 'completed'
  when 'lost' then 'cancelled'
  when 'qualified' then 'draft'
  when 'quote_sent' then 'draft'
  when 'new' then 'draft'
  when 'unscheduled' then 'draft'
  when 'late' then 'scheduled'
  when 'action_required' then 'draft'
  when 'requires_invoicing' then 'completed'
  else 'draft'
end
where lower(coalesce(status, 'draft')) not in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')
   or lower(coalesce(status, 'draft')) in ('canceled', 'closed', 'lost', 'qualified', 'quote_sent', 'new', 'unscheduled', 'late', 'action_required', 'requires_invoicing');

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs
  add constraint jobs_status_check
  check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'));

create index if not exists idx_jobs_org_deleted_at on public.jobs(org_id, deleted_at);

-- -------------------------------------------------------------------
-- Leads RLS (strict org scoped, owner/admin writes)
-- -------------------------------------------------------------------
alter table public.leads enable row level security;

drop policy if exists leads_select_org on public.leads;
drop policy if exists leads_insert_org on public.leads;
drop policy if exists leads_update_org on public.leads;
drop policy if exists leads_delete_org on public.leads;
drop policy if exists leads_insert_org_scope on public.leads;

create policy leads_select_org on public.leads
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy leads_insert_org on public.leads
for insert to authenticated
with check (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
  and created_by = auth.uid()
);

create policy leads_update_org on public.leads
for update to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
)
with check (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

create policy leads_delete_org on public.leads
for delete to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

-- -------------------------------------------------------------------
-- Pipeline soft-delete metadata + RPC soft_delete_lead
-- -------------------------------------------------------------------
alter table public.pipeline_deals add column if not exists deleted_at timestamptz;
alter table public.pipeline_deals add column if not exists deleted_by uuid;

create index if not exists idx_pipeline_deals_org_deleted_idx on public.pipeline_deals(org_id, deleted_at);

create or replace function public.soft_delete_lead(p_org_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_leads integer := 0;
  v_deals integer := 0;
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
  get diagnostics v_leads = row_count;

  if v_leads = 0 then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  update public.pipeline_deals
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id
    and deleted_at is null;
  get diagnostics v_deals = row_count;

  if to_regclass('public.audit_events') is not null then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'lead.soft_deleted', jsonb_build_object(
      'lead_id', p_lead_id,
      'leads', v_leads,
      'deals', v_deals
    );
  end if;

  return jsonb_build_object('lead', v_leads, 'deals', v_deals);
end;
$fn$;

revoke all on function public.soft_delete_lead(uuid, uuid) from public;
grant execute on function public.soft_delete_lead(uuid, uuid) to authenticated, service_role;

-- -------------------------------------------------------------------
-- Ensure job creation RPCs always emit valid job statuses
-- -------------------------------------------------------------------
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
    vals := vals || quote_literal('draft');
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

create or replace function public.rpc_create_job_with_optional_schedule(
  p_lead_id uuid default null,
  p_client_id uuid default null,
  p_team_id uuid default null,
  p_title text default null,
  p_job_number text default null,
  p_job_type text default null,
  p_status text default null,
  p_address text default null,
  p_notes text default null,
  p_scheduled_at timestamptz default null,
  p_end_at timestamptz default null,
  p_timezone text default 'America/Montreal'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org_id uuid := public.current_org_id();
  v_user_id uuid := auth.uid();
  v_job_id uuid;
  v_event_id uuid;
  v_existing_job uuid;
  v_status text;
begin
  if v_org_id is null then
    raise exception 'No organization context';
  end if;

  if p_lead_id is not null then
    select id into v_existing_job
    from public.jobs
    where org_id = v_org_id
      and lead_id = p_lead_id
      and deleted_at is null
      and lower(coalesce(status, 'draft')) not in ('canceled', 'cancelled', 'completed', 'done')
    limit 1;

    if v_existing_job is not null then
      return jsonb_build_object('job_id', v_existing_job, 'event_id', null, 'existing', true);
    end if;
  end if;

  v_status := case
    when lower(coalesce(trim(p_status), '')) in ('scheduled') then 'scheduled'
    when lower(coalesce(trim(p_status), '')) in ('in_progress', 'in progress') then 'in_progress'
    when lower(coalesce(trim(p_status), '')) in ('completed', 'closed', 'done') then 'completed'
    when lower(coalesce(trim(p_status), '')) in ('cancelled', 'canceled', 'lost') then 'cancelled'
    when lower(coalesce(trim(p_status), '')) in ('draft', 'unscheduled', 'late', 'action_required', 'requires_invoicing', 'qualified', 'quote_sent', 'new') then 'draft'
    when p_scheduled_at is null then 'draft'
    else 'scheduled'
  end;

  insert into public.jobs (
    org_id, created_by, lead_id, client_id, team_id, title, job_number, job_type,
    status, property_address, notes, scheduled_at, end_at
  )
  values (
    v_org_id,
    coalesce(v_user_id, gen_random_uuid()),
    p_lead_id,
    p_client_id,
    p_team_id,
    coalesce(nullif(trim(p_title), ''), 'New job'),
    nullif(trim(p_job_number), ''),
    nullif(trim(p_job_type), ''),
    v_status,
    nullif(trim(p_address), ''),
    nullif(trim(p_notes), ''),
    p_scheduled_at,
    p_end_at
  )
  returning id into v_job_id;

  if p_scheduled_at is not null then
    insert into public.schedule_events (
      org_id, created_by, job_id, team_id, start_at, end_at, timezone, status, notes
    )
    values (
      v_org_id,
      coalesce(v_user_id, gen_random_uuid()),
      v_job_id,
      p_team_id,
      p_scheduled_at,
      coalesce(p_end_at, p_scheduled_at + interval '1 hour'),
      coalesce(nullif(trim(p_timezone), ''), 'America/Montreal'),
      'scheduled',
      nullif(trim(p_notes), '')
    )
    returning id into v_event_id;
  end if;

  return jsonb_build_object(
    'job_id', v_job_id,
    'event_id', v_event_id,
    'existing', false
  );
end;
$fn$;

create or replace function public.rpc_unschedule_job(
  p_job_id uuid,
  p_event_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if p_event_id is not null then
    update public.schedule_events
    set deleted_at = now(),
        updated_at = now()
    where id = p_event_id
      and job_id = p_job_id
      and deleted_at is null;
  else
    update public.schedule_events
    set deleted_at = now(),
        updated_at = now()
    where job_id = p_job_id
      and deleted_at is null;
  end if;

  update public.jobs
  set status = 'draft',
      scheduled_at = null,
      end_at = null,
      updated_at = now()
  where id = p_job_id
    and deleted_at is null;
end;
$fn$;

revoke all on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) from public;
revoke all on function public.rpc_create_job_with_optional_schedule(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, text) from public;
revoke all on function public.rpc_unschedule_job(uuid, uuid) from public;

grant execute on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.rpc_create_job_with_optional_schedule(uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, text) to authenticated, service_role;
grant execute on function public.rpc_unschedule_job(uuid, uuid) to authenticated, service_role;

commit;
