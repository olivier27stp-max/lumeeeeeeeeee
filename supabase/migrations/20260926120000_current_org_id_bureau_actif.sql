-- current_org_id() honore le BUREAU ACTIF du navigateur.
--
-- Constat (Vision Lavage, 2026-09-24) : un compte propriétaire de deux bureaux
-- (Vision Lavage + Coquin lavage) voyait 15 factures au lieu de 645, et
-- rpc_create_invoice_draft aurait refusé ses clients (« Client does not belong
-- to your organization »). Cause : sans claim JWT, current_org_id() retombe sur
-- la PLUS ANCIENNE adhésion de l'utilisateur, alors que le navigateur, lui,
-- travaille dans le bureau choisi (localStorage « lume-active-org »).
--
-- Le client Supabase du navigateur envoie désormais ce bureau dans l'en-tête
-- HTTP `x-lume-org` (src/lib/supabase.ts). PostgREST expose les en-têtes dans
-- le paramètre `request.headers` (JSON, clés en minuscules) : on le lit ici en
-- premier, après vérification de l'adhésion — un en-tête forgé vers un bureau
-- dont on n'est pas membre est simplement ignoré. Le reste du corps est
-- inchangé (20260302210000_crm_core.sql).
create or replace function public.current_org_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
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

  -- 3. Repli : plus ancienne adhésion (compte à un seul bureau = toujours juste).
  if to_regclass('public.memberships') is not null then
    select m.org_id
      into v_org
      from public.memberships m
     where m.user_id = v_user
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
$$;

comment on function public.current_org_id() is
  'Bureau courant : en-tête x-lume-org (bureau actif du navigateur, adhésion vérifiée) → claim JWT org_id → plus ancienne adhésion → auth.uid().';
