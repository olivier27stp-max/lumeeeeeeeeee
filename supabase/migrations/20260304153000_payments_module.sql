begin;

create extension if not exists pgcrypto;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  client_id uuid null references public.clients(id) on delete set null,
  invoice_id uuid null references public.invoices(id) on delete set null,
  job_id uuid null references public.jobs(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'CAD',
  method text null,
  status text not null default 'pending',
  payment_date timestamptz not null default now(),
  payout_date timestamptz null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.payments add column if not exists org_id uuid;
alter table public.payments add column if not exists client_id uuid;
alter table public.payments add column if not exists invoice_id uuid;
alter table public.payments add column if not exists job_id uuid;
alter table public.payments add column if not exists amount_cents integer;
alter table public.payments add column if not exists currency text;
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists status text;
alter table public.payments add column if not exists payment_date timestamptz;
alter table public.payments add column if not exists payout_date timestamptz;
alter table public.payments add column if not exists created_at timestamptz;
alter table public.payments add column if not exists deleted_at timestamptz;

-- Compatibility with previous insights implementation.
alter table public.payments add column if not exists paid_at timestamptz;

alter table public.payments alter column org_id set default public.current_org_id();
alter table public.payments alter column currency set default 'CAD';
alter table public.payments alter column status set default 'pending';
alter table public.payments alter column payment_date set default now();
alter table public.payments alter column created_at set default now();

update public.payments
set org_id = public.current_org_id()
where org_id is null;

update public.payments
set currency = 'CAD'
where currency is null or btrim(currency) = '';

update public.payments
set status = 'pending'
where status is null or btrim(status) = '';

update public.payments
set status = 'pending'
where status not in ('succeeded', 'pending', 'failed');

update public.payments
set method = null
where method is not null and method not in ('card', 'e-transfer', 'cash', 'check');

update public.payments
set created_at = now()
where created_at is null;

update public.payments
set payment_date = coalesce(payment_date, paid_at, created_at, now())
where payment_date is null;

update public.payments
set paid_at = payment_date
where paid_at is null;

alter table public.payments alter column org_id set not null;
alter table public.payments alter column amount_cents set not null;
alter table public.payments alter column currency set not null;
alter table public.payments alter column status set not null;
alter table public.payments alter column payment_date set not null;
alter table public.payments alter column created_at set not null;

alter table public.payments drop constraint if exists payments_client_id_fkey;
alter table public.payments
  add constraint payments_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

alter table public.payments drop constraint if exists payments_invoice_id_fkey;
alter table public.payments
  add constraint payments_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete set null;

alter table public.payments drop constraint if exists payments_job_id_fkey;
alter table public.payments
  add constraint payments_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete set null;

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('succeeded', 'pending', 'failed'));

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments
  add constraint payments_method_check
  check (method is null or method in ('card', 'e-transfer', 'cash', 'check'));

create index if not exists idx_payments_org_id_module on public.payments (org_id);
create index if not exists idx_payments_payment_date_module on public.payments (payment_date desc);
create index if not exists idx_payments_invoice_id_module on public.payments (invoice_id);
create index if not exists idx_payments_client_id_module on public.payments (client_id);
create index if not exists idx_payments_org_payment_date_module on public.payments (org_id, payment_date desc);

create or replace function public.payments_sync_legacy_dates()
returns trigger
language plpgsql
as $$
begin
  new.payment_date := coalesce(new.payment_date, new.paid_at, new.created_at, now());
  new.paid_at := new.payment_date;
  return new;
end;
$$;

drop trigger if exists trg_payments_sync_legacy_dates on public.payments;
create trigger trg_payments_sync_legacy_dates
before insert or update of payment_date, paid_at
on public.payments
for each row execute function public.payments_sync_legacy_dates();

drop trigger if exists trg_payments_enforce_scope on public.payments;
create trigger trg_payments_enforce_scope
before insert on public.payments
for each row execute function public.crm_enforce_scope();

revoke all on table public.payments from public;
alter table public.payments enable row level security;

