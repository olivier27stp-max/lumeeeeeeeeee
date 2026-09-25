-- ═══════════════════════════════════════════════════════════════════════════
-- ISOLATION STRICTE ENTRE BUREAUX : la base connaît enfin le bureau sélectionné.
--
-- Constat (2026-09-24) : un compte membre de deux bureaux (Vision Lavage, Coquin
-- lavage) voyait dans l'un les factures et demandes de l'autre. La RLS n'a jamais
-- su quel bureau était affiché : has_org_membership() accepte TOUS les bureaux
-- du compte, et current_org_id() retombait sur la membership la plus ancienne.
--
-- Défense en base, indépendante du code :
--  1. bureau_actif_demande() lit l'en-tête HTTP `x-org-id` que PostgREST expose
--     dans current_setting('request.headers'). Le navigateur le pose sur chaque
--     requête (src/lib/supabase.ts) ; le serveur Express l'exige déjà.
--  2. acces_bureau(p_user, p_org) = membre ET (aucun en-tête OU en-tête = p_org).
--  3. Une policy RESTRICTIVE « bureau_actif » est posée sur CHAQUE table métier
--     portant org_id : elle s'ajoute (ET logique) aux policies existantes, quel
--     que soit leur style (has_org_membership(...) ou org_id in (select ...)).
--     Une lecture ou une écriture visant un autre bureau que celui de l'en-tête
--     ne renvoie rien / est refusée — même si une page oublie son filtre.
--  4. current_org_id() préfère l'en-tête (si membre) avant tout repli : les RPC
--     sans p_org et les colonnes `default current_org_id()` suivent le sélecteur.
--
-- Hors périmètre, volontairement (le sélecteur doit pouvoir lister les bureaux
-- et le catalogue reste partagé) : memberships, orgs, company_settings,
-- org_billing_settings, subscriptions, org_features, billing_profiles,
-- predefined_services (has_company_membership), invitations, org_knowledge.
-- Sans en-tête (app mobile, realtime, service_role) : comportement inchangé.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.bureau_actif_demande()
returns uuid
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_brut text;
begin
  begin
    v_brut := nullif(trim(current_setting('request.headers', true)::jsonb ->> 'x-org-id'), '');
  exception when others then
    return null; -- pas de contexte HTTP (cron, realtime, psql)
  end;
  if v_brut is null then
    return null;
  end if;
  begin
    return v_brut::uuid;
  exception when others then
    return null; -- en-tête mal formé = ignoré, jamais une erreur 500
  end;
end;
$$;

revoke all on function public.bureau_actif_demande() from public;
grant execute on function public.bureau_actif_demande() to authenticated, anon, service_role;

comment on function public.bureau_actif_demande() is
  'Bureau sélectionné par le client (en-tête HTTP x-org-id via PostgREST), ou null hors contexte HTTP.';

create or replace function public.acces_bureau(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_org_membership(p_user, p_org)
     and (public.bureau_actif_demande() is null or public.bureau_actif_demande() = p_org);
$$;

revoke all on function public.acces_bureau(uuid, uuid) from public;
grant execute on function public.acces_bureau(uuid, uuid) to authenticated, service_role;

comment on function public.acces_bureau(uuid, uuid) is
  'Membre du bureau ET bureau = celui de l''en-tête x-org-id quand il est présent.';

-- ── current_org_id() : l'en-tête d'abord, puis le claim JWT, puis le repli historique ──
create or replace function public.current_org_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_claim_org text;
  v_org uuid;
begin
  v_user := auth.uid();
  if v_user is null then
    return null;
  end if;

  -- 1. Bureau sélectionné dans l'application (en-tête x-org-id), si le compte en est membre.
  v_org := public.bureau_actif_demande();
  if v_org is not null and public.has_org_membership(v_user, v_org) then
    return v_org;
  end if;

  -- 2. Claim JWT explicite (jamais posé aujourd'hui, conservé pour compatibilité).
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

  -- 3. Repli historique : membership la plus ancienne (comptes à un seul bureau).
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
    execute 'select org_id from public.org_members where user_id = $1 order by created_at asc limit 1'
      into v_org using v_user;
    if v_org is not null then
      return v_org;
    end if;
  end if;

  return null;
end;
$$;

-- ── Policy RESTRICTIVE « bureau_actif » sur chaque table métier portant org_id ──
do $$
declare
  r record;
  v_expr text;
  v_exclues text[] := array[
    'memberships', 'orgs', 'company_settings', 'org_billing_settings', 'subscriptions',
    'org_features', 'billing_profiles', 'predefined_services', 'invitations', 'org_knowledge',
    'processed_checkout_sessions', 'billing_receipt_log'
  ];
begin
  for r in
    select c.table_name, c.data_type
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and c.column_name = 'org_id'
       and t.table_type = 'BASE TABLE'
       and c.table_name <> all (v_exclues)
     order by c.table_name
  loop
    if r.data_type = 'uuid' then
      v_expr := 'public.bureau_actif_demande() is null or org_id is null or org_id = public.bureau_actif_demande()';
    else
      v_expr := 'public.bureau_actif_demande() is null or org_id is null or org_id::text = public.bureau_actif_demande()::text';
    end if;
    execute format('drop policy if exists bureau_actif on public.%I', r.table_name);
    execute format(
      'create policy bureau_actif on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
      r.table_name, v_expr, v_expr
    );
  end loop;
end;
$$;
