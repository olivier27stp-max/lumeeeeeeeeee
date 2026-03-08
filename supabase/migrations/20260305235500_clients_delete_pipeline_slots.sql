begin;

create extension if not exists pgcrypto;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  actor_id uuid null,
  action text not null,
  entity_type text not null,
  entity_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_org_created_at on public.audit_events(org_id, created_at desc);
create index if not exists idx_audit_events_entity on public.audit_events(entity_type, entity_id);

alter table if exists public.clients
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

-- Keep duplicate emails allowed, but indexed for deterministic replace.
drop index if exists public.clients_email_key;
drop index if exists public.clients_org_id_email_key;
drop index if exists public.clients_org_email_unique;
create index if not exists idx_clients_org_lower_email_active
  on public.clients(org_id, lower(email))
  where email is not null and deleted_at is null;

create or replace function public.create_client_with_duplicate_handling(
  p_org_id uuid,
  p_mode text,
  p_payload jsonb,
  p_merge_duplicates boolean default true
)
returns public.clients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := lower(coalesce(trim(p_mode), 'add'));
  v_first_name text := nullif(trim(coalesce(p_payload->>'first_name', '')), '');
  v_last_name text := nullif(trim(coalesce(p_payload->>'last_name', '')), '');
  v_company text := nullif(trim(coalesce(p_payload->>'company', '')), '');
  v_email text := nullif(trim(coalesce(p_payload->>'email', '')), '');
  v_phone text := nullif(trim(coalesce(p_payload->>'phone', '')), '');
  v_address text := nullif(trim(coalesce(p_payload->>'address', '')), '');
  v_status text := coalesce(nullif(trim(p_payload->>'status'), ''), 'active');
  v_primary public.clients%rowtype;
  v_dup record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null then
    raise exception 'p_org_id is required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  if v_first_name is null then
    v_first_name := 'Unknown';
  end if;
  if v_last_name is null then
    v_last_name := 'Client';
  end if;

  if v_mode not in ('add', 'replace') then
    raise exception 'Invalid mode: %', v_mode using errcode = '22023';
  end if;

  if v_mode = 'add' then
    insert into public.clients (
      org_id, first_name, last_name, company, email, phone, address, status, created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_uid, now()
    )
    returning * into v_primary;

    return v_primary;
  end if;

  if v_email is null then
    raise exception 'replace mode requires email' using errcode = '22023';
  end if;

  select * into v_primary
  from public.clients c
  where c.org_id = p_org_id
    and c.deleted_at is null
    and lower(coalesce(c.email, '')) = lower(v_email)
  order by c.created_at asc, c.id asc
  limit 1
  for update;

  if v_primary.id is null then
    insert into public.clients (
      org_id, first_name, last_name, company, email, phone, address, status, created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_uid, now()
    )
    returning * into v_primary;

    return v_primary;
  end if;

  update public.clients
  set
    first_name = v_first_name,
    last_name = v_last_name,
    company = v_company,
    email = v_email,
    phone = v_phone,
    address = v_address,
    status = v_status,
    updated_at = now()
  where id = v_primary.id
  returning * into v_primary;

  if p_merge_duplicates then
    for v_dup in
      select c.id
      from public.clients c
      where c.org_id = p_org_id
        and c.deleted_at is null
        and lower(coalesce(c.email, '')) = lower(v_email)
        and c.id <> v_primary.id
      order by c.created_at asc, c.id asc
    loop
      update public.jobs
      set client_id = v_primary.id, updated_at = now()
      where org_id = p_org_id and client_id = v_dup.id;

      if to_regclass('public.invoices') is not null then
        begin
          execute 'update public.invoices set client_id = $1, updated_at = now() where org_id = $2 and client_id = $3'
          using v_primary.id, p_org_id, v_dup.id;
        exception when others then
          null;
        end;
      end if;

      if to_regclass('public.payments') is not null then
        begin
          execute 'update public.payments set client_id = $1, updated_at = now() where org_id = $2 and client_id = $3'
          using v_primary.id, p_org_id, v_dup.id;
        exception when others then
          null;
        end;
      end if;

      update public.pipeline_deals
      set client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and client_id = v_dup.id;

      update public.leads
      set client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and client_id = v_dup.id;

      update public.leads
      set converted_to_client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and converted_to_client_id = v_dup.id;

      delete from public.clients
      where org_id = p_org_id
        and id = v_dup.id;
    end loop;
  end if;

  return v_primary;
end;
$$;

revoke all on function public.create_client_with_duplicate_handling(uuid, text, jsonb, boolean) from public;
grant execute on function public.create_client_with_duplicate_handling(uuid, text, jsonb, boolean) to authenticated, service_role;

