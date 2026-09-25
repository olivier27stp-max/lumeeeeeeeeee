-- La RLS respecte enfin memberships.status : un membre retiré (suspended)
-- perd réellement l'accès aux données, immédiatement.
--
-- Constat du 2026-09-25 (prod) : « Retirer de l'équipe » met status =
-- 'suspended', mais aucune barrière ne lisait ce statut :
--   * has_org_membership(user, org) — 260 politiques — testait l'existence
--     de la ligne seulement (staging avait déjà le filtre, posé hors
--     migration : dérive signalée par db:diff, résorbée ici) ;
--   * custom_access_token_hook mettait toutes les orgs dans le claim, et
--     current_org_ids() lui faisait confiance ;
--   * ~165 politiques lisent memberships directement ;
--   * memberships_update_org laissait un membre modifier SA ligne, statut
--     compris : un suspendu pouvait se remettre « active » lui-même.
--
-- Correction à la source, sans réécrire 165 politiques :
--   1. fonctions d'accès : status = 'active' exigé ;
--   2. claim JWT : seulement les adhésions actives, et current_org_ids()
--      re-vérifie en base (un jeton émis avant la suspension ne vaut plus) ;
--   3. memberships a FORCE RLS : les politiques qui lisent memberships en
--      sous-requête passent par sa politique SELECT — qui ne montre plus à
--      un utilisateur ses propres lignes non actives ;
--   4. le statut devient un champ sensible (trigger de garde) : personne ne
--      change le sien, seuls owner/admin actifs changent celui des autres.
-- Aucune adhésion non active en prod aujourd'hui (14/14 actives) : aucun
-- utilisateur actuel ne perd d'accès.
-- CREATE OR REPLACE conserve les ACL existantes.

-- 1. Fonctions d'accès ─────────────────────────────────────────────

create or replace function public.has_org_membership(p_user uuid, p_org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.memberships m
     where m.user_id = p_user
       and m.org_id = p_org
       and coalesce(m.status, 'active') = 'active'
  );
$function$;

create or replace function public.has_org_admin_role(p_user uuid, p_org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_user
      and m.org_id = p_org
      and lower(coalesce(m.role, '')) in ('owner', 'admin')
      and coalesce(m.status, 'active') = 'active'
  );
$function$;

create or replace function public.has_org_role(p_user uuid, p_org uuid, p_roles text[])
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_exists boolean := false;
begin
  if p_user is null or p_org is null then
    return false;
  end if;

  if to_regclass('public.memberships') is not null then
    select exists (
      select 1
      from public.memberships m
      where m.user_id = p_user
        and m.org_id = p_org
        and m.role = any(p_roles)
        and coalesce(m.status, 'active') = 'active'
    ) into v_exists;
    if v_exists then return true; end if;
  end if;

  if to_regclass('public.org_memberships') is not null then
    execute $q$
      select exists(
        select 1 from public.org_memberships m
        where m.user_id = $1 and m.org_id = $2 and m.role = any($3)
      )
    $q$ into v_exists using p_user, p_org, p_roles;
    if v_exists then return true; end if;
  end if;

  if to_regclass('public.org_members') is not null then
    execute $q$
      select exists(
        select 1 from public.org_members m
        where m.user_id = $1 and m.org_id = $2 and m.role = any($3)
      )
    $q$ into v_exists using p_user, p_org, p_roles;
    if v_exists then return true; end if;
  end if;

  return false;
end;
$function$;

create or replace function public.verify_org_access(p_user_id uuid, p_org_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.memberships
     where user_id = p_user_id
       and org_id  = p_org_id
       and coalesce(status, 'active') = 'active'
  );
$function$;

-- 2. Jeton et bureau courant ────────────────────────────────────────

create or replace function public.current_org_ids()
 returns setof uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  claim_orgs jsonb;
begin
  -- Fast path : org_ids depuis le claim JWT (posé par custom_access_token_hook),
  -- re-vérifiés contre les adhésions ACTIVES : un jeton émis avant une
  -- suspension ne rouvre rien (clé primaire (user_id, org_id) → lookup direct).
  begin
    claim_orgs := auth.jwt() -> 'app_metadata' -> 'org_ids';
  exception when others then
    claim_orgs := null;
  end;
  if claim_orgs is not null and jsonb_typeof(claim_orgs) = 'array' and jsonb_array_length(claim_orgs) > 0 then
    return query
      select c.org_id
        from (select (jsonb_array_elements_text(claim_orgs))::uuid as org_id) c
       where exists (
         select 1 from public.memberships m
          where m.user_id = auth.uid()
            and m.org_id = c.org_id
            and coalesce(m.status, 'active') = 'active'
       );
    return;
  end if;
  -- Fallback (vieux token sans claim) : requête memberships. Aucun lockout.
  if to_regclass('public.memberships') is not null then
    return query select m.org_id from public.memberships m
      where m.user_id = auth.uid() and coalesce(m.status, 'active') = 'active';
  end if;
  return;
end;
$function$;

create or replace function public.custom_access_token_hook(event jsonb)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  claims jsonb;
  user_orgs uuid[];
