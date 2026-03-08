begin;

create extension if not exists pgcrypto;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  created_by uuid not null default auth.uid(),
  invoice_id uuid null references public.invoices(id) on delete set null,
  job_id uuid null references public.jobs(id) on delete set null,
  client_id uuid null references public.clients(id) on delete set null,
  amount_cents integer not null check (amount_cents >= 0),
  paid_at timestamptz not null,
  method text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

alter table public.payments add column if not exists org_id uuid;
alter table public.payments add column if not exists created_by uuid;
alter table public.payments add column if not exists invoice_id uuid;
alter table public.payments add column if not exists job_id uuid;
alter table public.payments add column if not exists client_id uuid;
alter table public.payments add column if not exists amount_cents integer;
alter table public.payments add column if not exists paid_at timestamptz;
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists created_at timestamptz;
alter table public.payments add column if not exists updated_at timestamptz;
alter table public.payments add column if not exists deleted_at timestamptz;

alter table public.payments alter column org_id set default public.current_org_id();
alter table public.payments alter column created_by set default auth.uid();
alter table public.payments alter column created_at set default now();
alter table public.payments alter column updated_at set default now();

update public.payments
set org_id = public.current_org_id()
where org_id is null;

update public.payments
set created_by = auth.uid()
where created_by is null;

update public.payments
set created_at = now()
where created_at is null;

update public.payments
set updated_at = now()
where updated_at is null;

alter table public.payments alter column org_id set not null;
alter table public.payments alter column created_by set not null;
alter table public.payments alter column amount_cents set not null;
alter table public.payments alter column paid_at set not null;
alter table public.payments alter column created_at set not null;
alter table public.payments alter column updated_at set not null;

alter table public.payments drop constraint if exists payments_invoice_id_fkey;
alter table public.payments
  add constraint payments_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete set null;

alter table public.payments drop constraint if exists payments_job_id_fkey;
alter table public.payments
  add constraint payments_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete set null;

alter table public.payments drop constraint if exists payments_client_id_fkey;
alter table public.payments
  add constraint payments_client_id_fkey
  foreign key (client_id) references public.clients(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_amount_cents_non_negative'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint payments_amount_cents_non_negative
      check (amount_cents >= 0);
  end if;
end;
$$;

create index if not exists idx_leads_org_created_at_insights on public.leads (org_id, created_at);
create index if not exists idx_jobs_org_created_at_insights on public.jobs (org_id, created_at);
create index if not exists idx_jobs_org_lead_id_insights on public.jobs (org_id, lead_id);
create index if not exists idx_invoices_org_issued_at_insights on public.invoices (org_id, issued_at);
create index if not exists idx_invoices_org_status_insights on public.invoices (org_id, status);
create index if not exists idx_payments_org_paid_at on public.payments (org_id, paid_at);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'stage_slug'
  ) then
    execute 'create index if not exists idx_leads_org_stage_slug_insights on public.leads (org_id, stage_slug)';
  end if;
end;
$$;

drop trigger if exists trg_payments_set_updated_at on public.payments;
create trigger trg_payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists trg_payments_enforce_scope on public.payments;
create trigger trg_payments_enforce_scope
before insert on public.payments
for each row execute function public.crm_enforce_scope();

