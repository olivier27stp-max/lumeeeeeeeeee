-- ============================================================================
-- Correctifs Insights (audit 2026-08-02) — 5 RPC réparés :
-- 1. rpc_insights_revenue_series : ne compte plus les paiements pending/
--    failed/refunded comme du revenu (filtre status = 'succeeded').
-- 2. rpc_insights_lead_conversion : « leads créés » ne comptait que les
--    clients dont le statut ACTUEL est 'lead' — chaque lead converti (status
--    → 'active') disparaissait du dénominateur; « convertis » comptait des
--    jobs, pas des leads (un lead à 3 jobs comptait 3×). Taux plafonné à 1.
-- 3. rpc_insights_pipeline_velocity : lisait pipeline_deals.status, colonne
--    inexistante (c'est stage) — la RPC plantait et les tuiles « Délai de
--    conversion » / « Taux de réussite » affichaient toujours 0.
-- 4. rpc_insights_client_lifetime_value : le revenu incluait les jobs draft
--    et cancelled.
-- 5. rpc_insights_invoices_summary : « À recevoir » et « en retard » étaient
--    restreints aux factures émises dans la période — une facture impayée
--    plus ancienne disparaissait. Un encours n'est pas une métrique de
--    période : calculé org-wide.
-- ============================================================================

-- ── 1. Revenue series ───────────────────────────────────────────────────────
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
        and p.status = 'succeeded'
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

-- ── 2. Lead conversion ──────────────────────────────────────────────────────
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
volatile
security definer
set search_path = public
as $LUMES$
declare
  v_org uuid; v_from_date date; v_to_date date; v_from_ts timestamptz; v_to_exclusive timestamptz;
  v_has_payments boolean; v_created bigint := 0; v_closed bigint := 0; v_rate numeric := 0; v_breakdown jsonb := null;
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), v_org) then raise exception 'Not allowed for this organization'; end if;

  v_from_date := least(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_to_date := greatest(coalesce(p_from, date_trunc('month', current_date)::date), coalesce(p_to, current_date));
  v_from_ts := v_from_date::timestamptz;
  v_to_exclusive := (v_to_date + 1)::timestamptz;
  v_has_payments := to_regclass('public.payments') is not null;

  -- Un client « a été un lead » s'il l'est encore, s'il porte un lead_status,
  -- ou si un job le référence comme lead_id (la conversion met status='active'
  -- — filtrer sur le statut actuel faisait disparaître chaque lead converti).
  select count(*) into v_created
  from public.clients l
  where l.org_id = v_org and l.deleted_at is null
    and l.created_at >= v_from_ts and l.created_at < v_to_exclusive
    and (
      l.status = 'lead'
      or l.lead_status is not null
      or exists (select 1 from public.jobs j2 where j2.org_id = l.org_id and j2.lead_id = l.id and j2.deleted_at is null)
    );

  -- Leads distincts convertis (pas des jobs — un lead à 3 jobs comptait 3×).
  select count(distinct j.lead_id) into v_closed
  from public.jobs j
  where j.org_id = v_org and j.deleted_at is null and j.lead_id is not null
    and j.created_at >= v_from_ts and j.created_at < v_to_exclusive;

  if v_created > 0 then
    v_rate := least(round((v_closed::numeric / v_created::numeric), 4), 1);
  else
    v_rate := 0;
  end if;

  if v_has_payments then
    with created_source as (
      select coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key, count(*)::bigint as leads_created
      from public.clients l
      where l.org_id = v_org and l.deleted_at is null
        and l.created_at >= v_from_ts and l.created_at < v_to_exclusive
        and (
          l.status = 'lead'
          or l.lead_status is not null
          or exists (select 1 from public.jobs j2 where j2.org_id = l.org_id and j2.lead_id = l.id and j2.deleted_at is null)
        )
      group by 1
    ),
    closed_source as (
      select coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key, count(distinct j.lead_id)::bigint as leads_closed
      from public.jobs j
      join public.clients l on l.id = j.lead_id and l.org_id = j.org_id and l.deleted_at is null
      where j.org_id = v_org and j.deleted_at is null and j.lead_id is not null
        and j.created_at >= v_from_ts and j.created_at < v_to_exclusive
      group by 1
    ),
    revenue_source as (
      select coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key, coalesce(sum(p.amount_cents), 0)::bigint as revenue_cents
      from public.payments p
      join public.jobs j on j.id = p.job_id and j.org_id = p.org_id and j.deleted_at is null and j.lead_id is not null
      join public.clients l on l.id = j.lead_id and l.org_id = j.org_id and l.deleted_at is null
      where p.org_id = v_org and p.deleted_at is null and p.status = 'succeeded'
        and p.paid_at >= v_from_ts and p.paid_at < v_to_exclusive
      group by 1
    ),
    source_keys as (
      select source_key from created_source union
      select source_key from closed_source union
      select source_key from revenue_source
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'source', sk.source_key,
      'leads_created', coalesce(cs.leads_created, 0),
      'leads_closed', coalesce(cl.leads_closed, 0),
      'revenue_cents', coalesce(rs.revenue_cents, 0)
    ) order by sk.source_key), '[]'::jsonb)
    into v_breakdown
    from source_keys sk
    left join created_source cs on cs.source_key = sk.source_key
    left join closed_source cl on cl.source_key = sk.source_key
    left join revenue_source rs on rs.source_key = sk.source_key;
  else
    with created_source as (
      select coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key, count(*)::bigint as leads_created
      from public.clients l
      where l.org_id = v_org and l.deleted_at is null
        and l.created_at >= v_from_ts and l.created_at < v_to_exclusive
        and (
          l.status = 'lead'
          or l.lead_status is not null
          or exists (select 1 from public.jobs j2 where j2.org_id = l.org_id and j2.lead_id = l.id and j2.deleted_at is null)
        )
      group by 1
    ),
    closed_source as (
      select coalesce(nullif(trim(l.source), ''), 'Unknown') as source_key, count(distinct j.lead_id)::bigint as leads_closed
      from public.jobs j
      join public.clients l on l.id = j.lead_id and l.org_id = j.org_id and l.deleted_at is null
      where j.org_id = v_org and j.deleted_at is null and j.lead_id is not null
        and j.created_at >= v_from_ts and j.created_at < v_to_exclusive
      group by 1
    ),
    source_keys as (
      select source_key from created_source union
      select source_key from closed_source
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'source', sk.source_key,
      'leads_created', coalesce(cs.leads_created, 0),
      'leads_closed', coalesce(cl.leads_closed, 0),
      'revenue_cents', 0
    ) order by sk.source_key), '[]'::jsonb)
    into v_breakdown
    from source_keys sk
    left join created_source cs on cs.source_key = sk.source_key
    left join closed_source cl on cl.source_key = sk.source_key;
  end if;

  return query select v_created, v_closed, v_rate, v_breakdown;
