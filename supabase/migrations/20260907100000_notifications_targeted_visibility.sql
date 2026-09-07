-- Notifications ciblées (2026-09-07)
--
-- Une notification avec user_id renseigné est adressée à UNE personne
-- (ex. « le client a ouvert votre devis » → owners, admins et vendeur
-- assigné, une ligne par destinataire). Jusqu'ici les politiques RLS
-- étaient purement org-scoped : n'importe quel membre voyait (et marquait
-- lues) les lignes adressées aux autres — le « tout marquer lu » du centre
-- d'activité ou de l'app mobile effaçait le non-lu des collègues.
--
-- Règle : user_id IS NULL = tout l'org ; sinon = ce user seulement, en
-- lecture comme en écriture. L'INSERT reste org-scoped (les inserts ciblés
-- passent par la clé service ou par ac_log_event, SECURITY DEFINER).
-- Realtime (postgres_changes) respecte ces politiques : un rep ne reçoit
-- plus l'événement d'une notification qui ne lui est pas adressée.

DROP POLICY IF EXISTS notifications_auth       ON public.notifications;
DROP POLICY IF EXISTS notifications_org        ON public.notifications;
DROP POLICY IF EXISTS notifications_select_org ON public.notifications;
DROP POLICY IF EXISTS notifications_update_org ON public.notifications;
DROP POLICY IF EXISTS notifications_delete_org ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_org ON public.notifications;

CREATE POLICY notifications_select_org ON public.notifications
  FOR SELECT TO authenticated
  USING (
    public.has_org_membership((SELECT auth.uid()), org_id)
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
  );

CREATE POLICY notifications_update_org ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    public.has_org_membership((SELECT auth.uid()), org_id)
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
  )
  WITH CHECK (
    public.has_org_membership((SELECT auth.uid()), org_id)
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
  );

CREATE POLICY notifications_delete_org ON public.notifications
  FOR DELETE TO authenticated
  USING (
    public.has_org_membership((SELECT auth.uid()), org_id)
    AND (user_id IS NULL OR user_id = (SELECT auth.uid()))
  );

CREATE POLICY notifications_insert_org ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.has_org_membership((SELECT auth.uid()), org_id));

COMMENT ON COLUMN public.notifications.user_id IS
  'Destinataire. NULL = tout l''org. Sinon visible/modifiable par ce user seulement (RLS) et poussé sur ses appareils seulement (fn_push_on_notification).';