revoke all on table public.payments from public;
alter table public.payments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments' and policyname = 'payments_select_org'
  ) then
    create policy payments_select_org on public.payments
      for select to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments' and policyname = 'payments_insert_org'
  ) then
    create policy payments_insert_org on public.payments
      for insert to authenticated
      with check (public.has_org_membership(auth.uid(), org_id) and created_by = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments' and policyname = 'payments_update_org'
  ) then
    create policy payments_update_org on public.payments
      for update to authenticated
      using (public.has_org_membership(auth.uid(), org_id))
      with check (public.has_org_membership(auth.uid(), org_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments' and policyname = 'payments_delete_org'
  ) then
    create policy payments_delete_org on public.payments
      for delete to authenticated
      using (public.has_org_membership(auth.uid(), org_id));
  end if;
end;
$$;

create or replace function public.rpc_insights_overview(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  new_leads_count bigint,
  converted_quotes_count bigint,
  new_oneoff_jobs_count bigint,
  invoiced_value_cents bigint,
  revenue_cents bigint,
  requests_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from_date date;
  v_to_date date;
  v_from_ts timestamptz;
  v_to_exclusive timestamptz;
  v_has_job_type boolean;
  v_has_payments boolean;
  v_new_leads bigint := 0;
  v_converted_quotes bigint := 0;
  v_new_oneoff_jobs bigint := 0;
  v_invoiced_cents bigint := 0;
  v_revenue_cents bigint := 0;
  v_requests bigint := null;
  v_has_requests boolean;
  v_requests_has_org boolean;
  v_requests_has_created boolean;
  v_requests_has_deleted boolean;
  v_requests_sql text;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;

  v_has_job_type := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'jobs'
      and column_name = 'job_type'
  );
  v_has_payments := to_regclass('public.payments') is not null;

  select count(*)
    into v_new_leads
  from public.leads l
  where l.org_id = v_org
    and l.deleted_at is null
    and l.created_at >= v_from_ts
    and l.created_at < v_to_exclusive;

  -- Converted quotes definition used here:
  -- jobs created from a lead (jobs.lead_id is not null) in selected date range.
  select count(*)
    into v_converted_quotes
  from public.jobs j
  where j.org_id = v_org
    and j.deleted_at is null
    and j.lead_id is not null
    and j.created_at >= v_from_ts
    and j.created_at < v_to_exclusive;

  select count(*)
    into v_new_oneoff_jobs
  from public.jobs j
  where j.org_id = v_org
    and j.deleted_at is null
    and j.created_at >= v_from_ts
    and j.created_at < v_to_exclusive
    and (
      not v_has_job_type
      or coalesce(nullif(lower(trim(j.job_type)), ''), 'one_off') = 'one_off'
    );

  select coalesce(sum(i.total_cents), 0)::bigint
    into v_invoiced_cents
  from public.invoices i
  where i.org_id = v_org
    and i.deleted_at is null
    and i.status in ('sent', 'partial', 'paid')
    and coalesce(i.issued_at, i.created_at) >= v_from_ts
    and coalesce(i.issued_at, i.created_at) < v_to_exclusive;

  if v_has_payments then
    select coalesce(sum(p.amount_cents), 0)::bigint
      into v_revenue_cents
    from public.payments p
    where p.org_id = v_org
      and p.deleted_at is null
      and p.paid_at >= v_from_ts
      and p.paid_at < v_to_exclusive;
  else
    select coalesce(sum(i.paid_cents), 0)::bigint
      into v_revenue_cents
    from public.invoices i
    where i.org_id = v_org
      and i.deleted_at is null
      and i.paid_at is not null
      and i.paid_at >= v_from_ts
      and i.paid_at < v_to_exclusive;
  end if;

  v_has_requests := to_regclass('public.requests') is not null;
  if v_has_requests then
    v_requests_has_org := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'requests' and column_name = 'org_id'
    );
    v_requests_has_created := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'requests' and column_name = 'created_at'
    );
    v_requests_has_deleted := exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'requests' and column_name = 'deleted_at'
    );

    if v_requests_has_org and v_requests_has_created then
      v_requests_sql := 'select count(*) from public.requests r where r.org_id = $1 and r.created_at >= $2 and r.created_at < $3';
      if v_requests_has_deleted then
        v_requests_sql := v_requests_sql || ' and r.deleted_at is null';
      end if;
      execute v_requests_sql into v_requests using v_org, v_from_ts, v_to_exclusive;
    end if;
  end if;

  return query
  select
    v_new_leads,
    v_converted_quotes,
    v_new_oneoff_jobs,
    v_invoiced_cents,
    v_revenue_cents,
    v_requests;
end;
$$;

