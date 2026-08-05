-- Modèle personne — PHASE 2 : la vue de lecture unique.
--
-- `v_org_members` = membership (la relation) ⋈ profiles (l'identité).
-- C'est le SEUL endroit que le code devrait lire pour afficher un membre :
-- plus besoin de choisir entre memberships.full_name, profiles.full_name,
-- team_members.first_name/last_name ou field_sales_reps.display_name.
--
-- ⚠️ security_invoker = on est OBLIGATOIRE. Sans lui, la vue s'exécute avec les
-- droits du propriétaire (postgres, qui contourne la RLS) et n'importe quel
-- utilisateur authentifié lirait les membres de TOUTES les organisations —
-- c'est exactement la fuite trouvée sur `properties_active` en juillet.
-- La RLS de `memberships` et de `profiles` s'applique donc normalement.

create or replace view public.v_org_members
with (security_invoker = on)
as
select
  m.org_id,
  m.user_id,
  -- Identité : profiles fait foi, memberships sert de repli tant que la
  -- duplication n'est pas retirée (phase 5).
  coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(m.full_name), '')) as full_name,
  coalesce(p.avatar_url, m.avatar_url)                                     as avatar_url,
  -- Relation
  m.role,
  m.status,
  m.scope,
  m.team_id,
  m.language,
  m.show_on_leaderboard,
  m.permissions,
  m.permissions_custom,
  -- Emploi (rapatrié depuis team_members en phase 1)
  m.hourly_rate_cents,
  m.labour_cost_hourly,
  m.compensation_mode,
  m.working_hours,
  m.communication_preferences,
  m.suspended_at,
  m.mfa_required,
  m.password_reset_required,
  m.last_login,
  m.created_at,
  m.updated_at
from public.memberships m
left join public.profiles p on p.id = m.user_id;

comment on view public.v_org_members is
  'Source de lecture unique pour les membres d''une organisation : relation (memberships) + identité (profiles). security_invoker = on : la RLS des tables sous-jacentes s''applique.';

revoke all on public.v_org_members from public;
grant select on public.v_org_members to authenticated, service_role;
