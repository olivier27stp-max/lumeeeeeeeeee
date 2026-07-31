-- ============================================================================
-- Detection : brancher les sondes d'invariants et alimenter la telemetrie
-- ============================================================================
--
-- CONSTAT DE DEPART (audit 2026-07-31)
--   * Les 7 sondes check_* creees le 30 juillet n'avaient AUCUN appelant dans
--     tout le depot. Une sonde non planifiee ne detecte rien.
--   * 6 tables de telemetrie securite etaient VIDES : login_history,
--     failed_login_attempts, active_sessions, security_alerts,
--     security_incidents, ip_blocklist. En cas d'incident : aucune trace.
--
-- POURQUOI ELLES ETAIENT VIDES
--   Le login se fait entierement cote navigateur
--   (src/pages/Auth.tsx:39, supabase.auth.signInWithPassword) : il ne passe
--   JAMAIS par le serveur Express. Rien n'appelait donc record_failed_login().
--   auth.audit_log_entries est vide egalement sur ce projet.
--
--   MAIS auth.sessions, lui, est riche et alimente : 70 sessions vivantes,
--   avec ip, user_agent, aal (niveau MFA), created_at. La donnee forensique
--   EXISTE — elle n'etait simplement reliee a rien.
--
-- CE QUE FAIT CETTE MIGRATION
--   1. sync_auth_telemetry()   : recopie auth.sessions vers login_history et
--                                active_sessions (planifie tous les quarts d'heure)
--   2. run_invariant_checks()  : execute check_all_invariants() et ecrit toute
--                                defaillance dans security_events (chaque nuit)
--
-- security_events est le bon receptacle : son org_id est NULLABLE (donc les
-- evenements plateforme passent) et il est deja consomme par l'application
-- (server/lib/security.ts:474, server/routes/security.ts).
--
-- LIMITE ASSUMEE — a lire avant de se croire couvert
--   Une session n'existe que si la connexion a REUSSI. Cette migration donne
--   donc l'historique des connexions reussies et les sessions actives, mais
--   PAS les tentatives echouees. Capturer les echecs exige un Auth Hook
--   Supabase ou de faire transiter le login par le serveur — decision produit,
--   hors perimetre ici. failed_login_attempts et ip_blocklist restent vides.
-- ============================================================================


-- ── 1. Telemetrie d'authentification ────────────────────────────────────────
create or replace function public.sync_auth_telemetry()
returns table (nouvelles_connexions int, sessions_suivies int, sessions_expirees int)
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_new int := 0;
  v_tracked int := 0;
  v_expired int := 0;
begin
  -- 1a. Historique des connexions : une ligne par session jamais enregistree.
  -- org_id est NOT NULL : on rattache l'utilisateur a son organisation. Les
  -- utilisateurs sans aucune adhesion sont ignores (on ne peut pas inventer
  -- une org, et une session sans tenant n'a pas de sens ici).
  with candidat as (
    select s.id, s.user_id, s.created_at, s.ip, s.user_agent, s.aal::text as aal,
           (select m.org_id from public.memberships m
             where m.user_id = s.user_id order by m.created_at limit 1) as org_id
      from auth.sessions s
  ), insere as (
    insert into public.login_history
      (user_id, org_id, ip_address, user_agent, login_method, success, session_id, created_at)
    select c.user_id, c.org_id, c.ip, c.user_agent,
           'supabase_auth' || case when c.aal = 'aal2' then '+mfa' else '' end,
           true, c.id::text, c.created_at
      from candidat c
     where c.org_id is not null
       and not exists (select 1 from public.login_history lh where lh.session_id = c.id::text)
    returning 1
  )
  select count(*)::int into v_new from insere;

  -- 1b. Sessions actives : miroir de auth.sessions.
  with candidat as (
    select s.id, s.user_id, s.ip, s.user_agent,
           coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at) as last_act,
           (s.not_after is null or s.not_after > now()) as encore_valide,
           encode(sha256(s.id::text::bytea), 'hex') as jeton_hash,
           (select m.org_id from public.memberships m
             where m.user_id = s.user_id order by m.created_at limit 1) as org_id
      from auth.sessions s
  ), insere as (
    insert into public.active_sessions
      (user_id, org_id, session_token_hash, ip_address, user_agent, last_activity, is_valid)
    select c.user_id, c.org_id, c.jeton_hash, c.ip, c.user_agent, c.last_act, c.encore_valide
      from candidat c
     where c.org_id is not null
       and not exists (select 1 from public.active_sessions a where a.session_token_hash = c.jeton_hash)
    returning 1
  )
  select count(*)::int into v_tracked from insere;

  -- 1c. Sessions disparues de auth.sessions = revoquees ou expirees.
  update public.active_sessions a
     set is_valid = false,
         invalidated_reason = coalesce(a.invalidated_reason, 'session absente de auth.sessions')
   where a.is_valid is distinct from false
     and not exists (
       select 1 from auth.sessions s
        where encode(sha256(s.id::text::bytea), 'hex') = a.session_token_hash);
  get diagnostics v_expired = row_count;

  return query select v_new, v_tracked, v_expired;
end;
$$;

revoke all on function public.sync_auth_telemetry() from public, anon, authenticated;

comment on function public.sync_auth_telemetry() is
  'Alimente login_history et active_sessions depuis auth.sessions. Ne capture '
  'QUE les connexions reussies : une tentative echouee ne cree pas de session.';


-- ── 2. Sondes d'invariants → security_events ────────────────────────────────
create or replace function public.run_invariant_checks()
returns int
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int := 0;
begin
  insert into public.security_events
    (org_id, event_type, severity, source, details)
  select null,                      -- invariant de plateforme, pas d'org
         'db_invariant_failure',
         case when r.failures > 10 then 'critical' else 'high' end,
         'db-cron',
         jsonb_build_object('check', r.check_name, 'failures', r.failures, 'detail', r.detail)
    from public.check_all_invariants() r
   where r.failures > 0;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.run_invariant_checks() from public, anon, authenticated;

comment on function public.run_invariant_checks() is
  'Execute check_all_invariants() et consigne toute defaillance dans '
  'security_events (org_id NULL = evenement de plateforme). A executer par cron.';


-- ── 3. Planification ────────────────────────────────────────────────────────
-- Idempotent : on desinscrit avant de reinscrire, sans echouer si absent.
do $$
begin
  perform cron.unschedule('lume_sync_auth_telemetry');
exception when others then null;
end $$;

do $$
begin
  perform cron.unschedule('lume_invariant_checks');
exception when others then null;
end $$;

select cron.schedule(
  'lume_sync_auth_telemetry', '*/15 * * * *',
  $$ select public.sync_auth_telemetry() $$
);

select cron.schedule(
  'lume_invariant_checks', '40 4 * * *',
  $$ select public.run_invariant_checks() $$
);
