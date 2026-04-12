-- Fix all analytics RPCs: skip membership check when auth.uid() is NULL (service_role / management API)
-- The pattern: IF auth.uid() IS NOT NULL AND NOT has_org_membership(...) THEN RAISE

-- 1. revenue_forecast
CREATE OR REPLACE FUNCTION public.rpc_insights_revenue_forecast(p_org uuid default null)
RETURNS TABLE (month_start date, projected_cents bigint, source text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_avg bigint; v_pipeline bigint; v_rate numeric;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;

  SELECT coalesce(sum(i.total_cents)/greatest(count(distinct date_trunc('month',coalesce(i.paid_at,i.issued_at))),1),0)::bigint INTO v_avg
  FROM invoices i WHERE i.org_id=v_org AND i.deleted_at IS NULL AND i.status='paid' AND i.paid_at>=(current_date-interval '6 months');

  SELECT coalesce(sum(q.total_cents),0)::bigint INTO v_pipeline
  FROM quotes q WHERE q.org_id=v_org AND q.deleted_at IS NULL AND q.status IN ('draft','sent','action_required');

  SELECT CASE WHEN count(*)>0 THEN (count(*) FILTER (WHERE q.status='approved'))::numeric/count(*) ELSE 0.3 END INTO v_rate
  FROM quotes q WHERE q.org_id=v_org AND q.deleted_at IS NULL AND q.created_at>=(current_date-interval '6 months');

  RETURN QUERY
  SELECT (date_trunc('month',current_date)+(n||' months')::interval)::date, (v_avg*0.7+(v_pipeline*v_rate*(1.0/(n+1)))*0.3)::bigint, 'blended'::text
  FROM generate_series(1,3) AS n;
END;
$$;

-- 2. team_performance
CREATE OR REPLACE FUNCTION public.rpc_insights_team_performance(p_org uuid default null, p_from date default null, p_to date default null)
RETURNS TABLE (team_id uuid, team_name text, jobs_count bigint, jobs_completed bigint, completion_rate numeric, revenue_cents bigint, avg_job_value_cents bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_from_ts timestamptz; v_to_ex timestamptz;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  v_from_ts := coalesce(p_from, date_trunc('month',current_date)::date)::timestamptz;
  v_to_ex := (coalesce(p_to,current_date)+1)::timestamptz;

  RETURN QUERY
  SELECT tm.id, tm.name,
    count(j.id)::bigint,
    count(j.id) FILTER (WHERE j.status IN ('completed','invoiced'))::bigint,
    CASE WHEN count(j.id)>0 THEN round((count(j.id) FILTER (WHERE j.status IN ('completed','invoiced')))::numeric/count(j.id)*100,1) ELSE 0 END,
    coalesce(sum(j.total_cents) FILTER (WHERE j.status IN ('completed','invoiced')),0)::bigint,
    CASE WHEN count(j.id) FILTER (WHERE j.status IN ('completed','invoiced'))>0 THEN (sum(j.total_cents) FILTER (WHERE j.status IN ('completed','invoiced'))/count(j.id) FILTER (WHERE j.status IN ('completed','invoiced')))::bigint ELSE 0 END
  FROM teams tm
  LEFT JOIN jobs j ON j.team_id=tm.id AND j.org_id=v_org AND j.deleted_at IS NULL AND j.created_at>=v_from_ts AND j.created_at<v_to_ex
  WHERE tm.org_id=v_org AND tm.deleted_at IS NULL AND tm.is_active=true
  GROUP BY tm.id, tm.name ORDER BY revenue_cents DESC;
END;
$$;

-- 3. pipeline_velocity
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
    SELECT d.id, d.status, d.value_cents, d.created_at, d.updated_at,
      CASE WHEN d.status IN ('won','closed_won') THEN extract(epoch FROM (d.updated_at-d.created_at))/86400.0 ELSE NULL END AS days_to_close
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

-- 4. client_lifetime_value
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
    FROM clients c LEFT JOIN jobs j ON j.client_id=c.id AND j.org_id=c.org_id AND j.deleted_at IS NULL
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

-- 5. job_profitability
CREATE OR REPLACE FUNCTION public.rpc_insights_job_profitability(p_org uuid default null, p_from date default null, p_to date default null)
RETURNS TABLE (total_jobs bigint, total_revenue_cents bigint, total_cost_cents bigint, gross_margin_cents bigint, margin_pct numeric, avg_revenue_per_job_cents bigint, avg_cost_per_job_cents bigint, profitable_jobs bigint, unprofitable_jobs bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_from_ts timestamptz; v_to_ex timestamptz; v_has_cost boolean;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  v_from_ts := coalesce(p_from, date_trunc('month',current_date)::date)::timestamptz;
  v_to_ex := (coalesce(p_to,current_date)+1)::timestamptz;
  v_has_cost := exists (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='jobs' AND column_name='cost_cents');

  IF v_has_cost THEN
    RETURN QUERY
    WITH jd AS (SELECT j.id, coalesce(j.total_cents,0) AS rev, coalesce(j.cost_cents,0) AS cost FROM jobs j WHERE j.org_id=v_org AND j.deleted_at IS NULL AND j.status IN ('completed','invoiced') AND j.created_at>=v_from_ts AND j.created_at<v_to_ex)
    SELECT count(*)::bigint, coalesce(sum(rev),0)::bigint, coalesce(sum(cost),0)::bigint, (coalesce(sum(rev),0)-coalesce(sum(cost),0))::bigint,
      CASE WHEN sum(rev)>0 THEN round(((sum(rev)-sum(cost))::numeric/sum(rev))*100,1) ELSE 0 END,
      CASE WHEN count(*)>0 THEN (sum(rev)/count(*))::bigint ELSE 0 END,
      CASE WHEN count(*)>0 THEN (sum(cost)/count(*))::bigint ELSE 0 END,
      count(*) FILTER (WHERE rev>cost)::bigint, count(*) FILTER (WHERE rev<=cost AND cost>0)::bigint FROM jd;
  ELSE
    RETURN QUERY SELECT count(*)::bigint, coalesce(sum(j.total_cents),0)::bigint, 0::bigint, coalesce(sum(j.total_cents),0)::bigint, 100::numeric,
      CASE WHEN count(*)>0 THEN (sum(j.total_cents)/count(*))::bigint ELSE 0 END, 0::bigint, count(*)::bigint, 0::bigint
    FROM jobs j WHERE j.org_id=v_org AND j.deleted_at IS NULL AND j.status IN ('completed','invoiced') AND j.created_at>=v_from_ts AND j.created_at<v_to_ex;
  END IF;
END;
$$;

-- 6. churn_risk
CREATE OR REPLACE FUNCTION public.rpc_insights_churn_risk(p_org uuid default null, p_limit int default 20)
RETURNS TABLE (client_id uuid, client_name text, email text, total_jobs bigint, total_revenue_cents bigint, last_activity_at timestamptz, days_inactive int, overdue_invoices bigint, overdue_amount_cents bigint, churn_risk_score numeric, risk_level text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;

  RETURN QUERY
  WITH ca AS (
    SELECT c.id AS cid, concat(c.first_name,' ',c.last_name) AS cname, c.email, count(j.id) AS jc, coalesce(sum(j.total_cents),0) AS rev, max(coalesce(j.updated_at,j.created_at)) AS last_act
    FROM clients c LEFT JOIN jobs j ON j.client_id=c.id AND j.org_id=c.org_id AND j.deleted_at IS NULL
    WHERE c.org_id=v_org AND c.deleted_at IS NULL GROUP BY c.id, c.first_name, c.last_name, c.email HAVING count(j.id)>0
  ),
  od AS (
    SELECT i.client_id AS cid, count(*) AS oc, coalesce(sum(i.balance_cents),0) AS oa
    FROM invoices i WHERE i.org_id=v_org AND i.deleted_at IS NULL AND i.status IN ('sent','partial') AND i.balance_cents>0 AND i.due_date<current_date GROUP BY i.client_id
  ),
  scored AS (
    SELECT ca.*, coalesce(od.oc,0) AS overdue_c, coalesce(od.oa,0) AS overdue_a,
      least(100,
        CASE WHEN extract(day FROM (now()-coalesce(ca.last_act,now())))>=180 THEN 50 WHEN extract(day FROM (now()-coalesce(ca.last_act,now())))>=90 THEN 40 WHEN extract(day FROM (now()-coalesce(ca.last_act,now())))>=60 THEN 25 WHEN extract(day FROM (now()-coalesce(ca.last_act,now())))>=30 THEN 10 ELSE 0 END
        + least(coalesce(od.oc,0)::numeric*10,30)
        + CASE WHEN ca.jc<=1 THEN 15 WHEN ca.jc<=2 THEN 8 ELSE 0 END
      ) AS score
    FROM ca LEFT JOIN od ON od.cid=ca.cid
  )
  SELECT s.cid, s.cname, s.email, s.jc::bigint, s.rev::bigint, s.last_act,
    extract(day FROM (now()-coalesce(s.last_act,now())))::int,
    s.overdue_c::bigint, s.overdue_a::bigint, round(s.score,1),
    CASE WHEN s.score>=60 THEN 'high' WHEN s.score>=30 THEN 'medium' ELSE 'low' END::text
  FROM scored s ORDER BY s.score DESC LIMIT p_limit;
END;
$$;

-- 7. cohort_retention
CREATE OR REPLACE FUNCTION public.rpc_insights_cohort_retention(p_org uuid default null)
RETURNS TABLE (cohort_month text, months_after int, cohort_size bigint, active_count bigint, retention_pct numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;

  RETURN QUERY
  WITH cfj AS (
    SELECT c.id AS client_id, date_trunc('month',min(j.created_at))::date AS acq
    FROM clients c JOIN jobs j ON j.client_id=c.id AND j.org_id=c.org_id AND j.deleted_at IS NULL
    WHERE c.org_id=v_org AND c.deleted_at IS NULL GROUP BY c.id HAVING min(j.created_at)>=(current_date-interval '12 months')
  ),
  coh AS (SELECT acq, count(*)::bigint AS sz FROM cfj GROUP BY acq),
  act AS (
    SELECT cfj.client_id, cfj.acq, date_trunc('month',j.created_at)::date AS am
    FROM cfj JOIN jobs j ON j.client_id=cfj.client_id AND j.org_id=v_org AND j.deleted_at IS NULL
  ),
  ret AS (
    SELECT a.acq, (extract(year FROM a.am)*12+extract(month FROM a.am)-extract(year FROM a.acq)*12-extract(month FROM a.acq))::int AS ma, count(distinct a.client_id)::bigint AS ac
    FROM act a GROUP BY a.acq, 2
  )
  SELECT to_char(c.acq,'YYYY-MM'), r.ma, c.sz, r.ac, round((r.ac::numeric/c.sz)*100,1)
  FROM coh c JOIN ret r ON r.acq=c.acq WHERE r.ma BETWEEN 0 AND 11 ORDER BY c.acq, r.ma;
END;
$$;

-- 8. budget_vs_actual
CREATE OR REPLACE FUNCTION public.rpc_insights_budget_vs_actual(p_org uuid default null, p_from date default null, p_to date default null)
RETURNS TABLE (month_label text, metric text, target_value bigint, actual_value bigint, variance_pct numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_from date; v_to date;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  v_from := coalesce(p_from, date_trunc('year',current_date)::date);
  v_to := coalesce(p_to, current_date);

  RETURN QUERY
  WITH months AS (SELECT generate_series(date_trunc('month',v_from)::date, date_trunc('month',v_to)::date, '1 month'::interval)::date AS m),
  tg AS (SELECT month, metric AS tm, target_value FROM budget_targets WHERE org_id=v_org AND month>=v_from AND month<=v_to),
  ra AS (SELECT date_trunc('month',coalesce(i.paid_at,i.issued_at))::date AS m, coalesce(sum(i.total_cents),0)::bigint AS v FROM invoices i WHERE i.org_id=v_org AND i.deleted_at IS NULL AND i.status='paid' AND coalesce(i.paid_at,i.issued_at)>=v_from::timestamptz AND coalesce(i.paid_at,i.issued_at)<(v_to+1)::timestamptz GROUP BY 1),
  ja AS (SELECT date_trunc('month',j.created_at)::date AS m, count(*)::bigint AS v FROM jobs j WHERE j.org_id=v_org AND j.deleted_at IS NULL AND j.created_at>=v_from::timestamptz AND j.created_at<(v_to+1)::timestamptz GROUP BY 1),
  la AS (SELECT date_trunc('month',l.created_at)::date AS m, count(*)::bigint AS v FROM leads l WHERE l.org_id=v_org AND l.deleted_at IS NULL AND l.created_at>=v_from::timestamptz AND l.created_at<(v_to+1)::timestamptz GROUP BY 1)
  SELECT to_char(mo.m,'Mon YY'), 'revenue'::text, coalesce(t.target_value,0), coalesce(r.v,0), CASE WHEN coalesce(t.target_value,0)>0 THEN round(((coalesce(r.v,0)-t.target_value)::numeric/t.target_value)*100,1) ELSE NULL END
  FROM months mo LEFT JOIN tg t ON t.month=mo.m AND t.tm='revenue' LEFT JOIN ra r ON r.m=mo.m WHERE coalesce(t.target_value,0)>0 OR coalesce(r.v,0)>0
  UNION ALL
  SELECT to_char(mo.m,'Mon YY'), 'jobs', coalesce(t.target_value,0), coalesce(j.v,0), CASE WHEN coalesce(t.target_value,0)>0 THEN round(((coalesce(j.v,0)-t.target_value)::numeric/t.target_value)*100,1) ELSE NULL END
  FROM months mo LEFT JOIN tg t ON t.month=mo.m AND t.tm='jobs' LEFT JOIN ja j ON j.m=mo.m WHERE coalesce(t.target_value,0)>0 OR coalesce(j.v,0)>0
  UNION ALL
  SELECT to_char(mo.m,'Mon YY'), 'leads', coalesce(t.target_value,0), coalesce(l.v,0), CASE WHEN coalesce(t.target_value,0)>0 THEN round(((coalesce(l.v,0)-t.target_value)::numeric/t.target_value)*100,1) ELSE NULL END
  FROM months mo LEFT JOIN tg t ON t.month=mo.m AND t.tm='leads' LEFT JOIN la l ON l.m=mo.m WHERE coalesce(t.target_value,0)>0 OR coalesce(l.v,0)>0
  ORDER BY 1, 2;
END;
$$;
