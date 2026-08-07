-- Un représentant doit pouvoir modifier SES jobs. Jusqu'ici `jobs_update_org`
-- réservait toute modification aux propriétaires et aux admins : un rep ne
-- pouvait ni corriger le titre d'une job qu'il a vendue, ni la compléter.
--
-- Cette politique s'ajoute à l'existante (les politiques permissives se
-- cumulent en OU) : les admins gardent l'accès complet, les membres n'obtiennent
-- l'accès qu'aux jobs dont ils sont le vendeur, l'assigné ou le créateur.
--
-- Le WITH CHECK reprend la même condition : après modification la job doit
-- toujours appartenir à la personne et à son organisation. Un rep ne peut donc
-- pas se donner une job qui ne lui revient pas, ni la déplacer vers une autre
-- organisation.
DROP POLICY IF EXISTS jobs_update_own ON public.jobs;
CREATE POLICY jobs_update_own ON public.jobs
  FOR UPDATE
  USING (
    public.has_org_membership((SELECT auth.uid()), org_id)
    AND (
      salesperson_id = (SELECT auth.uid())
      OR assigned_user_id = (SELECT auth.uid())
      OR created_by = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    public.has_org_membership((SELECT auth.uid()), org_id)
    AND (
      salesperson_id = (SELECT auth.uid())
      OR assigned_user_id = (SELECT auth.uid())
      OR created_by = (SELECT auth.uid())
    )
  );
