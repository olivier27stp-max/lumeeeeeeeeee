-- ============================================================================
-- PROPOSÉE — NE PAS APPLIQUER SANS L'OK DE RAFBA (audit commissions 2026-09-30)
-- Avant application en prod : dump complet de la prod.
-- Après : npm run check:broken-objects && npm run check:db-coherence
--         && npm run check:schema-refs && npm run qa:rls-roles
--
-- Loi 25 — commissions et taux sont des renseignements personnels. Constats
-- prouvés contre PostgREST avec un jeton de technicien (test
-- tests/commissions-audit/securite.test.ts) :
--   S-01 fs_commission_entries : tout membre lit les commissions de TOUS les
--        reps (branche show_peer_payouts, vraie par défaut), technicien compris.
--   S-02 fs_commission_rules : tout membre lit taux, paliers, bonus et la liste
--        des bénéficiaires de chaque plan.
--   S-03 les branches « owner/admin » ne vérifient pas memberships.status : un
--        admin suspendu garde la lecture.
--   S-04 commission_settings_modify : ALL pour tout membre (neutralisé
--        aujourd'hui seulement parce que authenticated n'a pas le GRANT).
--
-- Aucune page ne lit ces tables directement : tout passe par /api/commissions
-- (client service_role, portée « soi » pour un non-admin). Rien ne casse.
-- Conséquence produit : la visibilité entre collègues (show_peer_payouts)
-- n'a plus d'effet en base — elle n'en avait déjà aucun à l'écran. Décision D15.
-- ============================================================================
begin;

-- S-01 + S-03 : chacun ses commissions ; le propriétaire/admin ACTIF voit tout.
drop policy if exists fs_commission_entries_select on public.fs_commission_entries;
create policy fs_commission_entries_select on public.fs_commission_entries
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or org_id in (
      select m.org_id from public.memberships m
      where m.user_id = (select auth.uid()) and m.role in ('owner', 'admin') and coalesce(m.status, 'active') = 'active'
    )
  );

do $$
declare t text; op text;
begin
  -- S-03 sur les écritures (inchangées sinon) des deux tables.
  foreach t in array array['fs_commission_entries', 'fs_commission_rules'] loop
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_' || op, t);
    end loop;
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (org_id in (select m.org_id from public.memberships m
        where m.user_id = (select auth.uid()) and m.role in ('owner','admin') and coalesce(m.status, 'active') = 'active'))$p$, t || '_insert', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (org_id in (select m.org_id from public.memberships m
        where m.user_id = (select auth.uid()) and m.role in ('owner','admin') and coalesce(m.status, 'active') = 'active'))
      with check (org_id in (select m.org_id from public.memberships m
        where m.user_id = (select auth.uid()) and m.role in ('owner','admin') and coalesce(m.status, 'active') = 'active'))$p$, t || '_update', t);
    execute format($p$create policy %I on public.%I for delete to authenticated
      using (org_id in (select m.org_id from public.memberships m
        where m.user_id = (select auth.uid()) and m.role in ('owner','admin') and coalesce(m.status, 'active') = 'active'))$p$, t || '_delete', t);
  end loop;
end $$;

-- S-02 : un membre ne lit que SON plan (assigné, ou plan par défaut de l'org).
drop policy if exists fs_commission_rules_select on public.fs_commission_rules;
create policy fs_commission_rules_select on public.fs_commission_rules
  for select to authenticated
  using (
    org_id in (
      select m.org_id from public.memberships m
      where m.user_id = (select auth.uid()) and m.role in ('owner', 'admin') and coalesce(m.status, 'active') = 'active'
    )
    or (
      has_org_membership((select auth.uid()), org_id)
      and (
        (select auth.uid()) = any(assigned_user_ids)
        or id = (select cs.default_rule_id from public.commission_settings cs where cs.org_id = fs_commission_rules.org_id)
      )
    )
  );

-- S-04 : réglages modifiables par le propriétaire/admin actif seulement.
drop policy if exists commission_settings_modify on public.commission_settings;
create policy commission_settings_modify on public.commission_settings
  for all to authenticated
  using (org_id in (select m.org_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.role in ('owner','admin') and coalesce(m.status, 'active') = 'active'))
  with check (org_id in (select m.org_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.role in ('owner','admin') and coalesce(m.status, 'active') = 'active'));

-- Défaut Loi 25 pour les NOUVELLES entreprises (les existantes ne changent pas
-- de valeur — sans effet de toute façon après la politique ci-dessus).
alter table public.field_settings alter column show_peer_payouts set default false;

commit;
