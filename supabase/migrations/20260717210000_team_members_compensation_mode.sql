-- Mode de rémunération par membre : horaire, commission, ou les deux.
-- Piloté depuis la fiche membre (Équipe → Membres → Rémunération).
alter table public.team_members
  add column if not exists compensation_mode text not null default 'hourly';

alter table public.team_members
  drop constraint if exists team_members_compensation_mode_check;
alter table public.team_members
  add constraint team_members_compensation_mode_check
  check (compensation_mode in ('hourly', 'commission', 'both'));
