-- Champs personnalisés — refonte « comme GoHighLevel », PR 2 : valeur par défaut.
--
-- `default_value` : ce que la fenêtre de création pré-remplit pour ce champ
-- (le « Set default value » de GHL). Stockée telle que saisie : texte, nombre
-- (montant en cents), date AAAA-MM-JJ, ou LIBELLÉ d'option pour une liste
-- (les ids d'options n'existent pas encore quand on crée le champ). Rien n'est
-- écrit sur les fiches existantes : c'est un pré-remplissage, pas une valeur.
-- Additif ; les triggers existants de custom_fields ne lisent pas cette colonne.

alter table public.custom_fields
  add column if not exists default_value jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'custom_fields_default_value_type') then
    alter table public.custom_fields
      add constraint custom_fields_default_value_type
      check (default_value is null or jsonb_typeof(default_value) in ('string', 'number', 'array', 'boolean'));
  end if;
end $$;

comment on column public.custom_fields.default_value is
  'Pré-remplissage à la création d''une fiche (texte, nombre, date AAAA-MM-JJ, libellé d''option). N''écrit rien sur les fiches existantes.';

-- Variables {{client.type_de_toiture}} (format GoHighLevel, alias de
-- {client_cf_type_de_toiture}) : le rapport d'impact les reconnaît aussi, dans
-- les modèles ET dans le texte des automatisations, sinon on pourrait purger un
-- champ encore cité. Même corps qu'avant, seules les deux conditions changent ;
-- `create or replace` garde les droits (authenticated, service_role).
create or replace function public.cf_impact_champ(p_field uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  f public.custom_fields%rowtype;
  v_tag text;
  v_alias text;
begin
  select * into f from public.custom_fields where id = p_field;
  if not found then raise exception 'Champ introuvable.' using errcode = 'P0002'; end if;
  v_tag := f.object_type::text || '_cf_' || f.key;
  -- La clé ne contient que [a-z0-9_] (contrainte) : sûre dans une regex.
  v_alias := '\{\{\s*' || f.object_type::text || '\.' || f.key || '\s*\}\}';
  return jsonb_build_object(
    'valeurs', (select count(*) from public.custom_field_values v where v.field_id = p_field),
    'automatisations', (
      select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name)), '[]'::jsonb)
        from public.automation_rules r
       where r.org_id = f.org_id
         and ((coalesce(r.conditions::text, '') || coalesce(r.actions::text, '') || coalesce(r.steps::text, ''))
               like '%' || p_field::text || '%'
           or (coalesce(r.actions::text, '') || coalesce(r.steps::text, '')) like '%' || v_tag || '%'
           or (coalesce(r.actions::text, '') || coalesce(r.steps::text, '')) ~ v_alias)
    ),
    'modeles', (
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name)), '[]'::jsonb)
        from public.email_templates t
       where t.org_id = f.org_id
         and ((coalesce(t.subject, '') || coalesce(t.body, '')) like '%' || v_tag || '%'
           or (coalesce(t.subject, '') || coalesce(t.body, '')) ~ v_alias)
    ),
    'pipelines', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name)), '[]'::jsonb)
        from public.custom_field_pipeline_cards c
        join public.pipelines_ventes p on p.id = c.pipeline_id
       where c.field_id = p_field
    ),
    'formulaires', (
      select coalesce(jsonb_agg(jsonb_build_object('id', rf.id, 'name', rf.title)), '[]'::jsonb)
        from public.request_forms rf
       where rf.org_id = f.org_id and rf.deleted_at is null
         and jsonb_typeof(rf.custom_fields) = 'array'
         and exists (select 1 from jsonb_array_elements(rf.custom_fields) x where x->>'cf_field_id' = p_field::text)
    )
  );
end $$;
