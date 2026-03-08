begin;

create or replace function public.hard_delete_client(p_org_id uuid, p_client_id uuid)
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
  v_invoice_items integer := 0;
  v_notes integer := 0;
  v_has_leads_client_id boolean := false;
  v_protected_jobs integer := 0;
  v_protected_invoices integer := 0;
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

  select count(*)::int
  into v_protected_jobs
  from public.jobs j
  where j.org_id = p_org_id
    and j.client_id = p_client_id
    and j.deleted_at is null
    and lower(coalesce(j.status, 'draft')) in ('scheduled', 'in_progress', 'completed');

  if to_regclass('public.invoices') is not null then
    begin
      execute $sql$
        select count(*)::int
        from public.invoices i
        where i.org_id = $1
          and i.client_id = $2
          and i.deleted_at is null
          and lower(coalesce(i.status, 'draft')) in ('paid', 'sent')
      $sql$
      into v_protected_invoices
      using p_org_id, p_client_id;
    exception when others then
      v_protected_invoices := 0;
    end;
  end if;

  if v_protected_jobs > 0 or v_protected_invoices > 0 then
    raise exception 'Cannot delete: linked scheduled/completed jobs or paid invoices. Use archive instead.'
      using errcode = 'P0001';
  end if;

  select exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'client_id'
  ) into v_has_leads_client_id;

  if to_regclass('public.invoice_items') is not null and to_regclass('public.invoices') is not null then
    begin
      execute $sql$
        delete from public.invoice_items ii
        using public.invoices i
        where ii.invoice_id = i.id
          and i.org_id = $1
          and i.client_id = $2
          and i.deleted_at is null
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_invoice_items = row_count;
    exception when others then
      v_invoice_items := 0;
    end;
  end if;

  if to_regclass('public.invoices') is not null then
    begin
      execute $sql$
        delete from public.invoices
        where org_id = $1
          and client_id = $2
          and deleted_at is null
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_invoices = row_count;
    exception when others then
      v_invoices := 0;
    end;
  end if;

  delete from public.jobs
  where org_id = p_org_id
    and client_id = p_client_id
    and deleted_at is null
    and lower(coalesce(status, 'draft')) not in ('scheduled', 'in_progress', 'completed');
  get diagnostics v_jobs = row_count;

  if v_has_leads_client_id then
    delete from public.leads
    where org_id = p_org_id
      and deleted_at is null
      and (
        client_id = p_client_id
        or converted_to_client_id = p_client_id
      );
  else
    delete from public.leads
    where org_id = p_org_id
      and deleted_at is null
      and converted_to_client_id = p_client_id;
  end if;
  get diagnostics v_leads = row_count;

  if to_regclass('public.notes') is not null then
    begin
      execute $sql$
        delete from public.notes
        where org_id = $1
          and client_id = $2
      $sql$
      using p_org_id, p_client_id;
      get diagnostics v_notes = row_count;
    exception when others then
      v_notes := 0;
    end;
  end if;

  delete from public.clients
  where id = p_client_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_client = row_count;

  if v_client = 0 then
    raise exception 'Client not found or already deleted.' using errcode = 'P0002';
  end if;

  if to_regclass('public.audit_events') is not null then
    begin
      execute
        'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
         values ($1, $2, $3, $4::jsonb, now())'
      using p_org_id, v_uid, 'client.hard_deleted',
        jsonb_build_object(
          'client_id', p_client_id,
          'client', v_client,
          'jobs', v_jobs,
          'leads', v_leads,
          'invoices', v_invoices,
          'invoice_items', v_invoice_items,
          'notes', v_notes
        );
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object(
    'client', v_client,
    'jobs', v_jobs,
    'leads', v_leads,
    'invoices', v_invoices,
    'invoice_items', v_invoice_items,
    'notes', v_notes
  );
end;
$$;

revoke all on function public.hard_delete_client(uuid, uuid) from public;
grant execute on function public.hard_delete_client(uuid, uuid) to authenticated, service_role;

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs
  add constraint jobs_status_check
  check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'));

commit;
