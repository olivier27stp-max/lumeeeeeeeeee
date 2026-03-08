begin;

create extension if not exists pgcrypto;

alter table public.clients add column if not exists deleted_at timestamptz;
alter table public.clients add column if not exists deleted_by uuid;

alter table public.jobs add column if not exists deleted_at timestamptz;
alter table public.jobs add column if not exists deleted_by uuid;

alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists deleted_by uuid;

create index if not exists idx_jobs_org_deleted_at on public.jobs (org_id, deleted_at);
create index if not exists idx_clients_org_deleted_at on public.clients (org_id, deleted_at);
create index if not exists idx_leads_org_deleted_at on public.leads (org_id, deleted_at);

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

create or replace function public.enforce_soft_delete_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    if auth.uid() is null then
      return new;
    end if;
    if not public.has_org_admin_role(auth.uid(), new.org_id) then
      raise exception 'Only owner/admin can soft-delete records.'
        using errcode = '42501';
    end if;
    if new.deleted_by is null then
      new.deleted_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clients_enforce_soft_delete_admin on public.clients;
create trigger trg_clients_enforce_soft_delete_admin
before update on public.clients
for each row
execute function public.enforce_soft_delete_admin();

drop trigger if exists trg_jobs_enforce_soft_delete_admin on public.jobs;
create trigger trg_jobs_enforce_soft_delete_admin
before update on public.jobs
for each row
execute function public.enforce_soft_delete_admin();

drop trigger if exists trg_leads_enforce_soft_delete_admin on public.leads;
create trigger trg_leads_enforce_soft_delete_admin
before update on public.leads
for each row
execute function public.enforce_soft_delete_admin();

create or replace function public.soft_delete_job(p_org_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_jobs integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_org_id is null or p_job_id is null then
    raise exception 'p_org_id and p_job_id are required' using errcode = '22023';
  end if;
  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;
  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete jobs' using errcode = '42501';
  end if;

  update public.jobs
  set deleted_at = now(),
      deleted_by = v_uid
  where id = p_job_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_jobs = row_count;

  if to_regclass('public.audit_events') is not null and v_jobs > 0 then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'job.soft_deleted', jsonb_build_object('job_id', p_job_id, 'count', v_jobs);
  end if;

  return jsonb_build_object('job', v_jobs);
end;
$$;

create or replace function public.soft_delete_client(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_client integer := 0;
  v_jobs integer := 0;
  v_leads integer := 0;
  v_invoices integer := 0;
  v_notes integer := 0;
  v_has_leads_client_id boolean := false;
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
      deleted_by = v_uid
  where id = p_client_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_client = row_count;

  update public.jobs
  set deleted_at = now(),
      deleted_by = v_uid
  where org_id = p_org_id
    and client_id = p_client_id
    and deleted_at is null;
  get diagnostics v_jobs = row_count;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'client_id'
  ) into v_has_leads_client_id;

  if v_has_leads_client_id then
    update public.leads
    set deleted_at = now(),
        deleted_by = v_uid
    where org_id = p_org_id
      and deleted_at is null
      and (
        client_id = p_client_id
        or converted_to_client_id = p_client_id
      );
  else
    update public.leads
    set deleted_at = now(),
        deleted_by = v_uid
    where org_id = p_org_id
      and deleted_at is null
      and converted_to_client_id = p_client_id;
  end if;
  get diagnostics v_leads = row_count;

  if to_regclass('public.invoices') is not null then
    begin
      execute
        'update public.invoices
            set deleted_at = now()
          where org_id = $1
            and client_id = $2
            and deleted_at is null'
      using p_org_id, p_client_id;
      get diagnostics v_invoices = row_count;
    exception when others then
      v_invoices := 0;
    end;
  end if;

  if to_regclass('public.notes') is not null then
    begin
      execute
        'update public.notes
            set deleted_at = now()
          where org_id = $1
            and client_id = $2
            and deleted_at is null'
      using p_org_id, p_client_id;
      get diagnostics v_notes = row_count;
    exception when others then
      v_notes := 0;
    end;
  end if;

  if to_regclass('public.audit_events') is not null then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'client.soft_deleted',
      jsonb_build_object(
        'client_id', p_client_id,
        'client', v_client,
        'jobs', v_jobs,
        'leads', v_leads,
        'invoices', v_invoices,
        'notes', v_notes
      );
  end if;

  return jsonb_build_object(
    'client', v_client,
    'jobs', v_jobs,
    'leads', v_leads,
    'invoices', v_invoices,
    'notes', v_notes
  );
end;
$$;

revoke all on function public.soft_delete_job(uuid, uuid) from public;
revoke all on function public.soft_delete_client(uuid, uuid) from public;

grant execute on function public.soft_delete_job(uuid, uuid) to authenticated, service_role;
grant execute on function public.soft_delete_client(uuid, uuid) to authenticated, service_role;

commit;

