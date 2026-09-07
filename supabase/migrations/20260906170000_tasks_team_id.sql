-- ═══════════════════════════════════════════════════════════════
-- Assignation d'une tâche à une ÉQUIPE (en plus d'une personne)
-- ─────────────────────────────────────────────────────────────
-- Les tâches pouvaient déjà être attribuées à une personne
-- (assignee_user_id). On ajoute l'option « équipe entière », comme les
-- jobs. Les deux restent nullables et indépendants : une tâche peut viser
-- une personne, une équipe, ou personne.
--
-- team_id nullable, ON DELETE SET NULL : si l'équipe est supprimée, la tâche
-- reste, simplement désassignée.
alter table public.tasks
  add column if not exists team_id uuid references public.teams(id) on delete set null;

create index if not exists idx_tasks_team on public.tasks (team_id) where team_id is not null and deleted_at is null;

comment on column public.tasks.team_id is
  'Équipe assignée (optionnel). Complète assignee_user_id : une tâche peut viser une personne OU une équipe.';

-- La vue tasks_active est en SELECT * (migration 20260906145000) : elle expose
-- donc team_id automatiquement. On la recrée quand même par sécurité SI elle
-- listait encore ses colonnes en dur, TOUJOURS avec security_invoker (sinon
-- fuite RLS cross-tenant — cf. incident 2026-09-06).
create or replace view public.tasks_active
  with (security_invoker = true) as
  select * from public.tasks where deleted_at is null;
