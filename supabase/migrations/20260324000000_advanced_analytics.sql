begin;

-- ═══════════════════════════════════════════════════════════════
-- Advanced Analytics RPCs — Period comparison, forecasting, team perf
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Period Comparison (current vs previous) ──────────────
create or replace function public.rpc_insights_period_comparison(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  metric text,
  current_value bigint,
  previous_value bigint,
  change_pct numeric
)
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_from date; v_to date;
  v_days int;
  v_prev_from date; v_prev_to date;
  v_from_ts timestamptz; v_to_ex timestamptz;
  v_prev_from_ts timestamptz; v_prev_to_ex timestamptz;
  v_has_payments boolean;
begin
  v_org := coalesce(p_org, current_org_id());
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not has_org_membership(auth.uid(), v_org) then raise exception 'Not allowed'; end if;

  v_from := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to := coalesce(p_to, current_date);
  v_days := greatest(v_to - v_from + 1, 1);
  v_prev_from := v_from - v_days;
  v_prev_to := v_from - 1;

  v_from_ts := v_from::timestamptz;
  v_to_ex := (v_to + 1)::timestamptz;
  v_prev_from_ts := v_prev_from::timestamptz;
  v_prev_to_ex := v_from::timestamptz;

  v_has_payments := to_regclass('public.payments') is not null;

  return query
  with cur as (
    select
      (select count(*) from leads where org_id = v_org and deleted_at is null and created_at >= v_from_ts and created_at < v_to_ex) as leads,
      (select count(*) from jobs where org_id = v_org and deleted_at is null and created_at >= v_from_ts and created_at < v_to_ex) as jobs,
      (select coalesce(sum(total_cents),0) from invoices where org_id = v_org and deleted_at is null and status in ('sent','partial','paid') and coalesce(issued_at,created_at) >= v_from_ts and coalesce(issued_at,created_at) < v_to_ex) as invoiced,
      (select count(*) from jobs where org_id = v_org and deleted_at is null and lead_id is not null and created_at >= v_from_ts and created_at < v_to_ex) as conversions,
      (select count(*) from invoices where org_id = v_org and deleted_at is null and status = 'paid' and paid_at >= v_from_ts and paid_at < v_to_ex) as paid_invoices
  ),
  prev as (
    select
      (select count(*) from leads where org_id = v_org and deleted_at is null and created_at >= v_prev_from_ts and created_at < v_prev_to_ex) as leads,
      (select count(*) from jobs where org_id = v_org and deleted_at is null and created_at >= v_prev_from_ts and created_at < v_prev_to_ex) as jobs,
      (select coalesce(sum(total_cents),0) from invoices where org_id = v_org and deleted_at is null and status in ('sent','partial','paid') and coalesce(issued_at,created_at) >= v_prev_from_ts and coalesce(issued_at,created_at) < v_prev_to_ex) as invoiced,
      (select count(*) from jobs where org_id = v_org and deleted_at is null and lead_id is not null and created_at >= v_prev_from_ts and created_at < v_prev_to_ex) as conversions,
      (select count(*) from invoices where org_id = v_org and deleted_at is null and status = 'paid' and paid_at >= v_prev_from_ts and paid_at < v_prev_to_ex) as paid_invoices
  )
  select 'new_leads'::text, cur.leads::bigint, prev.leads::bigint, case when prev.leads > 0 then round(((cur.leads - prev.leads)::numeric / prev.leads) * 100, 1) else null end from cur, prev
  union all
  select 'new_jobs', cur.jobs, prev.jobs, case when prev.jobs > 0 then round(((cur.jobs - prev.jobs)::numeric / prev.jobs) * 100, 1) else null end from cur, prev
  union all
  select 'invoiced_value', cur.invoiced, prev.invoiced, case when prev.invoiced > 0 then round(((cur.invoiced - prev.invoiced)::numeric / prev.invoiced) * 100, 1) else null end from cur, prev
  union all
  select 'conversions', cur.conversions, prev.conversions, case when prev.conversions > 0 then round(((cur.conversions - prev.conversions)::numeric / prev.conversions) * 100, 1) else null end from cur, prev
  union all
  select 'paid_invoices', cur.paid_invoices, prev.paid_invoices, case when prev.paid_invoices > 0 then round(((cur.paid_invoices - prev.paid_invoices)::numeric / prev.paid_invoices) * 100, 1) else null end from cur, prev;
end;
$$;

