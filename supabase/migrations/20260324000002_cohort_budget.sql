begin;

-- ═══════════════════════════════════════════════════════════════
-- Cohort Analysis + Budget vs Actual
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Cohort Retention ──────────────────────────────────────
-- Returns: acquisition_month, months_after (0-11), active_clients
create or replace function public.rpc_insights_cohort_retention(
  p_org uuid default null
)
returns table (
  cohort_month text,
  months_after int,
  cohort_size bigint,
  active_count bigint,
  retention_pct numeric
)
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
begin
  v_org := coalesce(p_org, current_org_id());
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not has_org_membership(auth.uid(), v_org) then raise exception 'Not allowed'; end if;

  return query
  with client_first_job as (
    select
      c.id as client_id,
      date_trunc('month', min(j.created_at))::date as acquisition_month
    from clients c
    join jobs j on j.client_id = c.id and j.org_id = c.org_id and j.deleted_at is null
    where c.org_id = v_org and c.deleted_at is null
    group by c.id
    having min(j.created_at) >= (current_date - interval '12 months')
  ),
  cohorts as (
    select acquisition_month, count(*)::bigint as cohort_size
    from client_first_job
    group by acquisition_month
  ),
  activity as (
    select
      cfj.client_id,
      cfj.acquisition_month,
      date_trunc('month', j.created_at)::date as activity_month
    from client_first_job cfj
    join jobs j on j.client_id = cfj.client_id and j.org_id = v_org and j.deleted_at is null
  ),
  retention as (
    select
      a.acquisition_month,
      (extract(year from a.activity_month) * 12 + extract(month from a.activity_month)
       - extract(year from a.acquisition_month) * 12 - extract(month from a.acquisition_month))::int as months_after,
      count(distinct a.client_id)::bigint as active_count
    from activity a
    group by a.acquisition_month, 2
  )
  select
    to_char(c.acquisition_month, 'YYYY-MM') as cohort_month,
    r.months_after,
    c.cohort_size,
    r.active_count,
    round((r.active_count::numeric / c.cohort_size) * 100, 1) as retention_pct
  from cohorts c
  join retention r on r.acquisition_month = c.acquisition_month
  where r.months_after between 0 and 11
  order by c.acquisition_month, r.months_after;
end;
$$;

-- ── 2. Budget Targets table ──────────────────────────────────
create table if not exists public.budget_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  month date not null,
  metric text not null, -- 'revenue', 'jobs', 'leads', 'invoiced'
  target_value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, month, metric)
);

alter table public.budget_targets enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'budget_targets' and policyname = 'budget_targets_select_org') then
    create policy budget_targets_select_org on public.budget_targets for select to authenticated using (has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'budget_targets' and policyname = 'budget_targets_insert_org') then
    create policy budget_targets_insert_org on public.budget_targets for insert to authenticated with check (has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'budget_targets' and policyname = 'budget_targets_update_org') then
    create policy budget_targets_update_org on public.budget_targets for update to authenticated using (has_org_membership(auth.uid(), org_id));
  end if;
end $$;

-- ── 3. Budget vs Actual RPC ──────────────────────────────────
create or replace function public.rpc_insights_budget_vs_actual(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  month_label text,
  metric text,
  target_value bigint,
  actual_value bigint,
  variance_pct numeric
)
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_from date; v_to date;
begin
  v_org := coalesce(p_org, current_org_id());
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not has_org_membership(auth.uid(), v_org) then raise exception 'Not allowed'; end if;

  v_from := coalesce(p_from, date_trunc('year', current_date)::date);
  v_to := coalesce(p_to, current_date);

  return query
  with months as (
    select generate_series(
      date_trunc('month', v_from)::date,
      date_trunc('month', v_to)::date,
      '1 month'::interval
    )::date as m
  ),
  targets as (
    select month, metric as tmetric, target_value
    from budget_targets
    where org_id = v_org and month >= v_from and month <= v_to
  ),
  -- Revenue actuals per month
  rev_actual as (
    select date_trunc('month', coalesce(i.paid_at, i.issued_at))::date as m,
      coalesce(sum(i.total_cents), 0)::bigint as val
    from invoices i
    where i.org_id = v_org and i.deleted_at is null and i.status = 'paid'
      and coalesce(i.paid_at, i.issued_at) >= v_from::timestamptz
      and coalesce(i.paid_at, i.issued_at) < (v_to + 1)::timestamptz
    group by 1
  ),
  -- Jobs actuals per month
  jobs_actual as (
    select date_trunc('month', j.created_at)::date as m,
      count(*)::bigint as val
    from jobs j
    where j.org_id = v_org and j.deleted_at is null
      and j.created_at >= v_from::timestamptz
      and j.created_at < (v_to + 1)::timestamptz
    group by 1
  ),
  -- Leads actuals per month
  leads_actual as (
    select date_trunc('month', l.created_at)::date as m,
      count(*)::bigint as val
    from leads l
    where l.org_id = v_org and l.deleted_at is null
      and l.created_at >= v_from::timestamptz
      and l.created_at < (v_to + 1)::timestamptz
    group by 1
  )
  -- Revenue targets
  select to_char(mo.m, 'Mon YY'), 'revenue'::text, coalesce(tg.target_value, 0), coalesce(ra.val, 0),
    case when coalesce(tg.target_value, 0) > 0 then round(((coalesce(ra.val, 0) - tg.target_value)::numeric / tg.target_value) * 100, 1) else null end
  from months mo
  left join targets tg on tg.month = mo.m and tg.tmetric = 'revenue'
  left join rev_actual ra on ra.m = mo.m
  where coalesce(tg.target_value, 0) > 0 or coalesce(ra.val, 0) > 0
  union all
  -- Jobs targets
  select to_char(mo.m, 'Mon YY'), 'jobs', coalesce(tg.target_value, 0), coalesce(ja.val, 0),
    case when coalesce(tg.target_value, 0) > 0 then round(((coalesce(ja.val, 0) - tg.target_value)::numeric / tg.target_value) * 100, 1) else null end
  from months mo
  left join targets tg on tg.month = mo.m and tg.tmetric = 'jobs'
  left join jobs_actual ja on ja.m = mo.m
  where coalesce(tg.target_value, 0) > 0 or coalesce(ja.val, 0) > 0
  union all
  -- Leads targets
  select to_char(mo.m, 'Mon YY'), 'leads', coalesce(tg.target_value, 0), coalesce(la.val, 0),
    case when coalesce(tg.target_value, 0) > 0 then round(((coalesce(la.val, 0) - tg.target_value)::numeric / tg.target_value) * 100, 1) else null end
  from months mo
  left join targets tg on tg.month = mo.m and tg.tmetric = 'leads'
  left join leads_actual la on la.m = mo.m
  where coalesce(tg.target_value, 0) > 0 or coalesce(la.val, 0) > 0
  order by 1, 2;
end;
$$;

-- ── Permissions ──────────────────────────────────────────────
revoke all on function public.rpc_insights_cohort_retention(uuid) from public;
revoke all on function public.rpc_insights_budget_vs_actual(uuid, date, date) from public;

grant execute on function public.rpc_insights_cohort_retention(uuid) to authenticated, service_role;
grant execute on function public.rpc_insights_budget_vs_actual(uuid, date, date) to authenticated, service_role;

commit;
