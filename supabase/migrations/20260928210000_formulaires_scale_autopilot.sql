-- Annule 20260928200000 : le formulaire de demande reste réservé à Scale et
-- Autopilot (précision de Rafba, 2026-09-25 : « juste dans les 2 autres plans »).
-- Données seulement ; rejouable sans effet.

update public.plans
set includes_request_forms = (slug <> 'starter')
where includes_request_forms is distinct from (slug <> 'starter');

-- Retirer de Minimum.
update public.plans
set features = (
  select coalesce(jsonb_agg(f), '[]'::jsonb)
  from jsonb_array_elements(features) f
  where f <> '"Custom request forms"'::jsonb
)
where slug = 'starter'
  and jsonb_typeof(features) = 'array'
  and features ? 'Custom request forms';

-- Remettre dans Scale (une seule fois).
update public.plans
set features = features || '["Custom request forms"]'::jsonb
where slug = 'pro'
  and jsonb_typeof(features) = 'array'
  and not features ? 'Custom request forms';
