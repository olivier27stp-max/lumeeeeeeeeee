-- ═══════════════════════════════════════════════════════════════
-- AUDIT SÉCURITÉ DB — Lume
--
-- À coller dans le SQL editor de Supabase. Lecture seule.
-- Chaque ligne du résultat doit afficher 0. Toute valeur > 0 est une
-- régression à corriger avant de déployer.
--
-- À relancer : après chaque migration, avant chaque mise en production,
-- et en cron nocturne (une régression détectée en 24 h vaut mieux qu'un
-- audit annuel).
--
-- Ces mêmes contrôles sont automatisés dans scripts/test-rls-isolation.ts
-- (gardes E à H), exécuté par la CI — mais ce job reste DORMANT tant que
-- le secret RLS_TEST_DB_URL n'est pas configuré.
-- ═══════════════════════════════════════════════════════════════

select 'A. Tables sans RLS' as controle,
       count(*) as doit_etre_zero
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

union all
-- RLS activée mais aucune policy : la table est muette, ce qui cache
-- souvent un bug fonctionnel autant qu'un risque.
select 'B. RLS active sans aucune policy',
       count(*)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  and not exists (select 1 from pg_policy p where p.polrelid = c.oid)

union all
-- La RLS ne s'applique PAS aux fonctions : une SECURITY DEFINER appelable
-- par anon tourne avec les droits du propriétaire et voit toutes les orgs.
select 'C. Fonctions SECURITY DEFINER ouvertes a anon',
       count(*)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and has_function_privilege('anon', p.oid, 'execute')

union all
-- search_path non figé = détournement de schéma possible dans une
-- SECURITY DEFINER.
select 'D. SECURITY DEFINER sans search_path fige',
       count(*)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef and p.proconfig is null

union all
-- Sans WITH CHECK, Postgres réutilise USING : la ligne APRÈS modification
-- n'est pas contrainte, donc on peut déplacer ses lignes vers une autre org.
select 'E. Policies UPDATE sans WITH CHECK (tenant hopping)',
       count(*)
from pg_policies p
join pg_class c on c.relname = p.tablename
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where p.schemaname = 'public' and p.cmd in ('UPDATE','ALL')
  and ('authenticated' = any(p.roles) or 'public' = any(p.roles))
  and p.with_check is null
  and has_table_privilege('authenticated', c.oid, 'update')

union all
-- Un client qui écrit ici se donne un forfait, efface ses traces d'audit,
-- casse la numérotation exigée par Revenu Québec, ou désactive les
-- protections anti-brute-force qui le visent.
select 'F. Control plane ecrivable par un client',
       count(*)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in ('plans','api_keys','audit_events','security_incidents',
      'security_events','security_alerts','rate_limits','ip_blocklist',
      'failed_login_attempts','login_history','payment_provider_secrets',
      'invoice_sequences','quote_sequences','org_invoice_sequences',
      'promo_codes','referrals','webhook_events','processed_checkout_sessions',
      'org_features','subscriptions','consents','dsar_requests',
      'integration_audit_logs')
  and (has_table_privilege('authenticated', c.oid, 'insert')
    or has_table_privilege('authenticated', c.oid, 'update')
    or has_table_privilege('authenticated', c.oid, 'delete'))

union all
-- La RLS filtre les LIGNES, jamais les COLONNES : un GRANT SELECT au
-- niveau table expose les jetons OAuth même si la ligne est cloisonnée.
select 'G. Secrets OAuth lisibles par un client',
       count(*)
from pg_attribute a
where a.attrelid = 'public.app_connections'::regclass
  and not a.attisdropped
  and a.attname in ('encrypted_access_token','encrypted_refresh_token',
                    'encrypted_credentials','credentials')
  and has_column_privilege('authenticated', 'public.app_connections',
                           a.attname, 'select')

union all
-- Une vue tourne avec les droits de son propriétaire (postgres) : sans
-- security_invoker, elle voit toutes les organisations.
-- Postgres accepte 'true' comme 'on' : tester les deux, sinon des vues
-- correctement protégées ressortent en faux positif.
select 'H. Vues sans security_invoker',
       count(*)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and has_table_privilege('authenticated', c.oid, 'select')
  and not exists (
    select 1 from unnest(coalesce(c.reloptions, array[]::text[])) o
    where lower(o) in ('security_invoker=true','security_invoker=on'))

union all
-- Détecteur de fuite historique : si > 0, un mélange entre organisations
-- a DÉJÀ eu lieu en base.
select 'I. References croisees entre organisations',
       (select count(*) from jobs j join clients c on c.id = j.client_id
        where c.org_id <> j.org_id)
     + (select count(*) from invoices i join jobs j on j.id = i.job_id
        where j.org_id <> i.org_id)
     + (select count(*) from quotes q join jobs j on j.id = q.job_id
        where j.org_id <> q.org_id)
     + (select count(*) from properties p join clients c on c.id = p.client_id
        where c.org_id <> p.org_id)

union all
-- Une numérotation de facture avec doublons est un problème fiscal, pas
-- seulement un bug d'affichage.
select 'J. Numeros de facture dupliques dans une org',
       (select count(*) from (
          select org_id, invoice_number from invoices
          where invoice_number is not null
          group by 1,2 having count(*) > 1) s)

union all
-- Argent en float = 19,99 qui devient 19,989999 après quelques calculs.
select 'K. Colonnes monetaires en virgule flottante',
       count(*)
from information_schema.columns
where table_schema = 'public'
  and data_type in ('real','double precision')
  and column_name ~* 'amount|price|total|cost|montant|cents|tps|tvq'

union all
-- timestamp sans fuseau + heure avancée du Québec = rendez-vous décalés
-- d'une heure, deux fois par année.
select 'L. Dates sans fuseau horaire',
       count(*)
from information_schema.columns
where table_schema = 'public'
  and data_type = 'timestamp without time zone'

order by 1;
