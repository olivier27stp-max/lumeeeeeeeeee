begin;

create extension if not exists pgcrypto;

create table if not exists public.payment_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null unique,
  stripe_enabled boolean not null default false,
  stripe_account_id text null,
  stripe_webhook_secret text null,
  paypal_enabled boolean not null default false,
  paypal_merchant_id text null,
  paypal_webhook_id text null,
  default_provider text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payment_providers add column if not exists org_id uuid;
alter table public.payment_providers add column if not exists stripe_enabled boolean;
alter table public.payment_providers add column if not exists stripe_account_id text;
alter table public.payment_providers add column if not exists stripe_webhook_secret text;
alter table public.payment_providers add column if not exists paypal_enabled boolean;
alter table public.payment_providers add column if not exists paypal_merchant_id text;
alter table public.payment_providers add column if not exists paypal_webhook_id text;
alter table public.payment_providers add column if not exists default_provider text;
alter table public.payment_providers add column if not exists created_at timestamptz;
alter table public.payment_providers add column if not exists updated_at timestamptz;

alter table public.payment_providers alter column stripe_enabled set default false;
alter table public.payment_providers alter column paypal_enabled set default false;
alter table public.payment_providers alter column created_at set default now();
alter table public.payment_providers alter column updated_at set default now();

update public.payment_providers
set org_id = public.current_org_id()
where org_id is null;

update public.payment_providers
set stripe_enabled = false
where stripe_enabled is null;

update public.payment_providers
set paypal_enabled = false
where paypal_enabled is null;

update public.payment_providers
set created_at = now()
where created_at is null;

update public.payment_providers
set updated_at = now()
where updated_at is null;

update public.payment_providers
set default_provider = null
where default_provider is not null and default_provider not in ('stripe', 'paypal');

alter table public.payment_providers alter column org_id set not null;
alter table public.payment_providers alter column stripe_enabled set not null;
alter table public.payment_providers alter column paypal_enabled set not null;
alter table public.payment_providers alter column created_at set not null;
alter table public.payment_providers alter column updated_at set not null;

alter table public.payment_providers drop constraint if exists payment_providers_default_provider_check;
alter table public.payment_providers
  add constraint payment_providers_default_provider_check
  check (default_provider is null or default_provider in ('stripe', 'paypal'));

alter table public.payment_providers drop constraint if exists payment_providers_org_id_key;
alter table public.payment_providers
  add constraint payment_providers_org_id_key unique (org_id);

create index if not exists idx_payment_providers_org_id on public.payment_providers (org_id);

drop trigger if exists trg_payment_providers_set_updated_at on public.payment_providers;
create trigger trg_payment_providers_set_updated_at
before update on public.payment_providers
for each row execute function public.set_updated_at();

drop trigger if exists trg_payment_providers_enforce_scope on public.payment_providers;
create trigger trg_payment_providers_enforce_scope
before insert on public.payment_providers
for each row execute function public.crm_enforce_scope();

alter table public.invoices add column if not exists total_cents integer;
alter table public.invoices add column if not exists paid_cents integer;
alter table public.invoices add column if not exists balance_cents integer;
alter table public.invoices add column if not exists status text;
alter table public.invoices add column if not exists issued_at timestamptz;
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists paid_at timestamptz;

update public.invoices
set total_cents = 0
where total_cents is null;

update public.invoices
set paid_cents = 0
where paid_cents is null;

update public.invoices
set balance_cents = greatest(coalesce(total_cents, 0) - coalesce(paid_cents, 0), 0)
where balance_cents is null;

update public.invoices
set status = case
  when coalesce(balance_cents, 0) = 0 and coalesce(total_cents, 0) > 0 then 'paid'
  when coalesce(paid_cents, 0) > 0 and coalesce(balance_cents, 0) > 0 then 'partial'
  else 'draft'
end
where status is null or btrim(status) = '';

alter table public.invoices alter column total_cents set default 0;
alter table public.invoices alter column paid_cents set default 0;
alter table public.invoices alter column balance_cents set default 0;

alter table public.invoices drop constraint if exists invoices_payment_status_check;
alter table public.invoices
  add constraint invoices_payment_status_check
  check (status in ('draft', 'sent', 'paid', 'partial', 'void'));

