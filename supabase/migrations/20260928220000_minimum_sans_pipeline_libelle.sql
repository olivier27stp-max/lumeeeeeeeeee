-- La liste de fonctions de Minimum promettait « Tasks & leads pipeline » alors
-- que le pipeline est réservé à Scale et Autopilot (includes_pipeline = faux).
-- Libellé corrigé : « Tasks & leads » (Rafba, 2026-09-25). Données seulement.

update public.plans
set features = (
  select jsonb_agg(case when f = '"Tasks & leads pipeline"'::jsonb then '"Tasks & leads"'::jsonb else f end order by n)
  from jsonb_array_elements(features) with ordinality as t(f, n)
)
where slug = 'starter'
  and jsonb_typeof(features) = 'array'
  and features ? 'Tasks & leads pipeline';
