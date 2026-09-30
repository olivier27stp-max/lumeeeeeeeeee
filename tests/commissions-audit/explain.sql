-- EXPLAIN ANALYZE des requêtes de la page, sur le tenant volumineux (org V).
-- Deux angles : (1) le chemin réel (serveur, service_role, RLS contournée),
-- (2) le même filtre en `authenticated` (RLS active) pour mesurer son coût.
-- L'index candidat est créé DANS la transaction puis annulé (rien ne reste).
\set org '\'cc000000-0000-4000-8000-0000000000a4\''
\set vic '\'cc000000-0000-4000-8000-000000000401\''
\set rep '\'cc000000-0000-4000-8000-000000500001\''
\pset pager off
\timing off

\echo '=== Q1 liste du mois (service_role) — SANS index de période'
explain (analyze, buffers, costs off, summary on)
select * from fs_commission_entries where org_id = :org and deleted_at is null
  and triggered_at >= '2026-09-01T04:00:00Z' and triggered_at < '2026-10-01T04:00:00Z'
  order by triggered_at desc, id limit 2000;

\echo '=== Q2 cumul du mois d un rep pour les paliers (service_role)'
explain (analyze, buffers, costs off, summary on)
select base_amount, invoice_id from fs_commission_entries where org_id = :org and user_id = :rep
  and deleted_at is null and invoice_id is not null and status <> 'reversed'
  and triggered_at >= '2026-09-01T04:00:00Z' and triggered_at < '2026-09-20T00:00:00Z';

\echo '=== Q3 ANCIEN filtre de la paie / page : created_at (service_role)'
explain (analyze, buffers, costs off, summary on)
select user_id, amount, status from fs_commission_entries where org_id = :org and deleted_at is null
  and created_at >= '2026-09-01T00:00:00Z' and created_at <= '2026-09-30T23:59:59.999Z';

\echo '=== Q4 même lecture en authenticated (RLS active, propriétaire)'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :vic, 'role', 'authenticated')::text, true);
explain (analyze, buffers, costs off, summary on)
select id, amount from fs_commission_entries where org_id = :org and deleted_at is null
  and triggered_at >= '2026-09-01T04:00:00Z' and triggered_at < '2026-10-01T04:00:00Z';
rollback;

\echo '=== Q5 idem en authenticated, rep (RLS : ses propres lignes)'
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :rep, 'role', 'authenticated')::text, true);
explain (analyze, buffers, costs off, summary on)
select id, amount from fs_commission_entries where org_id = :org and deleted_at is null
  and triggered_at >= '2026-09-01T04:00:00Z' and triggered_at < '2026-10-01T04:00:00Z';
rollback;

\echo '=== AVEC index candidat (org_id, triggered_at) et (org_id, user_id, triggered_at) — créés puis annulés'
begin;
create index tmp_ce_org_trig on fs_commission_entries (org_id, triggered_at desc) where deleted_at is null;
create index tmp_ce_org_user_trig on fs_commission_entries (org_id, user_id, triggered_at) where deleted_at is null;
analyze fs_commission_entries;
\echo '--- Q1 avec index'
explain (analyze, buffers, costs off, summary on)
select * from fs_commission_entries where org_id = :org and deleted_at is null
  and triggered_at >= '2026-09-01T04:00:00Z' and triggered_at < '2026-10-01T04:00:00Z'
  order by triggered_at desc, id limit 2000;
\echo '--- Q2 avec index'
explain (analyze, buffers, costs off, summary on)
select base_amount, invoice_id from fs_commission_entries where org_id = :org and user_id = :rep
  and deleted_at is null and invoice_id is not null and status <> 'reversed'
  and triggered_at >= '2026-09-01T04:00:00Z' and triggered_at < '2026-09-20T00:00:00Z';
\echo '--- Q4 avec index (RLS, propriétaire)'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :vic, 'role', 'authenticated')::text, true);
explain (analyze, buffers, costs off, summary on)
select id, amount from fs_commission_entries where org_id = :org and deleted_at is null
  and triggered_at >= '2026-09-01T04:00:00Z' and triggered_at < '2026-10-01T04:00:00Z';
rollback;
