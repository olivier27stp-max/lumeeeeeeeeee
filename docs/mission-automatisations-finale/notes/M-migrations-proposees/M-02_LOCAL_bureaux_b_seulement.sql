-- Variante LOCALE de M-02 (pile `lumefinal-*` partagée entre agents) : mêmes fonctions,
-- mais les triggers ne tirent que pour les bureaux de test « (b) » de l'agent M, pour ne
-- pas changer le comportement des bureaux des autres agents pendant leurs passes.
-- NE PAS appliquer ailleurs : la migration à appliquer est M-02_evenements_note_et_tache_par_la_base.sql.
BEGIN;
DROP TRIGGER IF EXISTS automation_evenements_tache ON public.tasks;
CREATE TRIGGER automation_evenements_tache
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW
  WHEN (new.org_id IN ('3260a22f-ee98-48e0-9949-f03783dcf004', 'ed6e3d45-557c-46ed-a5e3-bb6a25aa4d1f'))
  EXECUTE FUNCTION public.trg_automation_evenements_tache();

DROP TRIGGER IF EXISTS automation_evenements_note ON public.specific_notes;
CREATE TRIGGER automation_evenements_note
  AFTER INSERT ON public.specific_notes
  FOR EACH ROW
  WHEN (new.org_id IN ('3260a22f-ee98-48e0-9949-f03783dcf004', 'ed6e3d45-557c-46ed-a5e3-bb6a25aa4d1f'))
  EXECUTE FUNCTION public.trg_automation_evenements_note();
COMMIT;
