begin;

create extension if not exists pgcrypto;

drop function if exists public.finish_job_and_prepare_invoice(uuid, uuid);

create or replace function public.finish_job_and_prepare_invoice(
  p_org_id uuid,
  p_job_id uuid
)
returns table (
  ok boolean,
  invoice_id uuid,
  already_exists boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid := coalesce(p_org_id, public.current_org_id());
  v_payload jsonb := '{}'::jsonb;
  v_invoice_id uuid;
  v_already_exists boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if v_org_id is null or p_job_id is null then
    raise exception 'p_org_id and p_job_id are required' using errcode = '22023';
  end if;

  -- Allow every CRM member in org to finish jobs.
  if not public.has_org_membership(v_uid, v_org_id) then
    raise exception 'Forbidden for this organization.' using errcode = '42501';
  end if;

  perform 1
  from public.jobs j
  where j.id = p_job_id
    and j.org_id = v_org_id
    and j.deleted_at is null
  for update;

  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;

  update public.jobs
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where id = p_job_id
    and org_id = v_org_id
    and deleted_at is null;

  if to_regprocedure('public.create_invoice_from_job(uuid,uuid,boolean)') is not null then
    execute 'select public.create_invoice_from_job($1,$2,$3)'
      into v_payload
      using v_org_id, p_job_id, false;
  elsif to_regprocedure('public.create_invoice_from_job(uuid,uuid)') is not null then
    execute 'select public.create_invoice_from_job($1,$2)'
      into v_payload
      using v_org_id, p_job_id;
  end if;

  begin
    v_invoice_id := nullif(v_payload->>'invoice_id', '')::uuid;
  exception when others then
    v_invoice_id := null;
  end;

  if v_invoice_id is null then
    select i.id
      into v_invoice_id
    from public.invoices i
    where i.org_id = v_org_id
      and i.job_id = p_job_id
      and i.deleted_at is null
    order by i.created_at desc
    limit 1;

    v_already_exists := v_invoice_id is not null;
  else
    v_already_exists := coalesce((v_payload->>'already_exists')::boolean, false);
  end if;

  if v_invoice_id is null then
    raise exception 'Unable to prepare invoice from job.' using errcode = 'P0001';
  end if;

  return query
  select true, v_invoice_id, v_already_exists;
end;
$fn$;

revoke all on function public.finish_job_and_prepare_invoice(uuid, uuid) from public;
grant execute on function public.finish_job_and_prepare_invoice(uuid, uuid) to authenticated, service_role;

commit;
