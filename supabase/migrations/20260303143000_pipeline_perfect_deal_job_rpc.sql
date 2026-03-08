begin;

-- 1) Ensure pipeline_deals has required columns
alter table public.pipeline_deals
  add column if not exists job_id uuid,
  add column if not exists stage text,
  add column if not exists title text,
  add column if not exists notes text,
  add column if not exists value numeric not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- 2) Backfill stage/title
update public.pipeline_deals pd
set stage = case
  when lower(coalesce(ps.name, '')) like '%qualif%' then 'Qualified'
  when lower(coalesce(ps.name, '')) like '%contact%' then 'Contact'
  when lower(coalesce(ps.name, '')) like '%quote%' then 'Quote Sent'
  when lower(coalesce(ps.name, '')) like '%clos%' then 'Closed'
  when lower(coalesce(ps.name, '')) like '%lost%' then 'Lost'
  else 'Qualified'
end
from public.pipeline_stages ps
where pd.stage is null
  and pd.stage_id is not null
  and ps.id = pd.stage_id;

update public.pipeline_deals
set stage = 'Qualified'
where stage is null;

update public.pipeline_deals pd
set title = coalesce(j.title, concat('Deal ', left(pd.id::text, 8)))
from public.jobs j
where pd.title is null
  and pd.job_id is not null
  and j.id = pd.job_id;

update public.pipeline_deals
set title = concat('Deal ', left(id::text, 8))
where title is null;

-- 3) Backfill job_id if missing (creates job rows)
do $$
declare
  r record;
  v_client_id uuid;
  v_job_id uuid;
begin
  for r in
    select pd.id, pd.lead_id, pd.org_id, pd.created_by, pd.title
    from public.pipeline_deals pd
    where pd.job_id is null
  loop
    select l.converted_to_client_id
      into v_client_id
      from public.leads l
     where l.id = r.lead_id;

    if v_client_id is null then
      insert into public.clients (
        org_id, created_by, first_name, last_name, email, phone, status
      )
      select
        l.org_id,
        coalesce(l.created_by, auth.uid()),
        coalesce(l.first_name, 'Unknown'),
        coalesce(l.last_name, 'Lead'),
        l.email,
        l.phone,
        'active'
      from public.leads l
      where l.id = r.lead_id
      returning id into v_client_id;
    end if;

    insert into public.jobs (
      org_id,
      created_by,
      client_id,
      title,
      property_address,
      status,
      total_cents,
      currency
    )
    values (
      coalesce(r.org_id, public.current_org_id()),
      coalesce(r.created_by, auth.uid()),
      v_client_id,
      coalesce(r.title, 'New Deal Job'),
      '-',
      'new',
      0,
      'CAD'
    )
    returning id into v_job_id;

    update public.pipeline_deals
       set job_id = v_job_id
     where id = r.id;
  end loop;
end $$;

-- 4) Constraints
alter table public.pipeline_deals
  alter column job_id set not null,
  alter column stage set not null,
  alter column title set not null;

alter table public.pipeline_deals drop constraint if exists pipeline_deals_stage_check;
alter table public.pipeline_deals
  add constraint pipeline_deals_stage_check
  check (stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost'));

alter table public.pipeline_deals drop constraint if exists pipeline_deals_job_id_key;
alter table public.pipeline_deals
  add constraint pipeline_deals_job_id_key unique (job_id);

alter table public.pipeline_deals drop constraint if exists pipeline_deals_job_id_fkey;
alter table public.pipeline_deals
  add constraint pipeline_deals_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete cascade;

-- 5) Indexes
create index if not exists idx_pipeline_deals_stage on public.pipeline_deals(stage);
create index if not exists idx_pipeline_deals_lead_id on public.pipeline_deals(lead_id);
create index if not exists idx_pipeline_deals_job_id on public.pipeline_deals(job_id);
create index if not exists idx_pipeline_deals_created_at on public.pipeline_deals(created_at desc);
create index if not exists idx_schedule_events_job_id on public.schedule_events(job_id);

