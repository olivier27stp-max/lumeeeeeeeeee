-- ═══════════════════════════════════════════════════════════════
-- L'ancien registre des champs personnalisés s'en va
--
-- custom_columns / custom_column_values sont remplacées par les champs
-- personnalisés v2 (20260926100000, PR #541, en prod le 2026-09-24). Plus
-- aucun code ne les lit ni ne les écrit (vérifié : grep du dépôt, corps des
-- fonctions, vues et tâches cron de la prod — seule check_custom_field_orphans
-- les citait, et elle ne surveillait qu'elles).
--
-- Rien n'est perdu :
--   · les définitions ont été reprises dans custom_fields (legacy_column_id,
--     2 sur 2 en prod, toutes deux déjà supprimées → reprises archivées) ;
--   · aucune valeur n'a jamais existé (l'écriture échouait depuis 2026-07) ;
--   · une copie des deux tables est gardée dans le schéma archive, selon la
--     convention du projet (<table>_<date>).
-- custom_fields.legacy_column_id n'est pas une FK : rien ne dépend d'elles.
-- ═══════════════════════════════════════════════════════════════

begin;

set local lock_timeout = '5s';

-- Réexécutable : « create table if not exists … as table » évalue quand même
-- la source ; une fois les tables retirées, la copie ne se refait pas.
do $$ begin
  if to_regclass('public.custom_columns') is not null then
    create table if not exists archive.custom_columns_20260926 as table public.custom_columns;
  end if;
  if to_regclass('public.custom_column_values') is not null then
    create table if not exists archive.custom_column_values_20260926 as table public.custom_column_values;
  end if;
end $$;

revoke all on archive.custom_columns_20260926, archive.custom_column_values_20260926 from public, anon, authenticated;
-- Invariant check_rls_coverage : RLS activée ET forcée partout, archive compris ;
-- aucune policy = personne ne lit (deny-all, déclaré dans le commentaire).
alter table archive.custom_columns_20260926 enable row level security;
alter table archive.custom_columns_20260926 force row level security;
alter table archive.custom_column_values_20260926 enable row level security;
alter table archive.custom_column_values_20260926 force row level security;

comment on table archive.custom_columns_20260926 is
  'Copie de public.custom_columns au retrait de l''ancien registre (2026-09-26) — remplacé par public.custom_fields (legacy_column_id). RLS sans policy : deny-all volontaire.';
comment on table archive.custom_column_values_20260926 is
  'Copie de public.custom_column_values au retrait de l''ancien registre (2026-09-26) — vide : aucune valeur n''a jamais pu s''écrire. RLS sans policy : deny-all volontaire.';

-- check_all_invariants() (cron quotidien lume_invariant_checks) appelait
-- check_custom_field_orphans() : sans cette redéfinition, le cron tombait
-- chaque jour. Corps repris À L'IDENTIQUE de la prod (md5 5f082d19… le
-- 2026-09-24, identique en staging) ; seul le bloc custom_field_orphans change.
CREATE OR REPLACE FUNCTION public.check_all_invariants()
 RETURNS TABLE(check_name text, failures bigint, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  check_name := 'cross_tenant_references';
  select count(*), coalesce(string_agg(relation || '=' || violations, ', '), '')
    into failures, detail from public.check_cross_tenant_references();
  return next;

  check_name := 'invoice_totals_balance';
  select count(*), coalesce(string_agg(invoice_number, ', '), '')
    into failures, detail from public.check_invoice_totals_balance();
  return next;

  check_name := 'rls_coverage';
  select count(*), coalesce(string_agg(table_name, ', '), '')
    into failures, detail from public.check_rls_coverage();
  return next;

  check_name := 'invoice_numbering';
  select count(*), coalesce(string_agg(invoice_number, ', '), '')
    into failures, detail from public.check_invoice_numbering_invariant();
  return next;

  -- Champs personnalisés v2 (2026-09-26) : les orphelins sont impossibles
  -- (FK composites en cascade) ; ce contrôle reste en fil-piège — une valeur
  -- rattachée au champ d'une autre org ou d'un autre objet.
  check_name := 'custom_field_orphans';
  select count(*), coalesce(string_agg(v.id::text, ', '), '')
    into failures, detail
    from public.custom_field_values v
    join public.custom_fields f on f.id = v.field_id
   where f.org_id <> v.org_id or f.object_type <> v.object_type;
  return next;

  -- NOUVEAU — un cron en echec ne se voit nulle part ailleurs.
  check_name := 'failing_cron_jobs';
  select count(*), coalesce(string_agg(jobname, ', '), '')
    into failures, detail from public.check_failing_cron_jobs();
  return next;

  -- NOUVEAU — regression du moindre privilege sur les fonctions trigger.
  check_name := 'exposed_trigger_functions';
  select count(*), coalesce(string_agg(function_name, ', '), '')
    into failures, detail from public.check_exposed_trigger_functions();
  return next;
end $function$;
revoke all on function public.check_all_invariants() from public, anon, authenticated;
grant execute on function public.check_all_invariants() to service_role;

drop function if exists public.check_custom_field_orphans();
drop table if exists public.custom_column_values;
drop table if exists public.custom_columns;

comment on column public.custom_fields.legacy_column_id is
  'Id de la ligne d''origine dans l''ancien registre custom_columns (copie : archive.custom_columns_20260926). Trace de reprise, pas une FK.';

commit;