drop policy if exists payments_select_org on public.payments;
drop policy if exists payments_insert_org on public.payments;
drop policy if exists payments_update_org on public.payments;
drop policy if exists payments_delete_org on public.payments;

create policy payments_select_org on public.payments
  for select to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

create policy payments_insert_org on public.payments
  for insert to authenticated
  with check (public.has_org_membership(auth.uid(), org_id));

create policy payments_update_org on public.payments
  for update to authenticated
  using (public.has_org_membership(auth.uid(), org_id))
  with check (public.has_org_membership(auth.uid(), org_id));

create policy payments_delete_org on public.payments
  for delete to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

create or replace function public.rpc_payments_overview(
  p_org uuid default null
)
returns table (
  available_funds_cents bigint,
  invoice_payment_time_days_30d numeric,
  paid_on_time_global_pct_60d numeric,
  paid_on_time_residential_pct_60d numeric,
  paid_on_time_commercial_pct_60d numeric,
  has_property_split boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_has_property_type boolean;
  v_available bigint := 0;
  v_avg_payment_days numeric := null;
  v_global_pct numeric := null;
  v_res_pct numeric := null;
  v_com_pct numeric := null;
begin
  v_org := coalesce(p_org, public.current_org_id());

  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  select coalesce(sum(p.amount_cents), 0)::bigint
    into v_available
  from public.payments p
  where p.org_id = v_org
    and p.deleted_at is null
    and p.status = 'succeeded'
    and p.payout_date is null;

  with paid_invoice as (
    select
      p.invoice_id,
      max(p.payment_date) as last_payment_date
    from public.payments p
    where p.org_id = v_org
      and p.deleted_at is null
      and p.status = 'succeeded'
      and p.invoice_id is not null
    group by p.invoice_id
  )
  select avg(extract(epoch from (pi.last_payment_date - coalesce(i.issued_at, i.created_at))) / 86400.0)
    into v_avg_payment_days
  from paid_invoice pi
  join public.invoices i
    on i.id = pi.invoice_id
   and i.org_id = v_org
   and i.deleted_at is null
  where pi.last_payment_date >= (now() - interval '30 days')
    and coalesce(i.issued_at, i.created_at) is not null
    and pi.last_payment_date >= coalesce(i.issued_at, i.created_at);

  with paid_invoice as (
    select
      p.invoice_id,
      max(p.payment_date) as paid_date,
      max(p.job_id) as job_id
    from public.payments p
    where p.org_id = v_org
      and p.deleted_at is null
      and p.status = 'succeeded'
      and p.invoice_id is not null
    group by p.invoice_id
  ),
  paid_60 as (
    select
      pi.invoice_id,
      pi.paid_date,
      i.due_date,
      pi.job_id
    from paid_invoice pi
    join public.invoices i
      on i.id = pi.invoice_id
     and i.org_id = v_org
     and i.deleted_at is null
    where pi.paid_date >= (now() - interval '60 days')
      and i.due_date is not null
  )
  select
    case
      when count(*) = 0 then null
      else round(avg(case when p60.paid_date::date <= p60.due_date then 100.0 else 0 end)::numeric, 2)
    end
  into v_global_pct
  from paid_60 p60;

  v_has_property_type := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'property_type'
  );

  if v_has_property_type then
    with paid_invoice as (
      select
        p.invoice_id,
        max(p.payment_date) as paid_date,
        max(p.job_id) as job_id
      from public.payments p
      where p.org_id = v_org
        and p.deleted_at is null
        and p.status = 'succeeded'
        and p.invoice_id is not null
      group by p.invoice_id
    ),
    paid_60 as (
      select
        pi.invoice_id,
        pi.paid_date,
        i.due_date,
        lower(trim(coalesce(j.property_type, ''))) as property_type
      from paid_invoice pi
      join public.invoices i
        on i.id = pi.invoice_id
       and i.org_id = v_org
       and i.deleted_at is null
      left join public.jobs j
        on j.id = pi.job_id
       and j.org_id = v_org
       and j.deleted_at is null
      where pi.paid_date >= (now() - interval '60 days')
        and i.due_date is not null
    )
    select
      case
        when count(*) filter (where property_type = 'residential') = 0 then null
        else round(
          avg(case when paid_date::date <= due_date then 100.0 else 0 end)
            filter (where property_type = 'residential')::numeric,
          2
        )
      end,
      case
        when count(*) filter (where property_type = 'commercial') = 0 then null
        else round(
          avg(case when paid_date::date <= due_date then 100.0 else 0 end)
            filter (where property_type = 'commercial')::numeric,
          2
        )
      end
    into v_res_pct, v_com_pct
    from paid_60;
  end if;

  return query
  select
    v_available,
    v_avg_payment_days,
    v_global_pct,
    v_res_pct,
    v_com_pct,
    v_has_property_type;
