-- ═══════════════════════════════════════════════════════════════════════
-- Crédits Lumi rendus — approuvé par Rafba le 2026-09-30 (« oui rembourse »).
--
-- Pourquoi : des sessions de test ont consommé ~32 crédits sur le vrai compte
-- de Coquin lavage. Le grand livre `ai_usage` est en AJOUT SEUL (et doit le
-- rester : c'est le suivi de nos vrais coûts API) — on ne peut ni l'effacer
-- ni y écrire un coût négatif sans fausser nos dépenses.
--
-- Ce que ça fait :
--   1. lumi_credits_ajustements : crédits RENDUS à un bureau (motif, auteur,
--      date). Écriture serveur seulement ; aucune lecture client.
--   2. Les trois calculs de consommation soustraient les crédits rendus
--      pendant la période EN COURS (ils repartent à zéro au renouvellement,
--      comme les crédits) :
--        - lumi_credits_utilises  (ce que le client voit)
--        - lumi_depense_du_mois   (paliers 70/90/100 %, alerte exploitant)
--        - reserve_ai_budget      (plafond dur, réservation atomique)
--      Jamais sous zéro. `ai_usage` n'est pas touché.
-- ═══════════════════════════════════════════════════════════════════════
begin;

-- 1. Crédits rendus ──────────────────────────────────────────────────
create table if not exists public.lumi_credits_ajustements (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  credits_micro  bigint not null check (credits_micro > 0),
  motif          text not null check (length(btrim(motif)) > 0),
  cree_par       text not null check (length(btrim(cree_par)) > 0),
  created_at     timestamptz not null default now()
);
create index if not exists lumi_credits_ajustements_org_date
  on public.lumi_credits_ajustements (org_id, created_at);
comment on table public.lumi_credits_ajustements is
  'Crédits Lumi rendus à un bureau (geste commercial, consommation de test). Soustraits de la période en cours ; ai_usage reste le vrai coût.';

alter table public.lumi_credits_ajustements enable row level security;
alter table public.lumi_credits_ajustements force row level security;
revoke all on public.lumi_credits_ajustements from anon, authenticated;

-- Micro-crédits rendus au GROUPE (pool partagé) depuis le début de la période.
create or replace function public.lumi_credits_rendus_micro(p_org uuid)
 returns bigint language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select coalesce(sum(credits_micro), 0)::bigint
    from public.lumi_credits_ajustements
   where org_id in (select public.lumi_groupe_orgs(p_org))
     and created_at >= public.lumi_periode_debut(p_org);
$$;
revoke all on function public.lumi_credits_rendus_micro(uuid) from public, anon, authenticated;

-- 2a. Ce que le client voit ───────────────────────────────────────────
create or replace function public.lumi_credits_utilises(p_org uuid)
 returns bigint language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  -- Micro-crédits consommés par le GROUPE (pool partagé) depuis le début de la période,
  -- moins les crédits rendus sur la même période.
  select greatest(0, coalesce(sum(credits_micro), 0) - public.lumi_credits_rendus_micro(p_org))::bigint
    from public.ai_usage
   where org_id in (select public.lumi_groupe_orgs(p_org))
     and created_at >= public.lumi_periode_debut(p_org)
     and coalesce(source, 'lumi') <> 'support';
$$;

-- 2b. Dépense du mois (par bureau) ─────────────────────────────────────
create or replace function public.lumi_depense_du_mois(p_org uuid)
 returns numeric language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  -- Toujours en ¢ US de coût réel (usage interne) ; le client ne voit que des crédits.
  -- Crédits rendus À CE bureau sur la période : retirés au taux en vigueur.
  select greatest(0,
           coalesce(sum(cost_cents), 0)
           - coalesce((select sum(a.credits_micro)
                         from public.lumi_credits_ajustements a
                        where a.org_id = p_org
                          and a.created_at >= public.lumi_periode_debut(p_org)), 0)
             * public.lumi_cents_par_credit() / 1000000)
    from public.ai_usage
   where org_id = p_org
     and created_at >= public.lumi_periode_debut(p_org)
     and coalesce(source, 'lumi') <> 'support';
$$;

-- 2c. Plafond dur (réservation atomique) ──────────────────────────────
-- Identique à la version 20261005200000, sauf la dépense : moins les crédits rendus.
create or replace function public.reserve_ai_budget(p_org uuid, p_cents numeric, p_proactive boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
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
  -- Crédits rendus au groupe sur la période (2026-09-30) : jamais sous zéro.
  v_spent := greatest(0, v_spent - public.lumi_credits_rendus_micro(p_org) * public.lumi_cents_par_credit() / 1000000);
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

commit;