create index if not exists idx_invoices_org_issued_at_payments on public.invoices (org_id, issued_at desc);
create index if not exists idx_invoices_org_status_payments on public.invoices (org_id, status);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  client_id uuid null references public.clients(id) on delete set null,
  invoice_id uuid null references public.invoices(id) on delete set null,
  job_id uuid null references public.jobs(id) on delete set null,
  provider text not null default 'manual',
  provider_payment_id text null,
  provider_order_id text null,
  provider_event_id text null,
  status text not null default 'pending',
  method text null,
  amount_cents integer not null,
  currency text not null default 'CAD',
  payment_date timestamptz not null default now(),
  payout_date timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.payments add column if not exists org_id uuid;
alter table public.payments add column if not exists client_id uuid;
alter table public.payments add column if not exists invoice_id uuid;
alter table public.payments add column if not exists job_id uuid;
alter table public.payments add column if not exists provider text;
alter table public.payments add column if not exists provider_payment_id text;
alter table public.payments add column if not exists provider_order_id text;
alter table public.payments add column if not exists provider_event_id text;
alter table public.payments add column if not exists status text;
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists amount_cents integer;
alter table public.payments add column if not exists currency text;
alter table public.payments add column if not exists payment_date timestamptz;
alter table public.payments add column if not exists payout_date timestamptz;
alter table public.payments add column if not exists created_at timestamptz;
alter table public.payments add column if not exists updated_at timestamptz;
alter table public.payments add column if not exists deleted_at timestamptz;
alter table public.payments add column if not exists paid_at timestamptz;

alter table public.payments alter column org_id set default public.current_org_id();
alter table public.payments alter column provider set default 'manual';
alter table public.payments alter column status set default 'pending';
alter table public.payments alter column currency set default 'CAD';
alter table public.payments alter column payment_date set default now();
alter table public.payments alter column created_at set default now();
alter table public.payments alter column updated_at set default now();

update public.payments
set org_id = public.current_org_id()
where org_id is null;

update public.payments
set provider = 'manual'
where provider is null or btrim(provider) = '';

update public.payments
set status = 'pending'
where status is null or btrim(status) = '';

update public.payments
set status = 'pending'
where status not in ('succeeded', 'pending', 'failed', 'refunded');

update public.payments
set method = null
where method is not null and method not in ('card', 'e-transfer', 'cash', 'check');

update public.payments
set currency = 'CAD'
where currency is null or btrim(currency) = '';

update public.payments
set created_at = now()
where created_at is null;

update public.payments
set updated_at = now()
where updated_at is null;

update public.payments
set payment_date = coalesce(payment_date, paid_at, created_at, now())
where payment_date is null;

update public.payments
set paid_at = payment_date
where paid_at is null;

alter table public.payments alter column org_id set not null;
alter table public.payments alter column provider set not null;
alter table public.payments alter column status set not null;
alter table public.payments alter column amount_cents set not null;
alter table public.payments alter column currency set not null;
alter table public.payments alter column payment_date set not null;
alter table public.payments alter column created_at set not null;
alter table public.payments alter column updated_at set not null;

alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments
  add constraint payments_provider_check
  check (provider in ('stripe', 'paypal', 'manual'));

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments
  add constraint payments_status_check
  check (status in ('succeeded', 'pending', 'failed', 'refunded'));

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments
  add constraint payments_method_check
  check (method is null or method in ('card', 'e-transfer', 'cash', 'check'));

alter table public.payments drop constraint if exists payments_amount_cents_non_negative;
alter table public.payments
  add constraint payments_amount_cents_non_negative
  check (amount_cents >= 0);

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

create index if not exists idx_payments_org_id on public.payments (org_id);
create index if not exists idx_payments_payment_date on public.payments (payment_date desc);
create index if not exists idx_payments_invoice_id on public.payments (invoice_id);
create index if not exists idx_payments_client_id on public.payments (client_id);
create index if not exists idx_payments_status on public.payments (org_id, status);
create index if not exists idx_payments_provider on public.payments (org_id, provider);
create index if not exists idx_payments_provider_payment_id on public.payments (provider, provider_payment_id);
create index if not exists idx_payments_provider_event_id on public.payments (provider, provider_event_id);

create unique index if not exists uq_payments_provider_payment_id
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null and deleted_at is null;

create unique index if not exists uq_payments_provider_event_id
  on public.payments (provider, provider_event_id)
  where provider_event_id is not null and deleted_at is null;