-- 6) RPC atomic create deal + job
create or replace function public.create_deal_with_job(
  p_lead_id uuid,
  p_title text,
  p_value numeric,
  p_stage text,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead public.leads%rowtype;
  v_client_id uuid;
  v_job_id uuid;
  v_deal_id uuid;
  v_stage text;
begin
  select *
    into v_lead
    from public.leads
   where id = p_lead_id
   limit 1;

  if v_lead.id is null then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  v_stage := case
    when p_stage in ('Qualified', 'Contact', 'Quote Sent', 'Closed', 'Lost') then p_stage
    else 'Qualified'
  end;

  v_client_id := v_lead.converted_to_client_id;
  if v_client_id is null then
    insert into public.clients (
      org_id, created_by, first_name, last_name, email, phone, status
    )
    values (
      coalesce(v_lead.org_id, public.current_org_id()),
      coalesce(v_lead.created_by, auth.uid()),
      coalesce(v_lead.first_name, 'Unknown'),
      coalesce(v_lead.last_name, 'Lead'),
      v_lead.email,
      v_lead.phone,
      'active'
    )
    returning id into v_client_id;
  end if;

  insert into public.jobs (
    org_id,
    created_by,
    client_id,
    title,
    property_address,
    status,
    total_cents,
    currency
  )
  values (
    coalesce(v_lead.org_id, public.current_org_id()),
    coalesce(v_lead.created_by, auth.uid()),
    v_client_id,
    coalesce(nullif(trim(p_title), ''), 'New Deal Job'),
    '-',
    'new',
    0,
    'CAD'
  )
  returning id into v_job_id;

  insert into public.pipeline_deals (
    org_id,
    created_by,
    lead_id,
    job_id,
    stage,
    value,
    title,
    notes
  )
  values (
    coalesce(v_lead.org_id, public.current_org_id()),
    coalesce(v_lead.created_by, auth.uid()),
    v_lead.id,
    v_job_id,
    v_stage,
    coalesce(p_value, 0),
    coalesce(nullif(trim(p_title), ''), 'New Deal'),
    nullif(trim(p_notes), '')
  )
  returning id into v_deal_id;

  return v_deal_id;
end;
$$;

revoke all on function public.create_deal_with_job(uuid, text, numeric, text, text) from public;
grant execute on function public.create_deal_with_job(uuid, text, numeric, text, text) to authenticated, service_role;

-- 7) updated_at trigger
drop trigger if exists trg_pipeline_deals_set_updated_at on public.pipeline_deals;
create trigger trg_pipeline_deals_set_updated_at
before update on public.pipeline_deals
for each row execute function public.set_updated_at();

-- 8) RLS + minimal authenticated policies (org scoped)
alter table public.jobs enable row level security;
alter table public.leads enable row level security;
alter table public.pipeline_deals enable row level security;
alter table public.schedule_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='jobs_select_org') then
    create policy jobs_select_org on public.jobs for select to authenticated using (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='jobs_insert_org') then
    create policy jobs_insert_org on public.jobs for insert to authenticated with check (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='jobs' and policyname='jobs_update_org') then
    create policy jobs_update_org on public.jobs for update to authenticated using (public.has_org_membership(auth.uid(), org_id)) with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leads' and policyname='leads_select_org') then
    create policy leads_select_org on public.leads for select to authenticated using (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leads' and policyname='leads_insert_org') then
    create policy leads_insert_org on public.leads for insert to authenticated with check (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='leads' and policyname='leads_update_org') then
    create policy leads_update_org on public.leads for update to authenticated using (public.has_org_membership(auth.uid(), org_id)) with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pipeline_deals' and policyname='pipeline_deals_select_org') then
    create policy pipeline_deals_select_org on public.pipeline_deals for select to authenticated using (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pipeline_deals' and policyname='pipeline_deals_insert_org') then
    create policy pipeline_deals_insert_org on public.pipeline_deals for insert to authenticated with check (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pipeline_deals' and policyname='pipeline_deals_update_org') then
    create policy pipeline_deals_update_org on public.pipeline_deals for update to authenticated using (public.has_org_membership(auth.uid(), org_id)) with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='schedule_events' and policyname='schedule_events_select_org') then
    create policy schedule_events_select_org on public.schedule_events for select to authenticated using (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='schedule_events' and policyname='schedule_events_insert_org') then
    create policy schedule_events_insert_org on public.schedule_events for insert to authenticated with check (public.has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='schedule_events' and policyname='schedule_events_update_org') then
    create policy schedule_events_update_org on public.schedule_events for update to authenticated using (public.has_org_membership(auth.uid(), org_id)) with check (public.has_org_membership(auth.uid(), org_id));
  end if;
end $$;

commit;
