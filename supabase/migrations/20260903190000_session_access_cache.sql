-- ═══════════════════════════════════════════════════════════════════
-- Cache du jeton d'ACCÈS de la session utilisateur (anti-concurrence)
-- ───────────────────────────────────────────────────────────────────
-- Le brief du matin lance plusieurs outils EN PARALLÈLE. Chacun rejouait
-- la session Supabase en rafraîchissant le jeton — or ce jeton TOURNE à
-- chaque usage. Deux rafraîchissements simultanés : le second présente un
-- jeton déjà consommé, Supabase y voit un vol et révoque toute la famille.
-- Résultat vécu ce matin : « session plus rejouable », toute la couche
-- factures/revenus morte jusqu'à reconnexion.
--
-- Correctif : on met AUSSI en cache le jeton d'accès (durée de vie ~1 h)
-- et son échéance. Tant qu'il est valide, AUCUN rafraîchissement — le
-- parallélisme devient inoffensif. Le rafraîchissement, rare, est
-- sérialisé côté serveur (une seule volée par autorisation).
--
-- ⚠️ N'AJOUTE que deux colonnes à oauth_tokens (table à nous). Chiffré
-- comme le jeton de rafraîchissement, jamais exposé par la vue publique.
-- ═══════════════════════════════════════════════════════════════════

alter table public.oauth_tokens
  add column if not exists supabase_access_token_chiffre text,
  add column if not exists supabase_access_expire_a timestamptz;

comment on column public.oauth_tokens.supabase_access_token_chiffre is
  'Jeton d''ACCÈS Supabase de l''utilisateur, chiffré (même clé que le '
  'refresh). Cache anti-concurrence : tant qu''il est valide, aucun '
  'rafraîchissement — donc aucune rotation, donc aucun faux vol détecté '
  'quand plusieurs outils tournent en parallèle.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='oauth_tokens'
       and column_name='supabase_access_token_chiffre'
  ) then
    raise exception 'Colonne de cache absente.';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='oauth_autorisations_actives'
       and (column_name like '%token_hash%' or column_name like '%_chiffre')
  ) then
    raise exception 'La vue publique exposerait un secret.';
  end if;
  raise notice 'Cache du jeton d''accès en place — le parallélisme ne tue plus la session.';
end $$;
