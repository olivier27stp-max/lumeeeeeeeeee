-- Tighten fs_challenge_participants INSERT: prevent cross-tenant write.
--
-- The prior INSERT policy only checked `user_id = auth.uid()`, so a user could
-- insert a participant row referencing a challenge_id belonging to ANOTHER org
-- (cross-tenant pollution). The SELECT/UPDATE policies already scope
-- challenge_id to the caller's org via fs_challenges; the INSERT must too.

DROP POLICY IF EXISTS "fs_challenge_participants_insert" ON public.fs_challenge_participants;

CREATE POLICY "fs_challenge_participants_insert" ON public.fs_challenge_participants
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND challenge_id IN (
      SELECT id FROM public.fs_challenges
      WHERE org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
    )
  );
