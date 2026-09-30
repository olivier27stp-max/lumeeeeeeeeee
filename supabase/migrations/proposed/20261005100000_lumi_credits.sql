-- ═══════════════════════════════════════════════════════════════════════
-- PROPOSÉE — NE PAS APPLIQUER sans l'accord écrit de Rafba.
-- Mission « crédits Lumi », phase 1 (2026-09-30). Voir CREDITS_PLAN.md.
--
-- Ce que ça fait :
--   1. plans.lumi_credits_mensuels (Autopilot 1 000 ; Scale et Minimum 0).
--   2. lumi_credit_taux : 1 crédit = 3 ¢ US de coût réel, versionné.
--   3. ai_usage devient le grand livre : request_id (idempotence),
--      credits_micro (entier), taux_version ; ajout seul (UPDATE/DELETE refusés).
--   4. Période ANNIVERSAIRE : chaque mois au jour du début d'abonnement,
--      dans le fuseau du bureau (repli : 1er du mois, Montréal).
--   5. reserve_ai_budget / lumi_depense_du_mois en crédits ; le support
--      ne consomme rien (décision D3).
--   6. Plus aucun montant en $ lisible par un client : lecture directe de
--      ai_usage / ai_usage_monthly retirée à `authenticated` (le serveur
--      lit en service).
--
-- Le plafond reste le même mécanisme (réservation atomique, verrou par
-- groupe d'entreprises, paliers 70 / 90 / 100 %) — seule l'unité change.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- 1. Allocation en crédits ────────────────────────────────────────────
alter table public.plans
  add column if not exists lumi_credits_mensuels integer not null default 0;
alter table public.plans drop constraint if exists plans_lumi_credits_positifs;
alter table public.plans add constraint plans_lumi_credits_positifs check (lumi_credits_mensuels >= 0);
-- 45 $ × 30/45 = 30 $ de coût réel = 1 000 crédits. Scale et Minimum : 0 → 0.
update public.plans set lumi_credits_mensuels = 1000 where slug = 'autopilot';
comment on column public.plans.lumi_credits_mensuels is
  'Crédits Lumi inclus par période (1 crédit = lumi_cents_par_credit() ¢ US de coût réel). Remplace ai_monthly_budget_cents comme plafond.';

-- 2. Taux de conversion, versionné ───────────────────────────────────
create table if not exists public.lumi_credit_taux (
  version              text primary key,
  cents_us_par_credit  numeric not null check (cents_us_par_credit > 0),
  en_vigueur_le        timestamptz not null default now()
);
alter table public.lumi_credit_taux enable row level security;
insert into public.lumi_credit_taux (version, cents_us_par_credit, en_vigueur_le)
values ('2026-10', 3, '2026-10-01T00:00:00Z') on conflict (version) do nothing;

create or replace function public.lumi_cents_par_credit()
returns numeric language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select cents_us_par_credit from public.lumi_credit_taux order by en_vigueur_le desc limit 1
$$;

-- 3. Le grand livre : ai_usage ───────────────────────────────────────
alter table public.ai_usage
  add column if not exists request_id    text,
  add column if not exists credits_micro bigint,
  add column if not exists taux_version  text;
-- Un même appel au fournisseur (id de réponse) n'est débité qu'une fois.
create unique index if not exists ai_usage_requete_unique
  on public.ai_usage (org_id, request_id) where request_id is not null;

-- Rattrapage des lignes existantes (242 en prod au 2026-09-30), AVANT le verrou d'ajout seul.
update public.ai_usage
   set credits_micro = round(cost_cents * 1000000 / 3)::bigint, taux_version = '2026-10'
 where credits_micro is null;

create or replace function public.ai_usage_credits_avant_insert()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_taux numeric; v_version text;
begin
  select cents_us_par_credit, version into v_taux, v_version
    from public.lumi_credit_taux order by en_vigueur_le desc limit 1;
  new.credits_micro := round(coalesce(new.cost_cents, 0) * 1000000 / v_taux)::bigint;
  new.taux_version := v_version;
  return new;
end $$;
drop trigger if exists ai_usage_credits on public.ai_usage;
create trigger ai_usage_credits before insert on public.ai_usage
  for each row execute function public.ai_usage_credits_avant_insert();

create or replace function public.ai_usage_ajout_seul()
returns trigger language plpgsql as $$
begin
  raise exception 'ai_usage est un grand livre : ajout seulement (% refusé)', tg_op;
end $$;
drop trigger if exists ai_usage_ajout_seul on public.ai_usage;
create trigger ai_usage_ajout_seul before update or delete on public.ai_usage
  for each row execute function public.ai_usage_ajout_seul();

revoke all on function public.lumi_cents_par_credit() from public, anon, authenticated;
revoke all on function public.ai_usage_credits_avant_insert() from public, anon, authenticated;
revoke all on function public.ai_usage_ajout_seul() from public, anon, authenticated;

-- 6. Aucun $ lisible par un client ───────────────────────────────────
drop policy if exists ai_usage_admin on public.ai_usage;
drop policy if exists ai_usage_monthly_admin on public.ai_usage_monthly;
revoke select on public.ai_usage, public.ai_usage_monthly from anon, authenticated;

-- 4. Période anniversaire ────────────────────────────────────────────
create or replace function public.lumi_periode_debut(p_org uuid, p_a timestamptz default now())
returns timestamptz language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_ancre  timestamptz;
  v_fuseau text;
  v_local  timestamp;
  v_jour   int;
  v_debut  date;
  v_mois   date;
begin
  select s.current_period_start into v_ancre
    from public.subscriptions s
   where s.org_id in (select public.lumi_groupe_orgs(p_org))
     and s.status in ('active', 'trialing', 'past_due')
   order by s.created_at desc limit 1;
  select coalesce(nullif(btrim(timezone), ''), 'America/Montreal') into v_fuseau
    from public.company_settings where org_id = p_org;
  v_fuseau := coalesce(v_fuseau, 'America/Montreal');
  v_local := p_a at time zone v_fuseau;
  if v_ancre is null then
    return date_trunc('month', v_local) at time zone v_fuseau;   -- repli : mois civil
  end if;
  v_jour := extract(day from v_ancre at time zone v_fuseau)::int;
  -- Ce mois-ci au jour d'ancrage (borné au dernier jour du mois : ancre 31 → 30 avril) ;
  -- si pas encore atteint, le même jour du mois précédent.
  v_mois := date_trunc('month', v_local)::date;
  v_debut := v_mois + (least(v_jour, extract(day from (v_mois + interval '1 month - 1 day'))::int) - 1);
  if v_debut > v_local::date then
    v_mois := (v_mois - interval '1 month')::date;
    v_debut := v_mois + (least(v_jour, extract(day from (v_mois + interval '1 month - 1 day'))::int) - 1);
  end if;
  return v_debut::timestamp at time zone v_fuseau;
end $$;

create or replace function public.lumi_periode_courante(p_org uuid)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select to_char(public.lumi_periode_debut(p_org) at time zone 'UTC', 'YYYY-MM-DD')
$$;

-- 5. Dépense et réservation en crédits ───────────────────────────────
create or replace function public.lumi_depense_du_mois(p_org uuid)
 returns numeric language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  -- Toujours en ¢ US de coût réel (usage interne) ; le client ne voit que des crédits.
  select coalesce(sum(cost_cents), 0)
    from public.ai_usage
   where org_id = p_org
     and created_at >= public.lumi_periode_debut(p_org)
     and coalesce(source, 'lumi') <> 'support';
$$;

create or replace function public.lumi_credits_utilises(p_org uuid)
 returns bigint language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  -- Micro-crédits consommés par le GROUPE (pool partagé) depuis le début de la période.
  select coalesce(sum(credits_micro), 0)::bigint
    from public.ai_usage
   where org_id in (select public.lumi_groupe_orgs(p_org))
     and created_at >= public.lumi_periode_debut(p_org)
     and coalesce(source, 'lumi') <> 'support';
$$;

CREATE OR REPLACE FUNCTION public.reserve_ai_budget(p_org uuid, p_cents numeric, p_proactive boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_periode     text := public.lumi_periode_courante(p_org);
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

  select coalesce(p.lumi_credits_mensuels, 0) * public.lumi_cents_par_credit(), coalesce(p.includes_ai, false)
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
     and created_at >= public.lumi_periode_debut(p_org)
     and coalesce(source, 'lumi') <> 'support';   -- D3 : le support ne consomme pas de crédits
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
$function$;

revoke all on function public.lumi_periode_debut(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.lumi_periode_courante(uuid) from public, anon, authenticated;
revoke all on function public.lumi_credits_utilises(uuid) from public, anon, authenticated;
revoke all on function public.lumi_depense_du_mois(uuid) from public, anon, authenticated;
revoke all on function public.reserve_ai_budget(uuid, numeric, boolean) from public, anon, authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════════════
-- DOWN (dans cet ordre) :
--   drop trigger if exists ai_usage_ajout_seul on public.ai_usage;
--   drop trigger if exists ai_usage_credits on public.ai_usage;
--   drop function if exists public.ai_usage_ajout_seul(), public.ai_usage_credits_avant_insert(),
--     public.lumi_credits_utilises(uuid), public.lumi_periode_courante(uuid),
--     public.lumi_periode_debut(uuid, timestamptz), public.lumi_cents_par_credit();
--   -- recréer reserve_ai_budget et lumi_depense_du_mois tels qu'en prod au 2026-09-30
--   -- (définitions sauvegardées dans CREDITS_PLAN.md, annexe A)
--   create policy ai_usage_admin on public.ai_usage for select to authenticated using (has_org_admin_role((select auth.uid()), org_id));
--   create policy ai_usage_monthly_admin on public.ai_usage_monthly for select to authenticated using (has_org_admin_role((select auth.uid()), org_id));
--   grant select on public.ai_usage, public.ai_usage_monthly to authenticated;
--   drop index if exists public.ai_usage_requete_unique;
--   alter table public.ai_usage drop column if exists request_id, drop column if exists credits_micro, drop column if exists taux_version;
--   drop table if exists public.lumi_credit_taux;
--   alter table public.plans drop constraint if exists plans_lumi_credits_positifs, drop column if exists lumi_credits_mensuels;
-- ═══════════════════════════════════════════════════════════════════════
