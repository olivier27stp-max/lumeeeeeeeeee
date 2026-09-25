-- ═══════════════════════════════════════════════════════════════════
-- Lumi B3 — réservation atomique du budget IA (audit du 2026-09-16, §5.5)
-- ───────────────────────────────────────────────────────────────────
-- Problème : le plafond mensuel (plans.ai_monthly_budget_cents) était lu
-- AVANT chaque tour puis la dépense écrite APRÈS ; cinquante tours lancés en
-- même temps passaient tous la vérification et dépassaient le plafond.
-- Solution : avant chaque appel au modèle, le serveur RÉSERVE le coût maximal
-- estimé (reserve_ai_budget, sous verrou par groupe d'entreprises) ; après
-- l'appel il RÈGLE au coût réel (settle_ai_budget). Les réservations
-- orphelines (serveur tombé entre les deux) expirent après 5 min.
-- Les agrégats (ai_usage_monthly) ne sont écrits QUE par ces fonctions ;
-- la vérité reste ai_usage (une ligne par appel), inchangée.
-- Fonctions réservées à service_role : le serveur vérifie l'appartenance à
-- l'org avant (requireAuthedClient), aucun appel client direct n'est possible.
--
-- À appliquer : staging (npm run db:apply) puis prod (npm run db:apply:prod),
-- AVANT de fusionner le code qui appelle ces RPC (le serveur retombe sur
-- l'ancien comportement si elles manquent, mais check:schema-refs les exige).
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Tables ──
create table if not exists public.ai_reservations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  period       text not null,                       -- 'YYYY-MM', mois civil de Montréal
  cents        numeric(12,4) not null check (cents >= 0),
  is_proactive boolean not null default false,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create index if not exists idx_ai_reservations_ouvertes
  on public.ai_reservations (org_id, period) where settled_at is null;
comment on table public.ai_reservations is
  'Coût maximal réservé avant chaque appel au modèle Lumi ; réglé au coût réel après, ou expiré après 5 min.';

create table if not exists public.ai_usage_monthly (
  org_id                uuid not null references public.orgs(id) on delete cascade,
  period                text not null,
  reserved_cents        numeric(12,4) not null default 0,
  spent_cents           numeric(12,4) not null default 0,
  spent_proactive_cents numeric(12,4) not null default 0,
  updated_at            timestamptz not null default now(),
  primary key (org_id, period)
);
comment on table public.ai_usage_monthly is
  'Agrégat mensuel par org, écrit seulement par reserve_ai_budget / settle_ai_budget / expire_ai_reservations. La vérité par appel reste ai_usage.';

alter table public.ai_reservations enable row level security;
alter table public.ai_reservations force row level security;
alter table public.ai_usage_monthly enable row level security;
alter table public.ai_usage_monthly force row level security;

drop policy if exists "ai_reservations_service" on public.ai_reservations;
create policy "ai_reservations_service" on public.ai_reservations as permissive for all to service_role using (true) with check (true);
drop policy if exists "ai_usage_monthly_service" on public.ai_usage_monthly;
create policy "ai_usage_monthly_service" on public.ai_usage_monthly as permissive for all to service_role using (true) with check (true);
-- La jauge du propriétaire peut lire l'agrégat de SON org (même règle que ai_usage).
drop policy if exists "ai_usage_monthly_admin" on public.ai_usage_monthly;
create policy "ai_usage_monthly_admin" on public.ai_usage_monthly
  as permissive for select to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id));

revoke all on public.ai_reservations, public.ai_usage_monthly from anon, authenticated;
grant select on public.ai_usage_monthly to authenticated;

-- ── 2. Helpers ──
-- Période courante (mois civil de Montréal), la même règle que lumi_depense_du_mois.
create or replace function public.lumi_periode_courante()
returns text
language sql
stable
as $$
  select to_char(now() at time zone 'America/Montreal', 'YYYY-MM');
$$;

-- Les bureaux d'une compagnie (company_group_id) ; l'org seule sinon.
create or replace function public.lumi_groupe_orgs(p_org uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o2.id
    from public.orgs o1
    join public.orgs o2 on o2.company_group_id = o1.company_group_id
   where o1.id = p_org and o1.company_group_id is not null
  union
  select p_org;
$$;
revoke all on function public.lumi_periode_courante() from public, anon;
revoke all on function public.lumi_groupe_orgs(uuid) from public, anon, authenticated;
grant execute on function public.lumi_periode_courante() to authenticated, service_role;
grant execute on function public.lumi_groupe_orgs(uuid) to service_role;

-- ── 3. Réserver ──
-- Renvoie {status, reservation_id, budget_cents, spent_cents, reserved_cents}.
-- status : 'ok' | 'econome' (≥ 70 %) | 'restreint' (≥ 90 %) | 'capped' (dépasserait
-- le plafond : rien n'est réservé) | 'plan_sans_lumi'. Budget 0 = pas de plafond.
create or replace function public.reserve_ai_budget(p_org uuid, p_cents numeric, p_proactive boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

-- ── 4. Régler au coût réel ──
create or replace function public.settle_ai_budget(p_reservation uuid, p_cost numeric)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

-- ── 5. Expirer les réservations orphelines ──
create or replace function public.expire_ai_reservations(p_minutes integer default 5)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer := 0;
  r record;
begin
  for r in
    select id, org_id, period, cents from public.ai_reservations
     where settled_at is null and created_at < now() - make_interval(mins => greatest(1, p_minutes))
     for update skip locked
  loop
    update public.ai_reservations set settled_at = now() where id = r.id;
    update public.ai_usage_monthly
       set reserved_cents = greatest(0, reserved_cents - r.cents), updated_at = now()
     where org_id = r.org_id and period = r.period;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.reserve_ai_budget(uuid, numeric, boolean) from public, anon, authenticated;
revoke all on function public.settle_ai_budget(uuid, numeric) from public, anon, authenticated;
revoke all on function public.expire_ai_reservations(integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_budget(uuid, numeric, boolean) to service_role;
grant execute on function public.settle_ai_budget(uuid, numeric) to service_role;
grant execute on function public.expire_ai_reservations(integer) to service_role;

-- ── 6. Expiration toutes les 5 min (pg_cron, comme lume_retention_logs) ──
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'lumi_expire_reservations';
    perform cron.schedule('lumi_expire_reservations', '*/5 * * * *', 'select public.expire_ai_reservations(5)');
  end if;
end $$;