create or replace function public.delete_client_cascade(
  p_org_id uuid,
  p_client_id uuid,
  p_deleted_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_deleted_by, auth.uid());
  v_client int := 0;
  v_jobs int := 0;
  v_leads int := 0;
  v_pipeline_deals int := 0;
  v_invoices int := 0;
  v_invoice_items int := 0;
  v_payments int := 0;
  v_schedule_events int := 0;
  v_job_line_items int := 0;
  v_exists int := 0;
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

  select 1 into v_exists
  from public.clients c
  where c.id = p_client_id
    and c.org_id = p_org_id
  limit 1;

  if coalesce(v_exists, 0) = 0 then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  if to_regclass('public.invoice_items') is not null and to_regclass('public.invoices') is not null then
    begin
      execute $sql$
        delete from public.invoice_items ii
        using public.invoices i
        where ii.invoice_id = i.id
          and i.org_id = $1
          and i.client_id = $2
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_invoice_items = row_count;
    exception when others then
      v_invoice_items := 0;
    end;
  end if;

  if to_regclass('public.payments') is not null then
    begin
      execute 'delete from public.payments where org_id = $1 and client_id = $2'
      using p_org_id, p_client_id;
      get diagnostics v_payments = row_count;
    exception when others then
      v_payments := 0;
    end;
  end if;

  if to_regclass('public.invoices') is not null then
    begin
      execute 'delete from public.invoices where org_id = $1 and client_id = $2'
      using p_org_id, p_client_id;
      get diagnostics v_invoices = row_count;
    exception when others then
      v_invoices := 0;
    end;
  end if;

  if to_regclass('public.schedule_events') is not null then
    begin
      execute $sql$
        delete from public.schedule_events se
        using public.jobs j
        where se.job_id = j.id
          and j.org_id = $1
          and j.client_id = $2
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_schedule_events = row_count;
    exception when others then
      v_schedule_events := 0;
    end;
  end if;

  if to_regclass('public.job_line_items') is not null then
    begin
      execute $sql$
        delete from public.job_line_items li
        using public.jobs j
        where li.job_id = j.id
          and j.org_id = $1
          and j.client_id = $2
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_job_line_items = row_count;
    exception when others then
      v_job_line_items := 0;
    end;
  end if;

  delete from public.pipeline_deals
  where org_id = p_org_id
    and client_id = p_client_id;
  get diagnostics v_pipeline_deals = row_count;

  delete from public.leads
  where org_id = p_org_id
    and (client_id = p_client_id or converted_to_client_id = p_client_id);
  get diagnostics v_leads = row_count;

  delete from public.jobs
  where org_id = p_org_id
    and client_id = p_client_id;
  get diagnostics v_jobs = row_count;

  delete from public.clients
  where id = p_client_id
    and org_id = p_org_id;
  get diagnostics v_client = row_count;

  if v_client = 0 then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_org_id,
    v_uid,
    'client.deleted',
    'client',
    p_client_id,
    jsonb_build_object(
      'client', v_client,
      'jobs', v_jobs,
      'leads', v_leads,
      'pipeline_deals', v_pipeline_deals,
      'invoices', v_invoices,
      'invoice_items', v_invoice_items,
      'payments', v_payments,
      'schedule_events', v_schedule_events,
      'job_line_items', v_job_line_items
    )
  );

  return jsonb_build_object(
    'client', v_client,
    'jobs', v_jobs,
    'leads', v_leads,
    'pipeline_deals', v_pipeline_deals,
    'invoices', v_invoices,
    'invoice_items', v_invoice_items,
    'payments', v_payments,
    'schedule_events', v_schedule_events,
    'job_line_items', v_job_line_items
  );
end;
$$;

revoke all on function public.delete_client_cascade(uuid, uuid, uuid) from public;
grant execute on function public.delete_client_cascade(uuid, uuid, uuid) to authenticated, service_role;

create or replace function public.hard_delete_client(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.delete_client_cascade(p_org_id, p_client_id, auth.uid());
end;
$$;

revoke all on function public.hard_delete_client(uuid, uuid) from public;
grant execute on function public.hard_delete_client(uuid, uuid) to authenticated, service_role;

create or replace function public.delete_lead_and_optional_client(
  p_org_id uuid,
  p_lead_id uuid,
  p_also_delete_client boolean default false,
  p_deleted_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_deleted_by, auth.uid());
  v_client_id uuid;
  v_lead int := 0;
  v_deals int := 0;
  v_jobs_unlinked int := 0;
  v_tasks int := 0;
  v_lead_lists int := 0;
  v_job_intents int := 0;
  v_client_deleted int := 0;
  v_client_result jsonb := '{}'::jsonb;
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

  select l.client_id
  into v_client_id
  from public.leads l
  where l.id = p_lead_id
    and l.org_id = p_org_id
  limit 1
  for update;

  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if to_regclass('public.tasks') is not null then
    begin
      execute 'delete from public.tasks where org_id = $1 and lead_id = $2'
      using p_org_id, p_lead_id;
      get diagnostics v_tasks = row_count;
    exception when others then
      v_tasks := 0;
    end;
  end if;

  if to_regclass('public.lead_lists') is not null then
    begin
      execute 'delete from public.lead_lists where lead_id = $1'
      using p_lead_id;
      get diagnostics v_lead_lists = row_count;
    exception when others then
      v_lead_lists := 0;
    end;
  end if;

  if to_regclass('public.job_intents') is not null then
    begin
      execute 'delete from public.job_intents where org_id = $1 and lead_id = $2'
      using p_org_id, p_lead_id;
      get diagnostics v_job_intents = row_count;
    exception when others then
      v_job_intents := 0;
    end;
  end if;

  delete from public.pipeline_deals
  where org_id = p_org_id
    and lead_id = p_lead_id;
  get diagnostics v_deals = row_count;

  update public.jobs
  set lead_id = null,
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id;
  get diagnostics v_jobs_unlinked = row_count;

  delete from public.leads
  where id = p_lead_id
    and org_id = p_org_id;
  get diagnostics v_lead = row_count;

  if v_lead = 0 then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  if p_also_delete_client and v_client_id is not null then
    v_client_result := public.delete_client_cascade(p_org_id, v_client_id, v_uid);
    v_client_deleted := coalesce((v_client_result->>'client')::int, 0);
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    p_org_id,
    v_uid,
    'lead.deleted',
    'lead',
    p_lead_id,
    jsonb_build_object(
      'lead', v_lead,
      'deals', v_deals,
      'jobs_unlinked', v_jobs_unlinked,
      'tasks', v_tasks,
      'lead_lists', v_lead_lists,
      'job_intents', v_job_intents,
      'client_deleted', v_client_deleted
    )
  );

  return jsonb_build_object(
    'lead', v_lead,
    'deals', v_deals,
    'jobs_unlinked', v_jobs_unlinked,
    'tasks', v_tasks,
    'lead_lists', v_lead_lists,
    'job_intents', v_job_intents,
    'client_deleted', v_client_deleted
  );
