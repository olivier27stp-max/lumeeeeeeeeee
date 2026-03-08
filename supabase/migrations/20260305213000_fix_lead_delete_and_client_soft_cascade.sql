begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- 1) Lead stage/status normalization to prevent delete-time check errors
-- ------------------------------------------------------------------
alter table if exists public.leads
  add column if not exists stage text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table if exists public.leads
  alter column stage set default 'qualified';

update public.leads
set stage = case lower(coalesce(stage, status, 'qualified'))
  when 'new' then 'qualified'
  when 'lead' then 'qualified'
  when 'qualified' then 'qualified'
  when 'contacted' then 'contacted'
  when 'quote_sent' then 'quote_sent'
  when 'quote sent' then 'quote_sent'
  when 'proposal' then 'quote_sent'
  when 'negotiation' then 'contacted'
  when 'won' then 'closed'
  when 'closed' then 'closed'
  when 'lost' then 'lost'
  else 'qualified'
end
where stage is null
   or lower(coalesce(stage, '')) not in ('qualified', 'contacted', 'quote_sent', 'closed', 'lost');

alter table if exists public.leads drop constraint if exists leads_stage_check;
alter table if exists public.leads
  add constraint leads_stage_check
  check (stage in ('qualified', 'contacted', 'quote_sent', 'closed', 'lost'));

-- Keep legacy status coherent for UI/read models that still consume it.
update public.leads
set status = case lower(coalesce(status, ''))
  when 'new' then 'qualified'
  when 'lead' then 'qualified'
  when 'proposal' then 'contacted'
  when 'negotiation' then 'contacted'
  when 'won' then 'closed'
  else coalesce(nullif(lower(status), ''), 'qualified')
end
where lower(coalesce(status, '')) in ('new', 'lead', 'proposal', 'negotiation', 'won')
   or coalesce(status, '') = '';

-- ------------------------------------------------------------------
-- 2) RLS hardening for destructive actions (owner/admin only)
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

alter table if exists public.leads enable row level security;
alter table if exists public.clients enable row level security;
alter table if exists public.jobs enable row level security;

drop policy if exists leads_delete_org on public.leads;
create policy leads_delete_org on public.leads
for delete to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

drop policy if exists clients_delete_org on public.clients;
create policy clients_delete_org on public.clients
for delete to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

drop policy if exists jobs_delete_org on public.jobs;
create policy jobs_delete_org on public.jobs
for delete to authenticated
using (
  public.has_org_membership(auth.uid(), org_id)
  and public.has_org_admin_role(auth.uid(), org_id)
);

-- ------------------------------------------------------------------
-- 3) One-time backfill to stable FK (jobs.client_id -> clients.id)
--    No runtime email/name matching in app code.
-- ------------------------------------------------------------------
alter table if exists public.jobs add column if not exists client_id uuid;
create index if not exists idx_jobs_org_client_id on public.jobs(org_id, client_id);

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

-- Prefer deterministic links already present via lead conversion.
update public.jobs j
set client_id = l.converted_to_client_id
from public.leads l
where j.client_id is null
  and j.lead_id is not null
  and l.id = j.lead_id
  and l.org_id = j.org_id
  and l.converted_to_client_id is not null;

-- Optional email backfill if jobs.client_email exists.
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

    execute $sql$
      insert into public.client_link_backfill_ambiguous(org_id, job_id, reason, client_email, candidate_client_ids)
      select
        r.org_id,
        r.job_id,
        'email_ambiguous',
        j.client_email,
        jsonb_agg(r.client_id)
      from (
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
      ) r
      join public.jobs j on j.id = r.job_id
      where r.match_count > 1
      group by r.org_id, r.job_id, j.client_email
    $sql$;
  end if;
end $$;

-- Fallback: exact normalized full-name match only when unique.
with client_names as (
  select
    c.id,
    c.org_id,
    lower(regexp_replace(trim(concat_ws(' ', coalesce(c.first_name, ''), coalesce(c.last_name, ''))), '\\s+', ' ', 'g')) as normalized_name
  from public.clients c
  where c.deleted_at is null
),
job_names as (
  select
    j.id as job_id,
    j.org_id,
    lower(regexp_replace(trim(coalesce(j.client_name, '')), '\\s+', ' ', 'g')) as normalized_name
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

insert into public.client_link_backfill_ambiguous(org_id, job_id, reason, client_name, candidate_client_ids)
select
  r.org_id,
  r.job_id,
  'name_ambiguous',
  j.client_name,
  jsonb_agg(r.client_id)
from (
  with client_names as (
    select
      c.id,
      c.org_id,
      lower(regexp_replace(trim(concat_ws(' ', coalesce(c.first_name, ''), coalesce(c.last_name, ''))), '\\s+', ' ', 'g')) as normalized_name
    from public.clients c
    where c.deleted_at is null
  ),
  job_names as (
    select
      j.id as job_id,
      j.org_id,
      lower(regexp_replace(trim(coalesce(j.client_name, '')), '\\s+', ' ', 'g')) as normalized_name
    from public.jobs j
    where j.client_id is null
      and coalesce(j.client_name, '') <> ''
  )
  select
    j.job_id,
    j.org_id,
    c.id as client_id,
    count(*) over (partition by j.job_id) as match_count
  from job_names j
  join client_names c
    on c.org_id = j.org_id
   and c.normalized_name = j.normalized_name
) r
join public.jobs j on j.id = r.job_id
where r.match_count > 1
group by r.org_id, r.job_id, j.client_name;

-- Enforce FK after backfill.
alter table if exists public.jobs drop constraint if exists jobs_client_id_fkey;
alter table if exists public.jobs
  add constraint jobs_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

-- ------------------------------------------------------------------
-- 4) Fix lead delete RPC (500 root cause mitigation + clear errors)
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
      stage = case lower(coalesce(stage, status, 'qualified'))
        when 'new' then 'qualified'
        when 'lead' then 'qualified'
        when 'proposal' then 'quote_sent'
        when 'negotiation' then 'contacted'
        when 'won' then 'closed'
        else lower(coalesce(stage, 'qualified'))
      end,
      status = case lower(coalesce(status, 'qualified'))
        when 'new' then 'qualified'
        when 'lead' then 'qualified'
        when 'proposal' then 'contacted'
        when 'negotiation' then 'contacted'
        when 'won' then 'closed'
        else lower(coalesce(status, 'qualified'))
      end,
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

  if to_regclass('public.job_intents') is not null then
    update public.job_intents
    set deleted_at = now(),
        updated_at = now()
    where org_id = p_org_id
      and lead_id = p_lead_id
      and deleted_at is null;
    get diagnostics v_intent_count = row_count;
  end if;

  return jsonb_build_object(
    'lead', v_lead_count,
    'deals', v_deal_count,
    'job_intents', v_intent_count
  );
