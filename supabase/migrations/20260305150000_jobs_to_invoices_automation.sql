begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- Jobs schema hardening (fix missing end_at error + completion fields)
-- ------------------------------------------------------------------
alter table public.jobs add column if not exists end_at timestamptz;
alter table public.jobs add column if not exists completed_at timestamptz;
alter table public.jobs add column if not exists closed_at timestamptz;

create index if not exists idx_jobs_org_deleted_at on public.jobs (org_id, deleted_at);

-- ------------------------------------------------------------------
-- Invoices linkage to jobs + idempotency guard (1 active invoice/job)
-- ------------------------------------------------------------------
alter table public.invoices add column if not exists job_id uuid;

alter table public.invoices drop constraint if exists invoices_job_id_fkey;
alter table public.invoices
  add constraint invoices_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete set null;

create index if not exists idx_invoices_org_job on public.invoices (org_id, job_id);
create unique index if not exists uq_invoices_org_job_active
  on public.invoices (org_id, job_id)
  where deleted_at is null and job_id is not null;

-- ------------------------------------------------------------------
-- RPC: create invoice from job (idempotent)
-- ------------------------------------------------------------------
drop function if exists public.create_invoice_from_job(uuid, uuid, boolean);
create or replace function public.create_invoice_from_job(
  p_org_id uuid,
  p_job_id uuid,
  p_send_now boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_job record;
  v_existing record;
  v_invoice_id uuid;
  v_invoice_status text;
  v_invoice_number text;
  v_due_date date := (current_date + interval '14 days')::date;
  v_subtotal integer := 0;
  v_line_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_job_id is null then
    raise exception 'p_org_id and p_job_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can create invoices from jobs' using errcode = '42501';
  end if;

  select j.id, j.org_id, j.client_id, j.title, j.currency, j.total_cents, j.total_amount, j.deleted_at
    into v_job
  from public.jobs j
  where j.id = p_job_id
    and j.org_id = p_org_id
  limit 1;

  if not found or v_job.deleted_at is not null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  if v_job.client_id is null then
    raise exception 'Job must be linked to a client before invoicing' using errcode = '23514';
  end if;

  select i.id, i.status
    into v_existing
  from public.invoices i
  where i.org_id = p_org_id
    and i.job_id = p_job_id
    and i.deleted_at is null
  order by i.created_at desc
  limit 1;

  if found then
    if p_send_now and v_existing.status = 'draft' then
      update public.invoices
         set status = 'sent',
             issued_at = coalesce(issued_at, now()),
             due_date = coalesce(due_date, v_due_date),
             updated_at = now()
       where id = v_existing.id;

      select status into v_invoice_status from public.invoices where id = v_existing.id;
    else
      v_invoice_status := v_existing.status;
    end if;

    return jsonb_build_object(
      'invoice_id', v_existing.id,
      'already_exists', true,
      'status', coalesce(v_invoice_status, v_existing.status)
    );
  end if;

  v_invoice_number := public.invoice_next_number(p_org_id);

  insert into public.invoices (
    org_id,
    created_by,
    client_id,
    job_id,
    invoice_number,
    status,
    subject,
    issued_at,
    due_date,
    subtotal_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_cents
  )
  values (
    p_org_id,
    v_uid,
    v_job.client_id,
    p_job_id,
    v_invoice_number,
    case when p_send_now then 'sent' else 'draft' end,
    coalesce(nullif(trim(v_job.title), ''), 'Job invoice'),
    case when p_send_now then now() else null end,
    case when p_send_now then v_due_date else null end,
    0,
    0,
    0,
    0,
    0
  )
  returning id, status into v_invoice_id, v_invoice_status;

  insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, line_total_cents)
  select
    p_org_id,
    v_invoice_id,
    coalesce(nullif(trim(jli.name), ''), 'Job line item'),
    greatest(coalesce(jli.qty, 1), 0),
    greatest(coalesce(jli.unit_price_cents, 0), 0),
    greatest(round(coalesce(jli.qty, 1) * coalesce(jli.unit_price_cents, 0))::integer, 0)
  from public.job_line_items jli
  where jli.org_id = p_org_id
    and jli.job_id = p_job_id;

  get diagnostics v_line_count = row_count;

  if v_line_count = 0 then
    v_subtotal := greatest(
      coalesce(v_job.total_cents, round(coalesce(v_job.total_amount, 0) * 100)::integer, 0),
      0
    );

    insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, line_total_cents)
    values (
      p_org_id,
      v_invoice_id,
      coalesce(nullif(trim(v_job.title), ''), 'Job service'),
      1,
      v_subtotal,
      v_subtotal
    );
  end if;

  perform public.recalculate_invoice_totals(v_invoice_id);

  if p_send_now then
    update public.invoices
       set status = 'sent',
           issued_at = coalesce(issued_at, now()),
           due_date = coalesce(due_date, v_due_date),
           updated_at = now()
     where id = v_invoice_id;
  end if;

  select status into v_invoice_status from public.invoices where id = v_invoice_id;

  if to_regclass('public.audit_events') is not null then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'invoice.created_from_job', jsonb_build_object(
      'job_id', p_job_id,
      'invoice_id', v_invoice_id,
      'send_now', p_send_now
    );
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'already_exists', false,
    'status', coalesce(v_invoice_status, case when p_send_now then 'sent' else 'draft' end)
  );
exception
  when unique_violation then
    select i.id, i.status
      into v_existing
    from public.invoices i
    where i.org_id = p_org_id
      and i.job_id = p_job_id
      and i.deleted_at is null
    order by i.created_at desc
    limit 1;

    if found then
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'already_exists', true,
        'status', v_existing.status
      );
    end if;

    raise;
end;
$fn$;

revoke all on function public.create_invoice_from_job(uuid, uuid, boolean) from public;
grant execute on function public.create_invoice_from_job(uuid, uuid, boolean) to authenticated, service_role;

commit;
