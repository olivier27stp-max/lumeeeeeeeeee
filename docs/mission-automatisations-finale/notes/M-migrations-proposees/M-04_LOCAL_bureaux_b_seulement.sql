-- Variante LOCALE de M-04 (pile `lumefinal-*` partagée entre agents) : le trigger ne tire que pour
-- les bureaux de test « (b) » de l'agent M. NE PAS appliquer ailleurs.
BEGIN;
DROP TRIGGER IF EXISTS automation_evenements_visite_deplacee ON public.schedule_events;
CREATE TRIGGER automation_evenements_visite_deplacee
  AFTER UPDATE ON public.schedule_events
  FOR EACH ROW
  WHEN (old.start_at IS DISTINCT FROM new.start_at
        AND new.org_id IN ('3260a22f-ee98-48e0-9949-f03783dcf004', 'ed6e3d45-557c-46ed-a5e3-bb6a25aa4d1f'))
  EXECUTE FUNCTION public.trg_automation_evenements_visite_deplacee();
COMMIT;
