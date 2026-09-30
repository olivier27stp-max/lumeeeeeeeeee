-- Rentabilité des jobs : UNE définition, en base, pour tous les écrans.
--
-- Constat (catalogue de tâches Lumi, 2026-09-29) :
--  * rpc_insights_job_profitability lisait jobs.cost_cents, colonne qui
--    n'existe pas : coût 0, marge TOUJOURS 100 %. C'est ce que Lumi recevait.
--    Et elle ne vérifiait que l'adhésion : un technicien pouvait y lire les
--    revenus.
--  * La fiche de job affichait « Main-d'œuvre 0,00 $ » et « Dépenses 0,00 $ »
--    écrits en dur, et comptait les taxes dans le revenu.
--  * La carte Rentabilité des Statistiques calculait à part, dans le
--    navigateur, avec le total TAXES INCLUSES comme revenu.
--
-- Définition retenue (celle de la carte des Statistiques, corrigée) :
--   revenu      = jobs.subtotal_cents (avant taxes : la TPS/TVQ n'est pas à nous)
--   main-d'œuvre = heures pointées SUR le job (time_entries.job_id, pauses
--                 déduites) × taux horaire du membre (team_members, comme la paie)
--   dépenses    = jobs.expenses_cents
--   profit      = revenu − main-d'œuvre − dépenses
-- Accès : permission financial.view_margins (page Rôles), comme l'écran.

begin;

-- Secondes nettes d'un pointage. Les pauses existent sous deux formats
-- (« HH:MM:SS » écrit par les routes de pointage, ISO écrit à la main) :
-- même règle que server/lib/payroll.ts.
create or replace function public.pointage_secondes_nettes(p_in timestamptz, p_out timestamptz, p_breaks jsonb)
returns numeric
language plpgsql
immutable
set search_path = public
as $function$
declare
  b jsonb;
  s text;
  e text;
  ds numeric;
  de numeric;
  pause numeric := 0;
begin
  if p_in is null or p_out is null or p_out <= p_in then return 0; end if;
  for b in select * from jsonb_array_elements(coalesce(p_breaks, '[]'::jsonb)) loop
    s := b ->> 'start';
    e := b ->> 'end';
    if s is null or e is null then continue; end if;
    begin
      if s ~ '^\d{4}-\d{2}-\d{2}T' and e ~ '^\d{4}-\d{2}-\d{2}T' then
        pause := pause + greatest(extract(epoch from (e::timestamptz - s::timestamptz)), 0);
      else
        ds := extract(epoch from substring(s from '(\d{1,2}:\d{2}(:\d{2})?)')::time);
        de := extract(epoch from substring(e from '(\d{1,2}:\d{2}(:\d{2})?)')::time);
        if ds is not null and de is not null and de <> ds then
          pause := pause + mod(de - ds + 86400, 86400);  -- pause qui traverse minuit
        end if;
      end if;
    exception when others then
      null; -- heure illisible : ignorée, pas devinée
    end;
  end loop;
  return greatest(extract(epoch from (p_out - p_in)) - pause, 0);
end;
$function$;

