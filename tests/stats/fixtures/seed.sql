-- ============================================================================
-- Jeu de données déterministe de l'audit Statistiques (STATS_AUDIT.md).
-- BASE LOCALE JETABLE UNIQUEMENT (scripts/qa/stats-stack.sh) — jamais staging, jamais prod.
-- Les comptes auth.users sont créés avant par scripts/qa/stats-fixture.mjs (API admin GoTrue).
--
-- T1 « Fixture Lavage »   : le tenant mesuré, cas limites compris.
-- T2 « Autre Entreprise » : ne doit JAMAIS apparaître (montants en 7 777 777,77 $, équipe « Fantôme »).
-- T3 « Entreprise Vide »  : aucun enregistrement.
-- (T4 volumineux : fixtures/volume.sql)
--
-- Toutes les heures sont écrites à l'heure de Toronto : c'est le fuseau des tenants.
-- Taxes QC : TPS 5 %, TVQ 9,975 %, arrondi par taxe (comme l'UI des factures).
--   1 000,00 $ HT → 50,00 + 99,75 = 149,75 → 1 149,75 $
--     500,00 $ HT → 25,00 + 49,88 =  74,88 →   574,88 $
--     200,00 $ HT → 10,00 + 19,95 =  29,95 →   229,95 $
--     333,33 $ HT → 16,67 + 33,25 =  49,92 →   383,25 $
-- ============================================================================
set session timezone = 'UTC';   -- comme PostgREST : les littéraux portent leur propre fuseau
-- Les triggers de portée (crm_enforce_scope) exigent un auteur : on écrit « en tant que » le propriétaire.
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-0000000000a1","role":"authenticated"}', false);

-- ── Organisations ───────────────────────────────────────────────────────────
insert into public.orgs (id, name, created_by) values
  ('a1000000-0000-4000-8000-000000000001', 'Fixture Lavage',    'a1000000-0000-4000-8000-0000000000a1'),
  ('b2000000-0000-4000-8000-000000000001', 'Autre Entreprise',  'b2000000-0000-4000-8000-0000000000b1'),
  ('c3000000-0000-4000-8000-000000000001', 'Entreprise Vide',   'c3000000-0000-4000-8000-0000000000c1');

insert into public.company_settings (org_id, company_name, timezone, currency, default_language, revenue_goal_cents)
values
  ('a1000000-0000-4000-8000-000000000001', 'Fixture Lavage',   'America/Toronto', 'CAD', 'fr', 12000000),
  ('b2000000-0000-4000-8000-000000000001', 'Autre Entreprise', 'America/Toronto', 'CAD', 'fr', 0),
  ('c3000000-0000-4000-8000-000000000001', 'Entreprise Vide',  'America/Toronto', 'CAD', 'en', 0)
on conflict (org_id) do update set timezone = excluded.timezone, revenue_goal_cents = excluded.revenue_goal_cents,
  default_language = excluded.default_language, company_name = excluded.company_name;

-- Assistant d'accueil déjà fait (sinon l'app l'affiche au lieu de la page).
update public.profiles set onboarding_done = true
 where id in ('a1000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-0000000000a2', 'a1000000-0000-4000-8000-0000000000a3',
              'a1000000-0000-4000-8000-0000000000a4', 'a1000000-0000-4000-8000-0000000000a5', 'b2000000-0000-4000-8000-0000000000b1',
              'c3000000-0000-4000-8000-0000000000c1', 'd4000000-0000-4000-8000-0000000000d1');

-- ── Équipes ─────────────────────────────────────────────────────────────────
insert into public.teams (id, org_id, name, is_active) values
  ('a1000000-0000-4000-8000-00000000077a', 'a1000000-0000-4000-8000-000000000001', 'Équipe A', true),
  ('a1000000-0000-4000-8000-00000000077b', 'a1000000-0000-4000-8000-000000000001', 'Équipe B', true),
  ('a1000000-0000-4000-8000-00000000077c', 'a1000000-0000-4000-8000-000000000001', 'Équipe C (inactive)', false),
  ('b2000000-0000-4000-8000-00000000077a', 'b2000000-0000-4000-8000-000000000001', 'Équipe Fantôme', true);

-- ── Membres (comptes créés par stats-fixture.mjs) ───────────────────────────
-- a1 propriétaire · a2 admin · a3 technicien 25 $/h (A) · a4 technicienne 32,50 $/h (B) · a5 vendeur (commission)
insert into public.memberships (user_id, org_id, role, status, full_name, team_id, hourly_rate_cents, compensation_mode, scope) values
  ('a1000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000001', 'owner',      'active', 'Olivia Proprio', null, 0, 'hourly', 'company'),
  ('a1000000-0000-4000-8000-0000000000a2', 'a1000000-0000-4000-8000-000000000001', 'admin',      'active', 'Adam Admin', null, 0, 'hourly', 'company'),
  ('a1000000-0000-4000-8000-0000000000a3', 'a1000000-0000-4000-8000-000000000001', 'technician', 'active', 'Théo Technicien', 'a1000000-0000-4000-8000-00000000077a', 2500, 'hourly', 'assigned'),
  ('a1000000-0000-4000-8000-0000000000a4', 'a1000000-0000-4000-8000-000000000001', 'technician', 'active', 'Tina Technicienne', 'a1000000-0000-4000-8000-00000000077b', 3250, 'hourly', 'assigned'),
  ('a1000000-0000-4000-8000-0000000000a5', 'a1000000-0000-4000-8000-000000000001', 'sales_rep',  'active', 'Rémi Représentant', null, 0, 'commission', 'assigned'),
  ('b2000000-0000-4000-8000-0000000000b1', 'b2000000-0000-4000-8000-000000000001', 'owner',      'active', 'Autre Proprio', null, 0, 'hourly', 'company'),
  ('c3000000-0000-4000-8000-0000000000c1', 'c3000000-0000-4000-8000-000000000001', 'owner',      'active', 'Vide Proprio', null, 0, 'hourly', 'company')
on conflict (user_id, org_id) do update set role = excluded.role, status = excluded.status, team_id = excluded.team_id,
  hourly_rate_cents = excluded.hourly_rate_cents, compensation_mode = excluded.compensation_mode, scope = excluded.scope;

-- Le taux horaire que lit rentabilite_jobs vit dans team_members (comme la paie).
update public.team_members tm set hourly_rate_cents = m.hourly_rate_cents, team_id = m.team_id,
  role = m.role, first_name = split_part(m.full_name, ' ', 1), last_name = split_part(m.full_name, ' ', 2)
from public.memberships m where m.user_id = tm.user_id and m.org_id = tm.org_id
  and tm.org_id in ('a1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001');
insert into public.team_members (org_id, user_id, email, role, status, first_name, last_name, hourly_rate_cents, team_id)
select m.org_id, m.user_id, u.email, m.role, 'active', split_part(m.full_name, ' ', 1), split_part(m.full_name, ' ', 2), m.hourly_rate_cents, m.team_id
from public.memberships m join auth.users u on u.id = m.user_id
where m.org_id in ('a1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'c3000000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.team_members t where t.org_id = m.org_id and t.user_id = m.user_id);

-- ── Clients & leads (T1) ────────────────────────────────────────────────────
insert into public.clients (id, org_id, first_name, last_name, email, status, lead_status, source, created_at, deleted_at) values
  ('a1000000-0000-4000-8000-0000000c0001', 'a1000000-0000-4000-8000-000000000001', 'Alice',    'Tremblay',  'alice@fixture.lume.test',   'active', null,  'Google',    '2025-10-05 10:00 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000c0002', 'a1000000-0000-4000-8000-000000000001', 'Bruno',    'Gagnon',    'bruno@fixture.lume.test',   'active', null,  'Référence', '2026-02-10 10:00 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000c0003', 'a1000000-0000-4000-8000-000000000001', 'Chantal',  'Roy',       'chantal@fixture.lume.test', 'active', 'won', 'Facebook',  '2026-08-15 10:00 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000c0004', 'a1000000-0000-4000-8000-000000000001', 'Denis',    'Côté',      'denis@fixture.lume.test',   'lead',   'new', 'Google',    '2026-09-03 10:00 America/Toronto', null),
  -- lead créé le 31 août à 23 h 30 (Toronto) = 1er septembre 03 h 30 UTC : c'est un lead d'AOÛT
  ('a1000000-0000-4000-8000-0000000c0005', 'a1000000-0000-4000-8000-000000000001', 'Émilie',   'Bouchard',  'emilie@fixture.lume.test',  'lead',   'new', 'Google',    '2026-08-31 23:30 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000c0006', 'a1000000-0000-4000-8000-000000000001', 'François', 'Pelletier', 'francois@fixture.lume.test','active', null,  'Référence', '2024-12-01 10:00 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000c0007', 'a1000000-0000-4000-8000-000000000001', 'Gisèle',   'Morin',     'gisele@fixture.lume.test',  'active', null,  'Google',    '2026-01-01 00:15 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000c0008', 'a1000000-0000-4000-8000-000000000001', 'Hugo',     'Lavoie',    'hugo@fixture.lume.test',    'active', null,  'Google',    '2026-03-01 10:00 America/Toronto', '2026-09-01 10:00 America/Toronto');

-- ── Jobs (T1) ───────────────────────────────────────────────────────────────
-- subtotal_cents / tax_cents / total_cents : la projection legacy (total, subtotal) est remplie par trigger.
insert into public.jobs (id, org_id, job_number, title, client_id, client_name, lead_id, team_id, status, job_type,
  subtotal_cents, tax_cents, total_cents, expenses_cents, created_at, completed_at, salesperson_id,
  property_address, latitude, longitude, deleted_at) values
  ('a1000000-0000-4000-8000-0000000f0001', 'a1000000-0000-4000-8000-000000000001', 'J-1',  'Lavage de vitres',          'a1000000-0000-4000-8000-0000000c0001', 'Alice Tremblay', null, 'a1000000-0000-4000-8000-00000000077a', 'completed', 'one_off',   100000, 14975, 114975, 15000, '2026-08-03 10:00 America/Toronto', '2026-08-05 16:00 America/Toronto', 'a1000000-0000-4000-8000-0000000000a5', '12 rue Principale, Granby, QC J2G 1A1',  45.4000, -72.7300, null),
  ('a1000000-0000-4000-8000-0000000f0002', 'a1000000-0000-4000-8000-000000000001', 'J-2',  'Lavage de vitres',          'a1000000-0000-4000-8000-0000000c0001', 'Alice Tremblay', null, 'a1000000-0000-4000-8000-00000000077a', 'completed', 'recurring',  50000,  7488,  57488,     0, '2026-09-02 10:00 America/Toronto', '2026-09-10 12:00 America/Toronto', null, '12 rue Principale, Granby, QC J2G 1A1',  45.4000, -72.7300, null),
  -- créé ET complété le 31 août en soirée (Toronto) : un job d'AOÛT
  ('a1000000-0000-4000-8000-0000000f0003', 'a1000000-0000-4000-8000-000000000001', 'J-3',  'Nettoyage de gouttières',   'a1000000-0000-4000-8000-0000000c0002', 'Bruno Gagnon',   null, 'a1000000-0000-4000-8000-00000000077b', 'completed', 'one_off',    20000,  2995,  22995,  2000, '2026-08-31 23:30 America/Toronto', '2026-08-31 23:45 America/Toronto', null, '5 rue du Lac, Bromont, QC J2L 1A1',     45.3200, -72.6500, null),
  ('a1000000-0000-4000-8000-0000000f0004', 'a1000000-0000-4000-8000-000000000001', 'J-4',  'Lavage à pression',         'a1000000-0000-4000-8000-0000000c0003', 'Chantal Roy',    'a1000000-0000-4000-8000-0000000c0003', 'a1000000-0000-4000-8000-00000000077b', 'scheduled', 'one_off',    33333,  4992,  38325,     0, '2026-09-05 10:00 America/Toronto', null, null, '8 rue King, Sherbrooke, QC J1H 1A1',   45.4000, -71.8900, null),
  -- créé la veille du jour de l'An à 23 h 30, complété le 1er janvier à 00 h 15
  ('a1000000-0000-4000-8000-0000000f0005', 'a1000000-0000-4000-8000-000000000001', 'J-5',  'Lavage de vitres',          'a1000000-0000-4000-8000-0000000c0006', 'François Pelletier', null, 'a1000000-0000-4000-8000-00000000077a', 'completed', 'recurring',  50000,  7488,  57488,     0, '2025-12-31 23:30 America/Toronto', '2026-01-01 00:15 America/Toronto', null, '12 rue Principale, Granby, QC J2G 1A1',  45.4000, -72.7300, null),
  ('a1000000-0000-4000-8000-0000000f0006', 'a1000000-0000-4000-8000-000000000001', 'J-6',  'Nettoyage de gouttières',   'a1000000-0000-4000-8000-0000000c0007', 'Gisèle Morin',   null, 'a1000000-0000-4000-8000-00000000077b', 'cancelled', 'one_off',    20000,  2995,  22995,     0, '2026-09-12 10:00 America/Toronto', null, null, '5 rue du Lac, Bromont, QC J2L 1A1',     45.3200, -72.6500, null),
  -- créé le 8 mars 2026 à 03 h 30 HAE (passage à l'heure d'été), 3 visites
  ('a1000000-0000-4000-8000-0000000f0007', 'a1000000-0000-4000-8000-000000000001', 'J-7',  'Lavage à pression',         'a1000000-0000-4000-8000-0000000c0002', 'Bruno Gagnon',   null, 'a1000000-0000-4000-8000-00000000077a', 'in_progress', 'one_off', 100000, 14975, 114975,     0, '2026-03-08 03:30 America/Toronto', null, null, '5 rue du Lac, Bromont, QC J2L 1A1',     45.3200, -72.6500, null),
  -- 2 novembre 2025 01 h 30, PREMIÈRE occurrence (HAE, -04) : l'heure qui se répète au retour à l'heure normale
  ('a1000000-0000-4000-8000-0000000f0008', 'a1000000-0000-4000-8000-000000000001', 'J-8',  'Lavage de vitres',          'a1000000-0000-4000-8000-0000000c0006', 'François Pelletier', null, 'a1000000-0000-4000-8000-00000000077b', 'completed', 'recurring',  50000,  7488,  57488,     0, '2025-11-02 01:30-04', '2025-11-02 11:00 America/Toronto', null, '12 rue Principale, Granby, QC J2G 1A1',  45.4000, -72.7300, null),
  ('a1000000-0000-4000-8000-0000000f0009', 'a1000000-0000-4000-8000-000000000001', 'J-9',  'Job supprimé',              'a1000000-0000-4000-8000-0000000c0008', 'Hugo Lavoie',    null, 'a1000000-0000-4000-8000-00000000077a', 'completed', 'one_off',   999900,     0, 999900,     0, '2026-08-10 10:00 America/Toronto', '2026-08-11 10:00 America/Toronto', null, '1 rue Test, Granby, QC', 45.4000, -72.7300, '2026-09-01 10:00 America/Toronto'),
  ('a1000000-0000-4000-8000-0000000f0010', 'a1000000-0000-4000-8000-000000000001', 'J-10', 'Traitement anti-mousse',    'a1000000-0000-4000-8000-0000000c0001', 'Alice Tremblay', null, 'a1000000-0000-4000-8000-00000000077a', 'draft',     'one_off',    20000,  2995,  22995,     0, '2026-09-15 10:00 America/Toronto', null, null, '12 rue Principale, Granby, QC J2G 1A1',  45.4000, -72.7300, null),
  -- 2e job du même lead converti : la conversion compte UN lead, pas deux
  ('a1000000-0000-4000-8000-0000000f0011', 'a1000000-0000-4000-8000-000000000001', 'J-11', 'Lavage de vitres',          'a1000000-0000-4000-8000-0000000c0003', 'Chantal Roy',    'a1000000-0000-4000-8000-0000000c0003', 'a1000000-0000-4000-8000-00000000077a', 'completed', 'one_off',  50000,  7488,  57488,  5000, '2026-09-20 10:00 America/Toronto', '2026-09-22 11:00 America/Toronto', 'a1000000-0000-4000-8000-0000000000a5', '8 rue King, Sherbrooke, QC J1H 1A1',   45.4000, -71.8900, null);

-- ── Six petits clients récents (200 $ HT chacun, septembre) ─────────────────
-- Ils ont un meilleur « score CLV » (récence) que François Pelletier (1 149,76 $, inactif depuis janvier) :
-- la carte « Top clients par revenu », qui prend les 6 meilleurs SCORES puis trie par revenu, le perd.
insert into public.clients (id, org_id, first_name, last_name, email, status, source, created_at)
select ('a1000000-0000-4000-8000-0000000c00' || lpad((8 + g)::text, 2, '0'))::uuid, 'a1000000-0000-4000-8000-000000000001',
       'Petit', 'Client ' || g, 'petit' || g || '@fixture.lume.test', 'active', 'Google', '2026-09-01 10:00 America/Toronto'
  from generate_series(1, 6) g;
insert into public.jobs (id, org_id, job_number, title, client_id, client_name, team_id, status, job_type,
  subtotal_cents, tax_cents, total_cents, expenses_cents, created_at, completed_at, property_address)
select ('a1000000-0000-4000-8000-0000000f00' || lpad((11 + g)::text, 2, '0'))::uuid, 'a1000000-0000-4000-8000-000000000001',
       'J-' || (11 + g), 'Nettoyage de gouttières', ('a1000000-0000-4000-8000-0000000c00' || lpad((8 + g)::text, 2, '0'))::uuid,
       'Petit Client ' || g, 'a1000000-0000-4000-8000-00000000077b', 'completed', 'one_off', 20000, 2995, 22995, 0,
       ('2026-09-2' || g || ' 09:00')::timestamp at time zone 'America/Toronto', ('2026-09-2' || g || ' 12:00')::timestamp at time zone 'America/Toronto',
       '3 rue Merry, Magog, QC J1X 1A1'
  from generate_series(1, 6) g;

-- « Dernière activité » (scores CLV / risque de départ) lit jobs.updated_at : on la fige à la
-- dernière vraie date du job, sinon elle vaudrait « aujourd'hui » pour tout le monde.
update public.jobs set updated_at = coalesce(completed_at, created_at)
 where org_id = 'a1000000-0000-4000-8000-000000000001';

-- ── Visites (schedule_events) ───────────────────────────────────────────────
insert into public.schedule_events (id, org_id, job_id, title, team_id, status, start_at, end_at, start_time, end_time, timezone) values
  ('a1000000-0000-4000-8000-0000000e0001', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f0001', 'J-1', 'a1000000-0000-4000-8000-00000000077a', 'completed', '2026-08-05 08:00 America/Toronto', '2026-08-05 16:00 America/Toronto', '2026-08-05 08:00 America/Toronto', '2026-08-05 16:00 America/Toronto', 'America/Toronto'),
  ('a1000000-0000-4000-8000-0000000e0002', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f0002', 'J-2', 'a1000000-0000-4000-8000-00000000077a', 'completed', '2026-09-10 09:00 America/Toronto', '2026-09-10 11:00 America/Toronto', '2026-09-10 09:00 America/Toronto', '2026-09-10 11:00 America/Toronto', 'America/Toronto'),
  -- visite du 31 août à 21 h (Toronto) = 1er septembre 01 h UTC
  ('a1000000-0000-4000-8000-0000000e0003', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f0003', 'J-3', 'a1000000-0000-4000-8000-00000000077b', 'completed', '2026-08-31 21:00 America/Toronto', '2026-08-31 23:00 America/Toronto', '2026-08-31 21:00 America/Toronto', '2026-08-31 23:00 America/Toronto', 'America/Toronto'),
  ('a1000000-0000-4000-8000-0000000e0004', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f0004', 'J-4', 'a1000000-0000-4000-8000-00000000077b', 'scheduled', '2026-10-06 09:00 America/Toronto', '2026-10-06 12:00 America/Toronto', '2026-10-06 09:00 America/Toronto', '2026-10-06 12:00 America/Toronto', 'America/Toronto'),
  ('a1000000-0000-4000-8000-0000000e0005', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f0005', 'J-5', 'a1000000-0000-4000-8000-00000000077a', 'completed', '2025-12-31 20:00 America/Toronto', '2025-12-31 23:00 America/Toronto', '2025-12-31 20:00 America/Toronto', '2025-12-31 23:00 America/Toronto', 'America/Toronto'),
  ('a1000000-0000-4000-8000-0000000e0071', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f0007', 'J-7 (1/3)', 'a1000000-0000-4000-8000-00000000077a', 'completed', '2026-03-08 09:00 America/Toronto', '2026-03-08 12:00 America/Toronto', '2026-03-08 09:00 America/Toronto', '2026-03-08 12:00 America/Toronto', 'America/Toronto'),
  ('a1000000-0000-4000-8000-0000000e0072', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f0007', 'J-7 (2/3)', 'a1000000-0000-4000-8000-00000000077a', 'completed', '2026-03-15 09:00 America/Toronto', '2026-03-15 12:00 America/Toronto', '2026-03-15 09:00 America/Toronto', '2026-03-15 12:00 America/Toronto', 'America/Toronto'),
  ('a1000000-0000-4000-8000-0000000e0073', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f0007', 'J-7 (3/3)', 'a1000000-0000-4000-8000-00000000077a', 'scheduled', '2026-10-13 09:00 America/Toronto', '2026-10-13 12:00 America/Toronto', '2026-10-13 09:00 America/Toronto', '2026-10-13 12:00 America/Toronto', 'America/Toronto'),
  ('a1000000-0000-4000-8000-0000000e0008', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f0008', 'J-8', 'a1000000-0000-4000-8000-00000000077b', 'completed', '2025-11-02 09:00 America/Toronto', '2025-11-02 11:00 America/Toronto', '2025-11-02 09:00 America/Toronto', '2025-11-02 11:00 America/Toronto', 'America/Toronto'),
  ('a1000000-0000-4000-8000-0000000e0011', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000f0011', 'J-11', 'a1000000-0000-4000-8000-00000000077a', 'completed', '2026-09-22 09:00 America/Toronto', '2026-09-22 11:00 America/Toronto', '2026-09-22 09:00 America/Toronto', '2026-09-22 11:00 America/Toronto', 'America/Toronto');

-- ── Pointages (main-d'œuvre de la rentabilité) ──────────────────────────────
--  J-1 : Théo 08 h–12 h, pause 30 min = 3,5 h × 25,00 $ = 87,50 $ ; Tina 13 h–16 h = 3 h × 32,50 $ = 97,50 $
--  J-2 : Théo 2 h = 50,00 $ · J-3 : Tina 2 h = 65,00 $ · J-11 : Théo 1,5 h = 37,50 $
insert into public.time_entries (id, org_id, employee_id, employee_name, job_id, team_id, date, punch_in, punch_out, punch_in_at, punch_out_at, breaks, status) values
  ('a1000000-0000-4000-8000-0000000d0001', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a3', 'Théo Technicien',   'a1000000-0000-4000-8000-0000000f0001', 'a1000000-0000-4000-8000-00000000077a', '2026-08-05', '08:00', '12:00', '2026-08-05 08:00 America/Toronto', '2026-08-05 12:00 America/Toronto', '[{"start":"2026-08-05T14:00:00Z","end":"2026-08-05T14:30:00Z"}]', 'completed'),
  ('a1000000-0000-4000-8000-0000000d0002', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a4', 'Tina Technicienne', 'a1000000-0000-4000-8000-0000000f0001', 'a1000000-0000-4000-8000-00000000077b', '2026-08-05', '13:00', '16:00', '2026-08-05 13:00 America/Toronto', '2026-08-05 16:00 America/Toronto', '[]', 'completed'),
  ('a1000000-0000-4000-8000-0000000d0003', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a3', 'Théo Technicien',   'a1000000-0000-4000-8000-0000000f0002', 'a1000000-0000-4000-8000-00000000077a', '2026-09-10', '09:00', '11:00', '2026-09-10 09:00 America/Toronto', '2026-09-10 11:00 America/Toronto', '[]', 'completed'),
  ('a1000000-0000-4000-8000-0000000d0004', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a4', 'Tina Technicienne', 'a1000000-0000-4000-8000-0000000f0003', 'a1000000-0000-4000-8000-00000000077b', '2026-08-31', '21:00', '23:00', '2026-08-31 21:00 America/Toronto', '2026-08-31 23:00 America/Toronto', '[]', 'completed'),
  ('a1000000-0000-4000-8000-0000000d0005', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a3', 'Théo Technicien',   'a1000000-0000-4000-8000-0000000f0011', 'a1000000-0000-4000-8000-00000000077a', '2026-09-22', '09:00', '10:30', '2026-09-22 09:00 America/Toronto', '2026-09-22 10:30 America/Toronto', '[]', 'completed');

-- ── Factures (T1) ───────────────────────────────────────────────────────────
-- Insérées « émises » (issued_at) ; le statut, paid_cents et balance_cents sont posés par les triggers
-- (invoices_apply_status_logic puis recalculate_invoice_from_payments à chaque paiement).
insert into public.invoices (id, org_id, client_id, job_id, invoice_number, subject, subtotal_cents, tax_cents, total_cents, paid_cents,
  issued_at, due_date, paid_at, status, is_recurring, recurrence_interval, salesperson_id, created_at, deleted_at) values
  ('a1000000-0000-4000-8000-0000000a0001', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0001', 'a1000000-0000-4000-8000-0000000f0001', 'F-1',  'Vitres',        100000, 14975, 114975, 0, '2026-08-05 17:00 America/Toronto', '2026-08-20', null, 'sent', false, null, 'a1000000-0000-4000-8000-0000000000a5', '2026-08-05 17:00 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000a0002', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0001', 'a1000000-0000-4000-8000-0000000f0002', 'F-2',  'Vitres',         50000,  7488,  57488, 0, '2026-09-10 13:00 America/Toronto', '2026-10-10', null, 'sent', false, null, null, '2026-09-10 13:00 America/Toronto', null),
  -- émise le 31 août 23 h 30 (Toronto) : facturée en AOÛT
  ('a1000000-0000-4000-8000-0000000a0003', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0002', 'a1000000-0000-4000-8000-0000000f0003', 'F-3',  'Gouttières',     20000,  2995,  22995, 0, '2026-08-31 23:30 America/Toronto', '2026-09-15', null, 'sent', false, null, null, '2026-08-31 23:30 America/Toronto', null),
  -- impayée, échue le 14 août : en retard
  ('a1000000-0000-4000-8000-0000000a0004', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0002', null,                                    'F-4',  'Pression',      100000, 14975, 114975, 0, '2026-07-15 10:00 America/Toronto', '2026-08-14', null, 'sent', false, null, null, '2026-07-15 10:00 America/Toronto', null),
  -- émise la veille du jour de l'An à 23 h 30 : facturée en DÉCEMBRE 2025
  ('a1000000-0000-4000-8000-0000000a0005', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0006', 'a1000000-0000-4000-8000-0000000f0005', 'F-5',  'Vitres',         50000,  7488,  57488, 0, '2025-12-31 23:30 America/Toronto', '2026-01-30', null, 'sent', false, null, null, '2025-12-31 23:30 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000a0006', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0007', null,                                    'F-6',  'Annulée',        20000,  2995,  22995, 0, '2026-09-01 10:00 America/Toronto', '2026-09-30', null, 'sent', false, null, null, '2026-09-01 10:00 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000a0007', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0002', 'a1000000-0000-4000-8000-0000000f0007', 'F-7',  'Pression (DST)',100000, 14975, 114975, 0, '2026-03-08 03:30 America/Toronto', '2026-04-07', null, 'sent', false, null, null, '2026-03-08 03:30 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000a0008', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0006', 'a1000000-0000-4000-8000-0000000f0008', 'F-8',  'Vitres (DST)',   50000,  7488,  57488, 0, '2025-11-02 01:30-04', '2025-12-02', null, 'sent', false, null, null, '2025-11-02 01:30-04', null),
  ('a1000000-0000-4000-8000-0000000a0009', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0006', null,                                    'F-9',  'Entretien mensuel', 20000, 2995, 22995, 0, '2026-09-01 10:00 America/Toronto', '2026-09-15', null, 'sent', true, 'monthly', null, '2026-09-01 10:00 America/Toronto', null),
  -- IMPORTÉE payée (comme les 618 factures Jobber en prod) : aucune ligne de paiement
  ('a1000000-0000-4000-8000-0000000a0010', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0001', null,                                    'F-10', 'Importée',       50000,  7488,  57488, 57488, '2026-06-10 10:00 America/Toronto', '2026-06-25', '2026-06-20 14:00 America/Toronto', 'paid', false, null, null, '2026-06-10 10:00 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000a0011', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0002', null,                                    'F-11', 'Brouillon',      20000,  2995,  22995, 0, null, null, null, 'draft', false, null, null, '2026-09-18 10:00 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000a0012', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0003', 'a1000000-0000-4000-8000-0000000f0011', 'F-12', 'Vitres',         50000,  7488,  57488, 0, '2026-09-22 12:00 America/Toronto', '2026-10-22', null, 'sent', false, null, 'a1000000-0000-4000-8000-0000000000a5', '2026-09-22 12:00 America/Toronto', null),
  ('a1000000-0000-4000-8000-0000000a0013', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0001', null,                                    'F-13', 'Supprimée',     100000, 14975, 114975, 0, '2026-09-05 10:00 America/Toronto', '2026-09-20', null, 'sent', false, null, null, '2026-09-05 10:00 America/Toronto', null);

-- Annulation (void) de F-6 et suppression douce de F-13, comme le fait l'app.
update public.invoices set status = 'void' where id = 'a1000000-0000-4000-8000-0000000a0006';
update public.invoices set deleted_at = '2026-09-06 10:00 America/Toronto' where id = 'a1000000-0000-4000-8000-0000000a0013';

-- ── Paiements (T1) ──────────────────────────────────────────────────────────
insert into public.payments (id, org_id, invoice_id, client_id, job_id, amount_cents, tip_cents, method, status, provider, payment_date, paid_at, created_at) values
  ('a1000000-0000-4000-8000-0000000b0001', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0001', 'a1000000-0000-4000-8000-0000000c0001', 'a1000000-0000-4000-8000-0000000f0001', 114975, 0,    'card',          'succeeded', 'stripe', '2026-08-10 12:00 America/Toronto', '2026-08-10 12:00 America/Toronto', '2026-08-10 12:00 America/Toronto'),
  ('a1000000-0000-4000-8000-0000000b0002', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0002', 'a1000000-0000-4000-8000-0000000c0001', 'a1000000-0000-4000-8000-0000000f0002',  20000, 0,    'cash',          'succeeded', 'manual', '2026-09-12 12:00 America/Toronto', '2026-09-12 12:00 America/Toronto', '2026-09-12 12:00 America/Toronto'),
  -- payé le 31 août à 23 h 50 (Toronto) = 1er septembre 03 h 50 UTC : un encaissement d'AOÛT
  ('a1000000-0000-4000-8000-0000000b0003', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0003', 'a1000000-0000-4000-8000-0000000c0002', 'a1000000-0000-4000-8000-0000000f0003',  22995, 0,    'e-transfer',    'succeeded', 'manual', '2026-08-31 23:50 America/Toronto', '2026-08-31 23:50 America/Toronto', '2026-08-31 23:50 America/Toronto'),
  -- payé le 1er janvier 00 h 15 : encaissé en JANVIER 2026 (facturé en décembre 2025)
  ('a1000000-0000-4000-8000-0000000b0005', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0005', 'a1000000-0000-4000-8000-0000000c0006', 'a1000000-0000-4000-8000-0000000f0005',  57488, 0,    'card',          'succeeded', 'stripe', '2026-01-01 00:15 America/Toronto', '2026-01-01 00:15 America/Toronto', '2026-01-01 00:15 America/Toronto'),
  ('a1000000-0000-4000-8000-0000000b0007', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0007', 'a1000000-0000-4000-8000-0000000c0002', 'a1000000-0000-4000-8000-0000000f0007', 114975, 0,    'card',          'succeeded', 'stripe', '2026-03-09 12:00 America/Toronto', '2026-03-09 12:00 America/Toronto', '2026-03-09 12:00 America/Toronto'),
  ('a1000000-0000-4000-8000-0000000b0008', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0008', 'a1000000-0000-4000-8000-0000000c0006', 'a1000000-0000-4000-8000-0000000f0008',  57488, 0,    'card',          'succeeded', 'stripe', '2025-11-02 10:00 America/Toronto', '2025-11-02 10:00 America/Toronto', '2025-11-02 10:00 America/Toronto'),
  ('a1000000-0000-4000-8000-0000000b0009', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0009', 'a1000000-0000-4000-8000-0000000c0006', null,                                     22995, 0,    'card',          'succeeded', 'stripe', '2026-09-01 10:05 America/Toronto', '2026-09-01 10:05 America/Toronto', '2026-09-01 10:05 America/Toronto'),
  -- pourboire de 10,00 $ : encaissé à part (tip_cents), ce n'est pas du revenu de la facture
  ('a1000000-0000-4000-8000-0000000b0012', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0012', 'a1000000-0000-4000-8000-0000000c0003', 'a1000000-0000-4000-8000-0000000f0011',  57488, 1000, 'e-transfer',    'succeeded', 'manual', '2026-09-25 12:00 America/Toronto', '2026-09-25 12:00 America/Toronto', '2026-09-25 12:00 America/Toronto'),
  ('a1000000-0000-4000-8000-0000000b0013', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0013', 'a1000000-0000-4000-8000-0000000c0001', null,                                    114975, 0,    'card',          'succeeded', 'stripe', '2026-09-05 12:00 America/Toronto', '2026-09-05 12:00 America/Toronto', '2026-09-05 12:00 America/Toronto'),
  ('a1000000-0000-4000-8000-0000000b0014', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0004', 'a1000000-0000-4000-8000-0000000c0002', null,                                    114975, 0,    'card',          'failed',    'stripe', '2026-08-20 12:00 America/Toronto', '2026-08-20 12:00 America/Toronto', '2026-08-20 12:00 America/Toronto'),
  ('a1000000-0000-4000-8000-0000000b0015', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000a0002', 'a1000000-0000-4000-8000-0000000c0001', null,                                     10000, 0,    'card',          'pending',   'stripe', '2026-09-28 12:00 America/Toronto', '2026-09-28 12:00 America/Toronto', '2026-09-28 12:00 America/Toronto');

-- Remboursements, comme les écrit server/routes/payments.ts : refunded_cents absolu,
-- statut 'refunded' seulement si TOUT est rendu.
update public.payments set refunded_cents = 30000 where id = 'a1000000-0000-4000-8000-0000000b0007';                            -- partiel : 300,00 $ rendus
update public.payments set refunded_cents = 57488, status = 'refunded' where id = 'a1000000-0000-4000-8000-0000000b0008';      -- total
update public.payments set deleted_at = '2026-09-06 10:00 America/Toronto' where id = 'a1000000-0000-4000-8000-0000000b0013';

-- ── Soumissions (T1) ────────────────────────────────────────────────────────
insert into public.quotes (id, org_id, quote_number, title, client_id, lead_id, status, subtotal_cents, tax_cents, total_cents, created_at, approved_at, declined_at, expired_at, converted_at, deleted_at) values
  ('a1000000-0000-4000-8000-000000009001', 'a1000000-0000-4000-8000-000000000001', 'S-1', 'Vitres',     'a1000000-0000-4000-8000-0000000c0001', null, 'approved',          100000, 14975, 114975, '2026-07-20 10:00 America/Toronto', '2026-07-25 10:00 America/Toronto', null, null, null, null),
  ('a1000000-0000-4000-8000-000000009002', 'a1000000-0000-4000-8000-000000000001', 'S-2', 'Gouttières', 'a1000000-0000-4000-8000-0000000c0002', null, 'converted',          20000,  2995,  22995, '2026-08-20 10:00 America/Toronto', '2026-08-22 10:00 America/Toronto', null, null, '2026-08-25 10:00 America/Toronto', null),
  ('a1000000-0000-4000-8000-000000009003', 'a1000000-0000-4000-8000-000000000001', 'S-3', 'Pression',   null, 'a1000000-0000-4000-8000-0000000c0004', 'declined',           50000,  7488,  57488, '2026-09-05 10:00 America/Toronto', null, '2026-09-08 10:00 America/Toronto', null, null, null),
  -- créée le 31 août à 23 h 30 (Toronto) : une soumission d'AOÛT
  ('a1000000-0000-4000-8000-000000009004', 'a1000000-0000-4000-8000-000000000001', 'S-4', 'Gouttières', null, 'a1000000-0000-4000-8000-0000000c0005', 'expired',            20000,  2995,  22995, '2026-08-31 23:30 America/Toronto', null, null, '2026-09-30 10:00 America/Toronto', null, null),
  ('a1000000-0000-4000-8000-000000009005', 'a1000000-0000-4000-8000-000000000001', 'S-5', 'Pression',   null, 'a1000000-0000-4000-8000-0000000c0004', 'awaiting_response',  33333,  4992,  38325, '2026-09-15 10:00 America/Toronto', null, null, null, null, null),
  ('a1000000-0000-4000-8000-000000009006', 'a1000000-0000-4000-8000-000000000001', 'S-6', 'Vitres',     'a1000000-0000-4000-8000-0000000c0003', null, 'draft',              50000,  7488,  57488, '2026-09-18 10:00 America/Toronto', null, null, null, null, null),
  ('a1000000-0000-4000-8000-000000009007', 'a1000000-0000-4000-8000-000000000001', 'S-7', 'Supprimée',  'a1000000-0000-4000-8000-0000000c0001', null, 'approved',         999900,     0, 999900, '2026-09-02 10:00 America/Toronto', '2026-09-03 10:00 America/Toronto', null, null, null, '2026-09-04 10:00 America/Toronto');

-- ── Commissions (vendeur a5) ────────────────────────────────────────────────
insert into public.fs_commission_rules (id, org_id, name, type, percentage, applies_to_user_id, is_active) values
  ('a1000000-0000-4000-8000-000000008001', 'a1000000-0000-4000-8000-000000000001', 'Vendeur 10 %', 'percentage', 10, 'a1000000-0000-4000-8000-0000000000a5', true);
insert into public.fs_commission_entries (id, org_id, user_id, rule_id, job_id, invoice_id, status, amount, base_amount, triggered_at) values
  ('a1000000-0000-4000-8000-000000008101', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a5', 'a1000000-0000-4000-8000-000000008001', 'a1000000-0000-4000-8000-0000000f0001', 'a1000000-0000-4000-8000-0000000a0001', 'approved', 100.00, 1000.00, '2026-08-10 12:00 America/Toronto'),
  ('a1000000-0000-4000-8000-000000008102', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000000a5', 'a1000000-0000-4000-8000-000000008001', 'a1000000-0000-4000-8000-0000000f0011', 'a1000000-0000-4000-8000-0000000a0012', 'pending',   50.00,  500.00, '2026-09-25 12:00 America/Toronto');

-- ── Pipeline (T1) ───────────────────────────────────────────────────────────
insert into public.pipeline_deals (id, org_id, lead_id, client_id, title, stage, value_cents, created_at, won_at, lost_at, lost_reason) values
  ('a1000000-0000-4000-8000-000000007001', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0003', 'a1000000-0000-4000-8000-0000000c0003', 'Chantal — vitres',     'closed_won',  57488, '2026-08-15 10:00 America/Toronto', '2026-08-25 10:00 America/Toronto', null, null),
  ('a1000000-0000-4000-8000-000000007002', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0004', null,                                    'Denis — pression',     'closed_lost', 57488, '2026-09-03 10:00 America/Toronto', null, '2026-09-08 10:00 America/Toronto', 'Prix'),
  ('a1000000-0000-4000-8000-000000007003', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-0000000c0005', null,                                    'Émilie — gouttières',  'quote_sent',  22995, '2026-08-31 23:30 America/Toronto', null, null, null);

-- Les deals créés par trg_auto_pipeline_deal_from_quote naissent à now() : on les date
-- comme leur soumission, sinon le jeu dépendrait du jour où il est chargé.
update public.pipeline_deals d
   set created_at = q.created_at,
       won_at = case when d.stage = 'closed_won' then coalesce(q.approved_at, q.converted_at, q.created_at) end,
       updated_at = coalesce(q.approved_at, q.converted_at, q.created_at)
  from public.quotes q
 where q.id = d.quote_id and d.org_id = 'a1000000-0000-4000-8000-000000000001';

-- Idem pour les deals « source = 'job' » que sync_job_leaderboard_deal crée pour
-- chaque job qui a un vendeur (won_at = now()).
update public.pipeline_deals d
   set created_at = j.created_at, won_at = j.created_at, updated_at = j.created_at
  from public.jobs j
 where j.id = d.job_id and d.source = 'job' and d.org_id = 'a1000000-0000-4000-8000-000000000001';

-- ── T2 « Autre Entreprise » : ne doit jamais apparaître ─────────────────────
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-0000000000b1","role":"authenticated"}', false);
insert into public.clients (id, org_id, first_name, last_name, email, status, source, created_at) values
  ('b2000000-0000-4000-8000-0000000c0001', 'b2000000-0000-4000-8000-000000000001', 'Zoé', 'Intruse', 'zoe@autre.lume.test', 'active', 'Google', '2026-08-01 10:00 America/Toronto'),
  ('b2000000-0000-4000-8000-0000000c0002', 'b2000000-0000-4000-8000-000000000001', 'Yves', 'Prospect', 'yves@autre.lume.test', 'lead', 'Google', '2026-09-02 10:00 America/Toronto');
insert into public.jobs (id, org_id, job_number, title, client_id, client_name, team_id, status, job_type, subtotal_cents, tax_cents, total_cents, expenses_cents, created_at, completed_at, property_address, latitude, longitude) values
  ('b2000000-0000-4000-8000-0000000f0001', 'b2000000-0000-4000-8000-000000000001', 'X-1', 'Service Fantôme', 'b2000000-0000-4000-8000-0000000c0001', 'Zoé Intruse', 'b2000000-0000-4000-8000-00000000077a', 'completed', 'one_off', 7777777, 0, 7777777, 0, '2026-08-15 10:00 America/Toronto', '2026-08-16 10:00 America/Toronto', '1 rue Fantôme, Magog, QC', 45.2600, -72.1400);
insert into public.schedule_events (id, org_id, job_id, title, team_id, status, start_at, end_at, start_time, end_time, timezone) values
  ('b2000000-0000-4000-8000-0000000e0001', 'b2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-0000000f0001', 'X-1', 'b2000000-0000-4000-8000-00000000077a', 'completed', '2026-08-16 09:00 America/Toronto', '2026-08-16 10:00 America/Toronto', '2026-08-16 09:00 America/Toronto', '2026-08-16 10:00 America/Toronto', 'America/Toronto');
insert into public.invoices (id, org_id, client_id, job_id, invoice_number, subject, subtotal_cents, tax_cents, total_cents, paid_cents, issued_at, due_date, status, created_at) values
  ('b2000000-0000-4000-8000-0000000a0001', 'b2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-0000000c0001', 'b2000000-0000-4000-8000-0000000f0001', 'X-F1', 'Fantôme', 7777777, 0, 7777777, 0, '2026-08-16 11:00 America/Toronto', '2026-08-01', 'sent', '2026-08-16 11:00 America/Toronto'),
  ('b2000000-0000-4000-8000-0000000a0002', 'b2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-0000000c0001', null, 'X-F2', 'Fantôme impayée', 7777777, 0, 7777777, 0, '2026-08-16 11:00 America/Toronto', '2026-08-20', 'sent', '2026-08-16 11:00 America/Toronto');
insert into public.payments (id, org_id, invoice_id, client_id, amount_cents, method, status, provider, payment_date, paid_at) values
  ('b2000000-0000-4000-8000-0000000b0001', 'b2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-0000000a0001', 'b2000000-0000-4000-8000-0000000c0001', 7777777, 'check', 'succeeded', 'manual', '2026-08-17 12:00 America/Toronto', '2026-08-17 12:00 America/Toronto');
insert into public.quotes (id, org_id, quote_number, title, client_id, status, subtotal_cents, tax_cents, total_cents, created_at, approved_at) values
  ('b2000000-0000-4000-8000-000000009001', 'b2000000-0000-4000-8000-000000000001', 'X-S1', 'Fantôme', 'b2000000-0000-4000-8000-0000000c0001', 'approved', 7777777, 0, 7777777, '2026-08-10 10:00 America/Toronto', '2026-08-11 10:00 America/Toronto');
insert into public.pipeline_deals (id, org_id, lead_id, title, stage, value_cents, created_at, won_at) values
  ('b2000000-0000-4000-8000-000000007001', 'b2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-0000000c0002', 'Fantôme', 'closed_won', 7777777, '2026-08-10 10:00 America/Toronto', '2026-08-12 10:00 America/Toronto');
select set_config('request.jwt.claims', '', false);
