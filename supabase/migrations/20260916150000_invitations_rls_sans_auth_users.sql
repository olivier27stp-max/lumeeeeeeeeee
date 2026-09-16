-- Invitations : les policies SELECT/UPDATE lisaient auth.users pour comparer
-- le courriel de l'invité. Le rôle `authenticated` n'a pas SELECT sur
-- auth.users : toute lecture d'invitations avec un JWT d'utilisateur échoue
-- (« permission denied for table users »). L'app n'y voit rien parce que ses
-- routes passent par service_role ; Lumi (JWT + RLS, règle du mandat) ne
-- pouvait ni lister, ni renvoyer, ni révoquer une invitation
-- (batterie des outils du 2026-09-16 : resend_invitation, revoke_invitation).
--
-- Correctif : le courriel vient du JWT (auth.jwt() ->> 'email'), sans toucher
-- auth.users. Même sens, même périmètre.
--
-- Appliquée sur staging puis en prod le 2026-09-16 (autorisation de Rafba), vérifiée.

begin;

drop policy if exists "invitations_select" on public.invitations;
create policy "invitations_select" on public.invitations
  for select using (
    public.has_org_membership((select auth.uid()), org_id)
    or email = (select auth.jwt() ->> 'email')
  );

drop policy if exists "invitations_update" on public.invitations;
create policy "invitations_update" on public.invitations
  for update using (
    public.has_org_membership((select auth.uid()), org_id)
    or email = (select auth.jwt() ->> 'email')
  ) with check (
    public.has_org_membership((select auth.uid()), org_id)
    or email = (select auth.jwt() ->> 'email')
  );

commit;
