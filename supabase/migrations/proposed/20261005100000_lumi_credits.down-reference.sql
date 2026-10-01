-- Référence pour le DOWN : définitions de PROD au 2026-09-30 (lecture seule, pg_get_functiondef).
-- NE PAS APPLIQUER telles quelles sans la migration inverse complète.

CREATE OR REPLACE FUNCTION public.reserve_ai_budget(p_org uuid, p_cents numeric, p_proactive boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_periode     text := public.lumi_periode_courante();
  v_groupe      uuid;
  v_budget      numeric := 0;
  v_includes    boolean := false;
  v_spent       numeric := 0;
  v_spent_pro   numeric := 0;
  v_reserved    numeric := 0;
  v_reserved_pro numeric := 0;
  v_part_pro    numeric := 0.20;   -- sous-budget proactif : 20 % du plafond
  v_id          uuid;
  v_status      text;
begin
  if p_cents is null or p_cents < 0 then
    raise exception 'reserve_ai_budget: montant invalide';
  end if;
  select company_group_id into v_groupe from public.orgs where id = p_org;
  -- Un seul réservataire à la fois par groupe : c'est ce qui rend le plafond dur.
  perform pg_advisory_xact_lock(hashtext('lumi_budget:' || coalesce(v_groupe::text, p_org::text)));

  select coalesce(p.ai_monthly_budget_cents, 0), coalesce(p.includes_ai, false)
    into v_budget, v_includes
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
   where s.org_id in (select public.lumi_groupe_orgs(p_org))
     and s.status in ('active', 'trialing', 'past_due')
   order by s.created_at desc
   limit 1;

  if not v_includes then
    return jsonb_build_object('status', 'plan_sans_lumi', 'reservation_id', null, 'budget_cents', 0, 'spent_cents', 0, 'reserved_cents', 0);
  end if;

  select coalesce(sum(cost_cents), 0)
    into v_spent
    from public.ai_usage
   where org_id in (select public.lumi_groupe_orgs(p_org))
     and created_at >= date_trunc('month', now() at time zone 'America/Montreal') at time zone 'America/Montreal';
  select coalesce(sum(spent_proactive_cents), 0) into v_spent_pro
    from public.ai_usage_monthly
   where org_id in (select public.lumi_groupe_orgs(p_org)) and period = v_periode;
  select coalesce(sum(cents), 0), coalesce(sum(cents) filter (where is_proactive), 0)
    into v_reserved, v_reserved_pro
    from public.ai_reservations
   where org_id in (select public.lumi_groupe_orgs(p_org)) and period = v_periode and settled_at is null;

  if v_budget > 0 then
    if v_spent + v_reserved + p_cents > v_budget then
      return jsonb_build_object('status', 'capped', 'reservation_id', null, 'budget_cents', v_budget, 'spent_cents', v_spent, 'reserved_cents', v_reserved);
    end if;
    if p_proactive and v_spent_pro + v_reserved_pro + p_cents > v_budget * v_part_pro then
      return jsonb_build_object('status', 'capped', 'reservation_id', null, 'budget_cents', v_budget, 'spent_cents', v_spent, 'reserved_cents', v_reserved, 'proactive', true);
    end if;
    if v_spent + v_reserved + p_cents >= v_budget * 0.9 then v_status := 'restreint';
    elsif v_spent + v_reserved + p_cents >= v_budget * 0.7 then v_status := 'econome';
    else v_status := 'ok';
    end if;
  else
    v_status := 'ok';
  end if;

  insert into public.ai_reservations (org_id, period, cents, is_proactive)
  values (p_org, v_periode, p_cents, p_proactive)
  returning id into v_id;
  insert into public.ai_usage_monthly (org_id, period, reserved_cents)
  values (p_org, v_periode, p_cents)
  on conflict (org_id, period) do update
    set reserved_cents = public.ai_usage_monthly.reserved_cents + excluded.reserved_cents, updated_at = now();

  return jsonb_build_object('status', v_status, 'reservation_id', v_id, 'budget_cents', v_budget, 'spent_cents', v_spent, 'reserved_cents', v_reserved + p_cents);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.lumi_depense_du_mois(p_org uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(sum(cost_cents), 0)
    from public.ai_usage
   where org_id = p_org
     and created_at >= date_trunc('month', now() at time zone 'America/Montreal') at time zone 'America/Montreal';
$function$

;

CREATE OR REPLACE FUNCTION public.lumi_periode_courante()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select to_char(now() at time zone 'America/Montreal', 'YYYY-MM');
$function$

;

CREATE OR REPLACE FUNCTION public.settle_ai_budget(p_reservation uuid, p_cost numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r public.ai_reservations%rowtype;
begin
  select * into r from public.ai_reservations where id = p_reservation and settled_at is null for update;
  if not found then return; end if;   -- déjà réglée ou expirée : idempotent
  update public.ai_reservations set settled_at = now() where id = r.id;
  update public.ai_usage_monthly
     set reserved_cents = greatest(0, reserved_cents - r.cents),
         spent_cents = spent_cents + coalesce(p_cost, 0),
         spent_proactive_cents = spent_proactive_cents + case when r.is_proactive then coalesce(p_cost, 0) else 0 end,
         updated_at = now()
   where org_id = r.org_id and period = r.period;
end;
$function$

;

