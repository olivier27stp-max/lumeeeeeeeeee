-- ═══════════════════════════════════════════════════════════════
-- Pipeline de ventes — moteur, file d'événements et forfait
-- (Phase 2, suite de 20260923100000 ; décisions Rafba 2026-09-23)
--
-- Trois choses distinctes, volontairement dans un seul fichier parce qu'elles
-- n'ont de sens qu'ensemble :
--
--   1. Le SCOPING des règles d'automatisation par pipeline et par étape.
--      `automation_rules.trigger_event` est un `text` LIBRE — aucun CHECK,
--      aucun enum (vérifié sur le schéma de prod du 2026-09-17). La base
--      accepte donc déjà `stage_entered` ; ce qui manquait, c'est de pouvoir
--      filtrer les règles SANS charger toutes celles de l'organisation.
--
--   2. La FILE D'ÉVÉNEMENTS (décision Q6). Aujourd'hui le bus est un
--      EventEmitter en mémoire : un changement d'étape fait par Lumi, un
--      import, le mobile ou du SQL n'émet RIEN, et un événement émis pendant
--      un redémarrage est perdu définitivement. Une table alimentée par
--      trigger règle les deux : peu importe l'origine, l'événement est écrit,
--      et le tick de 5 min le consomme. C'est aussi la réponse au point F9
--      de docs/audits/AUTOMATIONS_AUDIT.md.
--
--   3. Le DRAPEAU DE FORFAIT (décision Q8) : `includes_pipeline`, distinct de
--      `includes_automations` pour garder un levier de prix indépendant.
--
-- Ce fichier NE touche NI aux 461 règles existantes, NI à leur exécution :
-- les colonnes ajoutées sont nullables, et une règle sans `stage_id` se
-- comporte exactement comme avant.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Scoping des règles par étape de pipeline
-- ───────────────────────────────────────────────────────────────
alter table public.automation_rules
  add column if not exists pipeline_id uuid,
  add column if not exists stage_id    uuid;

-- FK composites : une règle ne peut pas viser l'étape d'une autre organisation.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'automation_rules_pipeline_same_org'
  ) then
    alter table public.automation_rules
      add constraint automation_rules_pipeline_same_org
      foreign key (org_id, pipeline_id)
      references public.pipelines_ventes (org_id, id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'automation_rules_stage_same_org'
  ) then
    alter table public.automation_rules
      add constraint automation_rules_stage_same_org
      foreign key (org_id, stage_id)
      references public.pipeline_stages (org_id, id) on delete cascade;
  end if;
end
$$;

-- Le matching actuel filtre sur (org_id, trigger_event, is_active). Cet index
-- ajoute l'étape pour que le moteur ne charge que les règles concernées.
create index if not exists idx_automation_rules_etape
  on public.automation_rules (org_id, stage_id, trigger_event)
  where is_active and stage_id is not null;

comment on column public.automation_rules.stage_id is
  'Étape du pipeline à laquelle la règle est attachée. NULL = règle globale (comportement historique, inchangé).';

-- ───────────────────────────────────────────────────────────────
-- 2. File d'événements du pipeline (Q6)
--    Écrite par trigger, consommée par le tick de 5 min du scheduler.
-- ───────────────────────────────────────────────────────────────
create table if not exists public.pipeline_events (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.orgs(id) on delete cascade,
  deal_id      uuid not null,
  type         text not null,
  payload      jsonb not null default '{}'::jsonb,
  -- Clé d'idempotence : le même événement ne s'exécute jamais deux fois.
  -- Elle inclut l'horodatage d'entrée en étape, pour qu'un deal qui RESSORT
  -- puis RENTRE dans une étape redéclenche bien ses actions.
  cle_unicite  text not null,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  attempts     integer not null default 0,
  last_error   text,
  constraint pipeline_events_type_connu
    check (type in ('deal.stage_entered', 'deal.stage_exited', 'deal.stage_idle')),
  constraint pipeline_events_deal_same_org
    foreign key (org_id, deal_id)
    references public.deals (org_id, id) on delete cascade
);

create unique index if not exists uq_pipeline_events_cle
  on public.pipeline_events (org_id, cle_unicite);

-- L'index du consommateur : les non-traités, par ordre d'arrivée.
create index if not exists idx_pipeline_events_a_traiter
  on public.pipeline_events (created_at)
  where processed_at is null;

alter table public.pipeline_events enable row level security;
alter table public.pipeline_events force row level security;

-- Lecture pour les membres (diagnostic) ; l'écriture est réservée aux
-- triggers SECURITY DEFINER et au serveur (service_role).
drop policy if exists pipeline_events_select_org on public.pipeline_events;
create policy pipeline_events_select_org on public.pipeline_events
  for select to authenticated
  using (has_org_membership((select auth.uid()), org_id));

comment on table public.pipeline_events is
  'File d''événements du pipeline, alimentée par trigger. Garantit qu''un changement d''étape déclenche ses actions quelle que soit son origine (UI, Lumi, import, SQL) et survive à un redémarrage — ce que le bus en mémoire ne fait pas.';

