-- M-02 (agent M, PROPOSÉE — non appliquée hors de la pile locale)
-- Constat B-14 : « Note ajoutée » et « Tâche terminée » ne partent que depuis UN écran.
--
--   · note.added n'est émis que par POST /api/activity-notes (le fil d'activité).
--     L'onglet Notes d'une fiche écrit `specific_notes` en direct, Lumi (`add_note`)
--     aussi : aucun événement.
--   · task.completed n'est émis que par un appel du NAVIGATEUR après l'écriture
--     (src/lib/tasksApi.ts → POST /api/automations/events/task-completed, « tire et
--     oublie »). Une tâche terminée par Lumi, ou un onglet fermé trop tôt : rien.
--
-- Même remède que pour les devis, factures, jobs et rendez-vous (migration
-- 20261003100000) : la base écrit l'événement dans `automation_evenements_base`,
-- dans la MÊME transaction que le geste. Le serveur le lit toutes les 15 s
-- (server/lib/evenementsBase.ts, qui remonte au CLIENT de la note ou de la tâche —
-- c'est lui l'entité de ces déclencheurs — et écarte l'événement que la route du
-- navigateur aurait déjà émis pour la même tâche).
--
-- Pas de boucle : l'action « Ajouter une note » du moteur écrit dans `notes`, pas
-- dans `specific_notes` ; aucune action du moteur ne termine une tâche.
-- `activity_notes` n'a PAS de trigger : sa route émet déjà, par l'outbox.
--
-- Non destructive : deux fonctions, deux triggers. Réversible (bloc DOWN à la fin).

BEGIN;

-- ── Tâche terminée ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_automation_evenements_tache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if new.status = 'done' and coalesce(old.status, '') <> 'done' and new.deleted_at is null then
    perform public.automation_consigner_evenement(
      new.org_id, 'task.completed', 'task', new.id,
      -- Une tâche rouverte puis terminée de nouveau redéclenche : la clé porte la transaction.
      'terminee:' || txid_current()::text,
      jsonb_build_object(
        'task_id', new.id, 'task_title', coalesce(new.title, ''),
        'linked_entity_type', new.linked_entity_type, 'linked_entity_id', new.linked_entity_id,
        'job_id', new.job_id, 'origine', 'base'),
      null, null);
  end if;
  return null;
end;
$$;
REVOKE ALL ON FUNCTION public.trg_automation_evenements_tache() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS automation_evenements_tache ON public.tasks;
CREATE TRIGGER automation_evenements_tache
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_automation_evenements_tache();

-- ── Note ajoutée (onglet Notes : specific_notes) ────────────────
CREATE OR REPLACE FUNCTION public.trg_automation_evenements_note()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  perform public.automation_consigner_evenement(
    new.org_id, 'note.added', new.entity_type, new.entity_id,
    'note:' || new.id::text,
    jsonb_build_object(
      'note_id', new.id, 'note_sur', new.entity_type,
      -- Borné, comme la route du fil d'activité : sert aux conditions.
      'texte', left(coalesce(new.text, ''), 500), 'origine', 'base'),
    null, null);
  return null;
end;
$$;
REVOKE ALL ON FUNCTION public.trg_automation_evenements_note() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS automation_evenements_note ON public.specific_notes;
CREATE TRIGGER automation_evenements_note
  AFTER INSERT ON public.specific_notes
  FOR EACH ROW EXECUTE FUNCTION public.trg_automation_evenements_note();

COMMIT;

-- DOWN
-- DROP TRIGGER IF EXISTS automation_evenements_note ON public.specific_notes;
-- DROP FUNCTION IF EXISTS public.trg_automation_evenements_note();
-- DROP TRIGGER IF EXISTS automation_evenements_tache ON public.tasks;
-- DROP FUNCTION IF EXISTS public.trg_automation_evenements_tache();
