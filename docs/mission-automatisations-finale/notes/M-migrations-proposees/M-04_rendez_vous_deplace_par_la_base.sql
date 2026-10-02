-- M-04 (agent M, PROPOSÉE — non appliquée hors de la pile locale)
-- Constat B-02 : un rendez-vous déplacé garde ses rappels à l'ancienne date.
--
-- Aujourd'hui, seul un appel du NAVIGATEUR replanifie (POST
-- /api/automations/events/appointment-rescheduled, « tire et oublie ») : une visite déplacée
-- par l'app mobile, par Lumi, par un import, ou un onglet fermé trop tôt, et le rappel
-- « c'est demain » reste calé sur l'ancienne date.
--
-- Le moteur revérifie maintenant la date à l'ÉCHÉANCE du rappel (sans migration : un rappel
-- dont la visite est déjà passée ne part plus, une visite repoussée reporte son rappel). Mais
-- une visite AVANCÉE a besoin que son rappel avance tout de suite — sinon, à l'ancienne
-- échéance, il est trop tard pour rappeler. D'où ce trigger : la base consigne le déplacement
-- dans `automation_evenements_base`, dans la même transaction ; le serveur le lit toutes les
-- 15 s et recale les rappels en attente de cette visite (server/lib/evenementsBase.ts →
-- `recalerRappelsDeVisite`). Rien n'est émis sur le bus : aucune confirmation ne repart.
--
-- Non destructive : une fonction, un trigger. Réversible (bloc DOWN à la fin).

BEGIN;

CREATE OR REPLACE FUNCTION public.trg_automation_evenements_visite_deplacee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if new.deleted_at is null
     and coalesce(new.status, 'scheduled') <> 'cancelled'
     and new.start_at is not null
     and new.start_at is distinct from old.start_at then
    perform public.automation_consigner_evenement(
      new.org_id, 'appointment.rescheduled', 'schedule_event', new.id,
      -- Une visite peut être déplacée plusieurs fois : la clé porte la transaction.
      'deplacement:' || txid_current()::text,
      jsonb_build_object('job_id', new.job_id, 'start_time', new.start_at, 'ancien_debut', old.start_at, 'origine', 'base'),
      case when new.job_id is null then null else 'job' end, new.job_id);
  end if;
  return null;
end;
$$;
REVOKE ALL ON FUNCTION public.trg_automation_evenements_visite_deplacee() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS automation_evenements_visite_deplacee ON public.schedule_events;
-- AFTER UPDATE (toute colonne) + condition : `start_at` peut être recalculé par un trigger BEFORE
-- (synchronisation des colonnes d'heure), que « UPDATE OF start_at » ne verrait pas.
CREATE TRIGGER automation_evenements_visite_deplacee
  AFTER UPDATE ON public.schedule_events
  FOR EACH ROW
  WHEN (old.start_at IS DISTINCT FROM new.start_at)
  EXECUTE FUNCTION public.trg_automation_evenements_visite_deplacee();

COMMIT;

-- DOWN
-- DROP TRIGGER IF EXISTS automation_evenements_visite_deplacee ON public.schedule_events;
-- DROP FUNCTION IF EXISTS public.trg_automation_evenements_visite_deplacee();