-- 2b. Le trigger qui remplit la file. Deux événements par mouvement :
--     la sortie de l'ancienne étape, puis l'entrée dans la nouvelle.
create or replace function public.deals_emettre_evenements()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE' and new.stage_id is not distinct from old.stage_id then
    return null;
  end if;

  if tg_op = 'UPDATE' and old.stage_id is not null then
    insert into public.pipeline_events (org_id, deal_id, type, payload, cle_unicite)
    values (
      new.org_id, new.id, 'deal.stage_exited',
      jsonb_build_object(
        'deal_id', new.id,
        'stage_id', old.stage_id,
        'to_stage_id', new.stage_id,
        'pipeline_id', new.pipeline_id,
        'source', new.source,
        'utm_campaign', new.utm_campaign,
        'assigned_user_id', new.assigned_user_id
      ),
      'exit:' || new.id::text || ':' || old.stage_id::text || ':'
        || extract(epoch from old.stage_entered_at)::bigint::text
    )
    on conflict (org_id, cle_unicite) do nothing;
  end if;

  insert into public.pipeline_events (org_id, deal_id, type, payload, cle_unicite)
  values (
    new.org_id, new.id, 'deal.stage_entered',
    jsonb_build_object(
      'deal_id', new.id,
      'stage_id', new.stage_id,
      'from_stage_id', case when tg_op = 'UPDATE' then old.stage_id else null end,
      'pipeline_id', new.pipeline_id,
      'source', new.source,
      'utm_campaign', new.utm_campaign,
      'assigned_user_id', new.assigned_user_id
    ),
    'enter:' || new.id::text || ':' || new.stage_id::text || ':'
      || extract(epoch from new.stage_entered_at)::bigint::text
  )
  on conflict (org_id, cle_unicite) do nothing;

  return null;
end;
$fn$;

drop trigger if exists trg_deals_emettre_evenements on public.deals;
create trigger trg_deals_emettre_evenements
  after insert or update of stage_id on public.deals
  for each row execute function public.deals_emettre_evenements();

-- 2c. Détection de stagnation (« stage_idle »). Appelée par le tick de 5 min.
--     Le déclencheur temporel n'existait nulle part : seul
--     `detectOverdueInvoices` était codé en dur dans le scheduler.
create or replace function public.pipeline_detecter_stagnation()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_insere integer := 0;
begin
  with candidats as (
    select
      d.org_id, d.id as deal_id, d.stage_id, d.pipeline_id,
      d.source, d.utm_campaign, d.assigned_user_id,
      r.id as rule_id,
      coalesce((r.conditions ->> 'idle_days')::integer, 7) as jours
    from public.deals d
    join public.pipeline_stages s
      on s.id = d.stage_id and s.org_id = d.org_id
    join public.automation_rules r
      on r.org_id = d.org_id
     and r.stage_id = d.stage_id
     and r.trigger_event = 'deal.stage_idle'
     and r.is_active
    where d.deleted_at is null
      and s.kind = 'open'
      and d.last_activity_at
          <= now() - make_interval(days => coalesce((r.conditions ->> 'idle_days')::integer, 7))
  ),
  inserees as (
    insert into public.pipeline_events (org_id, deal_id, type, payload, cle_unicite)
    select
      c.org_id, c.deal_id, 'deal.stage_idle',
      jsonb_build_object(
        'deal_id', c.deal_id, 'stage_id', c.stage_id, 'pipeline_id', c.pipeline_id,
        'source', c.source, 'utm_campaign', c.utm_campaign,
        'assigned_user_id', c.assigned_user_id, 'idle_days', c.jours,
        'rule_id', c.rule_id
      ),
      -- Une seule alerte de stagnation par règle et par passage en étape :
      -- sans l'horodatage d'entrée, le deal réalerterait à chaque tick.
      'idle:' || c.deal_id::text || ':' || c.rule_id::text || ':' || c.jours::text
    from candidats c
    on conflict (org_id, cle_unicite) do nothing
    returning 1
  )
  select count(*) into v_insere from inserees;

  return v_insere;
end;
$fn$;

revoke all on function public.pipeline_detecter_stagnation() from public, anon, authenticated;

comment on function public.pipeline_detecter_stagnation() is
  'Détecte les deals stagnants et remplit la file. Appelée par le tick de 5 min du scheduler. Idempotente : une alerte par règle et par passage en étape.';

-- ───────────────────────────────────────────────────────────────
-- 3. Forfait (Q8) — Scale (`pro`) et Autopilot, pas Minimum (`starter`)
-- ───────────────────────────────────────────────────────────────
alter table public.plans
  add column if not exists includes_pipeline boolean not null default false;

update public.plans set includes_pipeline = true,  updated_at = now() where slug in ('pro', 'autopilot');
update public.plans set includes_pipeline = false, updated_at = now() where slug = 'starter';

comment on column public.plans.includes_pipeline is
  'Accès au pipeline de ventes. Distinct de includes_automations pour garder un levier de prix indépendant (décision 2026-09-23).';

commit;
