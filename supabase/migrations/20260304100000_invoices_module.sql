begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  created_by uuid not null default auth.uid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  invoice_number text not null,
  status text not null default 'draft',
  subject text null,
  issued_at timestamptz null,
  due_date date null,
  subtotal_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,
  paid_cents integer not null default 0,
  balance_cents integer not null default 0,
  paid_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  qty numeric(12,2) not null default 1,
  unit_price_cents integer not null default 0,
  line_total_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.invoice_sequences (
  org_id uuid primary key,
  last_value integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.invoices add column if not exists org_id uuid;
alter table public.invoices add column if not exists created_by uuid;
alter table public.invoices add column if not exists client_id uuid;
alter table public.invoices add column if not exists invoice_number text;
alter table public.invoices add column if not exists status text;
alter table public.invoices add column if not exists subject text;
alter table public.invoices add column if not exists issued_at timestamptz;
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists subtotal_cents integer;
alter table public.invoices add column if not exists tax_cents integer;
alter table public.invoices add column if not exists total_cents integer;
alter table public.invoices add column if not exists paid_cents integer;
alter table public.invoices add column if not exists balance_cents integer;
alter table public.invoices add column if not exists paid_at timestamptz;
alter table public.invoices add column if not exists created_at timestamptz;
alter table public.invoices add column if not exists updated_at timestamptz;
alter table public.invoices add column if not exists deleted_at timestamptz;

alter table public.invoice_items add column if not exists org_id uuid;
alter table public.invoice_items add column if not exists invoice_id uuid;
alter table public.invoice_items add column if not exists description text;
alter table public.invoice_items add column if not exists qty numeric(12,2);
alter table public.invoice_items add column if not exists unit_price_cents integer;
alter table public.invoice_items add column if not exists line_total_cents integer;
alter table public.invoice_items add column if not exists created_at timestamptz;

alter table public.invoices alter column org_id set default public.current_org_id();
alter table public.invoices alter column created_by set default auth.uid();
alter table public.invoices alter column status set default 'draft';
alter table public.invoices alter column subtotal_cents set default 0;
alter table public.invoices alter column tax_cents set default 0;
alter table public.invoices alter column total_cents set default 0;
alter table public.invoices alter column paid_cents set default 0;
alter table public.invoices alter column balance_cents set default 0;
alter table public.invoices alter column created_at set default now();
alter table public.invoices alter column updated_at set default now();

alter table public.invoice_items alter column org_id set default public.current_org_id();
alter table public.invoice_items alter column qty set default 1;
alter table public.invoice_items alter column unit_price_cents set default 0;
alter table public.invoice_items alter column line_total_cents set default 0;
alter table public.invoice_items alter column created_at set default now();

alter table public.invoices alter column org_id set not null;
alter table public.invoices alter column created_by set not null;
alter table public.invoices alter column client_id set not null;
alter table public.invoices alter column invoice_number set not null;
alter table public.invoices alter column status set not null;
alter table public.invoices alter column subtotal_cents set not null;
alter table public.invoices alter column tax_cents set not null;
alter table public.invoices alter column total_cents set not null;
alter table public.invoices alter column paid_cents set not null;
alter table public.invoices alter column balance_cents set not null;
alter table public.invoices alter column created_at set not null;
alter table public.invoices alter column updated_at set not null;

alter table public.invoice_items alter column org_id set not null;
alter table public.invoice_items alter column invoice_id set not null;
alter table public.invoice_items alter column description set not null;
alter table public.invoice_items alter column qty set not null;
alter table public.invoice_items alter column unit_price_cents set not null;
alter table public.invoice_items alter column line_total_cents set not null;
alter table public.invoice_items alter column created_at set not null;

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('draft', 'sent', 'partial', 'paid', 'void'));

alter table public.invoices drop constraint if exists invoices_invoice_number_org_unique;
alter table public.invoices
  add constraint invoices_invoice_number_org_unique unique (org_id, invoice_number);

alter table public.invoices drop constraint if exists invoices_client_id_fkey;
alter table public.invoices
  add constraint invoices_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete restrict;

alter table public.invoice_items drop constraint if exists invoice_items_invoice_id_fkey;
alter table public.invoice_items
  add constraint invoice_items_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete cascade;

