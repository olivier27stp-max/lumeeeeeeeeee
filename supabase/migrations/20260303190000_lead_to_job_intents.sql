begin;

create extension if not exists pgcrypto;

-- Lead/job linkage + scheduling metadata.
alter table public.leads add column if not exists address text;
alter table public.jobs add column if not exists lead_id uuid;
alter table public.schedule_events add column if not exists timezone text;

update public.jobs set status = 'unscheduled' where status is null;
alter table public.jobs alter column status set default 'unscheduled';

-- Foreign keys and indexes.
alter table public.jobs drop constraint if exists jobs_lead_id_fkey;
alter table public.jobs
  add constraint jobs_lead_id_fkey
  foreign key (lead_id) references public.leads(id) on delete set null;

create index if not exists idx_leads_stage_slug on public.leads ((lower(coalesce(status, ''))));
create index if not exists idx_jobs_status on public.jobs (status);
create index if not exists idx_schedule_events_start_time on public.schedule_events (start_time);
create index if not exists idx_jobs_lead_id on public.jobs (lead_id);

-- Dedup: one active job per lead.
create unique index if not exists uq_jobs_active_lead
  on public.jobs (lead_id)
  where lead_id is not null
    and deleted_at is null
    and lower(coalesce(status, 'unscheduled')) not in ('done', 'canceled', 'cancelled', 'completed');

-- Job intents emitted when deal enters trigger stage.
create table if not exists public.job_intents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  deal_id uuid null references public.pipeline_deals(id) on delete set null,
  triggered_stage text not null,
  status text not null default 'pending' check (status in ('pending', 'consumed', 'canceled')),
  created_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  consumed_at timestamptz null
);

create index if not exists idx_job_intents_org_created_at on public.job_intents(org_id, created_at desc);
create index if not exists idx_job_intents_lead_status on public.job_intents(lead_id, status);
create unique index if not exists uq_job_intents_pending_lead on public.job_intents(lead_id) where status = 'pending';

alter table public.job_intents enable row level security;

-- Scope/intents trigger.
create or replace function public.pipeline_deals_emit_job_intent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_stage_slug text;
  v_active_job_exists boolean;
begin
  if new.lead_id is null then
    return new;
  end if;

  v_stage_slug := lower(replace(coalesce(new.stage, ''), ' ', '_'));

  -- Trigger stage = "qualified" by slug mapping.
  if v_stage_slug <> 'qualified' then
    return new;
  end if;

  -- Only on transition to qualified.
  if tg_op = 'UPDATE' then
    if lower(replace(coalesce(old.stage, ''), ' ', '_')) = 'qualified' then
      return new;
    end if;
  end if;

  select exists (
    select 1
    from public.jobs j
    where j.lead_id = new.lead_id
      and j.deleted_at is null
      and lower(coalesce(j.status, 'unscheduled')) not in ('done', 'canceled', 'cancelled', 'completed')
  ) into v_active_job_exists;

  if v_active_job_exists then
    return new;
  end if;

  insert into public.job_intents (org_id, lead_id, deal_id, triggered_stage, status, created_by)
  values (new.org_id, new.lead_id, new.id, v_stage_slug, 'pending', auth.uid())
  on conflict on constraint uq_job_intents_pending_lead
  do update set
    deal_id = excluded.deal_id,
    triggered_stage = excluded.triggered_stage,
    created_at = now(),
    created_by = excluded.created_by,
    org_id = excluded.org_id;

  return new;
end;
$fn$;

drop trigger if exists trg_pipeline_deals_emit_job_intent on public.pipeline_deals;
create trigger trg_pipeline_deals_emit_job_intent
after insert or update of stage on public.pipeline_deals
for each row execute function public.pipeline_deals_emit_job_intent();