end;
$fn$;

revoke all on function public.soft_delete_lead(uuid, uuid) from public;
grant execute on function public.soft_delete_lead(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 5) Default client cascade strategy: soft_delete_client RPC
-- ------------------------------------------------------------------
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
  v_pipeline_count integer := 0;
  v_generic_count integer := 0;
  v_table record;
  v_has_deleted_by boolean;
  v_has_updated_at boolean;
  v_sql text;
  v_rowcount integer;
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
    and converted_to_client_id = p_client_id
    and deleted_at is null;
  get diagnostics v_leads_count = row_count;

  if to_regclass('public.pipeline_deals') is not null then
    update public.pipeline_deals
    set deleted_at = now(),
        deleted_by = coalesce(deleted_by, v_uid),
        updated_at = now()
    where org_id = p_org_id
      and client_id = p_client_id
      and deleted_at is null;
    get diagnostics v_pipeline_count = row_count;
  end if;

  -- Generic sweep for any org-scoped table that uses (client_id, deleted_at).
  for v_table in
    select t.table_name
    from information_schema.tables t
    join information_schema.columns c1 on c1.table_schema = t.table_schema and c1.table_name = t.table_name and c1.column_name = 'org_id'
    join information_schema.columns c2 on c2.table_schema = t.table_schema and c2.table_name = t.table_name and c2.column_name = 'client_id'
    join information_schema.columns c3 on c3.table_schema = t.table_schema and c3.table_name = t.table_name and c3.column_name = 'deleted_at'
    where t.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and t.table_name not in ('clients', 'jobs', 'leads', 'pipeline_deals', 'audit_events', 'client_link_backfill_ambiguous')
  loop
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table.table_name and column_name = 'deleted_by'
    ) into v_has_deleted_by;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = v_table.table_name and column_name = 'updated_at'
    ) into v_has_updated_at;

    v_sql := format('update public.%I set deleted_at = now()', v_table.table_name);

    if v_has_deleted_by then
      v_sql := v_sql || ', deleted_by = coalesce(deleted_by, $1)';
    end if;
    if v_has_updated_at then
      v_sql := v_sql || ', updated_at = now()';
    end if;

    v_sql := v_sql || ' where org_id = $2 and client_id = $3 and deleted_at is null';

    execute v_sql using v_uid, p_org_id, p_client_id;
    get diagnostics v_rowcount = row_count;
    v_generic_count := v_generic_count + coalesce(v_rowcount, 0);
  end loop;

  return jsonb_build_object(
    'client', v_client_count,
    'jobs', v_jobs_count,
    'leads', v_leads_count,
    'pipeline_deals', v_pipeline_count,
    'other_rows', v_generic_count
  );
end;
$fn$;

revoke all on function public.soft_delete_client(uuid, uuid) from public;
grant execute on function public.soft_delete_client(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 6) Keep lead creation aligned with the normalized stage model
-- ------------------------------------------------------------------
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
    org_id, created_by, first_name, last_name, email, phone, status, stage, contact_id
  )
  values (
    v_org_id,
    v_created_by,
    v_first_name,
    v_last_name,
    nullif(trim(p_email), ''),
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

revoke all on function public.create_lead_and_deal(text, text, text, text, numeric, text, uuid) from public;
grant execute on function public.create_lead_and_deal(text, text, text, text, numeric, text, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- 7) Optional hard-delete variant (explicitly opt-in)
-- ------------------------------------------------------------------
-- If you need hard cascades instead of soft delete, apply manually:
-- alter table public.jobs drop constraint if exists jobs_client_id_fkey;
-- alter table public.jobs add constraint jobs_client_id_fkey
--   foreign key (client_id) references public.clients(id) on delete cascade;
-- alter table public.invoices drop constraint if exists invoices_client_id_fkey;
-- alter table public.invoices add constraint invoices_client_id_fkey
--   foreign key (client_id) references public.clients(id) on delete cascade;

commit;
