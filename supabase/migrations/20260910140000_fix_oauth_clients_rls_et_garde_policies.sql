-- ═══════════════════════════════════════════════════════════════
-- P1 — oauth_clients lisible par tout compte + garde anti-policy USING(true)
-- ───────────────────────────────────────────────────────────────
-- 1) oauth_clients_select_authentifie était `for select to authenticated
--    using (true)` : tout compte connecté listait TOUS les clients OAuth/MCP de
--    la plateforme (client_id, redirect_uris, scopes, last_used_at) — corrélation
--    d'usage inter-tenant + base de phishing de consentement OAuth.
--    Le serveur lit oauth_clients UNIQUEMENT via getServiceClient() (service_role,
--    qui contourne la RLS) — vérifié : aucune lecture PostgREST côté client. La
--    policy n'a donc aucun usage légitime : on la supprime.
--
-- 2) Garde permanent : une fonction qui recense les policies `using(true)`/
--    `with_check(true)` ouvertes au rôle public (anon+authenticated). Aujourd'hui
--    0 en prod, mais le jour où une base neuve rejoue les migrations « AI » /
--    billing, on veut que ça se voie. À câbler au job d'invariants.
-- ═══════════════════════════════════════════════════════════════

-- 1. Retirer l'exposition oauth_clients (le service_role garde son accès ALL).
drop policy if exists oauth_clients_select_authentifie on public.oauth_clients;

-- 2. Garde : renvoie les policies dangereuses (permissives, qual/with_check=true,
--    accessibles au rôle 'public' donc à anon+authenticated). 0 ligne = sain.
create or replace function public.check_public_true_policies()
returns table(schemaname text, tablename text, policyname text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.schemaname::text, p.tablename::text, p.policyname::text
    from pg_policies p
   where p.schemaname = 'public'
     and 'public' = any(p.roles)
     and (p.qual = 'true' or p.with_check = 'true');
$$;

revoke all on function public.check_public_true_policies() from public, anon, authenticated;

-- 3. Valider l'état courant : la migration échoue si une policy dangereuse subsiste.
do $$
declare n int;
begin
  select count(*) into n from public.check_public_true_policies();
  if n > 0 then
    raise exception 'GARDE: % policy(ies) USING(true)/WITH CHECK(true) ouvertes au public — cross-tenant', n;
  end if;
end $$;