create index if not exists idx_invoices_org_status on public.invoices (org_id, status);
create index if not exists idx_invoices_org_due_date on public.invoices (org_id, due_date);
create index if not exists idx_invoices_org_issued_at on public.invoices (org_id, issued_at);
create index if not exists idx_invoices_org_client on public.invoices (org_id, client_id);
create index if not exists idx_invoices_org_number on public.invoices (org_id, invoice_number);
create index if not exists idx_invoices_org_deleted on public.invoices (org_id, deleted_at);
create index if not exists idx_invoice_items_org_invoice on public.invoice_items (org_id, invoice_id);
create index if not exists idx_invoices_number_trgm on public.invoices using gin (invoice_number gin_trgm_ops);
create index if not exists idx_invoices_subject_trgm on public.invoices using gin (coalesce(subject, '') gin_trgm_ops);
create index if not exists idx_clients_search_name_trgm on public.clients
  using gin ((lower(concat_ws(' ', coalesce(first_name, ''), coalesce(last_name, ''), coalesce(company, '')))) gin_trgm_ops);

create or replace function public.invoice_next_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_next integer;
begin
  insert into public.invoice_sequences (org_id, last_value)
  values (p_org, 0)
  on conflict (org_id) do nothing;

  update public.invoice_sequences
  set last_value = last_value + 1,
      updated_at = now()
  where org_id = p_org
  returning last_value into v_next;

  return 'INV-' || lpad(v_next::text, 6, '0');
end;
$fn$;

create or replace function public.invoice_items_set_line_total()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.qty := greatest(coalesce(new.qty, 1), 0);
  new.unit_price_cents := greatest(coalesce(new.unit_price_cents, 0), 0);
  new.line_total_cents := greatest(round(new.qty * new.unit_price_cents)::integer, 0);
  return new;
end;
$fn$;

create or replace function public.invoice_items_sync_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
begin
  select org_id
    into v_org
  from public.invoices
  where id = new.invoice_id
    and deleted_at is null
  limit 1;

  if v_org is null then
    raise exception 'Invoice not found for item';
  end if;

  new.org_id := v_org;
  return new;
end;
$fn$;

create or replace function public.recalculate_invoice_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_subtotal integer := 0;
begin
  select coalesce(sum(ii.line_total_cents), 0)::integer
    into v_subtotal
  from public.invoice_items ii
  where ii.invoice_id = p_invoice_id;

  update public.invoices i
  set subtotal_cents = v_subtotal,
      total_cents = greatest(v_subtotal + coalesce(i.tax_cents, 0), 0),
      paid_cents = greatest(coalesce(i.paid_cents, 0), 0),
      balance_cents = greatest((v_subtotal + coalesce(i.tax_cents, 0)) - greatest(coalesce(i.paid_cents, 0), 0), 0),
      updated_at = now()
  where i.id = p_invoice_id;
end;
$fn$;

create or replace function public.invoices_apply_status_logic()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.subtotal_cents := greatest(coalesce(new.subtotal_cents, 0), 0);
  new.tax_cents := greatest(coalesce(new.tax_cents, 0), 0);
  new.total_cents := greatest(new.subtotal_cents + new.tax_cents, 0);
  new.paid_cents := greatest(coalesce(new.paid_cents, 0), 0);

  if new.paid_cents > new.total_cents then
    new.paid_cents := new.total_cents;
  end if;

  new.balance_cents := greatest(new.total_cents - new.paid_cents, 0);

  if coalesce(new.status, '') = 'void' then
    if new.paid_cents = 0 then
      new.paid_at := null;
    end if;
    return new;
  end if;

  if new.issued_at is null then
    new.status := 'draft';
    if new.paid_cents = 0 then
      new.paid_at := null;
    end if;
    return new;
  end if;

  if new.balance_cents = 0 then
    new.status := 'paid';
    if new.paid_at is null then
      new.paid_at := now();
    end if;
    return new;
  end if;

  if new.paid_cents > 0 then
    new.status := 'partial';
  else
    new.status := 'sent';
  end if;

  if new.balance_cents > 0 then
    new.paid_at := null;
  end if;

  return new;
end;
$fn$;

create or replace function public.invoice_items_recalculate_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_invoice_id uuid;
begin
  v_invoice_id := coalesce(new.invoice_id, old.invoice_id);
  perform public.recalculate_invoice_totals(v_invoice_id);
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists trg_invoice_items_set_line_total on public.invoice_items;
create trigger trg_invoice_items_set_line_total
before insert or update of qty, unit_price_cents
on public.invoice_items
for each row
execute function public.invoice_items_set_line_total();

