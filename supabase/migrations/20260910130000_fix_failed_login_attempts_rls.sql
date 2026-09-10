-- ═══════════════════════════════════════════════════════════════
-- P0 — Fuite inter-tenant de failed_login_attempts
-- ───────────────────────────────────────────────────────────────
-- La policy failed_login_attempts_admin_read (20260421195740) autorisait la
-- LECTURE à tout owner/admin « quelque part » — sans lien avec un org, car la
-- table n'a PAS de colonne org_id. Résultat : n'importe quel inscrit (tout
-- inscrit est owner de son propre org) lisait le journal d'échecs de connexion
-- de TOUTE la plateforme : courriels, IP, user-agent de tous les utilisateurs
-- Lume. Renseignements personnels (Loi 25) exposés + reconnaissance pour du
-- credential stuffing.
--
-- L'intention documentée à côté de la table est « service_role writes only, no
-- client access ». On la rétablit : plus aucun accès client direct. Un RPC
-- borné laisse à la rigueur un utilisateur voir SES propres échecs (son courriel).
-- ═══════════════════════════════════════════════════════════════

-- 1. Supprimer la policy de lecture fautive + couper l'accès client direct.
drop policy if exists failed_login_attempts_admin_read on public.failed_login_attempts;
revoke all on table public.failed_login_attempts from anon, authenticated;

-- 2. RPC borné : un utilisateur peut lire uniquement les échecs sur SON courriel.
--    (SECURITY DEFINER pour contourner le revoke ci-dessus, mais filtré sur
--    l'identité de l'appelant — jamais d'accès aux autres comptes.)
create or replace function public.rpc_my_failed_logins(p_limit int default 50)
returns table(email text, ip inet, user_agent text, reason text, created_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select f.email, f.ip_address, f.user_agent, f.reason, f.created_at
    from public.failed_login_attempts f
   where lower(f.email) = lower((select u.email from auth.users u where u.id = (select auth.uid())))
   order by f.created_at desc
   limit least(p_limit, 200);
$$;

-- Moindre privilège : révoquer PUBLIC + anon, n'ouvrir qu'à authenticated.
revoke all on function public.rpc_my_failed_logins(int) from public, anon;
grant execute on function public.rpc_my_failed_logins(int) to authenticated;