end;
$$;

revoke all on function public.delete_lead_and_optional_client(uuid, uuid, boolean, uuid) from public;
grant execute on function public.delete_lead_and_optional_client(uuid, uuid, boolean, uuid) to authenticated, service_role;

create table if not exists public.availabilities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  team_id uuid null references public.teams(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_minute int not null check (start_minute >= 0 and start_minute < 1440),
  end_minute int not null check (end_minute > start_minute and end_minute <= 1440),
  timezone text not null default 'America/Toronto',
  is_active boolean not null default true,
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_availabilities_org_team_weekday
  on public.availabilities(org_id, team_id, weekday)
  where is_active = true;

alter table public.availabilities enable row level security;

drop policy if exists availabilities_select_org on public.availabilities;
drop policy if exists availabilities_insert_org on public.availabilities;
drop policy if exists availabilities_update_org on public.availabilities;
drop policy if exists availabilities_delete_org on public.availabilities;

create policy availabilities_select_org on public.availabilities
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy availabilities_insert_org on public.availabilities
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id));

create policy availabilities_update_org on public.availabilities
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

create policy availabilities_delete_org on public.availabilities
for delete to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create or replace function public.get_available_slots(
  p_org_id uuid,
  p_team_id uuid default null,
  p_start_date date default current_date,
  p_days int default 14,
  p_slot_minutes int default 30,
  p_timezone text default 'America/Toronto'
)
returns table(slot_start timestamptz, slot_end timestamptz, team_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_days int := greatest(1, least(coalesce(p_days, 14), 31));
  v_slot int := greatest(15, least(coalesce(p_slot_minutes, 30), 180));
  v_tz text := coalesce(nullif(trim(p_timezone), ''), 'America/Toronto');
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null then
    raise exception 'p_org_id is required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  return query
  with days as (
    select (p_start_date + g.d)::date as day_local
    from generate_series(0, v_days - 1) as g(d)
  ),
  windows as (
    select
      d.day_local,
      a.team_id,
      a.start_minute,
      a.end_minute
    from days d
    join public.availabilities a
      on a.org_id = p_org_id
     and a.is_active = true
     and a.weekday = extract(dow from d.day_local)::int
     and (
       (p_team_id is not null and (a.team_id = p_team_id or a.team_id is null))
       or (p_team_id is null and a.team_id is null)
     )
  ),
  slots as (
    select
      ((w.day_local::timestamp + make_interval(mins => m.minute_val)) at time zone v_tz) as slot_start,
      ((w.day_local::timestamp + make_interval(mins => m.minute_val + v_slot)) at time zone v_tz) as slot_end,
      w.team_id
    from windows w
    cross join lateral generate_series(w.start_minute, w.end_minute - v_slot, v_slot) as m(minute_val)
  )
  select s.slot_start, s.slot_end, s.team_id
  from slots s
  where not exists (
    select 1
    from public.schedule_events se
    left join public.jobs j on j.id = se.job_id
    where se.org_id = p_org_id
      and se.deleted_at is null
      and coalesce(se.start_at, se.start_time) < s.slot_end
      and coalesce(se.end_at, se.end_time) > s.slot_start
      and (
        p_team_id is null
        or coalesce(se.team_id, j.team_id) = p_team_id
      )
  )
  order by s.slot_start asc;
end;
$$;

revoke all on function public.get_available_slots(uuid, uuid, date, int, int, text) from public;
grant execute on function public.get_available_slots(uuid, uuid, date, int, int, text) to authenticated, service_role;

commit;