create or replace function public.rpc_insights_revenue_series(
  p_org uuid default null,
  p_from date default null,
  p_to date default null,
  p_granularity text default 'month'
)
returns table (
  bucket_start date,
  revenue_cents bigint,
  invoiced_cents bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from_date date;
  v_to_date date;
  v_from_ts timestamptz;
  v_to_exclusive timestamptz;
  v_granularity text;
  v_step interval;
  v_series_start date;
  v_series_end date;
  v_has_payments boolean;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;
  v_granularity := lower(coalesce(p_granularity, 'month'));
  if v_granularity not in ('day', 'week', 'month') then
    v_granularity := 'month';
  end if;

  if v_granularity = 'day' then
    v_step := interval '1 day';
    v_series_start := v_from_date;
    v_series_end := v_to_date;
  elsif v_granularity = 'week' then
    v_step := interval '1 week';
    v_series_start := date_trunc('week', v_from_date::timestamp)::date;
    v_series_end := date_trunc('week', v_to_date::timestamp)::date;
  else
    v_step := interval '1 month';
    v_series_start := date_trunc('month', v_from_date::timestamp)::date;
    v_series_end := date_trunc('month', v_to_date::timestamp)::date;
  end if;

  v_has_payments := to_regclass('public.payments') is not null;

  if v_has_payments then
    return query
    with buckets as (
      select generate_series(v_series_start::timestamp, v_series_end::timestamp, v_step)::date as bucket_start
    ),
    revenue as (
      select
        date_trunc(v_granularity, p.paid_at)::date as bucket_start,
        coalesce(sum(p.amount_cents), 0)::bigint as revenue_cents
      from public.payments p
      where p.org_id = v_org
        and p.deleted_at is null
        and p.paid_at >= v_from_ts
        and p.paid_at < v_to_exclusive
      group by 1
    ),
    invoiced as (
      select
        date_trunc(v_granularity, coalesce(i.issued_at, i.created_at))::date as bucket_start,
        coalesce(sum(i.total_cents), 0)::bigint as invoiced_cents
      from public.invoices i
      where i.org_id = v_org
        and i.deleted_at is null
        and i.status in ('sent', 'partial', 'paid')
        and coalesce(i.issued_at, i.created_at) >= v_from_ts
        and coalesce(i.issued_at, i.created_at) < v_to_exclusive
      group by 1
    )
    select
      b.bucket_start,
      coalesce(r.revenue_cents, 0)::bigint,
      coalesce(i.invoiced_cents, 0)::bigint
    from buckets b
    left join revenue r on r.bucket_start = b.bucket_start
    left join invoiced i on i.bucket_start = b.bucket_start
    order by b.bucket_start asc;
  else
    return query
    with buckets as (
      select generate_series(v_series_start::timestamp, v_series_end::timestamp, v_step)::date as bucket_start
    ),
    revenue as (
      select
        date_trunc(v_granularity, i.paid_at)::date as bucket_start,
        coalesce(sum(i.paid_cents), 0)::bigint as revenue_cents
      from public.invoices i
      where i.org_id = v_org
        and i.deleted_at is null
        and i.paid_at is not null
        and i.paid_at >= v_from_ts
        and i.paid_at < v_to_exclusive
      group by 1
    ),
    invoiced as (
      select
        date_trunc(v_granularity, coalesce(i.issued_at, i.created_at))::date as bucket_start,
        coalesce(sum(i.total_cents), 0)::bigint as invoiced_cents
      from public.invoices i
      where i.org_id = v_org
        and i.deleted_at is null
        and i.status in ('sent', 'partial', 'paid')
        and coalesce(i.issued_at, i.created_at) >= v_from_ts
        and coalesce(i.issued_at, i.created_at) < v_to_exclusive
      group by 1
    )
    select
      b.bucket_start,
      coalesce(r.revenue_cents, 0)::bigint,
      coalesce(i.invoiced_cents, 0)::bigint
    from buckets b
    left join revenue r on r.bucket_start = b.bucket_start
    left join invoiced i on i.bucket_start = b.bucket_start
    order by b.bucket_start asc;
  end if;
end;
$$;

create or replace function public.rpc_insights_lead_conversion(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  leads_created bigint,
  leads_closed bigint,
  conversion_rate numeric,
  breakdown jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from_date date;
  v_to_date date;
  v_from_ts timestamptz;
  v_to_exclusive timestamptz;
  v_has_source boolean;
  v_has_payments boolean;
  v_created bigint := 0;
  v_closed bigint := 0;
  v_rate numeric := 0;
  v_breakdown jsonb := null;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;

  v_has_source := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'leads'
      and column_name = 'source'
  );
  v_has_payments := to_regclass('public.payments') is not null;

  select count(*)
    into v_created
  from public.leads l
  where l.org_id = v_org
    and l.deleted_at is null
    and l.created_at >= v_from_ts
    and l.created_at < v_to_exclusive;

  select count(*)
    into v_closed
  from public.jobs j
  where j.org_id = v_org
    and j.deleted_at is null
    and j.lead_id is not null
    and j.created_at >= v_from_ts
    and j.created_at < v_to_exclusive;

  if v_created > 0 then
    v_rate := round((v_closed::numeric / v_created::numeric), 4);
  else
    v_rate := 0;
  end if;

  if v_has_source then
    if v_has_payments then
      with created_source as (
        select
          coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key,
          count(*)::bigint as leads_created
        from public.leads l
        where l.org_id = v_org
          and l.deleted_at is null
          and l.created_at >= v_from_ts
          and l.created_at < v_to_exclusive
        group by 1
      ),
      closed_source as (
        select
          coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key,
          count(*)::bigint as leads_closed
        from public.jobs j
        join public.leads l
          on l.id = j.lead_id
         and l.org_id = j.org_id
         and l.deleted_at is null
        where j.org_id = v_org
          and j.deleted_at is null
          and j.lead_id is not null
          and j.created_at >= v_from_ts
          and j.created_at < v_to_exclusive
        group by 1
      ),
      revenue_source as (
        select
          coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key,
          coalesce(sum(p.amount_cents), 0)::bigint as revenue_cents
        from public.payments p
        join public.jobs j
          on j.id = p.job_id
         and j.org_id = p.org_id
         and j.deleted_at is null
         and j.lead_id is not null
        join public.leads l
          on l.id = j.lead_id
         and l.org_id = j.org_id
         and l.deleted_at is null
        where p.org_id = v_org
          and p.deleted_at is null
          and p.paid_at >= v_from_ts
          and p.paid_at < v_to_exclusive
        group by 1
      ),
      source_keys as (
        select source_key from created_source
        union
        select source_key from closed_source
        union
        select source_key from revenue_source
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'source', sk.source_key,
            'leads_created', coalesce(cs.leads_created, 0),
            'leads_closed', coalesce(cl.leads_closed, 0),
            'revenue_cents', coalesce(rs.revenue_cents, 0)
          )
          order by sk.source_key
        ),
        '[]'::jsonb
      )
      into v_breakdown
      from source_keys sk
      left join created_source cs on cs.source_key = sk.source_key
      left join closed_source cl on cl.source_key = sk.source_key
      left join revenue_source rs on rs.source_key = sk.source_key;
    else
      with created_source as (
        select
          coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key,
          count(*)::bigint as leads_created
        from public.leads l
        where l.org_id = v_org
          and l.deleted_at is null
          and l.created_at >= v_from_ts
          and l.created_at < v_to_exclusive
        group by 1
      ),
      closed_source as (
        select
          coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key,
          count(*)::bigint as leads_closed
        from public.jobs j
        join public.leads l
          on l.id = j.lead_id
         and l.org_id = j.org_id
         and l.deleted_at is null
        where j.org_id = v_org
          and j.deleted_at is null
          and j.lead_id is not null
          and j.created_at >= v_from_ts
          and j.created_at < v_to_exclusive
        group by 1
      ),
      source_keys as (
        select source_key from created_source
        union
        select source_key from closed_source
      )
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'source', sk.source_key,
            'leads_created', coalesce(cs.leads_created, 0),
            'leads_closed', coalesce(cl.leads_closed, 0),
            'revenue_cents', 0
          )
          order by sk.source_key
        ),
        '[]'::jsonb
      )
      into v_breakdown
      from source_keys sk
      left join created_source cs on cs.source_key = sk.source_key
      left join closed_source cl on cl.source_key = sk.source_key;
    end if;
  end if;

  return query
  select v_created, v_closed, v_rate, v_breakdown;