-- ── 2. Revenue Forecast (next 3 months based on pipeline + history) ─
create or replace function public.rpc_insights_revenue_forecast(
  p_org uuid default null
)
returns table (
  month_start date,
  projected_cents bigint,
  source text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_avg_monthly_revenue bigint;
  v_pipeline_value bigint;
  v_conversion_rate numeric;
begin
  v_org := coalesce(p_org, current_org_id());
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not has_org_membership(auth.uid(), v_org) then raise exception 'Not allowed'; end if;

  -- Average monthly revenue over last 6 months
  select coalesce(sum(i.total_cents) / greatest(count(distinct date_trunc('month', coalesce(i.paid_at, i.issued_at))), 1), 0)::bigint
  into v_avg_monthly_revenue
  from invoices i
  where i.org_id = v_org and i.deleted_at is null and i.status = 'paid'
    and i.paid_at >= (current_date - interval '6 months');

  -- Active pipeline value (quotes that are sent/draft)
  select coalesce(sum(q.total_cents), 0)::bigint
  into v_pipeline_value
  from quotes q
  where q.org_id = v_org and q.deleted_at is null and q.status in ('draft', 'sent', 'action_required');

  -- Historical conversion rate (quotes approved / total quotes last 6 months)
  select case
    when count(*) > 0 then (count(*) filter (where q.status = 'approved'))::numeric / count(*)
    else 0.3
  end
  into v_conversion_rate
  from quotes q
  where q.org_id = v_org and q.deleted_at is null
    and q.created_at >= (current_date - interval '6 months');

  -- Return 3 months forecast
  return query
  select
    (date_trunc('month', current_date) + (n || ' months')::interval)::date as month_start,
    -- Blend: 70% historical average + 30% pipeline-based projection (decaying)
    (v_avg_monthly_revenue * 0.7 + (v_pipeline_value * v_conversion_rate * (1.0 / (n + 1))) * 0.3)::bigint as projected_cents,
    'blended'::text as source
  from generate_series(1, 3) as n;
end;
$$;

-- ── 3. Team Performance ──────────────────────────────────────
create or replace function public.rpc_insights_team_performance(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  team_id uuid,
  team_name text,
  jobs_count bigint,
  jobs_completed bigint,
  completion_rate numeric,
  revenue_cents bigint,
  avg_job_value_cents bigint
)
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_from_ts timestamptz; v_to_ex timestamptz;
begin
  v_org := coalesce(p_org, current_org_id());
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not has_org_membership(auth.uid(), v_org) then raise exception 'Not allowed'; end if;

  v_from_ts := coalesce(p_from, date_trunc('month', current_date)::date)::timestamptz;
  v_to_ex := (coalesce(p_to, current_date) + 1)::timestamptz;

  return query
  select
    tm.id as team_id,
    tm.name as team_name,
    count(j.id)::bigint as jobs_count,
    count(j.id) filter (where j.status in ('completed', 'invoiced'))::bigint as jobs_completed,
    case when count(j.id) > 0
      then round((count(j.id) filter (where j.status in ('completed', 'invoiced')))::numeric / count(j.id) * 100, 1)
      else 0
    end as completion_rate,
    coalesce(sum(j.total_cents) filter (where j.status in ('completed', 'invoiced')), 0)::bigint as revenue_cents,
    case when count(j.id) filter (where j.status in ('completed', 'invoiced')) > 0
      then (sum(j.total_cents) filter (where j.status in ('completed', 'invoiced')) / count(j.id) filter (where j.status in ('completed', 'invoiced')))::bigint
      else 0
    end as avg_job_value_cents
  from teams tm
  left join jobs j on j.team_id = tm.id and j.org_id = v_org and j.deleted_at is null
    and j.created_at >= v_from_ts and j.created_at < v_to_ex
  where tm.org_id = v_org and tm.deleted_at is null and tm.is_active = true
  group by tm.id, tm.name
  order by revenue_cents desc;
end;
$$;

-- ── 4. Pipeline Velocity ─────────────────────────────────────
create or replace function public.rpc_insights_pipeline_velocity(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  total_deals bigint,
  won_deals bigint,
  lost_deals bigint,
  win_rate numeric,
  avg_deal_value_cents bigint,
  avg_days_to_close numeric
)
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_from_ts timestamptz; v_to_ex timestamptz;
begin
  v_org := coalesce(p_org, current_org_id());
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not has_org_membership(auth.uid(), v_org) then raise exception 'Not allowed'; end if;

  v_from_ts := coalesce(p_from, date_trunc('month', current_date)::date)::timestamptz;
  v_to_ex := (coalesce(p_to, current_date) + 1)::timestamptz;

  return query
  with deals as (
    select
      d.id,
      d.status,
      d.value_cents,
      d.created_at,
      d.updated_at,
      case when d.status in ('won', 'closed_won') then extract(epoch from (d.updated_at - d.created_at)) / 86400.0 else null end as days_to_close
    from pipeline_deals d
    where d.org_id = v_org and d.deleted_at is null
      and d.created_at >= v_from_ts and d.created_at < v_to_ex
  )
  select
    count(*)::bigint as total_deals,
    count(*) filter (where status in ('won', 'closed_won'))::bigint as won_deals,
    count(*) filter (where status in ('lost', 'closed_lost'))::bigint as lost_deals,
    case when count(*) filter (where status in ('won', 'closed_won', 'lost', 'closed_lost')) > 0
      then round(count(*) filter (where status in ('won', 'closed_won'))::numeric / count(*) filter (where status in ('won', 'closed_won', 'lost', 'closed_lost')) * 100, 1)
      else 0
    end as win_rate,
    case when count(*) filter (where status in ('won', 'closed_won')) > 0
      then (coalesce(sum(value_cents) filter (where status in ('won', 'closed_won')), 0) / count(*) filter (where status in ('won', 'closed_won')))::bigint
      else 0
    end as avg_deal_value_cents,
    round(coalesce(avg(days_to_close), 0)::numeric, 1) as avg_days_to_close
  from deals;
end;
$$;

-- ── Permissions ──────────────────────────────────────────────
revoke all on function public.rpc_insights_period_comparison(uuid, date, date) from public;
revoke all on function public.rpc_insights_revenue_forecast(uuid) from public;
revoke all on function public.rpc_insights_team_performance(uuid, date, date) from public;
revoke all on function public.rpc_insights_pipeline_velocity(uuid, date, date) from public;

grant execute on function public.rpc_insights_period_comparison(uuid, date, date) to authenticated, service_role;
grant execute on function public.rpc_insights_revenue_forecast(uuid) to authenticated, service_role;
grant execute on function public.rpc_insights_team_performance(uuid, date, date) to authenticated, service_role;
grant execute on function public.rpc_insights_pipeline_velocity(uuid, date, date) to authenticated, service_role;

commit;
