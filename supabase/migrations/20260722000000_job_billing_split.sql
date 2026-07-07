-- ════════════════════════════════════════════════════════════════════
-- Job billing split — payment schedule with multiple invoices
-- ────────────────────────────────────────────────────────────────────
-- Makes jobs.billing_split functional. When enabled, a job carries a
-- PAYMENT SCHEDULE (job_billing_milestones): ordered portions of the
-- job total (label + amount + optional % + due date). Each milestone
-- generates its own invoice, linked via invoices.billing_milestone_id.
--
-- The old "1 active invoice per job" unique guard is narrowed to
-- non-milestone invoices only, so split jobs can hold N invoices while
-- the classic single-invoice flow stays idempotent.
--
-- Idempotent — safe to run multiple times.
-- Apply with: npx tsx scripts/apply-sql.ts supabase/migrations/20260722000000_job_billing_split.sql
-- ════════════════════════════════════════════════════════════════════

begin;

-- ── 1) Payment schedule milestones ──────────────────────────────────
create table if not exists public.job_billing_milestones (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  position     integer not null default 0,
  label        text not null default '',
  percent      numeric(6,3),                 -- optional share of the job total (UI helper)
  amount_cents integer not null default 0 check (amount_cents >= 0),
  due_date     date,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_job_billing_milestones_org_job
  on public.job_billing_milestones (org_id, job_id);

drop trigger if exists trg_job_billing_milestones_set_updated_at on public.job_billing_milestones;
create trigger trg_job_billing_milestones_set_updated_at
  before update on public.job_billing_milestones
  for each row execute function public.set_updated_at();

-- ── RLS (mirror job_agreements: org members read/write) ─────────────
alter table public.job_billing_milestones enable row level security;

drop policy if exists job_billing_milestones_select on public.job_billing_milestones;
drop policy if exists job_billing_milestones_insert on public.job_billing_milestones;
drop policy if exists job_billing_milestones_update on public.job_billing_milestones;
drop policy if exists job_billing_milestones_delete on public.job_billing_milestones;

create policy job_billing_milestones_select on public.job_billing_milestones
  for select to authenticated
  using (public.has_org_membership((select auth.uid()), job_billing_milestones.org_id));

create policy job_billing_milestones_insert on public.job_billing_milestones
  for insert to authenticated
  with check (public.has_org_membership((select auth.uid()), job_billing_milestones.org_id));

create policy job_billing_milestones_update on public.job_billing_milestones
  for update to authenticated
  using  (public.has_org_membership((select auth.uid()), job_billing_milestones.org_id))
  with check (public.has_org_membership((select auth.uid()), job_billing_milestones.org_id));

create policy job_billing_milestones_delete on public.job_billing_milestones
  for delete to authenticated
  using  (public.has_org_membership((select auth.uid()), job_billing_milestones.org_id));

-- ── 2) Invoices ↔ milestone linkage ─────────────────────────────────
alter table public.invoices add column if not exists billing_milestone_id uuid;

alter table public.invoices drop constraint if exists invoices_billing_milestone_id_fkey;
alter table public.invoices
  add constraint invoices_billing_milestone_id_fkey
  foreign key (billing_milestone_id) references public.job_billing_milestones(id) on delete set null;

-- One active invoice per milestone (idempotency for the split flow)
create unique index if not exists uq_invoices_milestone_active
  on public.invoices (billing_milestone_id)
  where deleted_at is null and billing_milestone_id is not null;

-- Narrow the "1 active invoice per job" guard to non-milestone invoices:
-- split jobs hold N milestone invoices, the classic flow stays idempotent.
drop index if exists public.uq_invoices_org_job_active;
create unique index if not exists uq_invoices_org_job_active
  on public.invoices (org_id, job_id)
  where deleted_at is null and job_id is not null and billing_milestone_id is null;

-- ── 3) jobs.billing_split is now functional ─────────────────────────
comment on column public.jobs.billing_split is
  'When true the job is billed through the job_billing_milestones payment schedule (multiple invoices).';

-- ── 4) create_invoice_from_job: ignore milestone invoices ───────────
-- Same body as before; the two "existing invoice" lookups now exclude
-- milestone invoices so the classic flow is not blocked by a schedule.
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
    and i.billing_milestone_id is null
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
      and i.billing_milestone_id is null
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

-- ── 5) RPC: create invoice from a payment milestone (idempotent) ────
drop function if exists public.create_invoice_from_milestone(uuid, uuid, uuid, boolean);
create or replace function public.create_invoice_from_milestone(
  p_org_id uuid,
  p_job_id uuid,
  p_milestone_id uuid,
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
  v_ms record;
  v_existing record;
  v_invoice_id uuid;
  v_invoice_status text;
  v_invoice_number text;
  v_due_date date;
  v_amount integer;
  v_label text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_job_id is null or p_milestone_id is null then
    raise exception 'p_org_id, p_job_id and p_milestone_id are required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;

  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can create invoices from jobs' using errcode = '42501';
  end if;

  select j.id, j.org_id, j.client_id, j.title, j.deleted_at
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

  select m.id, m.label, m.amount_cents, m.due_date
    into v_ms
  from public.job_billing_milestones m
  where m.id = p_milestone_id
    and m.org_id = p_org_id
    and m.job_id = p_job_id
  limit 1;

  if not found then
    raise exception 'Payment milestone not found' using errcode = 'P0002';
  end if;

  v_amount := greatest(coalesce(v_ms.amount_cents, 0), 0);
  if v_amount <= 0 then
    raise exception 'Milestone amount must be greater than zero' using errcode = '23514';
  end if;

  -- The schedule defines the due date, so it is set even on drafts.
  v_due_date := coalesce(v_ms.due_date, (current_date + interval '14 days')::date);
  v_label := coalesce(nullif(trim(v_ms.label), ''), 'Scheduled payment');

  select i.id, i.status
    into v_existing
  from public.invoices i
  where i.billing_milestone_id = p_milestone_id
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
    billing_milestone_id,
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
    p_milestone_id,
    v_invoice_number,
    case when p_send_now then 'sent' else 'draft' end,
    coalesce(nullif(trim(v_job.title), ''), 'Job invoice') || ' — ' || v_label,
    case when p_send_now then now() else null end,
    v_due_date,
    0,
    0,
    0,
    0,
    0
  )
  returning id, status into v_invoice_id, v_invoice_status;

  insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, line_total_cents)
  values (
    p_org_id,
    v_invoice_id,
    v_label,
    1,
    v_amount,
    v_amount
  );

  perform public.recalculate_invoice_totals(v_invoice_id);

  if p_send_now then
    update public.invoices
       set status = 'sent',
           issued_at = coalesce(issued_at, now()),
           updated_at = now()
     where id = v_invoice_id;
  end if;

  select status into v_invoice_status from public.invoices where id = v_invoice_id;

  if to_regclass('public.audit_events') is not null then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'invoice.created_from_milestone', jsonb_build_object(
      'job_id', p_job_id,
      'milestone_id', p_milestone_id,
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
    where i.billing_milestone_id = p_milestone_id
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

revoke all on function public.create_invoice_from_milestone(uuid, uuid, uuid, boolean) from public;
grant execute on function public.create_invoice_from_milestone(uuid, uuid, uuid, boolean) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