begin
  -- Blindé : ne JAMAIS casser le login. Toute erreur => token inchangé.
  begin
    select array_agg(distinct m.org_id) into user_orgs
    from public.memberships m
    where m.user_id = (event->>'user_id')::uuid
      and coalesce(m.status, 'active') = 'active';

    claims := coalesce(event->'claims', '{}'::jsonb);
    if coalesce(claims->'app_metadata', 'null'::jsonb) = 'null'::jsonb then
      claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
    end if;
    if user_orgs is not null then
      claims := jsonb_set(claims, '{app_metadata,org_ids}', to_jsonb(user_orgs));
      claims := jsonb_set(claims, '{app_metadata,org_id}', to_jsonb(user_orgs[1]));
    else
      -- Plus aucune adhésion active : on retire les org_ids d'un ancien jeton.
      claims := claims #- '{app_metadata,org_ids}';
      claims := claims #- '{app_metadata,org_id}';
    end if;
    event := jsonb_set(event, '{claims}', claims);
  exception when others then
    null; -- on avale toute erreur, login jamais bloqué
  end;
  return event;
end;
$function$;

create or replace function public.current_org_id()
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_user uuid;
  v_header_org text;
  v_claim_org text;
  v_org uuid;
begin
  v_user := auth.uid();
  if v_user is null then
    return null;
  end if;

  -- 1. Bureau actif envoyé par le navigateur (en-tête x-lume-org), s'il en est membre.
  begin
    v_header_org := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-lume-org';
    if v_header_org is not null and v_header_org ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_org := v_header_org::uuid;
      if public.has_org_membership(v_user, v_org) then
        return v_org;
      end if;
    end if;
  exception when others then
    null;
  end;

  -- 2. Claim JWT (déploiements qui le posent).
  v_claim_org := nullif(current_setting('request.jwt.claim.org_id', true), '');
  if v_claim_org is not null then
    begin
      v_org := v_claim_org::uuid;
      if public.has_org_membership(v_user, v_org) then
        return v_org;
      end if;
    exception when others then
      null;
    end;
  end if;

  -- 3. Repli : plus ancienne adhésion ACTIVE (compte à un seul bureau = toujours juste).
  if to_regclass('public.memberships') is not null then
    select m.org_id
      into v_org
      from public.memberships m
     where m.user_id = v_user
       and coalesce(m.status, 'active') = 'active'
     order by m.created_at asc, m.org_id asc
     limit 1;
    if v_org is not null then
      return v_org;
    end if;
  end if;

  if to_regclass('public.org_members') is not null then
    select m.org_id
      into v_org
      from public.org_members m
     where m.user_id = v_user
     order by m.org_id asc
     limit 1;
    if v_org is not null then
      return v_org;
    end if;
  end if;

  return v_user;
end;
$function$;

-- Vérifications d'adhésion écrites en dur dans deux fonctions d'écriture.

create or replace function public.enforce_soft_delete_admin()
 returns trigger
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
BEGIN
  IF old.deleted_at IS NULL AND new.deleted_at IS NOT NULL THEN
    -- Allow service_role (no auth context)
    IF auth.uid() IS NULL THEN
      RETURN new;
    END IF;
    -- Allow any ACTIVE org member (not just admin/owner)
    IF EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND org_id = new.org_id
                AND coalesce(status, 'active') = 'active') THEN
      IF new.deleted_by IS NULL THEN
        new.deleted_by := auth.uid();
      END IF;
      RETURN new;
    END IF;
    RAISE EXCEPTION 'Only owner/admin can soft-delete records.' USING errcode = '42501';
  END IF;
  RETURN new;
END;
$function$;

create or replace function public.soft_delete_job(p_org_id uuid, p_job_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_now timestamptz := now();
  v_job int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND org_id = p_org_id
                                             AND coalesce(status, 'active') = 'active') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE jobs SET deleted_at = v_now, updated_at = v_now
  WHERE id = p_job_id AND org_id = p_org_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_job = ROW_COUNT;

  RETURN jsonb_build_object('job', v_job);
END;
$function$;

-- 3. Politiques de memberships (FORCE RLS : elles filtrent aussi les ────
--    sous-requêtes des ~165 politiques qui lisent memberships)

drop policy if exists memberships_select_own_org on public.memberships;
create policy memberships_select_own_org on public.memberships
  for select to authenticated
  using (
    has_org_membership((select auth.uid()), org_id)
    or ((user_id = (select auth.uid())) and coalesce(status, 'active') = 'active')
    or has_org_role((select auth.uid()), org_id, array['owner', 'admin'])
  );

drop policy if exists memberships_update_org on public.memberships;
create policy memberships_update_org on public.memberships
  for update to authenticated
  using (
    ((user_id = (select auth.uid())) and coalesce(status, 'active') = 'active')
    or has_org_admin_role((select auth.uid()), org_id)
  )
  with check (
    (user_id = (select auth.uid()))
    or has_org_admin_role((select auth.uid()), org_id)
  );

-- 4. Le statut devient un champ sensible ────────────────────────────

create or replace function public.enforce_membership_role_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_sensitive_change boolean;
begin
  v_sensitive_change :=
       (new.role        is distinct from old.role)
    or (new.permissions is distinct from old.permissions)
    or (new.scope       is distinct from old.scope)
    or (new.status      is distinct from old.status);

  if v_sensitive_change then
    -- Opérations serveur (service_role) : pas de session utilisateur.
    if auth.uid() is null then
      return new;
    end if;
    -- Personne ne modifie ses PROPRES droits (rôle, permissions, portée, statut).
    if auth.uid() = old.user_id then
      raise exception 'You cannot change your own role, permissions or status.' using errcode = '42501';
    end if;
    -- Seuls owner/admin (actifs) modifient les droits des autres.
    if not public.has_org_admin_role(auth.uid(), new.org_id) then
      raise exception 'Only org owners or admins can change member roles or permissions.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;
