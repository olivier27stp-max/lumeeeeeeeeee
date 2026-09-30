-- ============================================================================
-- Statistiques : filtres (équipe, technicien, vendeur, client, service), vrai revenu par service,
-- entonnoir par cohorte, soumissions et top clients sur la période, détail de chaque chiffre.
-- Suite de 20261004300000 (même garde : stats_lecture_permise ; même fuseau : stats_fuseau).
--
-- p_filtres jsonb, clés facultatives (uuid en texte) :
--   equipe      job de cette équipe (jobs.team_id ou une visite de cette équipe)
--   technicien  job où il a pointé, ou dont une visite lui est assignée ou est assignée à son équipe
--               (même règle que server/lib/rentabilite)
--   vendeur     jobs.salesperson_id / invoices.salesperson_id / quotes.salesperson_id / deals.rep_id /
--               clients.assigned_to (leads)
--   client      client_id (ou lead_id)
--   service     service du catalogue : ligne de job du même nom (jobs), ligne de soumission liée
--               (soumissions) — même règle de nom que la rentabilité
-- Chaque fonction ignore les filtres qui ne la concernent pas ; la page le signale sur la carte.
-- Les signatures existantes gagnent p_filtres avec une valeur par défaut : Lumi, les rapports
-- et l'aperçu multi-bureaux continuent d'appeler sans lui.
-- ============================================================================

-- ── Aides ───────────────────────────────────────────────────────────────────
create or replace function public.stats_norm(t text)
returns text language sql stable as $$ select lower(extensions.unaccent(btrim(coalesce(t, '')))) $$;

-- Les jobs qui passent les filtres « job » (équipe, technicien, service), calculés UNE fois par
-- requête : les appelants testent « j.id in (select public.stats_jobs_filtres(org, f)) », que
-- Postgres évalue en une table de hachage. (Une version par ligne — sous-requêtes rejouées pour
-- chaque paiement — dépassait 20 s sur 3 ans à 50 000 jobs avec technicien + service.)
--   équipe     : l'équipe du job, ou une visite faite par cette équipe ;
--   technicien : a pointé sur le job, ou visite assignée à lui ou à une de ses équipes ;
--   service    : une ligne du job (incluse, non supprimée) porte le nom du service du catalogue
--                (casse et accents ignorés).
create or replace function public.stats_jobs_filtres(p_org uuid, f jsonb)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_equipe uuid := nullif(f->>'equipe', '')::uuid;
  v_tech uuid := nullif(f->>'technicien', '')::uuid;
  v_service uuid := nullif(f->>'service', '')::uuid;
  v_nom text;
begin
  if v_service is not null then
    select public.stats_norm(s.name) into v_nom from public.predefined_services s where s.id = v_service and s.org_id = p_org;
    if v_nom is null then return; end if; -- service inconnu : aucun job
  end if;
  return query
  select j.id from public.jobs j
   where j.org_id = p_org
     and (v_equipe is null or j.team_id = v_equipe
          or j.id in (select e.job_id from public.schedule_events e where e.org_id = p_org and e.deleted_at is null and e.team_id = v_equipe))
     and (v_tech is null
          or j.id in (select te.job_id from public.time_entries te where te.org_id = p_org and te.employee_id = v_tech and te.job_id is not null)
          or j.id in (select e.job_id from public.schedule_events e
                       where e.org_id = p_org and e.deleted_at is null and e.job_id is not null
                         and (e.assigned_user = v_tech
                              or e.team_id in (select ta.team_id from public.team_assignments ta where ta.user_id = v_tech and ta.org_id = p_org
                                               union select m.team_id from public.memberships m where m.user_id = v_tech and m.org_id = p_org and m.team_id is not null
                                               union select tm.team_id from public.team_members tm where tm.user_id = v_tech and tm.org_id = p_org and tm.team_id is not null))))
     and (v_service is null
          or j.id in (select li.job_id from public.job_line_items li
                       where li.org_id = p_org and li.deleted_at is null and coalesce(li.included, true)
                         and public.stats_norm(li.name) = v_nom));
end;
$$;

-- Client et vendeur : comparaison simple (inlinée par Postgres, aucun coût par ligne).
create or replace function public.stats_client_vendeur_ok(p_client uuid, p_vendeur uuid, f jsonb)
returns boolean language sql immutable as $$
  select (nullif(f->>'client', '') is null or p_client = (f->>'client')::uuid)
     and (nullif(f->>'vendeur', '') is null or p_vendeur = (f->>'vendeur')::uuid)
$$;

-- Remplacées par les deux fonctions ci-dessus (présentes sur staging seulement).
drop function if exists public.stats_job_retenu(uuid, uuid, uuid, uuid, uuid, jsonb);
drop function if exists public.stats_job_a_technicien(uuid, uuid, uuid);

-- Des filtres « job » (équipe, technicien, service) sont-ils actifs ?
create or replace function public.stats_filtre_job_actif(f jsonb)
returns boolean language sql immutable as $$
  select nullif(f->>'equipe', '') is not null or nullif(f->>'technicien', '') is not null or nullif(f->>'service', '') is not null
