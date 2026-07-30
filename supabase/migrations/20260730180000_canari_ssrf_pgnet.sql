-- ═══════════════════════════════════════════════════════════════
-- Sonde : SSRF via pg_net
--
-- Ajoute un contrôle au canari nocturne. `pg_net` fait émettre à la base
-- des requêtes HTTP sortantes ; un rôle client qui peut l'appeler dispose
-- d'une SSRF — exfiltration vers un serveur tiers, accès à des services
-- internes, ou coupure du worker réseau (donc notifications push et
-- libération des numéros SMS).
--
-- ÉTAT AU 2026-07-30 : ce contrôle retourne **12**, pas 0. La faille est
-- ouverte et vérifiée exploitable (test réel en empruntant les rôles
-- `anon` et `authenticated`).
--
-- Elle ne peut pas être corrigée depuis une connexion externe : les
-- fonctions `net.*` appartiennent à `supabase_admin`, et un REVOKE lancé
-- par `postgres` est ignoré **sans lever d'erreur**. Trois voies essayées
-- (pooler, API Management, CLI Supabase), toutes silencieusement sans
-- effet.
--
-- → Correctif à appliquer dans le SQL editor du dashboard :
--   scripts/A-APPLIQUER-dashboard-pgnet.sql
--
-- Le contrôle reste en place après correction : une mise à jour de
-- l'extension réattribue les grants par défaut, et la sonde le verrait.
-- ═══════════════════════════════════════════════════════════════

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
    and has_column_privilege('authenticated', c.oid, 'version', 'update')

  union all
  -- NOUVEAU : SSRF via pg_net. Retourne 12 tant que le correctif dashboard
  -- n'est pas appliqué.
  select 'ssrf_pgnet_ouvert', count(*)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'net'
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'));

  delete from public.security_canary_runs where ran_at < now() - interval '90 days';
end $$;

revoke execute on function public.run_security_canary() from public, anon, authenticated;
