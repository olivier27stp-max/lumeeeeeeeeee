-- ============================================================================
-- N2.6 / N2.8 — Champs personnalises : integrite du stockage EAV
-- ============================================================================
-- CORRECTION D'UN CONSTAT D'AUDIT INITIAL :
-- L'audit annoncait « aucun unique sur (column_id, record_id) ». C'est FAUX :
-- l'index custom_column_values_record_col_uniq existe. Il n'apparaissait pas
-- dans pg_constraint parce que c'est un index et non une contrainte.
--
-- LES VRAIS DEFAUTS RESTANTS :
--   1. record_id pointe vers clients | jobs | invoices selon custom_columns.entity,
--      sans aucune FK possible (polymorphe, N2.8) -> orphelins garantis.
--   2. L'unique n'est pas scopee au tenant (N3.2).
--   3. Aucune coherence entre custom_columns.col_type et la colonne value_*
--      reellement remplie : un champ « number » peut stocker du texte.
--   4. Rien n'empeche une valeur de pointer un column_id d'une AUTRE org.
--
-- CHOIX ASSUME : on NE migre PAS vers `custom jsonb` malgre la recommandation
-- N2.6. La table est vide (0 ligne) et le registre ne contient que 2 colonnes
-- supprimees, donc la migration serait gratuite — mais le code applicatif
-- (src/) lit la forme EAV. Reecrire ce code depasse le cadre « corriger la DB »
-- et se ferait sans filet de test. On rend donc l'EAV existant INTEGRE.
-- La bascule vers jsonb reste souhaitable ; elle est documentee ci-dessous.
-- ============================================================================

set lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1. Unique scopee au tenant (N3.2)
-- ----------------------------------------------------------------------------
drop index if exists public.custom_column_values_record_col_uniq;
create unique index if not exists custom_column_values_org_col_record_uniq
  on public.custom_column_values (org_id, column_id, record_id);

-- ----------------------------------------------------------------------------
-- 2. FK composite : une valeur ne peut pas referencer la definition d'une
--    autre org (N3.3). Necessite unique (org_id, id) sur le registre.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.custom_columns'::regclass
       and contype = 'u'
       and (select array_agg(a.attname::text order by a.attname::text)
              from unnest(conkey) k
              join pg_attribute a on a.attrelid = conrelid and a.attnum = k) = array['id','org_id']::text[]
  ) then
    alter table public.custom_columns
      add constraint custom_columns_org_id_id_uq unique (org_id, id);
  end if;
end $$;

alter table public.custom_column_values
  drop constraint if exists custom_column_values_column_same_org;

alter table public.custom_column_values
  add constraint custom_column_values_column_same_org
  foreign key (org_id, column_id)
  references public.custom_columns (org_id, id)
  on delete cascade
  not valid;

alter table public.custom_column_values
  validate constraint custom_column_values_column_same_org;

-- ----------------------------------------------------------------------------
-- 3. Coherence type declare <-> colonne value_* remplie
--    Exactement une colonne de valeur doit etre renseignee, et elle doit
--    correspondre au col_type du registre.
-- ----------------------------------------------------------------------------
alter table public.custom_column_values
  drop constraint if exists custom_column_values_exactly_one_value;

alter table public.custom_column_values
  add constraint custom_column_values_exactly_one_value
  check (
    (case when value_text    is not null then 1 else 0 end)
  + (case when value_number  is not null then 1 else 0 end)
  + (case when value_boolean is not null then 1 else 0 end)
  + (case when value_date    is not null then 1 else 0 end)
  + (case when value_json    is not null then 1 else 0 end)
    <= 1
  )
  not valid;

alter table public.custom_column_values
  validate constraint custom_column_values_exactly_one_value;

-- ----------------------------------------------------------------------------
-- 4. Orphelins polymorphes (N2.8) : aucune FK n'est possible sur record_id.
--    On assume le polymorphe MAIS avec un moyen de detecter les orphelins,
--    plutot que de faire semblant qu'ils n'existent pas.
-- ----------------------------------------------------------------------------
create or replace function public.check_custom_field_orphans()
returns table (value_id uuid, org_id uuid, entity text, record_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select v.id, v.org_id, c.entity, v.record_id
    from public.custom_column_values v
    join public.custom_columns c on c.id = v.column_id
   where (c.entity = 'clients'
          and not exists (select 1 from public.clients t where t.id = v.record_id))
      or (c.entity = 'jobs'
          and not exists (select 1 from public.jobs t where t.id = v.record_id))
      or (c.entity = 'invoices'
          and not exists (select 1 from public.invoices t where t.id = v.record_id));
$$;

revoke all on function public.check_custom_field_orphans() from public, anon, authenticated;

comment on function public.check_custom_field_orphans() is
  'N2.8 — record_id est polymorphe (clients|jobs|invoices) donc sans FK possible. '
  'Cette fonction detecte les orphelins. A executer en cron avec purge. '
  'Doit retourner 0 ligne.';

comment on table public.custom_column_values is
  'Stockage EAV des champs personnalises. N2.6 recommande une colonne '
  '`custom jsonb` sur l''entite plutot que ce modele. Migration non faite car '
  'le code applicatif (src/) lit la forme EAV. Integrite renforcee a defaut : '
  'unique scopee org, FK composite vers le registre, une seule value_* remplie.';
