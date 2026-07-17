-- Profil : date de naissance du membre (affichée/éditée dans Paramètres → Profil).
alter table public.team_members
  add column if not exists birth_date date;
