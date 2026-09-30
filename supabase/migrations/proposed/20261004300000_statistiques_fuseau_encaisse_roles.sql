-- ============================================================================
-- PROPOSÉE — NE PAS APPLIQUER SANS L'ACCORD DE RAFBA (audit Statistiques, STATS_AUDIT.md §7)
-- Validée sur la stack locale (scripts/qa/stats-stack.sh) : tests/stats/*.integration.test.ts
--
-- Corrige, dans les RPC de /insights, de Lumi, des rapports programmés, de Réglages → Rapports
-- et de l'aperçu multi-bureaux (mêmes fonctions partout) :
--  B1  Fuseau : les bornes et les mois étaient calculés en UTC. Un paiement du 31 à 23 h 30
--      (Toronto) tombait le mois suivant. → bornes et regroupements dans company_settings.timezone.
--  B2  Encaissé : un remboursement PARTIEL (statut 'succeeded', refunded_cents > 0) restait
--      compté en entier. → montant − remboursé, pour 'succeeded' et 'refunded'.
--  B3  Encaissé : les factures payées SANS ligne de paiement (import Jobber : 618 factures,
--      279 261,15 $ en prod) valaient 0 $. → leur paid_cents compte, à paid_at.
--  B4  rpc_insights_overview (rapports programmés) sommait TOUS les paiements, échoués et en
--      attente compris. → même définition que la courbe.
--  B5  Pipeline : les deals « source = 'job' » (copies du classement, gagnées d'office) gonflaient
--      le taux de réussite (100 % en prod : 7/7 gagnés sont des copies). → exclus ;
--      délai = won_at − created_at (updated_at bougeait à chaque modification).
--  B6  Rôles : toute personne membre (technicien, vendeur) lisait le revenu, les factures, les
--      meilleurs clients (courriels compris) par appel direct. → permission de la page Rôles
--      (financial.view_analytics ou reports.read ; factures : financial.view_invoices ou invoices.read).
--  B7  Défense en profondeur : « auth.uid() IS NOT NULL AND … » laissait passer un appelant sans
--      identité ; seul le GRANT protégeait (un environnement neuf, avant db:sync-acl, fuyait).
--      → seul le service_role passe sans utilisateur (rapports programmés).
--  B8  rpc_insights_invoices_summary / revenue_series / period_comparison refusaient le
--      service_role : le « Solde impayé » des rapports programmés valait toujours 0 $.
--  B9  « Aujourd'hui » (retards, défauts) était la date UTC. → date locale du tenant.
--  B10 Dernière activité (score client, risque de départ) lisait jobs.updated_at : n'importe quelle
--      modification rendait un client « actif ». → date du job (complété, sinon créé).
--
-- Signatures et types de retour INCHANGÉS (create or replace).
-- ============================================================================

-- ── Aides ───────────────────────────────────────────────────────────────────
create or replace function public.stats_fuseau(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(cs.timezone, '') from public.company_settings cs where cs.org_id = p_org), 'America/Toronto');
$$;

create or replace function public.stats_lecture_permise(p_org uuid, p_cles text[])
returns boolean language plpgsql stable security definer set search_path = public as $$
declare k text;
begin
  if coalesce(auth.role(), '') = 'service_role' then return true; end if;   -- rapports programmés, serveur
  if auth.uid() is null or p_org is null then return false; end if;
  foreach k in array p_cles loop
    if public.member_has_permission(auth.uid(), p_org, k) then return true; end if;
  end loop;
  return false;
end $$;

-- Encaissé d'une entreprise entre deux instants, par instant local (brut, pour regroupement).
create or replace function public.stats_encaissements(p_org uuid, p_debut timestamptz, p_fin timestamptz)
returns table(quand timestamptz, cents bigint, methode text) language sql stable security definer set search_path = public as $$
  select p.payment_date, (p.amount_cents - coalesce(p.refunded_cents, 0))::bigint, p.method
    from public.payments p
   where p.org_id = p_org and p.deleted_at is null and p.status in ('succeeded', 'refunded')
     and p.payment_date >= p_debut and p.payment_date < p_fin
  union all
  select coalesce(i.paid_at, i.issued_at), i.paid_cents::bigint, null
    from public.invoices i
   where i.org_id = p_org and i.deleted_at is null and i.status in ('paid', 'partial') and i.paid_cents > 0
     and not exists (select 1 from public.payments p where p.invoice_id = i.id and p.deleted_at is null)
     and coalesce(i.paid_at, i.issued_at) >= p_debut and coalesce(i.paid_at, i.issued_at) < p_fin;
$$;

revoke all on function public.stats_fuseau(uuid) from public, anon;
revoke all on function public.stats_lecture_permise(uuid, text[]) from public, anon;
revoke all on function public.stats_encaissements(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.stats_fuseau(uuid) to authenticated, service_role;
grant execute on function public.stats_lecture_permise(uuid, text[]) to authenticated, service_role;
grant execute on function public.stats_encaissements(uuid, timestamptz, timestamptz) to service_role;

-- ── Série de revenus (carte Revenu, Lumi get_revenue_summary / get_financial_overview, rapports) ──
create or replace function public.rpc_insights_revenue_series(p_org uuid default null, p_from date default null, p_to date default null, p_granularity text default 'month')
returns table(bucket_start date, revenue_cents bigint, invoiced_cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, public.current_org_id());
  v_tz text; v_today date; v_from date; v_to date; v_debut timestamptz; v_fin timestamptz; v_g text; v_step interval;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed for this organization' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_from := least(coalesce(p_from, date_trunc('month', v_today)::date), coalesce(p_to, v_today));
  v_to := greatest(coalesce(p_from, date_trunc('month', v_today)::date), coalesce(p_to, v_today));
  v_debut := v_from::timestamp at time zone v_tz;
  v_fin := (v_to + 1)::timestamp at time zone v_tz;
  v_g := lower(coalesce(p_granularity, 'month'));
  if v_g not in ('day', 'week', 'month') then v_g := 'month'; end if;
  v_step := case v_g when 'day' then interval '1 day' when 'week' then interval '1 week' else interval '1 month' end;

  return query
  with buckets as (
    select generate_series(date_trunc(v_g, v_from::timestamp), date_trunc(v_g, v_to::timestamp), v_step)::date as b
  ),
  rev as (
    select date_trunc(v_g, e.quand at time zone v_tz)::date as b, sum(e.cents)::bigint as c
      from public.stats_encaissements(v_org, v_debut, v_fin) e group by 1
  ),
  inv as (
    select date_trunc(v_g, coalesce(i.issued_at, i.created_at) at time zone v_tz)::date as b, sum(i.total_cents)::bigint as c
      from public.invoices i
     where i.org_id = v_org and i.deleted_at is null and i.status in ('sent', 'partial', 'paid')
       and coalesce(i.issued_at, i.created_at) >= v_debut and coalesce(i.issued_at, i.created_at) < v_fin
     group by 1
  )
  select bk.b, coalesce(r.c, 0)::bigint, coalesce(i.c, 0)::bigint
    from buckets bk left join rev r on r.b = bk.b left join inv i on i.b = bk.b
   order by bk.b;
end;
$function$;

-- ── Aperçu (rapports programmés, aperçu multi-bureaux) ─────────────────────
create or replace function public.rpc_insights_overview(p_org uuid default null, p_from date default null, p_to date default null)
returns table(new_leads_count bigint, converted_quotes_count bigint, new_oneoff_jobs_count bigint, invoiced_value_cents bigint, revenue_cents bigint, requests_count bigint)
language plpgsql security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, public.current_org_id());
  v_tz text; v_today date; v_from date; v_to date; v_debut timestamptz; v_fin timestamptz;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed for this organization' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_from := least(coalesce(p_from, date_trunc('month', v_today)::date), coalesce(p_to, v_today));
  v_to := greatest(coalesce(p_from, date_trunc('month', v_today)::date), coalesce(p_to, v_today));
  v_debut := v_from::timestamp at time zone v_tz;
  v_fin := (v_to + 1)::timestamp at time zone v_tz;

  return query select
    (select count(*) from public.clients l where l.org_id = v_org and l.status = 'lead' and l.deleted_at is null
        and l.created_at >= v_debut and l.created_at < v_fin)::bigint,
    (select count(*) from public.jobs j where j.org_id = v_org and j.deleted_at is null and j.lead_id is not null
        and j.created_at >= v_debut and j.created_at < v_fin)::bigint,
    (select count(*) from public.jobs j where j.org_id = v_org and j.deleted_at is null
        and j.created_at >= v_debut and j.created_at < v_fin
        and coalesce(nullif(lower(trim(j.job_type)), ''), 'one_off') = 'one_off')::bigint,
    (select coalesce(sum(i.total_cents), 0) from public.invoices i where i.org_id = v_org and i.deleted_at is null
        and i.status in ('sent', 'partial', 'paid')
        and coalesce(i.issued_at, i.created_at) >= v_debut and coalesce(i.issued_at, i.created_at) < v_fin)::bigint,
    (select coalesce(sum(e.cents), 0) from public.stats_encaissements(v_org, v_debut, v_fin) e)::bigint,
    null::bigint;
end;
$function$;

-- ── Trésorerie ──────────────────────────────────────────────────────────────
create or replace function public.rpc_insights_invoices_summary(p_org uuid default null, p_from date default null, p_to date default null)
returns table(count_draft bigint, count_sent bigint, count_paid bigint, count_past_due bigint, total_outstanding_cents bigint, avg_payment_time_days numeric)
language plpgsql security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, public.current_org_id());
  v_tz text; v_today date; v_from date; v_to date; v_debut timestamptz; v_fin timestamptz;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read', 'financial.view_invoices', 'invoices.read']) then
    raise exception 'Not allowed for this organization' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_from := least(coalesce(p_from, date_trunc('month', v_today)::date), coalesce(p_to, v_today));
  v_to := greatest(coalesce(p_from, date_trunc('month', v_today)::date), coalesce(p_to, v_today));
  v_debut := v_from::timestamp at time zone v_tz;
  v_fin := (v_to + 1)::timestamp at time zone v_tz;

  return query
  with base as (
    select i.status from public.invoices i
     where i.org_id = v_org and i.deleted_at is null
       and coalesce(i.issued_at, i.created_at) >= v_debut and coalesce(i.issued_at, i.created_at) < v_fin
  ),
  -- L'encours n'est pas une métrique de période : toute l'entreprise, sans borne de date.
  open_inv as (
    select i.balance_cents, i.due_date from public.invoices i
     where i.org_id = v_org and i.deleted_at is null and i.status in ('sent', 'partial') and i.balance_cents > 0
  )
  select
    (select count(*) from base b where b.status = 'draft')::bigint,
    (select count(*) from base b where b.status in ('sent', 'partial'))::bigint,
    (select count(*) from base b where b.status = 'paid')::bigint,
    (select count(*) from open_inv o where o.due_date < v_today)::bigint,
    coalesce((select sum(o.balance_cents) from open_inv o), 0)::bigint,
    (select avg(extract(epoch from (i.paid_at - i.issued_at)) / 86400.0) from public.invoices i
      where i.org_id = v_org and i.deleted_at is null and i.paid_at is not null and i.issued_at is not null
        and i.paid_at >= v_debut and i.paid_at < v_fin and i.paid_at >= i.issued_at);
end;
$function$;

-- ── Comparaison de périodes (Lumi compare_revenue, rapport financier) ───────
create or replace function public.rpc_insights_period_comparison(p_org uuid default null, p_from date default null, p_to date default null)
returns table(metric text, current_value bigint, previous_value bigint, change_pct numeric)
language plpgsql security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, current_org_id());
  v_tz text; v_today date; v_from date; v_to date; v_days int;
  c0 timestamptz; c1 timestamptz; p0 timestamptz; p1 timestamptz;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_from := coalesce(p_from, date_trunc('month', v_today)::date);
  v_to := coalesce(p_to, v_today);
  v_days := greatest(v_to - v_from + 1, 1);
  c0 := v_from::timestamp at time zone v_tz;            c1 := (v_to + 1)::timestamp at time zone v_tz;
  p0 := (v_from - v_days)::timestamp at time zone v_tz; p1 := c0;

  return query
  with m as (
    select k, cur, prev from (values
      ('new_leads',
        (select count(*) from clients where org_id = v_org and status = 'lead' and deleted_at is null and created_at >= c0 and created_at < c1),
        (select count(*) from clients where org_id = v_org and status = 'lead' and deleted_at is null and created_at >= p0 and created_at < p1)),
      ('new_jobs',
        (select count(*) from jobs where org_id = v_org and deleted_at is null and created_at >= c0 and created_at < c1),
        (select count(*) from jobs where org_id = v_org and deleted_at is null and created_at >= p0 and created_at < p1)),
      ('invoiced_value',
        (select coalesce(sum(total_cents), 0) from invoices where org_id = v_org and deleted_at is null and status in ('sent','partial','paid') and coalesce(issued_at, created_at) >= c0 and coalesce(issued_at, created_at) < c1),
        (select coalesce(sum(total_cents), 0) from invoices where org_id = v_org and deleted_at is null and status in ('sent','partial','paid') and coalesce(issued_at, created_at) >= p0 and coalesce(issued_at, created_at) < p1)),
      ('conversions',
        (select count(*) from jobs where org_id = v_org and deleted_at is null and lead_id is not null and created_at >= c0 and created_at < c1),
        (select count(*) from jobs where org_id = v_org and deleted_at is null and lead_id is not null and created_at >= p0 and created_at < p1)),
      ('paid_invoices',
        (select count(*) from invoices where org_id = v_org and deleted_at is null and status = 'paid' and paid_at >= c0 and paid_at < c1),
        (select count(*) from invoices where org_id = v_org and deleted_at is null and status = 'paid' and paid_at >= p0 and paid_at < p1))
    ) as t(k, cur, prev)
  )
  select m.k, m.cur::bigint, m.prev::bigint,
         case when m.prev > 0 then round(((m.cur - m.prev)::numeric / m.prev) * 100, 1) else null end
    from m;
end;
$function$;

-- ── Équipes ─────────────────────────────────────────────────────────────────
create or replace function public.rpc_insights_team_performance(p_org uuid default null, p_from date default null, p_to date default null)
returns table(team_id uuid, team_name text, jobs_count bigint, jobs_completed bigint, completion_rate numeric, revenue_cents bigint, avg_job_value_cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, current_org_id());
  v_tz text; v_today date; v_debut timestamptz; v_fin timestamptz;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_debut := coalesce(p_from, date_trunc('month', v_today)::date)::timestamp at time zone v_tz;
  v_fin := (coalesce(p_to, v_today) + 1)::timestamp at time zone v_tz;

  return query
  select tm.id, tm.name,
    count(j.id)::bigint,
    count(j.id) filter (where j.status = 'completed')::bigint,
    case when count(j.id) > 0 then round((count(j.id) filter (where j.status = 'completed'))::numeric / count(j.id) * 100, 1) else 0 end,
    coalesce(sum(j.total_cents) filter (where j.status = 'completed'), 0)::bigint,
    case when count(j.id) filter (where j.status = 'completed') > 0
         then (sum(j.total_cents) filter (where j.status = 'completed') / count(j.id) filter (where j.status = 'completed'))::bigint else 0 end
  from teams tm
  left join jobs j on j.team_id = tm.id and j.org_id = v_org and j.deleted_at is null and j.created_at >= v_debut and j.created_at < v_fin
  where tm.org_id = v_org and tm.deleted_at is null and tm.is_active = true
  group by tm.id, tm.name order by 6 desc;
end;
$function$;

-- ── Valeur client (top clients, fidélité, Lumi get_top_clients, rapports) ───
create or replace function public.rpc_insights_client_lifetime_value(p_org uuid default null, p_limit integer default 20)
returns table(client_id uuid, client_name text, first_job_at timestamptz, tenure_days integer, total_jobs bigint, total_revenue_cents bigint, avg_job_value_cents bigint, last_activity_at timestamptz, days_since_last_activity integer, clv_score numeric)
language plpgsql security definer set search_path = public as $function$
declare v_org uuid := coalesce(p_org, current_org_id());
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  with cs as (
    select c.id as cid, concat(c.first_name, ' ', c.last_name) as cname, min(j.created_at) as first_job,
           max(coalesce(j.completed_at, j.created_at)) as last_act, count(j.id) as jc, coalesce(sum(j.total_cents), 0) as rev
      from clients c
      left join jobs j on j.client_id = c.id and j.org_id = c.org_id and j.deleted_at is null and j.status not in ('draft', 'cancelled')
     where c.org_id = v_org and c.deleted_at is null group by c.id, c.first_name, c.last_name
  ),
  ir as (select i.client_id as cid, coalesce(sum(i.total_cents), 0) as inv from invoices i
          where i.org_id = v_org and i.deleted_at is null and i.status = 'paid' group by i.client_id)
  select cs.cid, cs.cname, cs.first_job,
    extract(day from (now() - coalesce(cs.first_job, now())))::int,
    cs.jc::bigint, greatest(cs.rev, coalesce(ir.inv, 0))::bigint,
    case when cs.jc > 0 then (greatest(cs.rev, coalesce(ir.inv, 0)) / cs.jc)::bigint else 0 end,
    cs.last_act,
    extract(day from (now() - coalesce(cs.last_act, cs.first_job, now())))::int,
    round((least(greatest(cs.rev, coalesce(ir.inv, 0))::numeric / 100000, 40) * 0.5) + (least(cs.jc::numeric, 20) * 0.3)
          + (greatest(0, 40 - extract(day from (now() - coalesce(cs.last_act, now())))::numeric / 3) * 0.2), 1)
  from cs left join ir on ir.cid = cs.cid where cs.jc > 0 order by 10 desc, 6 desc, 1 limit p_limit;
end;
$function$;

-- ── Risque de départ (rapports) ─────────────────────────────────────────────
create or replace function public.rpc_insights_churn_risk(p_org uuid default null, p_limit integer default 20)
returns table(client_id uuid, client_name text, email text, total_jobs bigint, total_revenue_cents bigint, last_activity_at timestamptz, days_inactive integer, overdue_invoices bigint, overdue_amount_cents bigint, churn_risk_score numeric, risk_level text)
language plpgsql stable security definer set search_path = public as $function$
declare v_org uuid := coalesce(p_org, current_org_id()); v_today date;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_today := (now() at time zone public.stats_fuseau(v_org))::date;
  return query
  with ca as (
    select c.id as cid, concat(c.first_name, ' ', c.last_name) as cname, c.email, count(j.id) as jc, coalesce(sum(j.total_cents), 0) as rev,
           max(coalesce(j.completed_at, j.created_at)) as last_act
      from clients c left join jobs j on j.client_id = c.id and j.org_id = c.org_id and j.deleted_at is null
     where c.org_id = v_org and c.deleted_at is null group by c.id, c.first_name, c.last_name, c.email having count(j.id) > 0
  ),
  od as (
    select i.client_id as cid, count(*) as oc, coalesce(sum(i.balance_cents), 0) as oa from invoices i
     where i.org_id = v_org and i.deleted_at is null and i.status in ('sent', 'partial') and i.balance_cents > 0 and i.due_date < v_today
     group by i.client_id
  ),
  scored as (
    select ca.*, coalesce(od.oc, 0) as overdue_c, coalesce(od.oa, 0) as overdue_a,
      least(100,
        case when extract(day from (now() - coalesce(ca.last_act, now()))) >= 180 then 50
             when extract(day from (now() - coalesce(ca.last_act, now()))) >= 90 then 40
             when extract(day from (now() - coalesce(ca.last_act, now()))) >= 60 then 25
             when extract(day from (now() - coalesce(ca.last_act, now()))) >= 30 then 10 else 0 end
        + least(coalesce(od.oc, 0)::numeric * 10, 30)
        + case when ca.jc <= 1 then 15 when ca.jc <= 2 then 8 else 0 end) as score
    from ca left join od on od.cid = ca.cid
  )
  select s.cid, s.cname, s.email, s.jc::bigint, s.rev::bigint, s.last_act,
    extract(day from (now() - coalesce(s.last_act, now())))::int,
    s.overdue_c::bigint, s.overdue_a::bigint, round(s.score, 1),
    case when s.score >= 60 then 'high' when s.score >= 30 then 'medium' else 'low' end::text
  from scored s order by s.score desc, s.rev desc, s.cid limit p_limit;
end;
$function$;

-- ── Rétention par cohorte (fidélité) ────────────────────────────────────────
create or replace function public.rpc_insights_cohort_retention(p_org uuid default null)
returns table(cohort_month text, months_after integer, cohort_size bigint, active_count bigint, retention_pct numeric)
language plpgsql stable security definer set search_path = public as $function$
declare v_org uuid := coalesce(p_org, current_org_id()); v_tz text;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(v_org);
  return query
  with cfj as (
    select c.id as client_id, date_trunc('month', min(j.created_at) at time zone v_tz)::date as acq
      from clients c join jobs j on j.client_id = c.id and j.org_id = c.org_id and j.deleted_at is null
     where c.org_id = v_org and c.deleted_at is null group by c.id
    having min(j.created_at) >= ((now() at time zone v_tz)::date - interval '12 months')::timestamp at time zone v_tz
  ),
  coh as (select acq, count(*)::bigint as sz from cfj group by acq),
  act as (
    select cfj.client_id, cfj.acq, date_trunc('month', j.created_at at time zone v_tz)::date as am
      from cfj join jobs j on j.client_id = cfj.client_id and j.org_id = v_org and j.deleted_at is null
  ),
  ret as (
    select a.acq, (extract(year from a.am) * 12 + extract(month from a.am) - extract(year from a.acq) * 12 - extract(month from a.acq))::int as ma,
           count(distinct a.client_id)::bigint as ac
      from act a group by a.acq, 2
  )
  select to_char(c.acq, 'YYYY-MM'), r.ma, c.sz, r.ac, round((r.ac::numeric / c.sz) * 100, 1)
    from coh c join ret r on r.acq = c.acq where r.ma between 0 and 11 order by c.acq, r.ma;
end;
$function$;

-- ── Conversion des leads ────────────────────────────────────────────────────
create or replace function public.rpc_insights_lead_conversion(p_org uuid default null, p_from date default null, p_to date default null)
returns table(leads_created bigint, leads_closed bigint, conversion_rate numeric, breakdown jsonb)
language plpgsql security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, public.current_org_id());
  v_tz text; v_today date; v_from date; v_to date; v_debut timestamptz; v_fin timestamptz;
  v_created bigint := 0; v_closed bigint := 0; v_breakdown jsonb;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed for this organization' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_from := least(coalesce(p_from, date_trunc('month', v_today)::date), coalesce(p_to, v_today));
  v_to := greatest(coalesce(p_from, date_trunc('month', v_today)::date), coalesce(p_to, v_today));
  v_debut := v_from::timestamp at time zone v_tz;
  v_fin := (v_to + 1)::timestamp at time zone v_tz;

  -- Un client « a été un lead » s'il l'est encore, s'il porte un lead_status, ou si un job le référence.
  with leads as (
    select l.id, coalesce(nullif(trim(l.source), ''), 'Unknown') as src from public.clients l
     where l.org_id = v_org and l.deleted_at is null and l.created_at >= v_debut and l.created_at < v_fin
       and (l.status = 'lead' or l.lead_status is not null
            or exists (select 1 from public.jobs j2 where j2.org_id = l.org_id and j2.lead_id = l.id and j2.deleted_at is null))
  ),
  convertis as (
    select distinct j.lead_id from public.jobs j
     where j.org_id = v_org and j.deleted_at is null and j.lead_id is not null and j.created_at >= v_debut and j.created_at < v_fin
  ),
  par_source as (
    select src, count(*)::bigint as crees from leads group by src
  ),
  conv_source as (
    select coalesce(nullif(trim(l.source), ''), 'Unknown') as src, count(*)::bigint as conv
      from convertis c join public.clients l on l.id = c.lead_id and l.org_id = v_org and l.deleted_at is null group by 1
  ),
  rev_source as (
    select coalesce(nullif(trim(l.source), ''), 'Unknown') as src, sum(p.amount_cents - coalesce(p.refunded_cents, 0))::bigint as rev
      from public.payments p
      join public.jobs j on j.id = p.job_id and j.org_id = p.org_id and j.deleted_at is null and j.lead_id is not null
      join public.clients l on l.id = j.lead_id and l.org_id = j.org_id and l.deleted_at is null
     where p.org_id = v_org and p.deleted_at is null and p.status in ('succeeded', 'refunded')
       and p.payment_date >= v_debut and p.payment_date < v_fin
     group by 1
  ),
  cles as (select src from par_source union select src from conv_source union select src from rev_source)
  select (select count(*) from leads), (select count(*) from convertis),
         coalesce(jsonb_agg(jsonb_build_object('source', k.src, 'leads_created', coalesce(ps.crees, 0),
           'leads_closed', coalesce(cs.conv, 0), 'revenue_cents', coalesce(rs.rev, 0)) order by k.src), '[]'::jsonb)
    into v_created, v_closed, v_breakdown
    from cles k left join par_source ps on ps.src = k.src left join conv_source cs on cs.src = k.src left join rev_source rs on rs.src = k.src;

  return query select v_created, v_closed,
    case when v_created > 0 then least(round(v_closed::numeric / v_created, 4), 1) else 0 end, v_breakdown;
end;
$function$;

-- ── Vélocité du pipeline (taux de réussite, délai de conversion) ────────────
create or replace function public.rpc_insights_pipeline_velocity(p_org uuid default null, p_from date default null, p_to date default null)
returns table(total_deals bigint, won_deals bigint, lost_deals bigint, win_rate numeric, avg_deal_value_cents bigint, avg_days_to_close numeric)
language plpgsql security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, current_org_id());
  v_tz text; v_today date; v_debut timestamptz; v_fin timestamptz;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(v_org);
  v_today := (now() at time zone v_tz)::date;
  v_debut := coalesce(p_from, date_trunc('month', v_today)::date)::timestamp at time zone v_tz;
  v_fin := (coalesce(p_to, v_today) + 1)::timestamp at time zone v_tz;

  return query
  with deals as (
    -- Les deals « source = 'job' » sont des copies du classement (créées gagnées pour chaque job
    -- qui a un vendeur) : ce ne sont pas des opportunités du pipeline.
    select d.stage, d.value_cents,
           case when d.stage = 'closed_won' and d.won_at is not null then extract(epoch from (d.won_at - d.created_at)) / 86400.0 end as jours
      from pipeline_deals d
     where d.org_id = v_org and d.deleted_at is null and coalesce(d.source, '') <> 'job'
       and d.created_at >= v_debut and d.created_at < v_fin
  )
  select count(*)::bigint,
    count(*) filter (where stage = 'closed_won')::bigint,
    count(*) filter (where stage = 'closed_lost')::bigint,
    case when count(*) filter (where stage in ('closed_won', 'closed_lost')) > 0
      then round(count(*) filter (where stage = 'closed_won')::numeric / count(*) filter (where stage in ('closed_won', 'closed_lost')) * 100, 1) else 0 end,
    case when count(*) filter (where stage = 'closed_won') > 0
      then (coalesce(sum(value_cents) filter (where stage = 'closed_won'), 0) / count(*) filter (where stage = 'closed_won'))::bigint else 0 end,
    round(coalesce(avg(jours), 0)::numeric, 1)
  from deals;
end;
$function$;

-- ── Prévision de revenu (non affichée sur /insights ; mêmes gardes) ─────────
create or replace function public.rpc_insights_revenue_forecast(p_org uuid default null)
returns table(month_start date, projected_cents bigint, source text)
language plpgsql security definer set search_path = public as $function$
declare v_org uuid := coalesce(p_org, current_org_id()); v_avg bigint; v_pipeline bigint; v_rate numeric; v_tz text; v_today date;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(v_org);
  v_today := (now() at time zone v_tz)::date;
  select coalesce(sum(e.cents) / greatest(count(distinct date_trunc('month', e.quand at time zone v_tz)), 1), 0)::bigint into v_avg
    from public.stats_encaissements(v_org, (v_today - interval '6 months')::timestamp at time zone v_tz, (v_today + 1)::timestamp at time zone v_tz) e;
  select coalesce(sum(q.total_cents), 0)::bigint into v_pipeline from quotes q
   where q.org_id = v_org and q.deleted_at is null and q.status in ('draft', 'awaiting_response', 'changes_requested');
  select case when count(*) > 0 then (count(*) filter (where q.status in ('approved', 'converted')))::numeric / count(*) else 0.3 end into v_rate
    from quotes q where q.org_id = v_org and q.deleted_at is null and q.created_at >= (v_today - interval '6 months')::timestamp at time zone v_tz;
  return query
  select (date_trunc('month', v_today) + (n || ' months')::interval)::date, (v_avg * 0.7 + (v_pipeline * v_rate * (1.0 / (n + 1))) * 0.3)::bigint, 'blended'::text
    from generate_series(1, 3) as n;
end;
$function$;

-- ── Indicateurs de factures 30 jours (page Factures, Lumi get_financial_overview) ──
create or replace function public.rpc_invoices_kpis_30d(p_org uuid default null)
returns table(past_due_count bigint, past_due_total_cents bigint, sent_not_due_count bigint, sent_not_due_total_cents bigint, draft_count bigint, draft_total_cents bigint, issued_30d_count bigint, issued_30d_total_cents bigint, avg_invoice_30d_cents bigint, avg_payment_time_days_30d numeric)
language plpgsql stable security definer set search_path = public as $function$
declare v_org uuid := coalesce(p_org, public.current_org_id()); v_today date;
begin
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if not public.stats_lecture_permise(v_org, array['financial.view_invoices', 'invoices.read', 'financial.view_analytics']) then
    raise exception 'Not allowed for this organization' using errcode = '42501';
  end if;
  v_today := (now() at time zone public.stats_fuseau(v_org))::date;
  return query
  with base as (select * from public.invoices i where i.org_id = v_org and i.deleted_at is null),
  o as (
    select
      count(*) filter (where due_date < v_today and balance_cents > 0 and status in ('sent', 'partial')) as pdc,
      coalesce(sum(balance_cents) filter (where due_date < v_today and balance_cents > 0 and status in ('sent', 'partial')), 0)::bigint as pdt,
      count(*) filter (where due_date >= v_today and balance_cents > 0 and status in ('sent', 'partial')) as snc,
      coalesce(sum(balance_cents) filter (where due_date >= v_today and balance_cents > 0 and status in ('sent', 'partial')), 0)::bigint as snt,
      count(*) filter (where status = 'draft') as dc,
      coalesce(sum(total_cents) filter (where status = 'draft'), 0)::bigint as dt
    from base
  ),
  i as (select count(*) as ic, coalesce(sum(total_cents), 0)::bigint as it from base
         where issued_at >= (now() - interval '30 days') and status in ('sent', 'partial', 'paid')),
  p as (select avg(extract(epoch from (paid_at - issued_at)) / 86400.0) as ap from base
         where paid_at is not null and issued_at is not null and paid_at >= (now() - interval '30 days') and paid_at >= issued_at)
  select o.pdc, o.pdt, o.snc, o.snt, o.dc, o.dt, i.ic, i.it,
         case when i.ic = 0 then 0::bigint else round(i.it::numeric / i.ic)::bigint end, p.ap
    from o cross join i cross join p;
end;
$function$;

-- ── Rentabilité : même garde de rôle, service_role explicite (déjà juste sur le fuseau) ──
-- rentabilite_jobs / rpc_insights_job_profitability vérifient déjà financial.view_margins,
-- mais laissaient passer un appelant sans identité : on remplace « auth.uid() is not null and »
-- par la garde commune.
do $$
declare d text;
begin
  select pg_get_functiondef('public.rentabilite_jobs(uuid,date,date,uuid)'::regprocedure) into d;
  d := replace(d, 'if auth.uid() is not null and not public.member_has_permission(auth.uid(), p_org, ''financial.view_margins'') then',
                  'if not public.stats_lecture_permise(p_org, array[''financial.view_margins'']) then');
  execute d;
  select pg_get_functiondef('public.rpc_insights_job_profitability(uuid,date,date)'::regprocedure) into d;
  d := replace(d, 'if auth.uid() is not null and not public.member_has_permission(auth.uid(), v_org, ''financial.view_margins'') then',
                  'if not public.stats_lecture_permise(v_org, array[''financial.view_margins'']) then');
  execute d;
end $$;

-- Les droits ne changent pas (create or replace les conserve) ; on les réaffirme pour les nouvelles aides.
notify pgrst, 'reload schema';

-- ── Agrégats côté base pour les cartes calculées dans le navigateur ─────────
-- Sur le tenant volumineux de l'audit (100 000 paiements, 50 000 jobs), additionner dans le
-- navigateur coûtait > 25 s (lecture de toutes les lignes, RLS évaluée à chaque ligne).
-- Mêmes définitions que les cartes ; le code client retombe sur la lecture paginée tant
-- que ces fonctions n'existent pas (erreur PGRST202).

-- Modes de paiement : encaissé net des remboursements, par mode.
create or replace function public.rpc_insights_payment_mix(p_org uuid, p_from date, p_to date)
returns table(method text, cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text;
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  return query
  select coalesce(p.method, 'other'), sum(p.amount_cents - coalesce(p.refunded_cents, 0))::bigint
    from public.payments p
   where p.org_id = p_org and p.deleted_at is null and p.status in ('succeeded', 'refunded')
     and p.payment_date >= p_from::timestamp at time zone v_tz and p.payment_date < (p_to + 1)::timestamp at time zone v_tz
   group by 1 order by 2 desc, 1;
end;
$function$;

-- Revenu par service (valeur TTC des jobs créés, hors brouillon/annulé, par titre).
create or replace function public.rpc_insights_service_mix(p_org uuid, p_from date, p_to date)
returns table(title text, cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text;
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  return query
  select coalesce(nullif(j.title, ''), 'Untitled'), sum(j.total_cents)::bigint
    from public.jobs j
   where j.org_id = p_org and j.deleted_at is null and j.status not in ('draft', 'cancelled')
     and j.created_at >= p_from::timestamp at time zone v_tz and j.created_at < (p_to + 1)::timestamp at time zone v_tz
   group by 1 order by 2 desc, 1;
end;
$function$;

-- Jobs complétés par mois local de complétion (valeur moyenne, part récurrente).
create or replace function public.rpc_insights_completed_jobs_monthly(p_org uuid, p_from date, p_to date)
returns table(mois text, nombre bigint, total_cents bigint, recurrent_cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text;
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  return query
  select to_char(j.completed_at at time zone v_tz, 'YYYY-MM'), count(*)::bigint, sum(j.total_cents)::bigint,
         coalesce(sum(j.total_cents) filter (where j.job_type = 'recurring'), 0)::bigint
    from public.jobs j
   where j.org_id = p_org and j.deleted_at is null and j.status = 'completed'
     and j.completed_at >= p_from::timestamp at time zone v_tz and j.completed_at < (p_to + 1)::timestamp at time zone v_tz
   group by 1 order by 1;
end;
$function$;

-- Valeur vie moyenne sur TOUS les clients qui ont eu un job (même définition que la valeur client).
create or replace function public.rpc_insights_valeur_vie_moyenne(p_org uuid)
returns table(clients bigint, moyenne_cents bigint)
language plpgsql stable security definer set search_path = public as $function$
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  with cs as (
    select c.id, count(j.id) as nb, coalesce(sum(j.total_cents), 0) as rev
      from public.clients c
      join public.jobs j on j.client_id = c.id and j.org_id = c.org_id and j.deleted_at is null and j.status not in ('draft', 'cancelled')
     where c.org_id = p_org and c.deleted_at is null group by c.id
  ),
  ir as (select i.client_id, sum(i.total_cents) as inv from public.invoices i
          where i.org_id = p_org and i.deleted_at is null and i.status = 'paid' group by 1)
  select count(*)::bigint, coalesce(round(avg(greatest(cs.rev, coalesce(ir.inv, 0)))), 0)::bigint
    from cs left join ir on ir.client_id = cs.id;
end;
$function$;

revoke all on function public.rpc_insights_payment_mix(uuid, date, date) from public, anon;
revoke all on function public.rpc_insights_service_mix(uuid, date, date) from public, anon;
revoke all on function public.rpc_insights_completed_jobs_monthly(uuid, date, date) from public, anon;
revoke all on function public.rpc_insights_valeur_vie_moyenne(uuid) from public, anon;
grant execute on function public.rpc_insights_payment_mix(uuid, date, date) to authenticated, service_role;
grant execute on function public.rpc_insights_service_mix(uuid, date, date) to authenticated, service_role;
grant execute on function public.rpc_insights_completed_jobs_monthly(uuid, date, date) to authenticated, service_role;
grant execute on function public.rpc_insights_valeur_vie_moyenne(uuid) to authenticated, service_role;
notify pgrst, 'reload schema';

-- Revenu par ville : jobs complétés ayant au moins une visite dans la période, comptés UNE fois,
-- regroupés par adresse (une ligne par adresse au lieu d'une par visite : 30 000 visites sur 3 ans
-- dans le tenant volumineux). La ville se déduit de l'adresse côté client, comme avant.
create or replace function public.rpc_insights_zones(p_org uuid, p_from date, p_to date)
returns table(adresse text, jobs bigint, revenu_cents bigint, lat_somme double precision, lng_somme double precision)
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text;
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  return query
  select j.property_address, count(*)::bigint, coalesce(sum(j.total_cents), 0)::bigint, sum(j.latitude), sum(j.longitude)
    from public.jobs j
   where j.org_id = p_org and j.deleted_at is null and j.status = 'completed'
     and j.latitude is not null and j.longitude is not null and not (j.latitude = 0 and j.longitude = 0)
     and exists (select 1 from public.schedule_events e
                  where e.org_id = p_org and e.job_id = j.id and e.deleted_at is null
                    and e.start_at >= p_from::timestamp at time zone v_tz and e.start_at < (p_to + 1)::timestamp at time zone v_tz)
   group by j.property_address;
end;
$function$;
revoke all on function public.rpc_insights_zones(uuid, date, date) from public, anon;
grant execute on function public.rpc_insights_zones(uuid, date, date) to authenticated, service_role;
notify pgrst, 'reload schema';
