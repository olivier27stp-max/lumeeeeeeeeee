-- ═══════════════════════════════════════════════════════════════
-- La fiche d'un deal accueille des notes et des tâches
--
-- Les fiches de Lume (client, job, devis) ont déjà des notes détaillées avec
-- pièces jointes (`specific_notes`) et un journal d'activité
-- (`ActivityTimeline`). Les composants React sont génériques : ils prennent
-- `entityType` + `entityId`. Rien à réécrire côté interface.
--
-- Mais la base refuse : une CHECK n'admet que 'client', 'job' et 'quote'.
-- Sans cette migration, écrire une note sur un deal échouerait — et comme
-- supabase-js ne lève pas d'exception, la note disparaîtrait en silence.
--
-- On ajoute donc 'deal' aux valeurs admises, sur les notes ET sur les tâches
-- (pour qu'une tâche puisse être rattachée à un deal du pipeline).
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Notes détaillées sur un deal
-- ───────────────────────────────────────────────────────────────
alter table public.specific_notes
  drop constraint if exists specific_notes_entity_type_check;

alter table public.specific_notes
  add constraint specific_notes_entity_type_check
  check (entity_type = any (array['client'::text, 'job'::text, 'quote'::text, 'deal'::text]));

comment on constraint specific_notes_entity_type_check on public.specific_notes is
  'Entités pouvant porter des notes détaillées. « deal » ajouté le 2026-09-23 pour le pipeline de ventes.';

-- Les notes d'un deal se lisent par (entity_type, entity_id) : sans index,
-- chaque ouverture de fiche parcourrait toute la table.
create index if not exists idx_specific_notes_entite
  on public.specific_notes (org_id, entity_type, entity_id, created_at desc);

-- ───────────────────────────────────────────────────────────────
-- 2. Tâches rattachées à un deal
-- ───────────────────────────────────────────────────────────────
-- La colonne s'appelle `linked_entity_type` (pas `entity_type`) : vérifié
-- dans le catalogue plutôt que supposé — la première version de cette
-- migration a échoué là-dessus.
--
-- Les valeurs existantes sont reprises telles quelles ('lead' compris, encore
-- utilisée par des tâches créées avant le pipeline) : les retirer casserait
-- les lignes déjà en base.
alter table public.tasks
  drop constraint if exists tasks_linked_entity_type_check;

alter table public.tasks
  add constraint tasks_linked_entity_type_check
  check (linked_entity_type = any (array[
    'client'::text, 'lead'::text, 'quote'::text, 'invoice'::text, 'job'::text, 'deal'::text
  ]));

comment on constraint tasks_linked_entity_type_check on public.tasks is
  'Entités auxquelles une tâche peut être rattachée. « deal » ajouté le 2026-09-23 pour le pipeline de ventes.';

create index if not exists idx_tasks_entite_liee
  on public.tasks (org_id, linked_entity_type, linked_entity_id)
  where linked_entity_id is not null;

commit;