end;
$$;

create or replace function public.rpc_list_payments(
  p_status text default 'all',
  p_method text default 'all',
  p_date text default 'all',
  p_q text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 25,
  p_offset integer default 0,
  p_org uuid default null
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  invoice_id uuid,
  invoice_number text,
  payment_date timestamptz,
  payout_date timestamptz,
  status text,
  method text,
  amount_cents integer,
  currency text,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_status text := lower(coalesce(nullif(trim(p_status), ''), 'all'));
  v_method text := lower(coalesce(nullif(trim(p_method), ''), 'all'));
  v_date text := lower(coalesce(nullif(trim(p_date), ''), 'all'));
  v_q text := nullif(trim(coalesce(p_q, '')), '');
  v_q_amount text;
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  v_org := coalesce(p_org, public.current_org_id());

  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_q_amount := nullif(regexp_replace(coalesce(v_q, ''), '[^0-9.]', '', 'g'), '');

  return query
  with base as (
    select
      p.id,
      p.client_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        'Unknown client'
      ) as client_name,
      p.invoice_id,
      i.invoice_number,
      p.payment_date,
      p.payout_date,
      p.status,
      p.method,
      p.amount_cents,
      p.currency,
      p.created_at
    from public.payments p
    left join public.clients c
      on c.id = p.client_id
     and c.org_id = v_org
    left join public.invoices i
      on i.id = p.invoice_id
     and i.org_id = v_org
     and i.deleted_at is null
    where p.org_id = v_org
      and p.deleted_at is null
  ),
  filtered as (
    select *
    from base b
    where
      (v_status = 'all' or b.status = v_status)
      and (v_method = 'all' or coalesce(b.method, '') = v_method)
      and (
        v_date = 'all'
        or (v_date = '30d' and b.payment_date >= (now() - interval '30 days'))
        or (v_date = 'this_month' and date_trunc('month', b.payment_date) = date_trunc('month', now()))
        or (
          v_date = 'custom'
          and (p_from is null or b.payment_date::date >= p_from)
          and (p_to is null or b.payment_date::date <= p_to)
        )
      )
      and (
        v_q is null
        or b.client_name ilike ('%' || v_q || '%')
        or coalesce(b.invoice_number, '') ilike ('%' || v_q || '%')
        or coalesce(b.method, '') ilike ('%' || v_q || '%')
        or b.amount_cents::text ilike ('%' || v_q || '%')
        or (v_q_amount is not null and to_char((b.amount_cents::numeric / 100.0), 'FM9999999990D00') ilike ('%' || v_q_amount || '%'))
      )
  )
  select
    f.id,
    f.client_id,
    f.client_name,
    f.invoice_id,
    f.invoice_number,
    f.payment_date,
    f.payout_date,
    f.status,
    f.method,
    f.amount_cents,
    f.currency,
    count(*) over() as total_count
  from filtered f
  order by f.payment_date desc, f.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.rpc_payments_overview(uuid) from public;
revoke all on function public.rpc_list_payments(text, text, text, text, date, date, integer, integer, uuid) from public;

grant execute on function public.rpc_payments_overview(uuid) to authenticated, service_role;
grant execute on function public.rpc_list_payments(text, text, text, text, date, date, integer, integer, uuid) to authenticated, service_role;

commit;
