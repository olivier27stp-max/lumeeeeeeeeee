-- ═══════════════════════════════════════════════════════════════
-- pg_net — pourquoi ce n'est PAS surveillé par le canari
--
-- Cette migration remet `run_security_canary()` dans son état antérieur.
-- Une version intermédiaire y avait ajouté un contrôle `ssrf_pgnet_ouvert`
-- qui rapportait 12 : il est retiré, et voici pourquoi — pour éviter que
-- quelqu'un le rajoute plus tard en croyant combler un trou.
--
-- ─── LE CONSTAT ─────────────────────────────────────────────────
-- `anon` détient bien EXECUTE sur net.http_post, net.http_get et
-- net.worker_restart. Un test empruntant les rôles via une connexion
-- Postgres directe montre que les appels aboutissent.
--
-- ─── POURQUOI CE N'EST PAS EXPLOITABLE ──────────────────────────
-- Ce test empruntait les rôles avec le mot de passe administrateur de la
-- base : ce n'est pas le chemin d'un attaquant. Un attaquant passe par
-- l'API REST avec la clé publique, et PostgREST n'expose que les schémas
-- déclarés dans la configuration de l'API. `net` n'en fait pas partie.
--
-- Vérifié contre la production avec la clé anon :
--     POST /rest/v1/rpc/http_get                → 404
--     idem avec en-tête Content-Profile: net    → 406
--
-- Il n'existe aucun chemin depuis l'extérieur.
--
-- ─── POURQUOI ON NE PEUT PAS LE RÉVOQUER ────────────────────────
-- Le schéma `net` et ses fonctions appartiennent à `supabase_admin`. Seul
-- le propriétaire peut révoquer un privilège, et `postgres` — le rôle de
-- TOUTE connexion externe, y compris l'API Management, le CLI Supabase et
-- le SQL editor du dashboard — ne peut pas modifier les schémas système.
--
-- ⚠️  Le REVOKE échoue alors SANS lever d'erreur : il « réussit » et ne
-- change rien. Quatre tentatives par quatre voies différentes ont toutes
-- semblé aboutir sans effet. Toujours vérifier l'ACL après un REVOKE.
--
-- Référence : github.com/orgs/supabase/discussions/39221
--
-- ─── POURQUOI NE PAS LE SURVEILLER QUAND MÊME ───────────────────
-- Un contrôle qui rapporte en permanence une valeur non nulle, pour une
-- condition que personne ne peut corriger, entraîne exactement ce qu'on
-- veut éviter : on s'habitue au rouge et on cesse de le lire. Le canari ne
-- doit contenir que des contrôles actionnables.
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
    and has_column_privilege('authenticated', c.oid, 'version', 'update');

  delete from public.security_canary_runs where ran_at < now() - interval '90 days';
end $$;

revoke execute on function public.run_security_canary() from public, anon, authenticated;

-- Purge les relevés du contrôle retiré, pour ne pas laisser d'historique
-- rouge qui ferait croire à un problème encore ouvert.
delete from public.security_canary_runs where controle = 'ssrf_pgnet_ouvert';
