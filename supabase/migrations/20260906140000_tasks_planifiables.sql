-- ═══════════════════════════════════════════════════════════════
-- Tâches planifiables dans le calendrier
-- ─────────────────────────────────────────────────────────────
-- Aujourd'hui une tâche n'a qu'une `due_date` (une date, sans heure) : elle ne
-- peut pas s'afficher comme un bloc horaire dans le calendrier, au contraire
-- d'une job.
--
-- On ajoute une heure OPTIONNELLE :
--   • scheduled_at NULL      → tâche « à faire ce jour-là » (comportement actuel,
--                              rangée dans la liste du jour via due_date) ;
--   • scheduled_at renseigné → tâche placée à une heure précise, affichée comme
--                              un bloc dans le calendrier, comme une job.
-- duration_minutes donne la hauteur du bloc ; NULL = simple marqueur ponctuel.
--
-- Nullable, aucun défaut : les tâches existantes restent inchangées.
alter table public.tasks
  add column if not exists scheduled_at timestamptz,
  add column if not exists duration_minutes integer;

-- Une durée, si fournie, doit être positive et raisonnable (max 24 h).
alter table public.tasks
  drop constraint if exists tasks_duration_minutes_check;
alter table public.tasks
  add constraint tasks_duration_minutes_check
  check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 1440));

-- Index pour la requête calendrier « tâches planifiées d'un org sur une plage ».
create index if not exists idx_tasks_org_scheduled
  on public.tasks (org_id, scheduled_at)
  where scheduled_at is not null and deleted_at is null;

comment on column public.tasks.scheduled_at is
  'Heure précise optionnelle. NULL = tâche à échéance (due_date) sans heure. Renseigné = bloc horaire dans le calendrier.';
comment on column public.tasks.duration_minutes is
  'Durée du bloc en minutes (calendrier). NULL = marqueur ponctuel. Utilisé seulement quand scheduled_at est renseigné.';

-- La vue tasks_active listait ses colonnes en dur : elle n'exposait donc PAS
-- scheduled_at / duration_minutes, et toute lecture de ces colonnes via la vue
-- échouait (PostgREST : une colonne absente fait échouer TOUTE la requête).
-- On la recrée en SELECT * pour qu'elle suive désormais la table.
create or replace view public.tasks_active as
  select * from public.tasks where deleted_at is null;
