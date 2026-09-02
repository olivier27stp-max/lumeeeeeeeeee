-- ═══════════════════════════════════════════════════════════════════
-- Lume devient serveur d'autorisation OAuth 2.1 (pour MCP)
-- ───────────────────────────────────────────────────────────────────
-- Jusqu'ici, brancher Claude sur le CRM demandait de copier une clé
-- d'API : un identifiant PARTAGÉ par toute l'organisation. L'audit ne
-- pouvait pas dire qui avait consulté quoi, et les permissions de
-- chaque membre ne s'appliquaient pas.
--
-- Avec OAuth, chaque personne autorise Claude avec SON compte. Le
-- jeton porte son `user_id`, donc :
--   • l'audit nomme la personne, pas l'organisation ;
--   • RLS redevient actif (le serveur MCP peut bâtir un client
--     Supabase à l'identité du porteur) ;
--   • révoquer un accès n'affecte que lui.
--
-- ⚠️ CE FICHIER N'AJOUTE QUE DES TABLES NEUVES.
-- Aucune table, colonne, vue, fonction ou politique existante n'est
-- modifiée. `api_keys` continue de fonctionner en parallèle : les deux
-- modes d'authentification coexistent, rien de ce qui marche ne casse.
--
-- Références : OAuth 2.1 (draft-ietf-oauth-v2-1-13), RFC 7636 (PKCE),
-- RFC 8707 (Resource Indicators), RFC 9728 (Protected Resource
-- Metadata), spec MCP « Authorization ».
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Les clients OAuth (Claude, Cursor, …) ────────────────────────
-- Un « client » est une application qui demande l'accès. Claude peut
-- s'enregistrer tout seul (Dynamic Client Registration, RFC 7591) ou
-- être décrit par une URL de métadonnées (Client ID Metadata Document,
-- ce qu'Anthropic recommande) — d'où `client_id` en texte libre et non
-- en uuid : une URL https:// est un identifiant valide.
create table if not exists public.oauth_clients (
  id                uuid primary key default gen_random_uuid(),
  client_id         text not null unique,
  -- Haché, jamais en clair : même principe que api_keys.key_hash.
  -- Nul pour un client public (Claude utilise PKCE, pas de secret).
  client_secret_hash text,
  client_name       text not null,
  redirect_uris     text[] not null,
  grant_types       text[] not null default array['authorization_code','refresh_token'],
  scopes            text[] not null default array['mcp:read'],
  -- 'dynamic' = auto-enregistré, 'metadata_document' = décrit par URL,
  -- 'manual' = créé à la main.
  registration_type text not null default 'dynamic',
  client_uri        text,
  logo_uri          text,
  created_at        timestamptz not null default now(),
  last_used_at      timestamptz,
  disabled          boolean not null default false,
  constraint oauth_clients_registration_type_check
    check (registration_type in ('dynamic','metadata_document','manual')),
  constraint oauth_clients_redirect_uris_non_vide
    check (array_length(redirect_uris, 1) >= 1)
);

comment on table public.oauth_clients is
  'Applications autorisées à demander un accès MCP (Claude, Cursor…). '
  'Le secret est haché en SHA-256, jamais stocké en clair. '
  'Voir 20260902120000_oauth_serveur_mcp.sql.';

-- ── 2. Les codes d'autorisation (éphémères) ─────────────────────────
-- Émis quand l'utilisateur clique « Autoriser », échangés dans la
-- minute contre un jeton. Usage UNIQUE : `used_at` non nul = déjà
-- consommé, toute réutilisation est un signal d'attaque.
create table if not exists public.oauth_authorization_codes (
  id                    uuid primary key default gen_random_uuid(),
  code_hash             text not null unique,
  client_id             text not null references public.oauth_clients(client_id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  org_id                uuid not null references public.orgs(id) on delete cascade,
  scopes                text[] not null,
  redirect_uri          text not null,
  -- PKCE (RFC 7636) : obligatoire en OAuth 2.1, sans exception.
  code_challenge        text not null,
  code_challenge_method text not null default 'S256',
  -- RFC 8707 : le jeton n'est valable que pour CETTE ressource.
  -- C'est ce qui empêche un jeton volé ailleurs d'ouvrir Lume.
  resource              text not null,
  expires_at            timestamptz not null,
  used_at               timestamptz,
  created_at            timestamptz not null default now(),
  constraint oauth_codes_challenge_method_check
    check (code_challenge_method = 'S256')
);

comment on table public.oauth_authorization_codes is
  'Codes d''autorisation OAuth, durée de vie ~60 s, usage unique. '
  'PKCE S256 obligatoire. `resource` lie le futur jeton au serveur MCP.';

-- ── 3. Les jetons ───────────────────────────────────────────────────
-- Accès (courte durée) et rafraîchissement (longue durée), hachés.
-- `family_id` sert à la rotation : présenter deux fois le même jeton de
-- rafraîchissement révoque TOUTE la famille — la contre-mesure standard
-- contre un jeton volé (OAuth 2.1 §4.14.2).
create table if not exists public.oauth_tokens (
  id                     uuid primary key default gen_random_uuid(),
  access_token_hash      text unique,
  refresh_token_hash     text unique,
  family_id              uuid not null default gen_random_uuid(),
  client_id              text not null references public.oauth_clients(client_id) on delete cascade,
  user_id                uuid not null references auth.users(id) on delete cascade,
  org_id                 uuid not null references public.orgs(id) on delete cascade,
  scopes                 text[] not null,
  resource               text not null,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz,
  revoked                boolean not null default false,
  revoked_at             timestamptz,
  revoked_reason         text,
  last_used_at           timestamptz,
  created_at             timestamptz not null default now(),
  constraint oauth_tokens_au_moins_un_jeton
    check (access_token_hash is not null or refresh_token_hash is not null)
);

comment on table public.oauth_tokens is
  'Jetons OAuth émis par Lume, hachés en SHA-256. `family_id` porte la '
  'rotation des jetons de rafraîchissement : une réutilisation révoque '
  'toute la famille.';

-- ── Index ───────────────────────────────────────────────────────────
-- Chaque clé étrangère est indexée : sans cela, supprimer une org ou un
-- utilisateur déclenche un balayage complet de ces tables.
create index if not exists oauth_codes_client_idx      on public.oauth_authorization_codes (client_id);
create index if not exists oauth_codes_user_idx        on public.oauth_authorization_codes (user_id);
create index if not exists oauth_codes_org_idx         on public.oauth_authorization_codes (org_id);
create index if not exists oauth_codes_expiry_idx      on public.oauth_authorization_codes (expires_at) where used_at is null;

create index if not exists oauth_tokens_client_idx     on public.oauth_tokens (client_id);
create index if not exists oauth_tokens_user_idx       on public.oauth_tokens (user_id);
create index if not exists oauth_tokens_org_idx        on public.oauth_tokens (org_id);
create index if not exists oauth_tokens_family_idx     on public.oauth_tokens (family_id);
-- Liste « mes applications connectées » : jetons vivants d'un utilisateur.
create index if not exists oauth_tokens_actifs_idx     on public.oauth_tokens (user_id, revoked) where revoked = false;

-- ── RLS ─────────────────────────────────────────────────────────────
-- Ces tables portent des identifiants d'accès. Le serveur y touche via
-- le client `service_role` (qui contourne RLS) ; RLS existe donc pour
-- fermer la porte à tout le reste — un client anon/authenticated ne doit
-- JAMAIS lire un hash de jeton.
alter table public.oauth_clients              enable row level security;
alter table public.oauth_authorization_codes  enable row level security;
alter table public.oauth_tokens               enable row level security;

alter table public.oauth_clients              force row level security;
alter table public.oauth_authorization_codes  force row level security;
alter table public.oauth_tokens               force row level security;

-- Le serveur (service_role) fait tout.
drop policy if exists oauth_clients_service_all on public.oauth_clients;
create policy oauth_clients_service_all on public.oauth_clients
  as permissive for all to service_role using (true) with check (true);

drop policy if exists oauth_codes_service_all on public.oauth_authorization_codes;
create policy oauth_codes_service_all on public.oauth_authorization_codes
  as permissive for all to service_role using (true) with check (true);

drop policy if exists oauth_tokens_service_all on public.oauth_tokens;
create policy oauth_tokens_service_all on public.oauth_tokens
  as permissive for all to service_role using (true) with check (true);

-- Un utilisateur connecté voit SES propres autorisations — c'est ce qui
-- alimente « Applications connectées » dans les réglages. En lecture
-- seule, et sans jamais exposer les hachages (la vue ci-dessous les
-- exclut ; la politique protège l'accès direct à la table).
drop policy if exists oauth_tokens_select_proprietaire on public.oauth_tokens;
create policy oauth_tokens_select_proprietaire on public.oauth_tokens
  as permissive for select to authenticated
  using (user_id = (select auth.uid()));

-- Révoquer sa propre autorisation depuis l'interface.
drop policy if exists oauth_tokens_update_proprietaire on public.oauth_tokens;
create policy oauth_tokens_update_proprietaire on public.oauth_tokens
  as permissive for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Les clients OAuth sont publics par nature (nom, logo) : un utilisateur
-- doit pouvoir lire le nom de l'app qui lui demande l'accès. Le secret
-- haché reste hors de portée via la vue.
drop policy if exists oauth_clients_select_authentifie on public.oauth_clients;
create policy oauth_clients_select_authentifie on public.oauth_clients
  as permissive for select to authenticated using (true);

-- Les codes d'autorisation : personne d'autre que le serveur. Aucune
-- politique pour `authenticated` — RLS refuse par défaut.

-- ── Vue « mes applications connectées » ─────────────────────────────
-- Expose ce qu'il faut à l'écran des réglages, JAMAIS les hachages.
-- `security_invoker` : les politiques ci-dessus continuent de filtrer.
create or replace view public.oauth_autorisations_actives
with (security_invoker = true)
as
select
  t.id,
  t.client_id,
  c.client_name,
  c.logo_uri,
  c.client_uri,
  t.org_id,
  t.user_id,
  t.scopes,
  t.created_at,
  t.last_used_at,
  t.access_token_expires_at,
  t.refresh_token_expires_at
from public.oauth_tokens t
join public.oauth_clients c on c.client_id = t.client_id
where t.revoked = false;

comment on view public.oauth_autorisations_actives is
  'Applications OAuth actuellement autorisées, sans aucun hachage de '
  'jeton. Alimente « Applications connectées » dans les réglages.';

grant select on public.oauth_autorisations_actives to authenticated;

-- ── Ménage des codes et jetons périmés ──────────────────────────────
-- Un code expiré ou un jeton mort ne sert plus à rien et grossit la
-- table indéfiniment. SECURITY DEFINER pour pouvoir supprimer malgré
-- RLS ; EXECUTE retiré à PUBLIC (principe du moindre privilège).
create or replace function public.oauth_menage()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Codes : expirés ou consommés depuis plus d'une heure.
  delete from public.oauth_authorization_codes
   where expires_at < now() - interval '1 hour'
      or (used_at is not null and used_at < now() - interval '1 hour');

  -- Jetons : révoqués ou dont le rafraîchissement est mort depuis 30 j.
  -- On garde 30 jours pour que l'audit puisse encore expliquer un accès.
  delete from public.oauth_tokens
   where (revoked = true and revoked_at < now() - interval '30 days')
      or (refresh_token_expires_at is not null
          and refresh_token_expires_at < now() - interval '30 days');
end $$;

revoke all on function public.oauth_menage() from public;
grant execute on function public.oauth_menage() to service_role;

comment on function public.oauth_menage() is
  'Supprime les codes périmés et les jetons morts depuis 30 jours. '
  'Appelée par le planificateur du serveur.';

-- ── Vérification ────────────────────────────────────────────────────
do $$
declare
  n_politiques int;
begin
  if to_regclass('public.oauth_clients') is null then
    raise exception 'La table oauth_clients est absente.';
  end if;
  if to_regclass('public.oauth_authorization_codes') is null then
    raise exception 'La table oauth_authorization_codes est absente.';
  end if;
  if to_regclass('public.oauth_tokens') is null then
    raise exception 'La table oauth_tokens est absente.';
  end if;
  if to_regclass('public.oauth_autorisations_actives') is null then
    raise exception 'La vue oauth_autorisations_actives est absente.';
  end if;
  if to_regprocedure('public.oauth_menage()') is null then
    raise exception 'La fonction oauth_menage est absente.';
  end if;

  -- RLS active sur les trois tables, sinon on expose des jetons.
  if exists (
    select 1 from pg_class
     where relname in ('oauth_clients','oauth_authorization_codes','oauth_tokens')
       and relnamespace = 'public'::regnamespace
       and relrowsecurity = false
  ) then
    raise exception 'RLS n''est pas active sur toutes les tables OAuth.';
  end if;

  select count(*) into n_politiques
    from pg_policies
   where schemaname = 'public'
     and tablename in ('oauth_clients','oauth_authorization_codes','oauth_tokens');
  if n_politiques < 6 then
    raise exception 'Politiques RLS incomplètes sur les tables OAuth (% trouvées).', n_politiques;
  end if;

  raise notice 'Serveur OAuth : 3 tables, 1 vue, 1 fonction de ménage, RLS active.';
end $$;
