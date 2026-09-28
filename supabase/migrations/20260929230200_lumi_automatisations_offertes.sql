-- Lumi construit les automatisations GRATUITEMENT, et s'en souvient.
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. OFFERT. « Construire avec Lumi » puisait dans le budget Lumi de
--    l'entreprise. Starter et Pro ont un budget de 0 : tous ceux qui n'ont pas
--    Autopilot recevaient « budget atteint », pour un appel Haiku d'environ
--    0,3 ¢. Décision du 2026-09-28 : c'est offert, sur tous les forfaits.
--    La dépense reste journalisée dans ai_usage sous la source
--    'automatisations' (notre coût reste mesuré), mais elle est EXCLUE du
--    budget du client : lumi_depense_du_mois et reserve_ai_budget la filtrent.
--    Le garde-fou anti-abus est un plafond d'appels par jour et par entreprise,
--    côté serveur (generer-parcours.ts, LUMI_AUTOMATISATIONS_PAR_JOUR).
--
-- 2. MÉMOIRE. La conversation avec Lumi vivait dans la page : fermer
--    l'éditeur l'effaçait, et Lumi oubliait ce qui avait été dit. Elle est
--    maintenant gardée avec l'automatisation (automation_rules.lumi_conversation).
--
-- reserve_ai_budget est recopiée de la prod (baseline du 2026-09-26) avec une
-- seule ligne en plus : le filtre sur la source.

begin;

alter table public.ai_usage drop constraint if exists ai_usage_source_check;
alter table public.ai_usage add constraint ai_usage_source_check
  check (source = any (array['lumi', 'support', 'migration', 'briefing', 'routeur', 'cache', 'automatisations']));

create or replace function public.lumi_depense_du_mois(p_org uuid) returns numeric
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select coalesce(sum(cost_cents), 0)
    from public.ai_usage
   where org_id = p_org
     and created_at >= date_trunc('month', now() at time zone 'America/Montreal') at time zone 'America/Montreal'
     and source <> 'automatisations';  -- offert au client (voir en-tête)
$$;

create or replace function public.reserve_ai_budget(p_org uuid, p_cents numeric, p_proactive boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
     and created_at >= date_trunc('month', now() at time zone 'America/Montreal') at time zone 'America/Montreal'
     and source <> 'automatisations';  -- offert au client (voir en-tête)
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
$$;

-- Droits : exactement ceux de la prod (create or replace les garde, on les
-- réaffirme pour qu'un rejeu sur une base neuve donne le même résultat).
revoke all on function public.lumi_depense_du_mois(uuid) from public, anon;
grant execute on function public.lumi_depense_du_mois(uuid) to authenticated, service_role;
revoke all on function public.reserve_ai_budget(uuid, numeric, boolean) from public, anon, authenticated;
grant execute on function public.reserve_ai_budget(uuid, numeric, boolean) to service_role;

alter table public.automation_rules
  add column if not exists lumi_conversation jsonb not null default '[]'::jsonb;
comment on column public.automation_rules.lumi_conversation is
  'Conversation avec Lumi qui a construit ce parcours ([{role, content}]), pour qu''il s''en souvienne à la réouverture. Bornée à 40 tours par le serveur.';

commit;
