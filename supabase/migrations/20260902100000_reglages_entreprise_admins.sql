-- ============================================================================
-- Les réglages de l'entreprise ne se modifient que par un propriétaire ou un
-- administrateur
-- ============================================================================
-- CONSTAT (2026-09-02, banc des rôles du robot de recette)
-- Une session ouverte sous le rôle `sales_rep` a modifié `company_settings`
-- sans le moindre refus. Or son préréglage n'accorde que `settings.read` :
--
--     sales_rep: pick([ … 'settings.read' … ])   ← lecture seule
--
-- POURQUOI ÇA PASSAIT
-- Les trois politiques d'écriture (`update`, `insert`, `delete`) ne filtrent
-- que par ORGANISATION : « es-tu membre ? ». Elles ne regardent pas le rôle.
-- Tout membre — vendeur comme technicien — pouvait donc changer le nom de
-- l'entreprise, son adresse, ses taxes, ses coordonnées.
--
-- EXPOSITION RÉELLE
--     prod : 33 owner, 6 sales_rep, 1 admin
-- Les six vendeurs ont aujourd'hui ce pouvoir. Un changement de taxes ou
-- d'adresse de facturation se répercute sur toutes les factures émises
-- ensuite : ce n'est pas une case cosmétique.
--
-- CE QUE FAIT CETTE MIGRATION
-- Les trois politiques d'écriture exigent désormais `owner` ou `admin`. La
-- LECTURE reste ouverte à tous les membres : un vendeur doit voir le nom et
-- l'adresse de l'entreprise pour ses devis.
--
-- `has_org_admin_role()` existe déjà et fait exactement ce contrôle : on la
-- réutilise plutôt que de réécrire la condition.
--
-- Idempotent.
-- ============================================================================

-- ── Modification ────────────────────────────────────────────────────
drop policy if exists company_settings_update_org on public.company_settings;
create policy company_settings_update_org on public.company_settings
  as permissive for update to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id))
  with check (public.has_org_admin_role((select auth.uid()), org_id));

-- ── Création ────────────────────────────────────────────────────────
drop policy if exists company_settings_insert_org on public.company_settings;
create policy company_settings_insert_org on public.company_settings
  as permissive for insert to authenticated
  with check (public.has_org_admin_role((select auth.uid()), org_id));

-- ── Suppression ─────────────────────────────────────────────────────
drop policy if exists company_settings_delete_org on public.company_settings;
create policy company_settings_delete_org on public.company_settings
  as permissive for delete to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id));

-- ── La lecture reste ouverte à tous les membres ─────────────────────
-- Un vendeur a besoin du nom et de l'adresse de l'entreprise pour ses devis.
-- Cette politique n'est PAS modifiée ; elle est rappelée ici pour que la
-- prochaine lecture de ce fichier n'ait pas de doute.

-- ── Vérification ────────────────────────────────────────────────────
do $$
declare
  n_ecriture int;
begin
  select count(*) into n_ecriture
    from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'company_settings'
     and p.polcmd in ('w', 'a', 'd')
     and pg_get_expr(coalesce(p.polqual, p.polwithcheck), p.polrelid) like '%has_org_admin_role%';

  if n_ecriture < 3 then
    raise exception 'Seules % politique(s) d''écriture exigent un rôle admin (3 attendues).', n_ecriture;
  end if;

  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     where c.relname = 'company_settings' and p.polcmd = 'r'
  ) then
    raise exception 'La politique de LECTURE a disparu — les vendeurs ne verraient plus le nom de leur entreprise.';
  end if;

  raise notice 'Réglages d''entreprise : écriture réservée aux propriétaires et administrateurs.';
end $$;
