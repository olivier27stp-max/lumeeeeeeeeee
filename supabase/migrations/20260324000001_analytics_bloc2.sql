begin;

-- ═══════════════════════════════════════════════════════════════
-- Bloc 2 Analytics — CLV, Job Profitability, Churn Prediction
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Client Lifetime Value ─────────────────────────────────
create or replace function public.rpc_insights_client_lifetime_value(
  p_org uuid default null,
  p_limit int default 20
)
returns table (
  client_id uuid,
  client_name text,
  first_job_at timestamptz,
  tenure_days int,
  total_jobs bigint,
  total_revenue_cents bigint,
  avg_job_value_cents bigint,
  last_activity_at timestamptz,
  days_since_last_activity int,
  clv_score numeric
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
  with client_stats as (
    select
      c.id as cid,
      concat(c.first_name, ' ', c.last_name) as cname,
      min(j.created_at) as first_job,
      max(coalesce(j.updated_at, j.created_at)) as last_activity,
      count(j.id) as job_count,
      coalesce(sum(j.total_cents), 0) as rev_cents
    from clients c
    left join jobs j on j.client_id = c.id and j.org_id = c.org_id and j.deleted_at is null
    where c.org_id = v_org and c.deleted_at is null
    group by c.id, c.first_name, c.last_name
  ),
  invoice_rev as (
    select
      i.client_id as cid,
      coalesce(sum(i.total_cents), 0) as inv_cents
    from invoices i
    where i.org_id = v_org and i.deleted_at is null and i.status = 'paid'
    group by i.client_id
  )
  select
    cs.cid as client_id,
    cs.cname as client_name,
    cs.first_job as first_job_at,
    extract(day from (now() - coalesce(cs.first_job, now())))::int as tenure_days,
    cs.job_count::bigint as total_jobs,
    greatest(cs.rev_cents, coalesce(ir.inv_cents, 0))::bigint as total_revenue_cents,
    case when cs.job_count > 0 then (greatest(cs.rev_cents, coalesce(ir.inv_cents, 0)) / cs.job_count)::bigint else 0 end as avg_job_value_cents,
    cs.last_activity as last_activity_at,
    extract(day from (now() - coalesce(cs.last_activity, cs.first_job, now())))::int as days_since_last_activity,
    -- CLV score: weighted combo of revenue, frequency, recency
    round(
      (least(greatest(cs.rev_cents, coalesce(ir.inv_cents, 0))::numeric / 100000, 40) * 0.5) -- revenue weight (max 40pts)
      + (least(cs.job_count::numeric, 20) * 0.3) -- frequency weight (max 20pts → 6pts)
      + (greatest(0, 40 - extract(day from (now() - coalesce(cs.last_activity, now())))::numeric / 3) * 0.2) -- recency weight (max 40pts → 8pts)
    , 1) as clv_score
  from client_stats cs
  left join invoice_rev ir on ir.cid = cs.cid
  where cs.job_count > 0
  order by clv_score desc
  limit p_limit;
end;
$$;

-- ── 2. Job Profitability ─────────────────────────────────────
create or replace function public.rpc_insights_job_profitability(
  p_org uuid default null,
  p_from date default null,
  p_to date default null
)
returns table (
  total_jobs bigint,
  total_revenue_cents bigint,
  total_cost_cents bigint,
  gross_margin_cents bigint,
  margin_pct numeric,
  avg_revenue_per_job_cents bigint,
  avg_cost_per_job_cents bigint,
  profitable_jobs bigint,
  unprofitable_jobs bigint
)
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid;
  v_from_ts timestamptz; v_to_ex timestamptz;
  v_has_cost boolean;
  v_has_time_entries boolean;
begin
  v_org := coalesce(p_org, current_org_id());
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not has_org_membership(auth.uid(), v_org) then raise exception 'Not allowed'; end if;

  v_from_ts := coalesce(p_from, date_trunc('month', current_date)::date)::timestamptz;
  v_to_ex := (coalesce(p_to, current_date) + 1)::timestamptz;

  v_has_cost := exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='cost_cents');
  v_has_time_entries := to_regclass('public.time_entries') is not null;

  if v_has_cost then
    return query
    with job_data as (
      select
        j.id,
        coalesce(j.total_cents, 0) as rev,
        coalesce(j.cost_cents, 0) as cost
      from jobs j
      where j.org_id = v_org and j.deleted_at is null
        and j.status in ('completed', 'invoiced')
        and j.created_at >= v_from_ts and j.created_at < v_to_ex
    )
    select
      count(*)::bigint,
      coalesce(sum(rev), 0)::bigint,
      coalesce(sum(cost), 0)::bigint,
      (coalesce(sum(rev), 0) - coalesce(sum(cost), 0))::bigint,
      case when sum(rev) > 0 then round(((sum(rev) - sum(cost))::numeric / sum(rev)) * 100, 1) else 0 end,
      case when count(*) > 0 then (sum(rev) / count(*))::bigint else 0 end,
      case when count(*) > 0 then (sum(cost) / count(*))::bigint else 0 end,
      count(*) filter (where rev > cost)::bigint,
      count(*) filter (where rev <= cost and cost > 0)::bigint
    from job_data;
  else
    -- No cost data: estimate from time entries if available
    return query
    select
      count(*)::bigint,
      coalesce(sum(j.total_cents), 0)::bigint,
      0::bigint,
      coalesce(sum(j.total_cents), 0)::bigint,
      100::numeric,
      case when count(*) > 0 then (sum(j.total_cents) / count(*))::bigint else 0 end,
      0::bigint,
      count(*)::bigint,
      0::bigint
    from jobs j
    where j.org_id = v_org and j.deleted_at is null
      and j.status in ('completed', 'invoiced')
      and j.created_at >= v_from_ts and j.created_at < v_to_ex;
  end if;
