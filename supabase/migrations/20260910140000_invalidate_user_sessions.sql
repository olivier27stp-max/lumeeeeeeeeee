-- ═══════════════════════════════════════════════════════════════
-- Révoquer toutes les sessions d'un utilisateur (déconnexion forcée)
-- ─────────────────────────────────────────────────────────────
-- POST /api/team-compliance/force-logout (retrait d'un membre) appelait
-- `auth.admin.signOut(member.user_id, 'global')`. Or l'API admin de GoTrue
-- attend un JWT, pas un identifiant : l'appel échouait TOUJOURS, puis
-- retombait sur cette RPC… qui n'existait pas. Un membre retiré gardait
-- donc ses sessions (contrôle de cohérence : « fonction absente, tolérée »).
--
-- Supprimer les lignes de auth.sessions invalide les jetons de
-- rafraîchissement (auth.refresh_tokens suit en cascade) : au prochain
-- rafraîchissement, l'appareil est déconnecté. Le JWT d'accès courant reste
-- valable jusqu'à son expiration (≤ 1 h), comme pour toute révocation GoTrue.
create or replace function public.invalidate_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  if p_user_id is null then return 0; end if;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

comment on function public.invalidate_user_sessions(uuid) is
  'Déconnexion forcée : supprime toutes les sessions auth d''un utilisateur. Réservée au serveur (service_role).';

-- Réservée au serveur : jamais exécutable par un client, même authentifié.
revoke all on function public.invalidate_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.invalidate_user_sessions(uuid) to service_role;