-- Rentabilité job par job. p_job : un seul job (fiche de job), sinon les jobs
-- TERMINÉS dont la fin (à défaut la création) tombe dans la période.
create or replace function public.rentabilite_jobs(
  p_org uuid,
  p_from date default null,
  p_to date default null,
  p_job uuid default null
)
returns table(
  job_id uuid,
  job_number text,
  titre text,
  client_nom text,
  statut text,
  revenu_cents bigint,
  heures numeric,
  main_oeuvre_cents bigint,
  depenses_cents bigint,
  profit_cents bigint,
  marge_pct numeric
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_from date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to date := coalesce(p_to, current_date);
begin
  if p_org is null then
    raise exception 'org requis' using errcode = '22023';
  end if;
  if auth.uid() is not null and not public.member_has_permission(auth.uid(), p_org, 'financial.view_margins') then
    raise exception 'Permission refusée : financial.view_margins' using errcode = '42501';
  end if;

  return query
  with js as (
    select j.id, j.job_number, j.title, j.client_name, j.status,
           coalesce(j.subtotal_cents, 0)::bigint as revenu,
           coalesce(j.expenses_cents, 0)::bigint as depenses
      from public.jobs j
     where j.org_id = p_org
       and j.deleted_at is null
       and (
         (p_job is not null and j.id = p_job)
         or (p_job is null and j.status = 'completed'
             and (coalesce(j.completed_at, j.created_at) at time zone 'America/Toronto')::date between v_from and v_to)
       )
  ),
  temps as (
    select te.job_id,
           sum(public.pointage_secondes_nettes(
                 coalesce(te.punch_in_at, (te.date + te.punch_in)::timestamp at time zone 'UTC'),
                 coalesce(te.punch_out_at, (te.date + te.punch_out
                   + case when te.punch_out < te.punch_in then interval '1 day' else interval '0' end)::timestamp at time zone 'UTC'),
                 te.breaks)) as secondes,
           sum(public.pointage_secondes_nettes(
                 coalesce(te.punch_in_at, (te.date + te.punch_in)::timestamp at time zone 'UTC'),
                 coalesce(te.punch_out_at, (te.date + te.punch_out
                   + case when te.punch_out < te.punch_in then interval '1 day' else interval '0' end)::timestamp at time zone 'UTC'),
                 te.breaks)
               / 3600.0
               * coalesce(nullif(tm.hourly_rate_cents, 0), round(tm.labour_cost_hourly * 100), 0)) as cout
      from public.time_entries te
      left join public.team_members tm on tm.org_id = te.org_id and tm.user_id = te.employee_id
     where te.org_id = p_org
       and te.job_id in (select js.id from js)
       and te.status = 'completed'
     group by te.job_id
  )
  select js.id,
         js.job_number,
         js.title,
         js.client_name,
         js.status,
         js.revenu,
         round(coalesce(t.secondes, 0) / 3600.0, 2),
         round(coalesce(t.cout, 0))::bigint,
         js.depenses,
         (js.revenu - round(coalesce(t.cout, 0))::bigint - js.depenses),
         case when js.revenu > 0
              then round(((js.revenu - round(coalesce(t.cout, 0)) - js.depenses)::numeric / js.revenu) * 100, 1)
              else 0 end
    from js
    left join temps t on t.job_id = js.id;
end;
$function$;

-- Le résumé des Statistiques (et de Lumi), maintenant bâti sur la même définition.
create or replace function public.rpc_insights_job_profitability(p_org uuid default null, p_from date default null, p_to date default null)
returns table(total_jobs bigint, total_revenue_cents bigint, total_cost_cents bigint, gross_margin_cents bigint, margin_pct numeric,
              avg_revenue_per_job_cents bigint, avg_cost_per_job_cents bigint, profitable_jobs bigint, unprofitable_jobs bigint)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_org uuid;
begin
  v_org := coalesce(p_org, current_org_id());
  if v_org is null then raise exception 'Unable to resolve org_id'; end if;
  if auth.uid() is not null and not public.member_has_permission(auth.uid(), v_org, 'financial.view_margins') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  select count(*)::bigint,
         coalesce(sum(r.revenu_cents), 0)::bigint,
         coalesce(sum(r.main_oeuvre_cents + r.depenses_cents), 0)::bigint,
         coalesce(sum(r.profit_cents), 0)::bigint,
         case when coalesce(sum(r.revenu_cents), 0) > 0
              then round((sum(r.profit_cents)::numeric / sum(r.revenu_cents)) * 100, 1) else 0 end,
         case when count(*) > 0 then (sum(r.revenu_cents) / count(*))::bigint else 0 end,
         case when count(*) > 0 then (sum(r.main_oeuvre_cents + r.depenses_cents) / count(*))::bigint else 0 end,
         count(*) filter (where r.profit_cents > 0)::bigint,
         count(*) filter (where r.profit_cents <= 0 and (r.main_oeuvre_cents + r.depenses_cents) > 0)::bigint
    from public.rentabilite_jobs(v_org, p_from, p_to) r;
end;
$function$;

-- Supabase accorde EXECUTE à anon sur toute nouvelle fonction : avec
-- auth.uid() nul, la garde de permission serait sautée. Fermé nommément.
revoke execute on function public.rentabilite_jobs(uuid, date, date, uuid) from public, anon;
revoke execute on function public.rpc_insights_job_profitability(uuid, date, date) from public, anon;
revoke execute on function public.pointage_secondes_nettes(timestamptz, timestamptz, jsonb) from public, anon;
grant execute on function public.rentabilite_jobs(uuid, date, date, uuid) to authenticated, service_role;
grant execute on function public.rpc_insights_job_profitability(uuid, date, date) to authenticated, service_role;
grant execute on function public.pointage_secondes_nettes(timestamptz, timestamptz, jsonb) to authenticated, service_role;

commit;
