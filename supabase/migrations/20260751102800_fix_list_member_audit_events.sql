-- ============================================================================
-- list_member_audit_events() etait inerte sous service_role
-- ============================================================================
--
-- Derniere fonctionnalite morte du meme motif que 20260751102400 et
-- 20260751102500 : une garde interne reposant sur auth.uid(), dans une
-- fonction appelee en service_role ou auth.uid() vaut NULL.
--
-- Ici la forme etait differente — d'ou son exclusion du correctif automatique
-- du 31 juillet, qui n'appariait que `if not has_org_*(auth.uid(), ...)`. La
-- fonction resolvait son org par une JOINTURE exigeant auth.uid() :
--
--     select m1.org_id into v_org
--       from memberships m1 join memberships m2 on m1.org_id = m2.org_id
--      where m1.user_id = auth.uid() ...
--
-- Sous service_role la jointure ne trouve rien, v_org reste NULL, et la
-- fonction levait « Not authorized » pour TOUT LE MONDE. L'historique d'audit
-- d'un membre etait donc inaccessible.
--
-- POURQUOI C'EST SUR — connexions verifiees :
--   server/routes/team-compliance.ts:170-175 valide DEJA, avant l'appel, que
--   la cible appartient a l'org de l'appelant (403 sinon) et que celui-ci est
--   admin/owner (403 sinon). Son commentaire nomme meme la cause :
--   « explicit — the RPC's auth.uid() check is NULL under service role ».
--   Aucun autre appelant, ni SQL ni applicatif.
--
-- Le chemin NAVIGATEUR reste garde a l'identique : auth.uid() y est renseigne,
-- la jointure d'origine s'applique donc pleinement.
--
-- REFUS EXPLICITE SI LA CIBLE EST DANS PLUSIEURS ORGS : on ne devine pas.
-- Servir les evenements de la mauvaise organisation serait une fuite. Aucun
-- utilisateur n'est dans ce cas aujourd'hui (verifie : max 1 org par
-- utilisateur sur 27), mais le schema l'autorise.
--
-- APPLIQUE EN PRODUCTION le 2026-07-31. Corps lu depuis pg_proc.prosrc.
-- Verifie par execution :
--   service_role                      -> 2 evenements retournes
--   authentifie non admin etranger    -> P0001 « Not authorized »
-- ROLLBACK : retirer le bloc `if v_org is null and auth.uid() is null`.
-- ============================================================================

create or replace function public.list_member_audit_events(p_user_id uuid, p_limit integer default 200)
returns setof audit_events
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $LUMEA$

declare v_org uuid;
begin
  -- Find an org where both caller and target are members
  select m1.org_id into v_org
    from public.memberships m1
    join public.memberships m2 on m1.org_id = m2.org_id
   where m1.user_id = auth.uid()
     and m2.user_id = p_user_id
     and public.has_org_admin_role(auth.uid(), m1.org_id)
   limit 1;
  -- Chemin serveur (service_role) : auth.uid() y est NULL, la jointure
  -- ci-dessus ne peut donc RIEN trouver et la fonction refusait tout le monde.
  -- La route team-compliance.ts:170-175 a deja verifie que la cible appartient
  -- a l'org de l'appelant ET que celui-ci est admin. On resout donc l'org
  -- depuis la cible seule.
  if v_org is null and auth.uid() is null then
    if (select count(distinct m.org_id) from public.memberships m
         where m.user_id = p_user_id) > 1 then
      -- On ne devine pas : servir les evenements de la mauvaise org serait une
      -- fuite. Le cas n'existe pas aujourd'hui, le schema l'autorise pourtant.
      raise exception 'Member belongs to several organizations — org is ambiguous'
        using errcode = '22023';
    end if;
    select m.org_id into v_org
      from public.memberships m
     where m.user_id = p_user_id
     limit 1;
  end if;
  if v_org is null then raise exception 'Not authorized'; end if;

  return query
    select * from public.audit_events
     where org_id = v_org
       and (actor_id = p_user_id or entity_id = p_user_id)
     order by created_at desc
     limit greatest(1, least(p_limit, 1000));
end $LUMEA$;
