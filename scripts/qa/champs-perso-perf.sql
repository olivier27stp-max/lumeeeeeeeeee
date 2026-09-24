-- Champs personnalisés v2 — performance du filtre pipeline (staging, transaction ANNULÉE).
-- 10 000 opportunités × 20 champs (200 000 valeurs), puis EXPLAIN ANALYZE de
-- cf_filtrer en rôle authenticated (RLS appliquée), avec 3 conditions.
-- Usage : node q.mjs -f scripts/qa/champs-perso-perf.sql
begin;

create temp table _p on commit drop as
select d.org_id, d.pipeline_id, d.stage_id, d.client_id,
       (select m.user_id from public.memberships m where m.org_id = d.org_id and m.role = 'owner' limit 1) as uid
  from public.deals d where d.deleted_at is null
   and exists (select 1 from public.memberships m where m.org_id = d.org_id and m.role = 'owner')
 limit 1;
grant select on _p to authenticated;

-- 20 champs : 8 nombres, 6 textes, 3 listes, 3 dates
insert into public.custom_fields (org_id, object_type, key, label, field_type)
select org_id, 'deal', '', 'Perf ' || g, (case when g <= 8 then 'number' when g <= 14 then 'single_line' when g <= 17 then 'dropdown_single' else 'date' end)::public.cf_field_type
  from _p, generate_series(1, 20) g;
insert into public.custom_field_options (org_id, field_id, label)
select f.org_id, f.id, 'Option ' || g from public.custom_fields f, generate_series(1, 4) g
 where f.label like 'Perf %' and f.field_type = 'dropdown_single' and f.org_id = (select org_id from _p);

-- 10 000 opportunités
create temp table _d on commit drop as
with n as (
  insert into public.deals (org_id, pipeline_id, stage_id, client_id, source, external_id)
  select org_id, pipeline_id, stage_id, client_id, 'import', 'perf-' || g from _p, generate_series(1, 10000) g
  returning id, org_id
) select * from n;

-- 200 000 valeurs
insert into public.custom_field_values (org_id, field_id, object_type, deal_id, value_number, value_text, value_option_id, value_date)
select d.org_id, f.id, 'deal', d.id,
       case when f.field_type = 'number' then (random() * 1000)::int end,
       case when f.field_type = 'single_line' then 'valeur ' || (random() * 500)::int end,
       case when f.field_type = 'dropdown_single' then (select o.id from public.custom_field_options o where o.field_id = f.id order by random() limit 1) end,
       case when f.field_type = 'date' then current_date - (random() * 365)::int end
  from _d d cross join public.custom_fields f
 where f.label like 'Perf %' and f.org_id = d.org_id;
analyze public.custom_field_values;
analyze public.deals;

create temp table _cond on commit drop as
select jsonb_build_array(
  jsonb_build_object('field_id', (select id from public.custom_fields where label = 'Perf 1' and org_id = (select org_id from _p)), 'op', 'gt', 'value', 500),
  jsonb_build_object('field_id', (select id from public.custom_fields where label = 'Perf 9' and org_id = (select org_id from _p)), 'op', 'contains', 'value', '12'),
  jsonb_build_object('field_id', (select id from public.custom_fields where label = 'Perf 18' and org_id = (select org_id from _p)), 'op', 'in_last', 'n', 3, 'unit', 'months')
) as c;
grant select on _cond to authenticated;

select set_config('request.jwt.claims', json_build_object('sub', (select uid from _p), 'role', 'authenticated')::text, true);
set local role authenticated;

explain (analyze, buffers, format text)
select count(*) from public.cf_filtrer((select org_id from _p), 'deal', (select c from _cond));

rollback;