drop trigger if exists trg_invoice_items_sync_org on public.invoice_items;
create trigger trg_invoice_items_sync_org
before insert or update of invoice_id
on public.invoice_items
for each row
execute function public.invoice_items_sync_org();

drop trigger if exists trg_invoice_items_recalculate_parent_insert on public.invoice_items;
create trigger trg_invoice_items_recalculate_parent_insert
after insert on public.invoice_items
for each row
execute function public.invoice_items_recalculate_parent();

drop trigger if exists trg_invoice_items_recalculate_parent_update on public.invoice_items;
create trigger trg_invoice_items_recalculate_parent_update
after update on public.invoice_items
for each row
execute function public.invoice_items_recalculate_parent();

drop trigger if exists trg_invoice_items_recalculate_parent_delete on public.invoice_items;
create trigger trg_invoice_items_recalculate_parent_delete
after delete on public.invoice_items
for each row
execute function public.invoice_items_recalculate_parent();

drop trigger if exists trg_invoices_set_updated_at on public.invoices;
create trigger trg_invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_invoices_apply_status_logic on public.invoices;
create trigger trg_invoices_apply_status_logic
before insert or update of issued_at, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, status, paid_at
on public.invoices
for each row
execute function public.invoices_apply_status_logic();

create or replace function public.rpc_create_invoice_draft(
  p_client_id uuid,
  p_subject text default null,
  p_due_date date default null
)
returns table (
  id uuid,
  invoice_number text,
  status text,
  subject text,
  due_date date,
  total_cents integer,
  balance_cents integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_number text;
  v_client public.clients%rowtype;
  v_invoice public.invoices%rowtype;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'Unable to resolve org_id for authenticated user';
  end if;

  select *
    into v_client
  from public.clients
  where id = p_client_id
    and deleted_at is null
  limit 1;

  if v_client.id is null then
    raise exception 'Client not found';
  end if;

  if v_client.org_id <> v_org then
    raise exception 'Client does not belong to your organization';
  end if;

  if lower(coalesce(v_client.status, 'active')) = 'inactive' then
    raise exception 'Client is inactive';
  end if;

  v_number := public.invoice_next_number(v_org);

  insert into public.invoices (
    org_id,
    created_by,
    client_id,
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
    v_org,
    auth.uid(),
    p_client_id,
    v_number,
    'draft',
    nullif(trim(p_subject), ''),
    null,
    p_due_date,
    0,
    0,
    0,
    0,
    0
  )
  returning * into v_invoice;

  return query
  select
    v_invoice.id,
    v_invoice.invoice_number,
    v_invoice.status,
    v_invoice.subject,
    v_invoice.due_date,
    v_invoice.total_cents,
    v_invoice.balance_cents,
    v_invoice.created_at;
end;
$fn$;

create or replace function public.rpc_save_invoice_draft(
  p_invoice_id uuid,
  p_subject text default null,
  p_due_date date default null,
  p_tax_cents integer default 0,
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_invoice public.invoices%rowtype;
  v_item jsonb;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'Unable to resolve org_id for authenticated user';
  end if;

  select *
    into v_invoice
  from public.invoices
  where id = p_invoice_id
    and deleted_at is null
  for update;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;

  if v_invoice.org_id <> v_org then
    raise exception 'Invoice does not belong to your organization';
  end if;

  if v_invoice.status = 'void' then
    raise exception 'Cannot edit a void invoice';
  end if;

  update public.invoices
  set subject = nullif(trim(p_subject), ''),
      due_date = p_due_date,
      tax_cents = greatest(coalesce(p_tax_cents, 0), 0),
      updated_at = now()
  where id = v_invoice.id;

  delete from public.invoice_items
  where invoice_id = v_invoice.id;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.invoice_items (
      org_id,
      invoice_id,
      description,
      qty,
      unit_price_cents
    )
    values (
      v_org,
      v_invoice.id,
      coalesce(nullif(trim(v_item->>'description'), ''), 'Item'),
      greatest(coalesce((v_item->>'qty')::numeric, 1), 0),
      greatest(coalesce((v_item->>'unit_price_cents')::integer, 0), 0)
    );
  end loop;

  perform public.recalculate_invoice_totals(v_invoice.id);

  return (
    select to_jsonb(i)
    from public.invoices i
    where i.id = v_invoice.id
  );
end;
$fn$;

create or replace function public.rpc_invoices_kpis_30d(
  p_org uuid default null
)
returns table (
  past_due_count bigint,
  past_due_total_cents bigint,
  sent_not_due_count bigint,
  sent_not_due_total_cents bigint,
  draft_count bigint,
  draft_total_cents bigint,
  issued_30d_count bigint,
  issued_30d_total_cents bigint,
  avg_invoice_30d_cents bigint,
  avg_payment_time_days_30d numeric
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  return query
  with base as (
    select *
    from public.invoices i
    where i.org_id = v_org
      and i.deleted_at is null
  ),
  overview as (
    select
      count(*) filter (
        where due_date < current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ) as past_due_count,
      coalesce(sum(balance_cents) filter (
        where due_date < current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ), 0)::bigint as past_due_total_cents,
      count(*) filter (
        where due_date >= current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ) as sent_not_due_count,
      coalesce(sum(balance_cents) filter (
        where due_date >= current_date
          and balance_cents > 0
          and status in ('sent', 'partial')
      ), 0)::bigint as sent_not_due_total_cents,
      count(*) filter (
        where status = 'draft'
      ) as draft_count,
      coalesce(sum(total_cents) filter (
        where status = 'draft'
      ), 0)::bigint as draft_total_cents
    from base
  ),
  issued as (
    select
      count(*) as issued_30d_count,
      coalesce(sum(total_cents), 0)::bigint as issued_30d_total_cents
    from base
    where issued_at >= (now() - interval '30 days')
      and status in ('sent', 'partial', 'paid')
  ),
  payment as (
    select
      avg(extract(epoch from (paid_at - issued_at)) / 86400.0) as avg_payment_time_days_30d
    from base
    where paid_at is not null
      and issued_at is not null
      and paid_at >= (now() - interval '30 days')
      and paid_at >= issued_at
  )
  select
    o.past_due_count,
    o.past_due_total_cents,
    o.sent_not_due_count,
    o.sent_not_due_total_cents,
    o.draft_count,
    o.draft_total_cents,
    i.issued_30d_count,
    i.issued_30d_total_cents,
    case
      when i.issued_30d_count = 0 then 0::bigint
      else round(i.issued_30d_total_cents::numeric / i.issued_30d_count::numeric)::bigint
    end as avg_invoice_30d_cents,
    p.avg_payment_time_days_30d
  from overview o
  cross join issued i
  cross join payment p;
end;
$fn$;

create or replace function public.rpc_list_invoices(
  p_status text default 'all',
  p_range text default 'all',
  p_q text default null,
  p_sort text default 'due_date_desc',
  p_limit integer default 25,
  p_offset integer default 0,
  p_from date default null,
  p_to date default null,
  p_org uuid default null
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  invoice_number text,
  status text,
  subject text,
  issued_at timestamptz,
  due_date date,
  total_cents integer,
  balance_cents integer,
  paid_cents integer,
  created_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_status text := lower(coalesce(p_status, 'all'));
  v_range text := lower(coalesce(p_range, 'all'));
  v_sort text := lower(coalesce(p_sort, 'due_date_desc'));
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  return query
  with base as (
    select
      i.id,
      i.client_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        'Unknown client'
      ) as client_name,
      i.invoice_number,
      i.status,
      i.subject,
      i.issued_at,
      i.due_date,
      i.total_cents,
      i.balance_cents,
      i.paid_cents,
      i.created_at,
      i.updated_at,
      coalesce(i.issued_at::date, i.created_at::date) as reference_date
    from public.invoices i
    left join public.clients c on c.id = i.client_id
    where i.org_id = v_org
      and i.deleted_at is null
      and (c.id is null or c.org_id = v_org)
  ),
  filtered as (
    select *
    from base b
    where
      (
        v_status = 'all'
        or (v_status = 'draft' and b.status = 'draft')
        or (v_status = 'paid' and b.status = 'paid')
        or (
          v_status = 'past_due'
          and b.status in ('sent', 'partial')
          and b.balance_cents > 0
          and b.due_date < current_date
        )
        or (
          v_status = 'sent_not_due'
          and b.status in ('sent', 'partial')
          and b.balance_cents > 0
          and b.due_date >= current_date
        )
      )
      and (
        v_range = 'all'
        or (v_range = '30d' and b.reference_date >= (current_date - interval '30 days')::date)
        or (v_range = 'this_month' and date_trunc('month', b.reference_date) = date_trunc('month', current_date))
        or (
          v_range = 'custom'
          and (p_from is null or b.reference_date >= p_from)
          and (p_to is null or b.reference_date <= p_to)
        )
      )
      and (
        v_q is null
        or b.client_name ilike ('%' || v_q || '%')
        or b.invoice_number ilike ('%' || v_q || '%')
        or coalesce(b.subject, '') ilike ('%' || v_q || '%')
      )
  )
  select
    f.id,
    f.client_id,
    f.client_name,
    f.invoice_number,
    f.status,
    f.subject,
    f.issued_at,
    f.due_date,
    f.total_cents,
    f.balance_cents,
    f.paid_cents,
    f.created_at,
    f.updated_at,
    count(*) over() as total_count
  from filtered f
  order by
    case when v_sort = 'client_asc' then lower(f.client_name) end asc nulls last,
    case when v_sort = 'client_desc' then lower(f.client_name) end desc nulls last,
    case when v_sort = 'invoice_number_asc' then f.invoice_number end asc nulls last,
    case when v_sort = 'invoice_number_desc' then f.invoice_number end desc nulls last,
    case when v_sort = 'due_date_asc' then f.due_date end asc nulls last,
    case when v_sort = 'due_date_desc' then f.due_date end desc nulls last,
    case when v_sort = 'status_asc' then f.status end asc nulls last,
    case when v_sort = 'status_desc' then f.status end desc nulls last,
    case when v_sort = 'total_asc' then f.total_cents end asc nulls last,
    case when v_sort = 'total_desc' then f.total_cents end desc nulls last,
    case when v_sort = 'balance_asc' then f.balance_cents end asc nulls last,
    case when v_sort = 'balance_desc' then f.balance_cents end desc nulls last,
    f.created_at desc
  limit v_limit
  offset v_offset;
end;
$fn$;

revoke all on table public.invoices from public;
revoke all on table public.invoice_items from public;
revoke all on table public.invoice_sequences from public;

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_sequences enable row level security;

do $do$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_select_org'
  ) then
    create policy invoices_select_org on public.invoices
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_insert_org'
  ) then
    create policy invoices_insert_org on public.invoices
      for insert to authenticated
      with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_update_org'
  ) then
    create policy invoices_update_org on public.invoices
      for update to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoices' and policyname = 'invoices_delete_org'
  ) then
    create policy invoices_delete_org on public.invoices
      for delete to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_items' and policyname = 'invoice_items_select_org'
  ) then
    create policy invoice_items_select_org on public.invoice_items
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_items' and policyname = 'invoice_items_insert_org'
  ) then
    create policy invoice_items_insert_org on public.invoice_items
      for insert to authenticated
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_items' and policyname = 'invoice_items_update_org'
  ) then
    create policy invoice_items_update_org on public.invoice_items
      for update to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_items' and policyname = 'invoice_items_delete_org'
  ) then
    create policy invoice_items_delete_org on public.invoice_items
      for delete to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_sequences' and policyname = 'invoice_sequences_select_org'
  ) then
    create policy invoice_sequences_select_org on public.invoice_sequences
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'invoice_sequences' and policyname = 'invoice_sequences_update_org'
  ) then
    create policy invoice_sequences_update_org on public.invoice_sequences
      for all to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$do$;

revoke all on function public.invoice_next_number(uuid) from public;
revoke all on function public.recalculate_invoice_totals(uuid) from public;
revoke all on function public.rpc_create_invoice_draft(uuid, text, date) from public;
revoke all on function public.rpc_save_invoice_draft(uuid, text, date, integer, jsonb) from public;
revoke all on function public.rpc_invoices_kpis_30d(uuid) from public;
revoke all on function public.rpc_list_invoices(text, text, text, text, integer, integer, date, date, uuid) from public;

grant execute on function public.invoice_next_number(uuid) to authenticated, service_role;
grant execute on function public.recalculate_invoice_totals(uuid) to authenticated, service_role;
grant execute on function public.rpc_create_invoice_draft(uuid, text, date) to authenticated, service_role;
grant execute on function public.rpc_save_invoice_draft(uuid, text, date, integer, jsonb) to authenticated, service_role;
grant execute on function public.rpc_invoices_kpis_30d(uuid) to authenticated, service_role;
grant execute on function public.rpc_list_invoices(text, text, text, text, integer, integer, date, date, uuid) to authenticated, service_role;

commit;