end;
$LUMES$;

-- ── 3. Pipeline velocity (stage, pas status) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_insights_pipeline_velocity(p_org uuid default null, p_from date default null, p_to date default null)
RETURNS TABLE (total_deals bigint, won_deals bigint, lost_deals bigint, win_rate numeric, avg_deal_value_cents bigint, avg_days_to_close numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_from_ts timestamptz; v_to_ex timestamptz;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  v_from_ts := coalesce(p_from, date_trunc('month',current_date)::date)::timestamptz;
  v_to_ex := (coalesce(p_to,current_date)+1)::timestamptz;

  RETURN QUERY
  WITH deals AS (
    -- pipeline_deals n'a pas de colonne status : l'état vit dans stage
    -- (closed_won / closed_lost). L'ancienne version lisait d.status et
    -- plantait à chaque appel.
    SELECT d.id, d.stage AS status, d.value_cents, d.created_at, d.updated_at,
      CASE WHEN d.stage IN ('won','closed_won') THEN extract(epoch FROM (d.updated_at-d.created_at))/86400.0 ELSE NULL END AS days_to_close
    FROM pipeline_deals d WHERE d.org_id=v_org AND d.deleted_at IS NULL AND d.created_at>=v_from_ts AND d.created_at<v_to_ex
  )
  SELECT count(*)::bigint,
    count(*) FILTER (WHERE status IN ('won','closed_won'))::bigint,
    count(*) FILTER (WHERE status IN ('lost','closed_lost'))::bigint,
    CASE WHEN count(*) FILTER (WHERE status IN ('won','closed_won','lost','closed_lost'))>0
      THEN round(count(*) FILTER (WHERE status IN ('won','closed_won'))::numeric/count(*) FILTER (WHERE status IN ('won','closed_won','lost','closed_lost'))*100,1) ELSE 0 END,
    CASE WHEN count(*) FILTER (WHERE status IN ('won','closed_won'))>0
      THEN (coalesce(sum(value_cents) FILTER (WHERE status IN ('won','closed_won')),0)/count(*) FILTER (WHERE status IN ('won','closed_won')))::bigint ELSE 0 END,
    round(coalesce(avg(days_to_close),0)::numeric,1)
  FROM deals;
END;
$$;

-- ── 4. Client lifetime value (sans jobs draft/cancelled) ────────────────────
CREATE OR REPLACE FUNCTION public.rpc_insights_client_lifetime_value(p_org uuid default null, p_limit int default 20)
RETURNS TABLE (client_id uuid, client_name text, first_job_at timestamptz, tenure_days int, total_jobs bigint, total_revenue_cents bigint, avg_job_value_cents bigint, last_activity_at timestamptz, days_since_last_activity int, clv_score numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;

  RETURN QUERY
  WITH cs AS (
    SELECT c.id AS cid, concat(c.first_name,' ',c.last_name) AS cname, min(j.created_at) AS first_job, max(coalesce(j.updated_at,j.created_at)) AS last_act, count(j.id) AS jc, coalesce(sum(j.total_cents),0) AS rev
    FROM clients c LEFT JOIN jobs j ON j.client_id=c.id AND j.org_id=c.org_id AND j.deleted_at IS NULL AND j.status NOT IN ('draft','cancelled')
    WHERE c.org_id=v_org AND c.deleted_at IS NULL GROUP BY c.id, c.first_name, c.last_name
  ),
  ir AS (SELECT i.client_id AS cid, coalesce(sum(i.total_cents),0) AS inv FROM invoices i WHERE i.org_id=v_org AND i.deleted_at IS NULL AND i.status='paid' GROUP BY i.client_id)
  SELECT cs.cid, cs.cname, cs.first_job,
    extract(day FROM (now()-coalesce(cs.first_job,now())))::int,
    cs.jc::bigint, greatest(cs.rev,coalesce(ir.inv,0))::bigint,
    CASE WHEN cs.jc>0 THEN (greatest(cs.rev,coalesce(ir.inv,0))/cs.jc)::bigint ELSE 0 END,
    cs.last_act,
    extract(day FROM (now()-coalesce(cs.last_act,cs.first_job,now())))::int,
    round((least(greatest(cs.rev,coalesce(ir.inv,0))::numeric/100000,40)*0.5)+(least(cs.jc::numeric,20)*0.3)+(greatest(0,40-extract(day FROM (now()-coalesce(cs.last_act,now())))::numeric/3)*0.2),1)
  FROM cs LEFT JOIN ir ON ir.cid=cs.cid WHERE cs.jc>0 ORDER BY 10 DESC LIMIT p_limit;
END;
$$;

-- ── 5. Invoices summary (encours org-wide) ──────────────────────────────────
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
  -- L'encours n'est pas une métrique de période : une facture impayée émise
  -- avant la fenêtre reste à recevoir. Org-wide, sans borne de date.
  open_inv as (
    select i.balance_cents, i.due_date
    from public.invoices i
    where i.org_id = v_org
      and i.deleted_at is null
      and i.status in ('sent', 'partial')
      and i.balance_cents > 0
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
    (select count(*) from base b where b.status = 'draft')::bigint as count_draft,
    (select count(*) from base b where b.status in ('sent', 'partial'))::bigint as count_sent,
    (select count(*) from base b where b.status = 'paid')::bigint as count_paid,
    (select count(*) from open_inv o where o.due_date < current_date)::bigint as count_past_due,
    coalesce((select sum(o.balance_cents) from open_inv o), 0)::bigint as total_outstanding_cents,
    (select p.avg_payment_time_days from paid_stats p) as avg_payment_time_days;
end;
$$;
