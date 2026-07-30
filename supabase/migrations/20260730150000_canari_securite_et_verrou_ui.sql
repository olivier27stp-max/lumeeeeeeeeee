-- ═══════════════════════════════════════════════════════════════
-- Sonde de sécurité continue + verrou optimiste jusqu'à l'écran
--
-- Appliqué en production; consigné ici pour survivre à un `db reset`.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. Validation des contraintes métier ──────────────────────
--
-- NOT VALID protège les écritures futures mais laisse Postgres supposer que
-- des lignes existantes peuvent violer la règle : l'invariant n'est donc pas
-- garanti sur l'historique. VALIDATE relit les lignes une fois, sous un
-- verrou SHARE UPDATE EXCLUSIVE qui n'empêche NI les lectures NI les
-- écritures ordinaires.

alter table public.invoices        validate constraint invoices_total_non_negatif;
alter table public.quotes          validate constraint quotes_total_non_negatif;
alter table public.jobs            validate constraint jobs_dates_coherentes;
alter table public.schedule_events validate constraint schedule_events_dates_coherentes;


-- ── 2. Tenant canari : surveillance continue ──────────────────
--
-- Un audit est une photo. Ce qui protège au client #30, c'est une sonde qui
-- tourne seule et crie quand quelque chose change. Chaque compteur doit
-- rester à 0 ; toute valeur non nulle signale une régression introduite
-- depuis la dernière exécution — typiquement une migration qui recrée une
-- table sans RLS, ou une policy ajoutée à la main dans le dashboard.
--
-- Volontairement en SQL pur côté base : une sonde qui dépendrait de l'API
-- Express ne détecterait rien si c'est justement l'API qui tombe.
--
-- Vérifié à l'installation : la sonde a détecté une régression réelle
-- (grant UPDATE sur `plans`) puis son retrait. Un détecteur qu'on n'a pas vu
-- détecter ne prouve rien.

create table if not exists public.security_canary_runs (
  id       uuid primary key default gen_random_uuid(),
  ran_at   timestamptz not null default now(),
  controle text not null,
  valeur   integer not null,
  ok       boolean generated always as (valeur = 0) stored
);

comment on table public.security_canary_runs is
  'Sonde d''isolation multi-tenant. Chaque `valeur` doit rester a 0 — toute ligne avec ok=false signale une regression de securite.';

create index if not exists idx_canary_runs_recent
  on public.security_canary_runs (ran_at desc) where not ok;

revoke all on public.security_canary_runs from authenticated, anon;
alter table public.security_canary_runs enable row level security;

create or replace function public.run_security_canary()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.security_canary_runs (controle, valeur)
  select 'tables_sans_rls', count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

  union all
  select 'secdef_ouvertes_a_anon', count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'execute')

  union all
  select 'secdef_sans_search_path', count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.proconfig is null

  union all
  -- Le filtre sur le privilège évite un faux positif permanent : une policy
  -- sans WITH CHECK sur une table dont le GRANT a été révoqué est inerte.
  select 'update_sans_with_check', count(*)
  from pg_policies p
  join pg_class c on c.relname = p.tablename and c.relkind = 'r'
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where p.schemaname = 'public' and p.cmd in ('UPDATE','ALL')
    and ('authenticated' = any(p.roles) or 'public' = any(p.roles))
    and p.with_check is null
    and has_table_privilege('authenticated', c.oid, 'update')

  union all
  select 'control_plane_ecrivable', count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('plans','api_keys','audit_events','security_incidents',
      'rate_limits','ip_blocklist','payment_provider_secrets','invoice_sequences',
      'promo_codes','webhook_events','subscriptions','consents','org_features',
      'integration_oauth_states','payments','tax_configs')
    and (has_table_privilege('authenticated', c.oid, 'insert')
      or has_table_privilege('authenticated', c.oid, 'update')
      or has_table_privilege('authenticated', c.oid, 'delete'))

  union all
  select 'secrets_oauth_lisibles', count(*)
  from pg_attribute a
  where a.attrelid = 'public.app_connections'::regclass and not a.attisdropped
    and a.attname in ('encrypted_access_token','encrypted_refresh_token',
                      'encrypted_credentials','credentials')
    and has_column_privilege('authenticated', 'public.app_connections',
                             a.attname, 'select')

  union all
  select 'vues_sans_security_invoker', count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and has_table_privilege('authenticated', c.oid, 'select')
    and not exists (
      select 1 from unnest(coalesce(c.reloptions, array[]::text[])) o
      where lower(o) in ('security_invoker=true','security_invoker=on'))

  union all
  -- > 0 signifie qu'un mélange entre organisations a DÉJÀ eu lieu en base.
  select 'references_croisees_orgs',
    (select count(*) from public.jobs j
       join public.clients c on c.id = j.client_id where c.org_id <> j.org_id)
  + (select count(*) from public.invoices i
       join public.jobs j on j.id = i.job_id where j.org_id <> i.org_id)

  union all
  select 'version_ecrivable', count(*)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('jobs','quotes','invoices')
    and has_column_privilege('authenticated', c.oid, 'version', 'update');

  delete from public.security_canary_runs where ran_at < now() - interval '90 days';