end;
$$;

create or replace function public.rpc_insights_invoices_summary(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  count_draft bigint,
  count_sent bigint,
  count_paid bigint,
  count_past_due bigint,
  total_outstanding_cents bigint,
  avg_payment_time_days numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_from_date date;
  v_to_date date;
  v_from_ts timestamptz;
  v_to_exclusive timestamptz;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;

  return query
  with base as (
    select *
    from public.invoices i
    where i.org_id = v_org
      and i.deleted_at is null
      and coalesce(i.issued_at, i.created_at) >= v_from_ts
      and coalesce(i.issued_at, i.created_at) < v_to_exclusive
  ),
  paid_stats as (
    select
      avg(extract(epoch from (i.paid_at - i.issued_at)) / 86400.0) as avg_payment_time_days
    from public.invoices i
    where i.org_id = v_org
      and i.deleted_at is null
      and i.paid_at is not null
      and i.issued_at is not null
      and i.paid_at >= v_from_ts
      and i.paid_at < v_to_exclusive
      and i.paid_at >= i.issued_at
  )
  select
    count(*) filter (where b.status = 'draft')::bigint as count_draft,
    count(*) filter (where b.status in ('sent', 'partial'))::bigint as count_sent,
    count(*) filter (where b.status = 'paid')::bigint as count_paid,
    count(*) filter (
      where b.status in ('sent', 'partial')
        and b.balance_cents > 0
        and b.due_date < current_date
    )::bigint as count_past_due,
    coalesce(sum(b.balance_cents) filter (
      where b.status in ('sent', 'partial')
        and b.balance_cents > 0
    ), 0)::bigint as total_outstanding_cents,
    p.avg_payment_time_days
  from base b
  cross join paid_stats p;
end;
$$;

revoke all on function public.rpc_insights_overview(uuid, date, date) from public;
revoke all on function public.rpc_insights_revenue_series(uuid, date, date, text) from public;
revoke all on function public.rpc_insights_lead_conversion(uuid, date, date) from public;
revoke all on function public.rpc_insights_invoices_summary(uuid, date, date) from public;

grant execute on function public.rpc_insights_overview(uuid, date, date) to authenticated, service_role;
grant execute on function public.rpc_insights_revenue_series(uuid, date, date, text) to authenticated, service_role;
grant execute on function public.rpc_insights_lead_conversion(uuid, date, date) to authenticated, service_role;
grant execute on function public.rpc_insights_invoices_summary(uuid, date, date) to authenticated, service_role;

commit;
