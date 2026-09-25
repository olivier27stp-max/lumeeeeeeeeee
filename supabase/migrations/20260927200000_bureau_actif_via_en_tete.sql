-- RE-DATÉE le 2026-09-25 (ex-20260927120000) : commitée le 2026-09-24 mais
-- appliquée NULLE PART (migration fantôme, db:diff ne voit pas un fichier non
-- appliqué). Re-datée APRÈS 20260927180000 pour ne pas écraser le filtre de
-- statut de current_org_id(), et les policies lisent l'en-tête UNE fois par
-- requête ((select …) = initplan) au lieu d'une fois par ligne.
-- ═══════════════════════════════════════════════════════════════════════════
-- ISOLATION STRICTE ENTRE BUREAUX : la base connaît enfin le bureau sélectionné.
--
-- Constat (2026-09-24) : un compte membre de deux bureaux (Vision Lavage, Coquin
-- lavage) voyait dans l'un les factures et demandes de l'autre. La RLS n'a jamais
-- su quel bureau était affiché : has_org_membership() accepte TOUS les bureaux
-- du compte, et current_org_id() retombait sur la membership la plus ancienne.
--
-- Défense en base, indépendante du code :
--  1. bureau_actif_demande() lit l'en-tête HTTP que PostgREST expose dans
--     current_setting('request.headers') : `x-lume-org` (posé par le navigateur
--     sur chaque requête Supabase, src/lib/supabase.ts, SQL 20260926120000) ou,
--     à défaut, `x-org-id` (convention de l'API Express).
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
-- predefined_services (has_company_membership) et le journal de facturation.
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
    v_brut := coalesce(
      nullif(trim(current_setting('request.headers', true)::jsonb ->> 'x-lume-org'), ''),
      nullif(trim(current_setting('request.headers', true)::jsonb ->> 'x-org-id'), '')
    );
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
  'Bureau sélectionné par le client (en-tête HTTP x-lume-org, sinon x-org-id, via PostgREST), ou null hors contexte HTTP.';

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
  'Membre du bureau ET bureau = celui de l''en-tête x-lume-org / x-org-id quand il est présent.';

-- ── current_org_id() : l'en-tête d'abord, puis le claim JWT, puis le repli historique ──
-- Remplace le corps posé par 20260926120000 (même ordre, même repli) : la lecture de
-- l'en-tête passe par bureau_actif_demande() pour n'avoir qu'une seule définition.
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

  -- 1. Bureau sélectionné dans l'application (en-tête x-lume-org / x-org-id), si le compte en est membre.
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

  -- 3. Repli historique : adhésion ACTIVE la plus ancienne (comptes à un seul bureau).
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
$$;

comment on function public.current_org_id() is
  'Bureau courant : en-tête x-lume-org / x-org-id (bureau actif, adhésion vérifiée) → claim JWT org_id → plus ancienne adhésion → auth.uid().';

-- ── Policy RESTRICTIVE « bureau_actif » sur chaque table métier portant org_id ──
do $$
declare
  r record;
  v_expr text;
  v_exclues text[] := array[
    'memberships', 'orgs', 'company_settings', 'org_billing_settings', 'subscriptions',
    'org_features', 'billing_profiles', 'predefined_services',
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
      v_expr := '(select public.bureau_actif_demande()) is null or org_id is null or org_id = (select public.bureau_actif_demande())';
    else
      v_expr := '(select public.bureau_actif_demande()) is null or org_id is null or org_id::text = (select public.bureau_actif_demande())::text';
    end if;
    execute format('drop policy if exists bureau_actif on public.%I', r.table_name);
    execute format(
      'create policy bureau_actif on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
      r.table_name, v_expr, v_expr
    );
  end loop;
end;
$$;
