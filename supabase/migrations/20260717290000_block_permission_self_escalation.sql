-- ═══════════════════════════════════════════════════════════════
-- SÉCURITÉ CRITIQUE : bloquer l'auto-escalade de privilèges.
--
-- Trou confirmé par test : le trigger enforce_membership_role_change ne
-- gardait QUE la colonne `role`. Un sales_rep pouvait donc modifier sa
-- propre ligne memberships et s'octroyer n'importe quelle `permissions`
-- (users.delete, financial.*, …) → pouvoirs d'admin en restant « rep ».
-- Idem `scope` (self → company = voir toutes les données de l'org).
--
-- Correctif : la garde couvre désormais role, permissions ET scope. Même
-- logique — auth.uid() null = service_role (serveur, de confiance) ;
-- personne ne modifie ses propres droits ; seuls owner/admin modifient
-- ceux des autres.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.enforce_membership_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sensitive_change boolean;
begin
  v_sensitive_change :=
       (new.role        is distinct from old.role)
    or (new.permissions is distinct from old.permissions)
    or (new.scope       is distinct from old.scope);

  if v_sensitive_change then
    -- Opérations serveur (service_role) : pas de session utilisateur.
    if auth.uid() is null then
      return new;
    end if;
    -- Personne ne modifie ses PROPRES droits (rôle, permissions ou portée).
    if auth.uid() = old.user_id then
      raise exception 'You cannot change your own role or permissions.' using errcode = '42501';
    end if;
    -- Seuls owner/admin modifient les droits des autres.
    if not public.has_org_admin_role(auth.uid(), new.org_id) then
      raise exception 'Only org owners or admins can change member roles or permissions.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