end $$;

revoke execute on function public.run_security_canary() from public, anon, authenticated;

-- Exécution nocturne (04h17 UTC ≈ minuit au Québec, hors pointe).
-- Une régression est donc détectée en moins de 24 h plutôt qu'au prochain
-- audit manuel.
select cron.unschedule('security-canary-nightly')
where exists (select 1 from cron.job where jobname = 'security-canary-nightly');

select cron.schedule(
  'security-canary-nightly',
  '17 4 * * *',
  $$select public.run_security_canary()$$
);


-- ── 3. jobs_active expose `version` ───────────────────────────
--
-- La vue précède l'ajout de la colonne et ne l'exposait pas. Le front lit
-- les jobs par cette vue : sans `version`, le client ne peut pas renvoyer la
-- version lue et le verrou optimiste ne s'active jamais côté interface. La
-- base était protégée, l'écran ne l'était pas.
--
-- `version` est ajoutée EN DERNIÈRE POSITION : CREATE OR REPLACE VIEW ne
-- permet que d'ajouter des colonnes à la fin (Postgres refuse en 42P16
-- toute insertion au milieu). L'ordre importe peu, le client adresse les
-- colonnes par nom.

create or replace view public.jobs_active
with (security_invoker = on) as
 SELECT id, org_id, job_number, title, client_id, client_name,
    property_address, scheduled_at, status, total_cents, currency, job_type,
    notes, invoice_url, attachments, created_at, updated_at, description,
    deleted_at, total_amount, created_by, deal_id, lead_id, team_id, address,
    latitude, longitude, geocoded_at, geocode_status, deleted_by, end_at,
    completed_at, closed_at, start_at, subtotal, tax_lines, tax_total, total,
    billing_split, fts_vector, salesperson_id, requires_invoicing,
    archived_at, archived_by, deposit_required, deposit_type, deposit_value,
    deposit_cents, require_payment_method, deposit_status, property_id, tags,
    ask_for_review, assigned_user_id, expenses_cents, sale_date,
    show_on_leaderboard,
        CASE
            WHEN lower(COALESCE(status, ''::text)) = 'completed'::text AND requires_invoicing THEN 'requires_invoicing'::text
            WHEN lower(COALESCE(status, ''::text)) = ANY (ARRAY['completed'::text, 'cancelled'::text, 'canceled'::text, 'archived'::text]) THEN 'archived'::text
            WHEN (EXISTS ( SELECT 1
               FROM public.schedule_events se
              WHERE se.job_id = j.id AND se.deleted_at IS NULL AND se.start_at >= now() AND lower(COALESCE(se.status, ''::text)) <> 'cancelled'::text)) THEN 'upcoming'::text
            WHEN (EXISTS ( SELECT 1
               FROM public.schedule_events se
              WHERE se.job_id = j.id AND se.deleted_at IS NULL AND se.start_at < now() AND (lower(COALESCE(se.status, ''::text)) <> ALL (ARRAY['completed'::text, 'cancelled'::text])))) THEN 'late'::text
            ELSE 'action_required'::text
        END AS derived_status,
    version
   FROM public.jobs j
  WHERE deleted_at IS NULL;