-- Atomic flow: create job (+ optional schedule event) + consume intent.
create or replace function public.create_job_from_intent(
  p_intent_id uuid,
  p_lead_id uuid,
  p_title text,
  p_address text default null,
  p_notes text default null,
  p_estimated_minutes integer default 60,
  p_start_at timestamptz default null,
  p_timezone text default null,
  p_force_create_another boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_intent public.job_intents%rowtype;
  v_lead public.leads%rowtype;
  v_job_id uuid;
  v_event_id uuid;
  v_active_job_id uuid;
  v_minutes integer := greatest(coalesce(p_estimated_minutes, 60), 15);
  v_status text;
begin
  select * into v_intent
  from public.job_intents
  where id = p_intent_id
  for update;

  if v_intent.id is null then
    raise exception 'Job intent not found' using errcode = 'P0002';
  end if;
  if v_intent.status <> 'pending' then
    raise exception 'Job intent is not pending' using errcode = 'P0001';
  end if;
  if v_intent.lead_id <> p_lead_id then
    raise exception 'Intent/lead mismatch' using errcode = 'P0001';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id
  for update;

  if v_lead.id is null then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  select j.id into v_active_job_id
  from public.jobs j
  where j.lead_id = p_lead_id
    and j.deleted_at is null
    and lower(coalesce(j.status, 'unscheduled')) not in ('done', 'canceled', 'cancelled', 'completed')
  limit 1;

  if v_active_job_id is not null and not coalesce(p_force_create_another, false) then
    raise exception 'Job already exists for this lead: %', v_active_job_id using errcode = '23505';
  end if;

  v_status := case when p_start_at is null then 'unscheduled' else 'scheduled' end;

  insert into public.jobs (
    org_id, created_by, lead_id, client_id, title, notes, property_address,
    status, scheduled_at, end_at, total_amount
  )
  values (
    v_intent.org_id,
    coalesce(auth.uid(), v_intent.created_by, v_lead.created_by),
    p_lead_id,
    v_lead.converted_to_client_id,
    coalesce(nullif(trim(p_title), ''), coalesce(v_lead.title, v_lead.company, 'Lead Job')),
    nullif(trim(p_notes), ''),
    coalesce(nullif(trim(p_address), ''), nullif(trim(v_lead.address), ''), '-'),
    v_status,
    p_start_at,
    case when p_start_at is null then null else p_start_at + make_interval(mins => v_minutes) end,
    0
  )
  returning id into v_job_id;

  if p_start_at is not null then
    insert into public.schedule_events (
      org_id, created_by, job_id, start_time, end_time, status, notes, timezone
    ) values (
      v_intent.org_id,
      coalesce(auth.uid(), v_intent.created_by, v_lead.created_by),
      v_job_id,
      p_start_at,
      p_start_at + make_interval(mins => v_minutes),
      'scheduled',
      nullif(trim(p_notes), ''),
      coalesce(nullif(trim(p_timezone), ''), 'UTC')
    )
    returning id into v_event_id;
  end if;

  update public.job_intents
  set status = 'consumed',
      consumed_at = now()
  where id = v_intent.id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'schedule_event_id', v_event_id,
    'intent_status', 'consumed'
  );
end;
$fn$;

revoke all on function public.create_job_from_intent(uuid, uuid, text, text, text, integer, timestamptz, text, boolean) from public;
grant execute on function public.create_job_from_intent(uuid, uuid, text, text, text, integer, timestamptz, text, boolean) to authenticated, service_role;

-- RLS policies for job_intents.
do $do$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_intents' and policyname='job_intents_select_org') then
    create policy job_intents_select_org on public.job_intents
    for select to authenticated
    using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_intents' and policyname='job_intents_insert_org') then
    create policy job_intents_insert_org on public.job_intents
    for insert to authenticated
    with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_intents' and policyname='job_intents_update_org') then
    create policy job_intents_update_org on public.job_intents
    for update to authenticated
    using (public.has_org_membership(auth.uid(), org_id))
    with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='job_intents' and policyname='job_intents_delete_org') then
    create policy job_intents_delete_org on public.job_intents
    for delete to authenticated
    using (public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$do$;

-- Ensure RLS is enabled for core tables.
alter table public.jobs enable row level security;
alter table public.schedule_events enable row level security;

-- Make job_intents available on Realtime.
alter table public.job_intents replica identity full;
do $do$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'job_intents'
  ) then
    alter publication supabase_realtime add table public.job_intents;
  end if;
end;
$do$;

commit;
