-- Modèle personne — PHASE 1 : les données d'EMPLOI rejoignent memberships.
--
-- Strictement ADDITIF et réversible : on ajoute des colonnes et on recopie les
-- lignes de team_members. Rien n'est supprimé, team_members reste la source
-- que le code lit jusqu'à la phase 4 (repointage du code).
--
-- Séparation retenue :
--   • données d'EMPLOI (propres au couple personne↔organisation) → memberships
--   • données d'IDENTITÉ (téléphone, adresse, date de naissance)  → profiles,
--     dans une phase ultérieure : elles ne dépendent pas de l'organisation.
--
-- Note : `memberships.permissions_custom` est un BOOLÉEN (drapeau « permissions
-- personnalisées »), ce n'est PAS l'équivalent de `team_members.permissions`.
-- L'équivalent est `memberships.permissions` (jsonb), qui existe déjà.

begin;

alter table public.memberships
  add column if not exists hourly_rate_cents integer not null default 0,
  add column if not exists labour_cost_hourly numeric(10,2),
  add column if not exists compensation_mode text not null default 'hourly',
  add column if not exists working_hours jsonb not null default
    '{"friday": {"end": "17:00", "start": "08:00", "active": true}, "monday": {"end": "17:00", "start": "08:00", "active": true}, "sunday": {"end": "17:00", "start": "08:00", "active": false}, "tuesday": {"end": "17:00", "start": "08:00", "active": true}, "saturday": {"end": "17:00", "start": "08:00", "active": false}, "thursday": {"end": "17:00", "start": "08:00", "active": true}, "wednesday": {"end": "17:00", "start": "08:00", "active": true}}'::jsonb,
  add column if not exists communication_preferences jsonb not null default
    '{"errors": true, "system": true, "surveys": true, "invoice_reminders": true, "appointment_reminders": true}'::jsonb,
  add column if not exists suspended_at timestamptz,
  add column if not exists mfa_required boolean not null default false,
  add column if not exists password_reset_required boolean not null default false,
  add column if not exists last_login timestamptz;

-- Reprise des lignes existantes : uniquement celles rattachées à un compte
-- ET à une membership du même org (les seules migrables sans invention).
update public.memberships m
set hourly_rate_cents         = t.hourly_rate_cents,
    labour_cost_hourly        = t.labour_cost_hourly,
    compensation_mode         = t.compensation_mode,
    working_hours             = t.working_hours,
    communication_preferences = t.communication_preferences,
    suspended_at              = t.suspended_at,
    mfa_required              = t.mfa_required,
    password_reset_required   = t.password_reset_required,
    last_login                = t.last_login
from public.team_members t
where t.user_id = m.user_id
  and t.org_id  = m.org_id;

commit;
