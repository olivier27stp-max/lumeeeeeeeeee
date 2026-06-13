-- ============================================================================
-- Clients: "display name as company" option
-- ----------------------------------------------------------------------------
-- Lets the users who manage clients/jobs choose, per client, whether the
-- client's PRIMARY/display name should be the company name instead of the
-- personal first/last name. This is an internal (org-side) preference set by
-- staff — NOT something the client chooses on the portal.
--
-- When display_as_company = true AND company is non-empty, the app renders the
-- company as the main client name everywhere (clients list, client detail,
-- jobs, portal greeting). Otherwise it keeps the personal name.
--
-- Idempotent and safe to re-run.
-- ============================================================================

-- 1. Column ------------------------------------------------------------------
alter table public.clients
  add column if not exists display_as_company boolean not null default false;

comment on column public.clients.display_as_company is
  'When true and company is set, the company name is used as the client''s primary display name (set by org staff, not the client).';

-- 2. Recreate clients_active so SELECT * exposes the new column ---------------
--    (security_invoker preserved — reads must respect the querying user''s RLS)
create or replace view public.clients_active with (security_invoker = true) as
  select * from public.clients where deleted_at is null;

grant select on public.clients_active to authenticated, anon;

-- 3. Teach the create/duplicate-merge RPC about the new field -----------------
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
  v_display_as_company boolean := coalesce((p_payload->>'display_as_company')::boolean, false);
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
      org_id, first_name, last_name, company, email, phone, address, status, display_as_company, created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_display_as_company, v_uid, now()
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
      org_id, first_name, last_name, company, email, phone, address, status, display_as_company, created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_display_as_company, v_uid, now()
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
    display_as_company = v_display_as_company,
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