create or replace function public.payments_sync_dates_and_update()
returns trigger
language plpgsql
as $$
begin
  new.payment_date := coalesce(new.payment_date, new.paid_at, new.created_at, now());
  new.paid_at := new.payment_date;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.recalculate_invoice_from_payments(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid_cents bigint := 0;
  v_latest_paid_at timestamptz := null;
  v_total_cents integer := 0;
  v_balance_cents integer := 0;
  v_status text := 'sent';
  v_prev_status text;
begin
  if p_invoice_id is null then
    return;
  end if;

  select
    coalesce(sum(p.amount_cents), 0)::bigint,
    max(p.payment_date)
  into v_paid_cents, v_latest_paid_at
  from public.payments p
  where p.invoice_id = p_invoice_id
    and p.deleted_at is null
    and p.status = 'succeeded';

  select i.total_cents, i.status
    into v_total_cents, v_prev_status
  from public.invoices i
  where i.id = p_invoice_id
    and i.deleted_at is null
  for update;

  if not found then
    return;
  end if;

  v_paid_cents := greatest(0, least(v_paid_cents, v_total_cents));
  v_balance_cents := greatest(v_total_cents - v_paid_cents::integer, 0);

  if v_prev_status = 'void' then
    v_status := 'void';
  elsif v_total_cents = 0 then
    v_status := 'draft';
  elsif v_balance_cents = 0 then
    v_status := 'paid';
  elsif v_paid_cents > 0 then
    v_status := 'partial';
  elsif v_prev_status = 'draft' then
    v_status := 'draft';
  else
    v_status := 'sent';
  end if;

  update public.invoices i
  set
    paid_cents = v_paid_cents::integer,
    balance_cents = v_balance_cents,
    status = v_status,
    paid_at = case when v_status = 'paid' then coalesce(v_latest_paid_at, i.paid_at, now()) else null end,
    updated_at = now()
  where i.id = p_invoice_id;
end;
$$;

create or replace function public.payments_recalculate_invoice_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recalculate_invoice_from_payments(new.invoice_id);
    return new;
  elsif tg_op = 'UPDATE' then
    if old.invoice_id is distinct from new.invoice_id then
      perform public.recalculate_invoice_from_payments(old.invoice_id);
      perform public.recalculate_invoice_from_payments(new.invoice_id);
    else
      perform public.recalculate_invoice_from_payments(new.invoice_id);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    perform public.recalculate_invoice_from_payments(old.invoice_id);
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_payments_set_updated_at on public.payments;
create trigger trg_payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists trg_payments_sync_dates on public.payments;
create trigger trg_payments_sync_dates
before insert or update of payment_date, paid_at
on public.payments
for each row execute function public.payments_sync_dates_and_update();

drop trigger if exists trg_payments_enforce_scope on public.payments;
create trigger trg_payments_enforce_scope
before insert on public.payments
for each row execute function public.crm_enforce_scope();

drop trigger if exists trg_payments_recalculate_invoice on public.payments;
create trigger trg_payments_recalculate_invoice
after insert or update or delete on public.payments
for each row execute function public.payments_recalculate_invoice_trigger();

revoke all on table public.payment_providers from public;
revoke all on table public.payments from public;

alter table public.payment_providers enable row level security;
alter table public.payments enable row level security;

drop policy if exists payment_providers_select_org on public.payment_providers;
drop policy if exists payment_providers_insert_org on public.payment_providers;
drop policy if exists payment_providers_update_org on public.payment_providers;
drop policy if exists payment_providers_delete_org on public.payment_providers;

create policy payment_providers_select_org on public.payment_providers
  for select to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

create policy payment_providers_insert_org on public.payment_providers
  for insert to authenticated
  with check (public.has_org_membership(auth.uid(), org_id));

create policy payment_providers_update_org on public.payment_providers
  for update to authenticated
  using (public.has_org_membership(auth.uid(), org_id))
  with check (public.has_org_membership(auth.uid(), org_id));

create policy payment_providers_delete_org on public.payment_providers
  for delete to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

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

create or replace function public.rpc_payments_overview_kpis(
  p_org uuid default null,
  p_now timestamptz default now()
)
returns table (
  available_funds_cents bigint,
  invoice_payment_time_days_30d numeric,
  paid_on_time_global_pct_60d numeric,
  paid_on_time_residential_pct_60d numeric,
  paid_on_time_commercial_pct_60d numeric,
  has_segment_split boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_now timestamptz := coalesce(p_now, now());
  v_has_jobs_service_type boolean;
  v_has_clients_segment boolean;
  v_available bigint := 0;
  v_avg_payment_days numeric := 0;
  v_global_pct numeric := 0;
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

  select coalesce(
    avg(
      extract(epoch from (p.payment_date - coalesce(i.issued_at, i.created_at))) / 86400.0
    ),
    0
  )
  into v_avg_payment_days
  from public.payments p
  join public.invoices i
    on i.id = p.invoice_id
   and i.org_id = v_org
   and i.deleted_at is null
  where p.org_id = v_org
    and p.deleted_at is null
    and p.status = 'succeeded'
    and p.invoice_id is not null
    and p.payment_date >= (v_now - interval '30 days')
    and coalesce(i.issued_at, i.created_at) is not null
    and p.payment_date >= coalesce(i.issued_at, i.created_at);

  select coalesce(
    avg(
      case when i.paid_at::date <= i.due_date then 100.0 else 0 end
    ),
    0
  )
  into v_global_pct
  from public.invoices i
  where i.org_id = v_org
    and i.deleted_at is null
    and i.due_date is not null
    and i.paid_at is not null
    and i.paid_at >= (v_now - interval '60 days')
    and (i.status = 'paid' or i.balance_cents = 0);

  v_has_jobs_service_type := exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'service_type'
  );

  v_has_clients_segment := exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'clients'
      and column_name = 'segment'
  );

  if v_has_jobs_service_type then
    with invoice_segment as (
      select
        i.id,
        i.paid_at,
        i.due_date,
        case
          when lower(coalesce(j.service_type, '')) like '%residential%' then 'residential'
          when lower(coalesce(j.service_type, '')) like '%commercial%' then 'commercial'
          else null
        end as segment
      from public.invoices i
      join public.payments p
        on p.invoice_id = i.id
       and p.org_id = v_org
       and p.deleted_at is null
      left join public.jobs j
        on j.id = p.job_id
       and j.org_id = v_org
       and j.deleted_at is null
      where i.org_id = v_org
        and i.deleted_at is null
        and i.due_date is not null
        and i.paid_at is not null
        and i.paid_at >= (v_now - interval '60 days')
        and (i.status = 'paid' or i.balance_cents = 0)
      group by i.id, i.paid_at, i.due_date, j.service_type
    )
    select
      case
        when count(*) filter (where segment = 'residential') = 0 then null
        else round(avg(case when paid_at::date <= due_date then 100.0 else 0 end)
          filter (where segment = 'residential')::numeric, 2)
      end,
      case
        when count(*) filter (where segment = 'commercial') = 0 then null
        else round(avg(case when paid_at::date <= due_date then 100.0 else 0 end)
          filter (where segment = 'commercial')::numeric, 2)
      end
    into v_res_pct, v_com_pct
    from invoice_segment;
  elsif v_has_clients_segment then
    with invoice_segment as (
      select
        i.id,
        i.paid_at,
        i.due_date,
        case
          when lower(coalesce(c.segment, '')) like '%residential%' then 'residential'
          when lower(coalesce(c.segment, '')) like '%commercial%' then 'commercial'
          else null
        end as segment
      from public.invoices i
      left join public.clients c
        on c.id = i.client_id
       and c.org_id = v_org
      where i.org_id = v_org
        and i.deleted_at is null
        and i.due_date is not null
        and i.paid_at is not null
        and i.paid_at >= (v_now - interval '60 days')
        and (i.status = 'paid' or i.balance_cents = 0)
    )
    select
      case
        when count(*) filter (where segment = 'residential') = 0 then null
        else round(avg(case when paid_at::date <= due_date then 100.0 else 0 end)
          filter (where segment = 'residential')::numeric, 2)
      end,
      case
        when count(*) filter (where segment = 'commercial') = 0 then null
        else round(avg(case when paid_at::date <= due_date then 100.0 else 0 end)
          filter (where segment = 'commercial')::numeric, 2)
      end
    into v_res_pct, v_com_pct
    from invoice_segment;
  end if;

  return query
  select
    v_available,
    coalesce(round(v_avg_payment_days::numeric, 2), 0),
    coalesce(round(v_global_pct::numeric, 2), 0),
    v_res_pct,
    v_com_pct,
    (v_res_pct is not null or v_com_pct is not null);
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

revoke all on function public.recalculate_invoice_from_payments(uuid) from public;
revoke all on function public.rpc_payments_overview_kpis(uuid, timestamptz) from public;
revoke all on function public.rpc_list_payments(text, text, text, text, date, date, integer, integer, uuid) from public;

grant execute on function public.recalculate_invoice_from_payments(uuid) to authenticated, service_role;
grant execute on function public.rpc_payments_overview_kpis(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.rpc_list_payments(text, text, text, text, date, date, integer, integer, uuid) to authenticated, service_role;

commit;