$$;

revoke all on function public.stats_norm(text) from public, anon;
revoke all on function public.stats_jobs_filtres(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.stats_client_vendeur_ok(uuid, uuid, jsonb) from public, anon;
revoke all on function public.stats_filtre_job_actif(jsonb) from public, anon;
grant execute on function public.stats_norm(text) to authenticated, service_role;
grant execute on function public.stats_jobs_filtres(uuid, jsonb) to service_role;
grant execute on function public.stats_client_vendeur_ok(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.stats_filtre_job_actif(jsonb) to authenticated, service_role;

-- ── Encaissements (source de la courbe, des modes, du top clients) ──────────
drop function if exists public.stats_encaissements(uuid, timestamptz, timestamptz);
-- Chemin FILTRÉ (équipe, technicien, service, vendeur) : jointure aux jobs, et l'ensemble des jobs
-- retenus calculé une fois (stats_jobs_filtres).
create or replace function public.stats_encaissements_filtres(p_org uuid, p_debut timestamptz, p_fin timestamptz, f jsonb)
returns table(quand timestamptz, cents bigint, methode text, source text, source_id uuid, client_id uuid, libelle text)
language sql stable security definer set search_path = public as $$
  select p.payment_date, (p.amount_cents - coalesce(p.refunded_cents, 0))::bigint, p.method, 'paiement', p.id,
         coalesce(p.client_id, i.client_id), coalesce(i.invoice_number, 'Paiement')
    from public.payments p
    left join public.invoices i on i.id = p.invoice_id and i.org_id = p.org_id
    left join public.jobs j on j.id = coalesce(p.job_id, i.job_id) and j.org_id = p.org_id and j.deleted_at is null
   where p.org_id = p_org and p.deleted_at is null and p.status in ('succeeded', 'refunded')
     and p.payment_date >= p_debut and p.payment_date < p_fin
     and (nullif(f->>'client', '') is null or coalesce(p.client_id, i.client_id) = (f->>'client')::uuid)
     and (nullif(f->>'vendeur', '') is null or coalesce(i.salesperson_id, j.salesperson_id) = (f->>'vendeur')::uuid)
     and (not public.stats_filtre_job_actif(f) or (j.id is not null and (public.stats_client_vendeur_ok(null, null, f - 'client' - 'vendeur') and (not public.stats_filtre_job_actif(f - 'client' - 'vendeur') or j.id in (select public.stats_jobs_filtres(p_org, f - 'client' - 'vendeur'))))))
  union all
  select coalesce(i.paid_at, i.issued_at), i.paid_cents::bigint, null, 'facture', i.id, i.client_id, i.invoice_number
    from public.invoices i
    left join public.jobs j on j.id = i.job_id and j.org_id = i.org_id and j.deleted_at is null
   where i.org_id = p_org and i.deleted_at is null and i.status in ('paid', 'partial') and i.paid_cents > 0
     and not exists (select 1 from public.payments p where p.invoice_id = i.id and p.deleted_at is null)
     and coalesce(i.paid_at, i.issued_at) >= p_debut and coalesce(i.paid_at, i.issued_at) < p_fin
     and (nullif(f->>'client', '') is null or i.client_id = (f->>'client')::uuid)
     and (nullif(f->>'vendeur', '') is null or coalesce(i.salesperson_id, j.salesperson_id) = (f->>'vendeur')::uuid)
     and (not public.stats_filtre_job_actif(f) or (j.id is not null and (public.stats_client_vendeur_ok(null, null, f - 'client' - 'vendeur') and (not public.stats_filtre_job_actif(f - 'client' - 'vendeur') or j.id in (select public.stats_jobs_filtres(p_org, f - 'client' - 'vendeur'))))));
$$;
revoke all on function public.stats_encaissements_filtres(uuid, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.stats_encaissements_filtres(uuid, timestamptz, timestamptz, jsonb) to service_role;

create or replace function public.stats_encaissements(p_org uuid, p_debut timestamptz, p_fin timestamptz, f jsonb default '{}'::jsonb)
returns table(quand timestamptz, cents bigint, methode text, source text, source_id uuid, client_id uuid, libelle text)
-- Encaissé : paiements nets des remboursements + factures payées sans paiement (imports Jobber).
-- SANS filtre de job ni de vendeur (la page à l'ouverture) : ni jointure aux jobs ni appel de
-- fonction par ligne. AVEC : stats_encaissements_filtres. (Une version SQL inlinable, essayée :
-- plus rapide sans filtre, mais délai dépassé avec un filtre technicien.)
language plpgsql stable security definer set search_path = public as $$
declare
  v_client uuid := nullif(f->>'client', '')::uuid;
  v_vendeur uuid := nullif(f->>'vendeur', '')::uuid;
  v_job boolean := public.stats_filtre_job_actif(f);
begin
  if not v_job and v_vendeur is null then
    return query
    select p.payment_date, (p.amount_cents - coalesce(p.refunded_cents, 0))::bigint, p.method, 'paiement'::text, p.id,
           coalesce(p.client_id, i.client_id), coalesce(i.invoice_number, 'Paiement')
      from public.payments p
      left join public.invoices i on i.id = p.invoice_id and i.org_id = p.org_id
     where p.org_id = p_org and p.deleted_at is null and p.status in ('succeeded', 'refunded')
       and p.payment_date >= p_debut and p.payment_date < p_fin
       and (v_client is null or coalesce(p.client_id, i.client_id) = v_client)
    union all
    select coalesce(i.paid_at, i.issued_at), i.paid_cents::bigint, null::text, 'facture'::text, i.id, i.client_id, i.invoice_number
      from public.invoices i
     where i.org_id = p_org and i.deleted_at is null and i.status in ('paid', 'partial') and i.paid_cents > 0
       and not exists (select 1 from public.payments p where p.invoice_id = i.id and p.deleted_at is null)
       and coalesce(i.paid_at, i.issued_at) >= p_debut and coalesce(i.paid_at, i.issued_at) < p_fin
       and (v_client is null or i.client_id = v_client);
    return;
  end if;

  return query select * from public.stats_encaissements_filtres(p_org, p_debut, p_fin, f);
end;
$$;
revoke all on function public.stats_encaissements(uuid, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.stats_encaissements(uuid, timestamptz, timestamptz, jsonb) to service_role;

-- ── Série de revenus ─────────────────────────────────────────────────────────
drop function if exists public.rpc_insights_revenue_series(uuid, date, date, text);
create or replace function public.rpc_insights_revenue_series(p_org uuid default null, p_from date default null, p_to date default null, p_granularity text default 'month', p_filtres jsonb default '{}'::jsonb)
returns table(bucket_start date, revenue_cents bigint, invoiced_cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, public.current_org_id());
  f jsonb := coalesce(p_filtres, '{}'::jsonb);
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
  with buckets as (select generate_series(date_trunc(v_g, v_from::timestamp), date_trunc(v_g, v_to::timestamp), v_step)::date as b),
  rev as (select date_trunc(v_g, e.quand at time zone v_tz)::date as b, sum(e.cents)::bigint as c
            from public.stats_encaissements(v_org, v_debut, v_fin, f) e group by 1),
  inv as (
    select date_trunc(v_g, coalesce(i.issued_at, i.created_at) at time zone v_tz)::date as b, sum(i.total_cents)::bigint as c
      from public.invoices i
      left join public.jobs j on j.id = i.job_id and j.org_id = i.org_id and j.deleted_at is null
     where i.org_id = v_org and i.deleted_at is null and i.status in ('sent', 'partial', 'paid')
       and coalesce(i.issued_at, i.created_at) >= v_debut and coalesce(i.issued_at, i.created_at) < v_fin
       and (nullif(f->>'client', '') is null or i.client_id = (f->>'client')::uuid)
       and (nullif(f->>'vendeur', '') is null or coalesce(i.salesperson_id, j.salesperson_id) = (f->>'vendeur')::uuid)
       and (not public.stats_filtre_job_actif(f) or (j.id is not null and (public.stats_client_vendeur_ok(null, null, f - 'client' - 'vendeur') and (not public.stats_filtre_job_actif(f - 'client' - 'vendeur') or j.id in (select public.stats_jobs_filtres(v_org, f - 'client' - 'vendeur'))))))
     group by 1)
  select bk.b, coalesce(r.c, 0)::bigint, coalesce(i.c, 0)::bigint
    from buckets bk left join rev r on r.b = bk.b left join inv i on i.b = bk.b order by bk.b;
end;
$function$;

-- ── Modes de paiement ────────────────────────────────────────────────────────
drop function if exists public.rpc_insights_payment_mix(uuid, date, date);
create or replace function public.rpc_insights_payment_mix(p_org uuid, p_from date, p_to date, p_filtres jsonb default '{}'::jsonb)
returns table(method text, cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text;
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  return query
  select coalesce(e.methode, 'other'), sum(e.cents)::bigint
    from public.stats_encaissements(p_org, p_from::timestamp at time zone v_tz, (p_to + 1)::timestamp at time zone v_tz, coalesce(p_filtres, '{}'::jsonb)) e
   where e.source = 'paiement'
   group by 1 having sum(e.cents) <> 0 order by 2 desc, 1;
end;
$function$;

-- ── Revenu par service : lignes des jobs COMPLÉTÉS, avant taxes ─────────────
-- Nom du service = celui du catalogue quand la ligne porte ce nom (même règle que la rentabilité),
-- sinon le nom de la ligne. Un job complété sans ligne compte son sous-total sous « (sans détail) ».
drop function if exists public.rpc_insights_service_mix(uuid, date, date);
create or replace function public.rpc_insights_service_mix(p_org uuid, p_from date, p_to date, p_filtres jsonb default '{}'::jsonb)
returns table(title text, cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text; f jsonb := coalesce(p_filtres, '{}'::jsonb);
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  return query
  with js as (
    select j.id, coalesce(j.subtotal_cents, 0) as st from public.jobs j
     where j.org_id = p_org and j.deleted_at is null and j.status = 'completed'
       and j.completed_at >= p_from::timestamp at time zone v_tz and j.completed_at < (p_to + 1)::timestamp at time zone v_tz
       and (public.stats_client_vendeur_ok(j.client_id, j.salesperson_id, f - 'service') and (not public.stats_filtre_job_actif(f - 'service') or j.id in (select public.stats_jobs_filtres(p_org, f - 'service'))))
  ),
  lignes as (
    select li.job_id, li.name, li.total_cents from public.job_line_items li join js on js.id = li.job_id
     where li.deleted_at is null and coalesce(li.included, true)
  ),
  catalogue as (select distinct on (public.stats_norm(s.name)) public.stats_norm(s.name) as n, s.name, s.id from public.predefined_services s
                 where s.org_id = p_org order by public.stats_norm(s.name), s.is_active desc, s.created_at),
  par_service as (
    select coalesce(c.name, btrim(l.name)) as nom, c.id as sid, l.total_cents::bigint as c from lignes l left join catalogue c on c.n = public.stats_norm(l.name)
    union all
    select '(sans détail)', null, js.st::bigint from js where not exists (select 1 from lignes l where l.job_id = js.id)
  )
  select ps.nom, sum(ps.c)::bigint from par_service ps
   where nullif(f->>'service', '') is null or ps.sid = (f->>'service')::uuid
   group by 1 having sum(ps.c) <> 0 order by 2 desc, 1;
end;
$function$;

-- ── Jobs complétés par mois (valeur moyenne, part récurrente) ───────────────
drop function if exists public.rpc_insights_completed_jobs_monthly(uuid, date, date);
create or replace function public.rpc_insights_completed_jobs_monthly(p_org uuid, p_from date, p_to date, p_filtres jsonb default '{}'::jsonb)
returns table(mois text, nombre bigint, total_cents bigint, recurrent_cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text; f jsonb := coalesce(p_filtres, '{}'::jsonb);
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
     and (public.stats_client_vendeur_ok(j.client_id, j.salesperson_id, f) and (not public.stats_filtre_job_actif(f) or j.id in (select public.stats_jobs_filtres(p_org, f))))
   group by 1 order by 1;
end;
$function$;

-- ── Équipes ──────────────────────────────────────────────────────────────────
drop function if exists public.rpc_insights_team_performance(uuid, date, date);
create or replace function public.rpc_insights_team_performance(p_org uuid default null, p_from date default null, p_to date default null, p_filtres jsonb default '{}'::jsonb)
returns table(team_id uuid, team_name text, jobs_count bigint, jobs_completed bigint, completion_rate numeric, revenue_cents bigint, avg_job_value_cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, current_org_id());
  f jsonb := coalesce(p_filtres, '{}'::jsonb);
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
                  and (public.stats_client_vendeur_ok(j.client_id, j.salesperson_id, f - 'equipe') and (not public.stats_filtre_job_actif(f - 'equipe') or j.id in (select public.stats_jobs_filtres(v_org, f - 'equipe'))))
  where tm.org_id = v_org and tm.deleted_at is null and tm.is_active = true
    and (nullif(f->>'equipe', '') is null or tm.id = (f->>'equipe')::uuid)
  group by tm.id, tm.name order by 6 desc, 2;
end;
$function$;

-- ── Valeur vie moyenne (à vie, clients qui ont eu un job retenu) ─────────────
drop function if exists public.rpc_insights_valeur_vie_moyenne(uuid);
create or replace function public.rpc_insights_valeur_vie_moyenne(p_org uuid, p_filtres jsonb default '{}'::jsonb)
returns table(clients bigint, moyenne_cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare f jsonb := coalesce(p_filtres, '{}'::jsonb);
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  with cs as (
    select c.id, count(j.id) as nb, coalesce(sum(j.total_cents), 0) as rev
      from public.clients c
      join public.jobs j on j.client_id = c.id and j.org_id = c.org_id and j.deleted_at is null and j.status not in ('draft', 'cancelled')
                         and (public.stats_client_vendeur_ok(j.client_id, j.salesperson_id, f) and (not public.stats_filtre_job_actif(f) or j.id in (select public.stats_jobs_filtres(p_org, f))))
     where c.org_id = p_org and c.deleted_at is null group by c.id
  ),
  ir as (select i.client_id, sum(i.total_cents) as inv from public.invoices i
          where i.org_id = p_org and i.deleted_at is null and i.status = 'paid' and not public.stats_filtre_job_actif(f)
            and (nullif(f->>'vendeur', '') is null or i.salesperson_id = (f->>'vendeur')::uuid) group by 1)
  select count(*)::bigint, coalesce(round(avg(greatest(cs.rev, coalesce(ir.inv, 0)))), 0)::bigint
    from cs left join ir on ir.client_id = cs.id;
end;
$function$;

-- ── Top clients : encaissé sur la période ────────────────────────────────────
create or replace function public.rpc_insights_top_clients(p_org uuid, p_from date, p_to date, p_filtres jsonb default '{}'::jsonb, p_limit int default 5)
returns table(client_id uuid, client_name text, cents bigint, paiements bigint)
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text;
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  return query
  select e.client_id, coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.company, '—'), sum(e.cents)::bigint, count(*)::bigint
    from public.stats_encaissements(p_org, p_from::timestamp at time zone v_tz, (p_to + 1)::timestamp at time zone v_tz, coalesce(p_filtres, '{}'::jsonb)) e
    join public.clients c on c.id = e.client_id and c.org_id = p_org
   group by e.client_id, c.first_name, c.last_name, c.company
  having sum(e.cents) > 0
   order by 3 desc, 2 limit greatest(coalesce(p_limit, 5), 1);
end;
$function$;

-- ── Entonnoir par cohorte : leads créés → ayant reçu une soumission → devenus un job ──
create or replace function public.rpc_insights_entonnoir(p_org uuid, p_from date, p_to date, p_filtres jsonb default '{}'::jsonb)
returns table(crees bigint, avec_soumission bigint, convertis bigint, jours_moyens numeric)
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text; f jsonb := coalesce(p_filtres, '{}'::jsonb);
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  return query
  with leads as (
    select l.id, l.created_at from public.clients l
     where l.org_id = p_org and l.deleted_at is null
       and l.created_at >= p_from::timestamp at time zone v_tz and l.created_at < (p_to + 1)::timestamp at time zone v_tz
       and (l.status = 'lead' or l.lead_status is not null
            or exists (select 1 from public.jobs j2 where j2.org_id = l.org_id and j2.lead_id = l.id and j2.deleted_at is null))
       and (nullif(f->>'vendeur', '') is null or l.assigned_to = (f->>'vendeur')::uuid)
       and (nullif(f->>'client', '') is null or l.id = (f->>'client')::uuid)
  ),
  etapes as (
    select l.id,
           exists (select 1 from public.quotes q where q.org_id = p_org and q.deleted_at is null and (q.lead_id = l.id or q.client_id = l.id)) as soumis,
           (select min(j.created_at) from public.jobs j where j.org_id = p_org and j.deleted_at is null and (j.lead_id = l.id or j.client_id = l.id)) as premier_job,
           l.created_at
      from leads l
  )
  select count(*)::bigint,
         count(*) filter (where soumis or premier_job is not null)::bigint,
         count(*) filter (where premier_job is not null)::bigint,
         round(avg(extract(epoch from (premier_job - created_at)) / 86400.0) filter (where premier_job is not null)::numeric, 1)
    from etapes;
end;
$function$;

-- ── Soumissions créées dans la période ───────────────────────────────────────
create or replace function public.rpc_insights_soumissions(p_org uuid, p_from date, p_to date, p_filtres jsonb default '{}'::jsonb)
returns table(nombre bigint, valeur_cents bigint, approuvees bigint, valeur_approuvee_cents bigint, en_attente bigint, valeur_en_attente_cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text; f jsonb := coalesce(p_filtres, '{}'::jsonb);
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  return query
  select count(*)::bigint, coalesce(sum(q.total_cents), 0)::bigint,
         count(*) filter (where q.status in ('approved', 'converted'))::bigint,
         coalesce(sum(q.total_cents) filter (where q.status in ('approved', 'converted')), 0)::bigint,
         count(*) filter (where q.status in ('draft', 'awaiting_response', 'changes_requested'))::bigint,
         coalesce(sum(q.total_cents) filter (where q.status in ('draft', 'awaiting_response', 'changes_requested')), 0)::bigint
    from public.quotes q
   where q.org_id = p_org and q.deleted_at is null
     and q.created_at >= p_from::timestamp at time zone v_tz and q.created_at < (p_to + 1)::timestamp at time zone v_tz
     and (nullif(f->>'client', '') is null or coalesce(q.client_id, q.lead_id) = (f->>'client')::uuid)
     and (nullif(f->>'vendeur', '') is null or q.salesperson_id = (f->>'vendeur')::uuid)
     and (nullif(f->>'service', '') is null or exists (select 1 from public.quote_line_items qi where qi.quote_id = q.id and qi.source_service_id = (f->>'service')::uuid));
end;
$function$;

-- ── Trésorerie (à recevoir à ce jour, retards, délai de paiement) ───────────
drop function if exists public.rpc_insights_invoices_summary(uuid, date, date);
create or replace function public.rpc_insights_invoices_summary(p_org uuid default null, p_from date default null, p_to date default null, p_filtres jsonb default '{}'::jsonb)
returns table(count_draft bigint, count_sent bigint, count_paid bigint, count_past_due bigint, total_outstanding_cents bigint, avg_payment_time_days numeric)
language plpgsql security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, public.current_org_id());
  f jsonb := coalesce(p_filtres, '{}'::jsonb);
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
  with fi as (
    select i.* from public.invoices i
      left join public.jobs j on j.id = i.job_id and j.org_id = i.org_id and j.deleted_at is null
     where i.org_id = v_org and i.deleted_at is null
       and (nullif(f->>'client', '') is null or i.client_id = (f->>'client')::uuid)
       and (nullif(f->>'vendeur', '') is null or coalesce(i.salesperson_id, j.salesperson_id) = (f->>'vendeur')::uuid)
       and (not public.stats_filtre_job_actif(f) or (j.id is not null and (public.stats_client_vendeur_ok(null, null, f - 'client' - 'vendeur') and (not public.stats_filtre_job_actif(f - 'client' - 'vendeur') or j.id in (select public.stats_jobs_filtres(v_org, f - 'client' - 'vendeur'))))))
  ),
  base as (select fi.status from fi where coalesce(fi.issued_at, fi.created_at) >= v_debut and coalesce(fi.issued_at, fi.created_at) < v_fin),
  open_inv as (select fi.balance_cents, fi.due_date from fi where fi.status in ('sent', 'partial') and fi.balance_cents > 0)
  select
    (select count(*) from base b where b.status = 'draft')::bigint,
    (select count(*) from base b where b.status in ('sent', 'partial'))::bigint,
    (select count(*) from base b where b.status = 'paid')::bigint,
    (select count(*) from open_inv o where o.due_date < v_today)::bigint,
    coalesce((select sum(o.balance_cents) from open_inv o), 0)::bigint,
    (select avg(extract(epoch from (fi.paid_at - fi.issued_at)) / 86400.0) from fi
      where fi.paid_at is not null and fi.issued_at is not null and fi.paid_at >= v_debut and fi.paid_at < v_fin and fi.paid_at >= fi.issued_at);
end;
$function$;

-- ── Pipeline (taux de réussite, délai) ───────────────────────────────────────
drop function if exists public.rpc_insights_pipeline_velocity(uuid, date, date);
create or replace function public.rpc_insights_pipeline_velocity(p_org uuid default null, p_from date default null, p_to date default null, p_filtres jsonb default '{}'::jsonb)
returns table(total_deals bigint, won_deals bigint, lost_deals bigint, win_rate numeric, avg_deal_value_cents bigint, avg_days_to_close numeric)
language plpgsql security definer set search_path = public as $function$
declare
  v_org uuid := coalesce(p_org, current_org_id());
  f jsonb := coalesce(p_filtres, '{}'::jsonb);
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
    select d.stage, d.value_cents,
           case when d.stage = 'closed_won' and d.won_at is not null then extract(epoch from (d.won_at - d.created_at)) / 86400.0 end as jours
      from pipeline_deals d
     where d.org_id = v_org and d.deleted_at is null and coalesce(d.source, '') <> 'job'
       and d.created_at >= v_debut and d.created_at < v_fin
       and (nullif(f->>'vendeur', '') is null or d.rep_id = (f->>'vendeur')::uuid)
       and (nullif(f->>'client', '') is null or coalesce(d.client_id, d.lead_id) = (f->>'client')::uuid)
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

-- ── Zones (par adresse, avec les jobs pour le détail) ────────────────────────
drop function if exists public.rpc_insights_zones(uuid, date, date);
create or replace function public.rpc_insights_zones(p_org uuid, p_from date, p_to date, p_filtres jsonb default '{}'::jsonb)
returns table(adresse text, jobs bigint, revenu_cents bigint, lat_somme double precision, lng_somme double precision, job_ids uuid[])
language plpgsql stable security definer set search_path = public as $function$
declare v_tz text; f jsonb := coalesce(p_filtres, '{}'::jsonb);
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  return query
  select j.property_address, count(*)::bigint, coalesce(sum(j.total_cents), 0)::bigint, sum(j.latitude), sum(j.longitude), array_agg(j.id order by j.id)
    from public.jobs j
   where j.org_id = p_org and j.deleted_at is null and j.status = 'completed'
     and j.latitude is not null and j.longitude is not null and not (j.latitude = 0 and j.longitude = 0)
     and exists (select 1 from public.schedule_events e
                  where e.org_id = p_org and e.job_id = j.id and e.deleted_at is null
                    and e.start_at >= p_from::timestamp at time zone v_tz and e.start_at < (p_to + 1)::timestamp at time zone v_tz)
     and (public.stats_client_vendeur_ok(j.client_id, j.salesperson_id, f) and (not public.stats_filtre_job_actif(f) or j.id in (select public.stats_jobs_filtres(p_org, f))))
   group by j.property_address;
end;
$function$;

-- ── Détail d'un chiffre : les lignes exactes qui le composent (somme = chiffre) ──
-- p_carte : revenu | mode | client | service | valeur_moyenne | equipe | a_recevoir | en_retard | delai
--           | jobs | soumissions | soumissions_approuvees | leads | leads_soumission | leads_convertis
--           | deals_gagnes | deals_perdus
-- p_cle   : mois « YYYY-MM » (revenu), mode, id client, nom de service, id équipe, liste JSON d'ids de jobs (jobs)
create or replace function public.rpc_insights_detail(p_org uuid, p_from date, p_to date, p_filtres jsonb default '{}'::jsonb, p_carte text default 'revenu', p_cle text default null)
returns table(type text, id uuid, libelle text, sous_libelle text, quand timestamptz, cents bigint)
language plpgsql stable security definer set search_path = public as $function$
declare
  v_tz text; v_today date; f jsonb := coalesce(p_filtres, '{}'::jsonb);
  v_debut timestamptz; v_fin timestamptz;
begin
  if not public.stats_lecture_permise(p_org, array['financial.view_analytics', 'reports.read']) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_tz := public.stats_fuseau(p_org);
  v_today := (now() at time zone v_tz)::date;
  v_debut := p_from::timestamp at time zone v_tz;
  v_fin := (p_to + 1)::timestamp at time zone v_tz;

  if p_carte in ('revenu', 'mode', 'client') then
    return query
    select e.source, e.source_id, coalesce(e.libelle, '—'),
           coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.company, '—'), e.quand, e.cents
      from public.stats_encaissements(p_org, v_debut, v_fin, f) e
      left join public.clients c on c.id = e.client_id
     where (p_carte <> 'revenu' or p_cle is null or to_char(e.quand at time zone v_tz, 'YYYY-MM') = p_cle)
       and (p_carte <> 'mode' or (e.source = 'paiement' and coalesce(e.methode, 'other') = p_cle))
       and (p_carte <> 'client' or e.client_id = p_cle::uuid)
     order by e.quand desc;

  elsif p_carte = 'service' then
    return query
    with js as (
      select j.* from public.jobs j
       where j.org_id = p_org and j.deleted_at is null and j.status = 'completed' and j.completed_at >= v_debut and j.completed_at < v_fin
         and (public.stats_client_vendeur_ok(j.client_id, j.salesperson_id, f - 'service') and (not public.stats_filtre_job_actif(f - 'service') or j.id in (select public.stats_jobs_filtres(p_org, f - 'service'))))
    ),
    catalogue as (select distinct on (public.stats_norm(s.name)) public.stats_norm(s.name) as n, s.name from public.predefined_services s
                   where s.org_id = p_org order by public.stats_norm(s.name), s.is_active desc, s.created_at)
    select 'job', js.id, coalesce(js.job_number, '—'), coalesce(js.client_name, '—'), js.completed_at, sum(li.total_cents)::bigint
      from js join public.job_line_items li on li.job_id = js.id and li.deleted_at is null and coalesce(li.included, true)
      left join catalogue c on c.n = public.stats_norm(li.name)
     where coalesce(c.name, btrim(li.name)) = p_cle
     group by js.id, js.job_number, js.client_name, js.completed_at
    union all
    select 'job', js.id, coalesce(js.job_number, '—'), coalesce(js.client_name, '—'), js.completed_at, coalesce(js.subtotal_cents, 0)::bigint
      from js where p_cle = '(sans détail)' and not exists (select 1 from public.job_line_items li where li.job_id = js.id and li.deleted_at is null and coalesce(li.included, true))
     order by 5 desc;

  elsif p_carte in ('valeur_moyenne', 'equipe', 'jobs') then
    return query
    select 'job', j.id, coalesce(j.job_number, '—'), coalesce(j.client_name, '—'), coalesce(j.completed_at, j.created_at),
           case when j.status = 'completed' then j.total_cents::bigint else 0 end
      from public.jobs j
     where j.org_id = p_org and j.deleted_at is null
       and case p_carte
             when 'valeur_moyenne' then j.status = 'completed' and j.completed_at >= v_debut and j.completed_at < v_fin
                                        and (public.stats_client_vendeur_ok(j.client_id, j.salesperson_id, f) and (not public.stats_filtre_job_actif(f) or j.id in (select public.stats_jobs_filtres(p_org, f))))
             when 'equipe' then j.team_id = p_cle::uuid and j.created_at >= v_debut and j.created_at < v_fin
                                and (public.stats_client_vendeur_ok(j.client_id, j.salesperson_id, f - 'equipe') and (not public.stats_filtre_job_actif(f - 'equipe') or j.id in (select public.stats_jobs_filtres(p_org, f - 'equipe'))))
             else j.id in (select jsonb_array_elements_text(p_cle::jsonb)::uuid)
           end
     order by 5 desc;

  elsif p_carte in ('a_recevoir', 'en_retard', 'delai') then
    return query
    select 'facture', i.id, coalesce(i.invoice_number, '—'), coalesce(i.client_name_snapshot, '—'),
           case when p_carte = 'delai' then i.paid_at else i.due_date::timestamptz end,
           case when p_carte = 'delai' then round(extract(epoch from (i.paid_at - i.issued_at)) / 86400.0 * 100)::bigint else i.balance_cents::bigint end
      from public.invoices i
      left join public.jobs j on j.id = i.job_id and j.org_id = i.org_id and j.deleted_at is null
     where i.org_id = p_org and i.deleted_at is null
       and (nullif(f->>'client', '') is null or i.client_id = (f->>'client')::uuid)
       and (nullif(f->>'vendeur', '') is null or coalesce(i.salesperson_id, j.salesperson_id) = (f->>'vendeur')::uuid)
       and (not public.stats_filtre_job_actif(f) or (j.id is not null and (public.stats_client_vendeur_ok(null, null, f - 'client' - 'vendeur') and (not public.stats_filtre_job_actif(f - 'client' - 'vendeur') or j.id in (select public.stats_jobs_filtres(p_org, f - 'client' - 'vendeur'))))))
       and case p_carte
             when 'a_recevoir' then i.status in ('sent', 'partial') and i.balance_cents > 0
             when 'en_retard' then i.status in ('sent', 'partial') and i.balance_cents > 0 and i.due_date < v_today
             else i.paid_at is not null and i.issued_at is not null and i.paid_at >= v_debut and i.paid_at < v_fin and i.paid_at >= i.issued_at
           end
     order by 5 desc nulls last;

  elsif p_carte in ('soumissions', 'soumissions_approuvees') then
    return query
    select 'soumission', q.id, coalesce(q.quote_number, '—'),
           coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), c.company, '—'), q.created_at, q.total_cents::bigint
      from public.quotes q left join public.clients c on c.id = coalesce(q.client_id, q.lead_id)
     where q.org_id = p_org and q.deleted_at is null and q.created_at >= v_debut and q.created_at < v_fin
       and (p_carte = 'soumissions' or q.status in ('approved', 'converted'))
       and (nullif(f->>'client', '') is null or coalesce(q.client_id, q.lead_id) = (f->>'client')::uuid)
       and (nullif(f->>'vendeur', '') is null or q.salesperson_id = (f->>'vendeur')::uuid)
       and (nullif(f->>'service', '') is null or exists (select 1 from public.quote_line_items qi where qi.quote_id = q.id and qi.source_service_id = (f->>'service')::uuid))
     order by 5 desc;

  elsif p_carte in ('leads', 'leads_soumission', 'leads_convertis') then
    return query
    select 'client', l.id, coalesce(nullif(btrim(concat_ws(' ', l.first_name, l.last_name)), ''), l.company, '—'), coalesce(l.source, ''), l.created_at, 0::bigint
      from public.clients l
     where l.org_id = p_org and l.deleted_at is null and l.created_at >= v_debut and l.created_at < v_fin
       and (l.status = 'lead' or l.lead_status is not null
            or exists (select 1 from public.jobs j2 where j2.org_id = l.org_id and j2.lead_id = l.id and j2.deleted_at is null))
       and (nullif(f->>'vendeur', '') is null or l.assigned_to = (f->>'vendeur')::uuid)
       and (nullif(f->>'client', '') is null or l.id = (f->>'client')::uuid)
       and (p_carte = 'leads'
            or (p_carte = 'leads_soumission' and (exists (select 1 from public.quotes q where q.org_id = p_org and q.deleted_at is null and (q.lead_id = l.id or q.client_id = l.id))
                                                  or exists (select 1 from public.jobs j where j.org_id = p_org and j.deleted_at is null and (j.lead_id = l.id or j.client_id = l.id))))
            or (p_carte = 'leads_convertis' and exists (select 1 from public.jobs j where j.org_id = p_org and j.deleted_at is null and (j.lead_id = l.id or j.client_id = l.id))))
     order by 5 desc;

  elsif p_carte in ('deals_gagnes', 'deals_perdus') then
    return query
    select 'deal', d.id, coalesce(d.title, '—'), coalesce(d.stage, ''), coalesce(d.won_at, d.lost_at, d.created_at), coalesce(d.value_cents, 0)::bigint
      from public.pipeline_deals d
     where d.org_id = p_org and d.deleted_at is null and coalesce(d.source, '') <> 'job'
       and d.created_at >= v_debut and d.created_at < v_fin
       and d.stage = case p_carte when 'deals_gagnes' then 'closed_won' else 'closed_lost' end
       and (nullif(f->>'vendeur', '') is null or d.rep_id = (f->>'vendeur')::uuid)
       and (nullif(f->>'client', '') is null or coalesce(d.client_id, d.lead_id) = (f->>'client')::uuid)
     order by 5 desc;
  else
    raise exception 'carte inconnue : %', p_carte using errcode = '22023';
  end if;
end;
$function$;

-- ── Droits : jamais anon ; authenticated et service_role (la garde interne vérifie la permission) ──
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('rpc_insights_revenue_series', 'rpc_insights_payment_mix', 'rpc_insights_service_mix',
              'rpc_insights_completed_jobs_monthly', 'rpc_insights_team_performance', 'rpc_insights_valeur_vie_moyenne', 'rpc_insights_top_clients',
              'rpc_insights_entonnoir', 'rpc_insights_soumissions', 'rpc_insights_invoices_summary', 'rpc_insights_pipeline_velocity',
              'rpc_insights_zones', 'rpc_insights_detail')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end $$;

notify pgrst, 'reload schema';
