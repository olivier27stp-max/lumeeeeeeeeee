-- S-02 (agent S, PROPOSÉE — appliquée à la pile LOCALE seulement)
-- Point 5 de la mission : « Historique des modifications de chaque automatisation : qui a modifié
-- quoi et quand (utilisateur ou Lumi) ». Constat D-20 : ni table, ni journal, ni écran — la seule
-- trace d'une modification était `automation_rules.updated_at`.
--
-- 1. La table `automation_rule_modifications` : une ligne par geste (création, modification,
--    publication, dépublication, corbeille, restauration, duplication), avec l'auteur, l'origine
--    (utilisateur, Lumi, système), les champs changés, un résumé lisible en français et en
--    anglais, et l'avant / l'après des SEULS champs changés.
--    QUI ÉCRIT : le serveur, par le rôle de service (`server/lib/automations-modifications.ts`,
--    `journaliserModification`). AUCUNE session d'utilisateur n'écrit : pas de policy
--    d'écriture, droits INSERT / UPDATE / DELETE révoqués à `anon` et `authenticated`, nommément.
--    QUI LIT : les membres qui ont « Voir les automatisations » (`automations.read`), dans le
--    bureau actif — les deux mêmes policies que `automation_execution_logs`.
--
-- 2. La purge : 12 mois, dans `run_retention_logs()` (cron `lume_retention_logs`, 04 h 20 UTC),
--    au même endroit et dans le même style que les journaux d'exécution (90 jours). Seule ligne
--    ajoutée à la fonction : la table de cette migration. AUCUNE autre durée ne change, aucune
--    donnée existante n'est supprimée (la table est neuve).
--
-- Non destructive, idempotente.
--
-- RETOUR ARRIÈRE :
--   -- 1. remettre `run_retention_logs()` sans la ligne `automation_rule_modifications`
--   --    (définition d'origine : supabase/migrations/20260910160000_scale_retention_logs.sql) ;
--   -- 2. drop table if exists public.automation_rule_modifications;

begin;

create table if not exists public.automation_rule_modifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  rule_id uuid not null,
  -- L'utilisateur qui a fait le geste, ou qui l'a demandé à Lumi. NULL : le système.
  auteur_id uuid,
  -- Son nom au moment du geste : l'historique reste lisible si le membre quitte le bureau.
  auteur_nom text,
  origine text not null,
  action text not null,
  champs text[] not null default '{}',
  resume_fr text not null,
  resume_en text not null,
  avant jsonb,
  apres jsonb,
  created_at timestamptz not null default now(),
  constraint automation_rule_modifications_origine_check
    check (origine in ('utilisateur', 'lumi', 'systeme')),
  constraint automation_rule_modifications_action_check
    check (action in ('creation', 'modification', 'publication', 'depublication', 'corbeille', 'restauration', 'duplication')),
  -- Même bureau que la règle ; l'historique part avec elle si elle est supprimée définitivement.
  constraint automation_rule_modifications_rule_same_org
    foreign key (org_id, rule_id) references public.automation_rules (org_id, id) on delete cascade
);

comment on table public.automation_rule_modifications is
  'Historique des modifications des automatisations : qui a changé quoi et quand (utilisateur, Lumi, système). Écrit par le serveur seulement (rôle de service). Gardé 12 mois (run_retention_logs).';

-- La lecture d'un écran : les modifications d'UNE automatisation, la plus récente d'abord.
create index if not exists idx_automation_rule_modifications_regle
  on public.automation_rule_modifications (org_id, rule_id, created_at desc);
-- La purge quotidienne (created_at < now() - 12 mois).
create index if not exists idx_automation_rule_modifications_created_at
  on public.automation_rule_modifications (created_at);

alter table public.automation_rule_modifications enable row level security;
alter table public.automation_rule_modifications force row level security;

drop policy if exists automation_rule_modifications_select_org on public.automation_rule_modifications;
create policy automation_rule_modifications_select_org
  on public.automation_rule_modifications
  for select to authenticated
  using (member_has_permission((select auth.uid()), org_id, 'automations.read'::text));

drop policy if exists bureau_actif on public.automation_rule_modifications;
create policy bureau_actif on public.automation_rule_modifications
  as restrictive to authenticated
  using ((select public.bureau_actif_demande()) is null or org_id is null or org_id = (select public.bureau_actif_demande()))
  with check ((select public.bureau_actif_demande()) is null or org_id is null or org_id = (select public.bureau_actif_demande()));

-- Aucune écriture par une session. Les droits par défaut de Supabase donnent TOUT à anon et
-- authenticated sur une table neuve : on retire tout, nommément, puis on rend la seule lecture.
revoke all on table public.automation_rule_modifications from public;
revoke all on table public.automation_rule_modifications from anon;
revoke all on table public.automation_rule_modifications from authenticated;
grant select on table public.automation_rule_modifications to authenticated;
grant all on table public.automation_rule_modifications to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- La purge : la fonction existante, à l'identique, avec UNE cible de plus.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.run_retention_logs()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v jsonb := '{}'::jsonb;
  n bigint;
  -- (table, colonne date, intervalle de rétention)
  cibles text[][] := array[
    ['automation_execution_logs', 'created_at', '90 days'],
    ['activity_log',              'created_at', '180 days'],
    ['login_history',             'created_at', '180 days'],
    ['security_events',           'created_at', '365 days'],
    ['webhook_deliveries',        'created_at', '30 days'],
    ['tracking_live_locations',   'updated_at', '7 days'],
    -- Historique des modifications des automatisations : 12 mois (décision du 2026-10-01).
    ['automation_rule_modifications', 'created_at', '365 days']
  ];
  c text[];
  total bigint;
begin
  foreach c slice 1 in array cibles loop
    total := 0;
    loop
      execute format(
        'with vieux as (select ctid from public.%I where %I < now() - interval %L order by %I limit 10000) '
        || 'delete from public.%I t using vieux where t.ctid = vieux.ctid',
        c[1], c[2], c[3], c[2], c[1]
      );
      get diagnostics n = row_count;
      total := total + n;
      exit when n < 10000;
    end loop;
    v := v || jsonb_build_object(c[1], total);
  end loop;

  -- notifications lues seulement (on garde les non-lues quel que soit l'âge)
  total := 0;
  loop
    with vieux as (
      select ctid from public.notifications
       where read_at is not null and created_at < now() - interval '90 days'
       order by created_at limit 10000
    )
    delete from public.notifications t using vieux where t.ctid = vieux.ctid;
    get diagnostics n = row_count;
    total := total + n;
    exit when n < 10000;
  end loop;
  v := v || jsonb_build_object('notifications', total);

  return v;
end $function$;

commit;