end;
$$;

-- ── 3. Churn Risk / At-Risk Clients ─────────────────────────
create or replace function public.rpc_insights_churn_risk(
  p_org uuid default null,
  p_limit int default 20
)
returns table (
  client_id uuid,
  client_name text,
  email text,
  total_jobs bigint,
  total_revenue_cents bigint,
  last_activity_at timestamptz,
  days_inactive int,
  overdue_invoices bigint,
  overdue_amount_cents bigint,
  churn_risk_score numeric,
  risk_level text
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
  with client_activity as (
    select
      c.id as cid,
      concat(c.first_name, ' ', c.last_name) as cname,
      c.email,
      count(j.id) as job_count,
      coalesce(sum(j.total_cents), 0) as rev,
      max(coalesce(j.updated_at, j.created_at)) as last_act
    from clients c
    left join jobs j on j.client_id = c.id and j.org_id = c.org_id and j.deleted_at is null
    where c.org_id = v_org and c.deleted_at is null
    group by c.id, c.first_name, c.last_name, c.email
    having count(j.id) > 0
  ),
  overdue as (
    select
      i.client_id as cid,
      count(*) as overdue_count,
      coalesce(sum(i.balance_cents), 0) as overdue_amt
    from invoices i
    where i.org_id = v_org and i.deleted_at is null
      and i.status in ('sent', 'partial')
      and i.balance_cents > 0
      and i.due_date < current_date
    group by i.client_id
  )
  select
    ca.cid as client_id,
    ca.cname as client_name,
    ca.email,
    ca.job_count::bigint as total_jobs,
    ca.rev::bigint as total_revenue_cents,
    ca.last_act as last_activity_at,
    extract(day from (now() - coalesce(ca.last_act, now())))::int as days_inactive,
    coalesce(o.overdue_count, 0)::bigint as overdue_invoices,
    coalesce(o.overdue_amt, 0)::bigint as overdue_amount_cents,
    -- Churn score: higher = more at risk (0-100)
    round(least(100,
      -- Inactivity: 0-50 points (30+ days = 10pts, 60+ = 25pts, 90+ = 40pts, 180+ = 50pts)
      case
        when extract(day from (now() - coalesce(ca.last_act, now()))) >= 180 then 50
        when extract(day from (now() - coalesce(ca.last_act, now()))) >= 90 then 40
        when extract(day from (now() - coalesce(ca.last_act, now()))) >= 60 then 25
        when extract(day from (now() - coalesce(ca.last_act, now()))) >= 30 then 10
        else 0
      end
      -- Overdue invoices: 0-30 points
      + least(coalesce(o.overdue_count, 0)::numeric * 10, 30)
      -- Low frequency: 0-20 points (1 job = 15pts, 2 jobs = 8pts)
      + case when ca.job_count <= 1 then 15 when ca.job_count <= 2 then 8 else 0 end
    ), 1) as churn_risk_score,
    case
      when least(100,
        case when extract(day from (now() - coalesce(ca.last_act, now()))) >= 180 then 50
             when extract(day from (now() - coalesce(ca.last_act, now()))) >= 90 then 40
             when extract(day from (now() - coalesce(ca.last_act, now()))) >= 60 then 25
             when extract(day from (now() - coalesce(ca.last_act, now()))) >= 30 then 10
             else 0 end
        + least(coalesce(o.overdue_count, 0)::numeric * 10, 30)
        + case when ca.job_count <= 1 then 15 when ca.job_count <= 2 then 8 else 0 end
      ) >= 60 then 'high'
      when least(100,
        case when extract(day from (now() - coalesce(ca.last_act, now()))) >= 180 then 50
             when extract(day from (now() - coalesce(ca.last_act, now()))) >= 90 then 40
             when extract(day from (now() - coalesce(ca.last_act, now()))) >= 60 then 25
             when extract(day from (now() - coalesce(ca.last_act, now()))) >= 30 then 10
             else 0 end
        + least(coalesce(o.overdue_count, 0)::numeric * 10, 30)
        + case when ca.job_count <= 1 then 15 when ca.job_count <= 2 then 8 else 0 end
      ) >= 30 then 'medium'
      else 'low'
    end as risk_level
  from client_activity ca
  left join overdue o on o.cid = ca.cid
  order by churn_risk_score desc
  limit p_limit;
end;
$$;

-- ── Permissions ──────────────────────────────────────────────
revoke all on function public.rpc_insights_client_lifetime_value(uuid, int) from public;
revoke all on function public.rpc_insights_job_profitability(uuid, date, date) from public;
revoke all on function public.rpc_insights_churn_risk(uuid, int) from public;

grant execute on function public.rpc_insights_client_lifetime_value(uuid, int) to authenticated, service_role;
grant execute on function public.rpc_insights_job_profitability(uuid, date, date) to authenticated, service_role;
grant execute on function public.rpc_insights_churn_risk(uuid, int) to authenticated, service_role;

commit;
