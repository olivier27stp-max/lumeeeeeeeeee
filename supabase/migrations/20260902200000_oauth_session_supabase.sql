-- ═══════════════════════════════════════════════════════════════════
-- Session Supabase rattachée à l'autorisation OAuth
-- ───────────────────────────────────────────────────────────────────
-- Deux outils de l'agent étaient MORTS en production : get_revenue_summary
-- et get_overdue_payments. Ils appellent des RPC `SECURITY DEFINER` qui
-- vérifient `has_org_membership(auth.uid(), org)` — or le serveur MCP
-- interroge la base avec le client `service_role`, qui n'a AUCUNE identité.
-- `auth.uid()` valait donc null et la RPC répondait « Not allowed for this
-- organization ». Demander son chiffre d'affaires à Claude renvoyait une
-- erreur générique.
--
-- Correctif : au moment où l'utilisateur clique « Autoriser », on garde le
-- jeton de rafraîchissement de SA session Supabase. Le serveur peut alors
-- rebâtir un client porteur de son identité — RLS redevient actif et les
-- RPC acceptent. C'est aussi ce qui rendra les écritures possibles plus tard.
--
-- Le jeton est CHIFFRÉ (AES-256-GCM, même helper que les secrets de
-- paiement) : la colonne ne contient jamais de valeur exploitable en clair.
--
-- ⚠️ N'AJOUTE QUE DES COLONNES à une table créée le même jour. Aucune table,
-- vue, fonction ou politique existante n'est modifiée.
-- ═══════════════════════════════════════════════════════════════════

alter table public.oauth_tokens
  add column if not exists supabase_refresh_token_chiffre text,
  add column if not exists supabase_session_maj_le timestamptz;

comment on column public.oauth_tokens.supabase_refresh_token_chiffre is
  'Jeton de rafraîchissement Supabase de l''utilisateur, chiffré AES-256-GCM. '
  'Permet au serveur MCP de rebâtir un client à l''identité du porteur, pour '
  'que les RPC SECURITY DEFINER (qui testent auth.uid()) acceptent l''appel. '
  'Jamais exposé : la vue oauth_autorisations_actives ne le sélectionne pas.';

comment on column public.oauth_tokens.supabase_session_maj_le is
  'Dernière rotation du jeton ci-dessus. Supabase le fait tourner à chaque '
  'rafraîchissement — cette colonne sert au diagnostic.';

-- ── Vérification ────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='oauth_tokens'
       and column_name='supabase_refresh_token_chiffre'
  ) then
    raise exception 'La colonne supabase_refresh_token_chiffre est absente.';
  end if;

  -- La vue publique ne doit JAMAIS exposer le jeton lui-même.
  -- (`refresh_token_expires_at` est une simple date : sans valeur pour un
  -- attaquant, et déjà exposée avant cette migration.)
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='oauth_autorisations_actives'
       and (column_name like '%token_hash%' or column_name like '%_chiffre')
  ) then
    raise exception 'La vue oauth_autorisations_actives exposerait un secret.';
  end if;

  raise notice 'Session Supabase rattachable à une autorisation OAuth.';
end $$;
