-- ============================================================
-- SCALING — org_id dans les claims JWT (élimine le hit `memberships` par requête)
-- ------------------------------------------------------------
-- Appliqué + vérifié en prod le 2026-07-08 (test:rls passe, les 2 chemins OK).
--
-- 1) `custom_access_token_hook` : à chaque émission de token, ajoute
--    app_metadata.org_ids (+ org_id primaire). Blindé : toute erreur => token
--    inchangé, le login ne peut jamais casser. À ACTIVER dans le dashboard
--    (Authentication → Hooks → Custom Access Token → Postgres → cette fonction).
-- 2) `current_org_ids()` (appelée par has_org_membership → 240 policies) :
--    fast-path via le claim JWT, FALLBACK sur `memberships` si le token n'a pas
--    encore le claim (vieux tokens) → zéro lockout pendant la transition.
--
-- ⚠️ Tradeoff : les changements d'appartenance (ajout/retrait d'un membre à un
-- org) ne sont plus instantanés côté RLS pour un token déjà émis — ils prennent
-- effet au refresh du token (~1h) ou à la reconnexion. Standard pour du JWT.
-- Réversible : re-CREATE current_org_ids() sans le fast-path (voir bas).
-- ============================================================

-- ── 1) Auth hook ──
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  claims jsonb;
  user_orgs uuid[];
begin
  begin
    select array_agg(distinct m.org_id) into user_orgs
    from public.memberships m
    where m.user_id = (event->>'user_id')::uuid;

    claims := coalesce(event->'claims', '{}'::jsonb);
    if coalesce(claims->'app_metadata', 'null'::jsonb) = 'null'::jsonb then
      claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
    end if;
    if user_orgs is not null then
      claims := jsonb_set(claims, '{app_metadata,org_ids}', to_jsonb(user_orgs));
      claims := jsonb_set(claims, '{app_metadata,org_id}', to_jsonb(user_orgs[1]));
    end if;
    event := jsonb_set(event, '{claims}', claims);
  exception when others then
    null; -- ne JAMAIS casser le login
  end;
  return event;
end;
$fn$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.memberships to supabase_auth_admin;

-- ── 2) Résolution d'org : claim d'abord, fallback memberships ──
create or replace function public.current_org_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  claim_orgs jsonb;
begin
  begin
    claim_orgs := auth.jwt() -> 'app_metadata' -> 'org_ids';
  exception when others then
    claim_orgs := null;
  end;
  if claim_orgs is not null and jsonb_typeof(claim_orgs) = 'array' and jsonb_array_length(claim_orgs) > 0 then
    return query select (jsonb_array_elements_text(claim_orgs))::uuid;
    return;
  end if;
  if to_regclass('public.memberships') is not null then
    return query select m.org_id from public.memberships m where m.user_id = auth.uid();
  end if;
  return;
end;
$fn$;

-- Rollback current_org_ids (retire le fast-path claim, revient au 100% memberships) :
--   create or replace function public.current_org_ids() returns setof uuid
--   language sql stable security definer set search_path to 'public' as $$
--     select m.org_id from public.memberships m where m.user_id = auth.uid(); $$;
