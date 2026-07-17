-- ============================================================
-- Leaderboard roster : flag « Appear on sales leaderboard » par membre
-- ============================================================
--
-- Le leaderboard devient roster-based : tous les membres de l'org sauf les
-- techniciens y apparaissent, même à 0$ d'activité. Ce flag (activé par
-- défaut) permet de retirer quelqu'un du leaderboard depuis les settings du
-- team member (/settings/team/:memberId).
--
-- Le code serveur tolère l'absence de la colonne (tout le monde visible)
-- tant que cette migration n'est pas appliquée.

begin;

alter table public.memberships
  add column if not exists show_on_leaderboard boolean not null default true;

commit;
