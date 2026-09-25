-- Formulaire de demande dans TOUS les forfaits (décision de Rafba, 2026-09-25).
--
-- Jusqu'ici réservé à Scale et Autopilot (plans.includes_request_forms,
-- faux pour Minimum). Un formulaire de demande, c'est la porte d'entrée des
-- clients : le réserver aux forfaits supérieurs coupait les petits comptes de
-- leurs propres demandes.
--
-- Données seulement : le drapeau passe à vrai pour tous les forfaits, et la
-- ligne « Custom request forms » passe de la liste de Scale à celle de
-- Minimum (Scale et Autopilot héritent déjà de « Everything in Minimum »).
-- Aucune colonne ni policy touchée ; rejouable sans effet.

update public.plans
set includes_request_forms = true
where includes_request_forms is distinct from true;

-- Ajouter à Minimum (une seule fois).
update public.plans
set features = features || '["Custom request forms"]'::jsonb
where slug = 'starter'
  and jsonb_typeof(features) = 'array'
  and not features ? 'Custom request forms';

-- Retirer de Scale (déjà compris dans « Everything in Minimum »).
update public.plans
set features = (
  select coalesce(jsonb_agg(f), '[]'::jsonb)
  from jsonb_array_elements(features) f
  where f <> '"Custom request forms"'::jsonb
)
where slug = 'pro'
  and jsonb_typeof(features) = 'array'
  and features ? 'Custom request forms';
