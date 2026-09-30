-- ============================================================================
-- T4 « Volume Lavage » : le tenant volumineux de l'audit Statistiques (performance).
-- BASE LOCALE JETABLE UNIQUEMENT. Chargé par : node scripts/qa/stats-fixture.mjs --volume
--   20 000 clients · 50 000 jobs · 100 000 factures · 100 000 paiements · 30 000 visites
--   5 000 soumissions · 2 000 deals · 20 000 pointages — répartis sur 3 ans.
-- Les triggers sont coupés pendant l'insertion en masse (session_replication_role) :
-- seuls le volume et la distribution comptent ici, pas les montants.
-- ============================================================================
set session timezone = 'UTC';
select set_config('request.jwt.claims', '{"sub":"d4000000-0000-4000-8000-0000000000d1","role":"authenticated"}', false);

insert into public.orgs (id, name, created_by) values
  ('d4000000-0000-4000-8000-000000000001', 'Volume Lavage', 'd4000000-0000-4000-8000-0000000000d1');
insert into public.company_settings (org_id, company_name, timezone, currency, default_language)
values ('d4000000-0000-4000-8000-000000000001', 'Volume Lavage', 'America/Toronto', 'CAD', 'fr')
on conflict (org_id) do update set timezone = excluded.timezone;
insert into public.memberships (user_id, org_id, role, status, full_name, hourly_rate_cents, compensation_mode, scope)
values ('d4000000-0000-4000-8000-0000000000d1', 'd4000000-0000-4000-8000-000000000001', 'owner', 'active', 'Volume Proprio', 0, 'hourly', 'company')
on conflict (user_id, org_id) do nothing;

set session_replication_role = replica;

insert into public.teams (id, org_id, name, is_active)
select ('d4000000-0000-4000-8000-0000000007' || lpad(g::text, 2, '0'))::uuid, 'd4000000-0000-4000-8000-000000000001', 'Équipe ' || g, true
  from generate_series(1, 8) g;

insert into public.clients (id, org_id, first_name, last_name, email, status, source, created_at, created_by)
select ('d4000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'd4000000-0000-4000-8000-000000000001',
       'Client', 'N' || g, 'c' || g || '@volume.lume.test', case when g % 5 = 0 then 'lead' else 'active' end,
       (array['Google', 'Facebook', 'Référence', 'Porte-à-porte'])[1 + g % 4],
       timestamptz '2023-10-01 10:00-04' + (g * interval '75 minutes'), 'd4000000-0000-4000-8000-0000000000d1'
  from generate_series(1, 20000) g;

insert into public.jobs (id, org_id, job_number, title, client_id, client_name, lead_id, team_id, status, job_type,
  subtotal_cents, tax_cents, total_cents, expenses_cents, created_at, updated_at, completed_at, property_address, latitude, longitude, created_by)
select ('d4000001-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'd4000000-0000-4000-8000-000000000001', 'V-' || g,
       (array['Lavage de vitres', 'Nettoyage de gouttières', 'Lavage à pression', 'Traitement anti-mousse', 'Scellant'])[1 + g % 5],
       ('d4000000-0000-4000-8000-' || lpad(to_hex(1 + g % 20000), 12, '0'))::uuid, 'Client N' || (1 + g % 20000),
       case when g % 7 = 0 then ('d4000000-0000-4000-8000-' || lpad(to_hex(1 + g % 20000), 12, '0'))::uuid end,
       ('d4000000-0000-4000-8000-0000000007' || lpad((1 + g % 8)::text, 2, '0'))::uuid,
       (array['completed', 'completed', 'completed', 'scheduled', 'in_progress', 'cancelled', 'draft'])[1 + g % 7],
       case when g % 3 = 0 then 'recurring' else 'one_off' end,
       10000 + (g % 90) * 1000, round((10000 + (g % 90) * 1000) * 0.14975)::int, 10000 + (g % 90) * 1000 + round((10000 + (g % 90) * 1000) * 0.14975)::int,
       (g % 11) * 500,
       timestamptz '2023-10-01 08:00-04' + (g * interval '31 minutes'), timestamptz '2023-10-01 08:00-04' + (g * interval '31 minutes') + interval '2 days',
       case when (1 + g % 7) <= 3 then timestamptz '2023-10-01 08:00-04' + (g * interval '31 minutes') + interval '2 days' end,
       (g % 300) || ' rue Principale, ' || (array['Granby', 'Bromont', 'Sherbrooke', 'Magog', 'Cowansville', 'Waterloo'])[1 + g % 6] || ', QC',
       45.2 + (g % 60) * 0.005, -72.9 + (g % 60) * 0.02, 'd4000000-0000-4000-8000-0000000000d1'
  from generate_series(1, 50000) g;

insert into public.schedule_events (id, org_id, job_id, title, team_id, status, start_at, end_at, start_time, end_time, timezone, created_by)
select ('d4000002-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'd4000000-0000-4000-8000-000000000001',
       ('d4000001-0000-4000-8000-' || lpad(to_hex(1 + (g * 5 / 3) % 50000), 12, '0'))::uuid, 'Visite ' || g,
       ('d4000000-0000-4000-8000-0000000007' || lpad((1 + g % 8)::text, 2, '0'))::uuid, 'completed',
       timestamptz '2023-10-02 09:00-04' + (g * interval '52 minutes'), timestamptz '2023-10-02 11:00-04' + (g * interval '52 minutes'),
       timestamptz '2023-10-02 09:00-04' + (g * interval '52 minutes'), timestamptz '2023-10-02 11:00-04' + (g * interval '52 minutes'),
       'America/Toronto', 'd4000000-0000-4000-8000-0000000000d1'
  from generate_series(1, 30000) g;

insert into public.invoices (id, org_id, client_id, job_id, invoice_number, subject, subtotal_cents, tax_cents, total_cents,
  paid_cents, balance_cents, issued_at, due_date, paid_at, status, created_at, created_by)
select ('d4000003-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'd4000000-0000-4000-8000-000000000001',
       ('d4000000-0000-4000-8000-' || lpad(to_hex(1 + g % 20000), 12, '0'))::uuid,
       case when g <= 50000 then ('d4000001-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid end,
       'VF-' || g, 'Facture', 10000 + (g % 90) * 1000, round((10000 + (g % 90) * 1000) * 0.14975)::int,
       10000 + (g % 90) * 1000 + round((10000 + (g % 90) * 1000) * 0.14975)::int,
       case when g % 10 < 8 then 10000 + (g % 90) * 1000 + round((10000 + (g % 90) * 1000) * 0.14975)::int else 0 end,
       case when g % 10 < 8 then 0 else 10000 + (g % 90) * 1000 + round((10000 + (g % 90) * 1000) * 0.14975)::int end,
       timestamptz '2023-10-01 12:00-04' + (g * interval '15 minutes'),
       (timestamptz '2023-10-01 12:00-04' + (g * interval '15 minutes') + interval '30 days')::date,
       case when g % 10 < 8 then timestamptz '2023-10-01 12:00-04' + (g * interval '15 minutes') + interval '6 days' end,
       case when g % 10 < 8 then 'paid' when g % 10 = 8 then 'sent' else 'void' end,
       timestamptz '2023-10-01 12:00-04' + (g * interval '15 minutes'), 'd4000000-0000-4000-8000-0000000000d1'
  from generate_series(1, 100000) g;

insert into public.payments (id, org_id, invoice_id, client_id, amount_cents, method, status, provider, payment_date, paid_at, created_at, created_by)
select ('d4000004-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'd4000000-0000-4000-8000-000000000001',
       ('d4000003-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('d4000000-0000-4000-8000-' || lpad(to_hex(1 + g % 20000), 12, '0'))::uuid,
       10000 + (g % 90) * 1000 + round((10000 + (g % 90) * 1000) * 0.14975)::int,
       (array['card', 'e-transfer', 'cash', 'check'])[1 + g % 4], case when g % 10 < 8 then 'succeeded' else 'pending' end, 'manual',
       timestamptz '2023-10-01 12:00-04' + (g * interval '15 minutes') + interval '6 days',
       timestamptz '2023-10-01 12:00-04' + (g * interval '15 minutes') + interval '6 days',
       timestamptz '2023-10-01 12:00-04' + (g * interval '15 minutes') + interval '6 days', 'd4000000-0000-4000-8000-0000000000d1'
  from generate_series(1, 100000) g;

insert into public.quotes (id, org_id, quote_number, title, client_id, status, subtotal_cents, tax_cents, total_cents, created_at, created_by)
select ('d4000005-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'd4000000-0000-4000-8000-000000000001', 'VS-' || g, 'Soumission',
       ('d4000000-0000-4000-8000-' || lpad(to_hex(1 + g % 20000), 12, '0'))::uuid,
       (array['draft', 'awaiting_response', 'approved', 'converted', 'declined', 'expired'])[1 + g % 6],
       20000 + (g % 50) * 1000, 0, 20000 + (g % 50) * 1000,
       timestamptz '2023-10-01 12:00-04' + (g * interval '5 hours'), 'd4000000-0000-4000-8000-0000000000d1'
  from generate_series(1, 5000) g;

insert into public.pipeline_deals (id, org_id, lead_id, title, stage, value_cents, created_at, updated_at, won_at, lost_at, source, created_by)
select ('d4000006-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'd4000000-0000-4000-8000-000000000001',
       ('d4000000-0000-4000-8000-' || lpad(to_hex(1 + g % 20000), 12, '0'))::uuid, 'Deal ' || g,
       (array['new_prospect', 'quote_sent', 'closed_won', 'closed_lost', 'no_response'])[1 + g % 5], 50000,
       timestamptz '2023-10-01 12:00-04' + (g * interval '13 hours'), timestamptz '2023-10-01 12:00-04' + (g * interval '13 hours') + interval '9 days',
       case when g % 5 = 2 then timestamptz '2023-10-01 12:00-04' + (g * interval '13 hours') + interval '7 days' end,
       case when g % 5 = 3 then timestamptz '2023-10-01 12:00-04' + (g * interval '13 hours') + interval '7 days' end,
       'manual', 'd4000000-0000-4000-8000-0000000000d1'
  from generate_series(1, 2000) g;

insert into public.time_entries (id, org_id, employee_id, employee_name, job_id, date, punch_in, punch_out, punch_in_at, punch_out_at, breaks, status)
select ('d4000007-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'd4000000-0000-4000-8000-000000000001',
       'd4000000-0000-4000-8000-0000000000d1', 'Volume Proprio',
       ('d4000001-0000-4000-8000-' || lpad(to_hex(1 + (g * 5 / 2) % 50000), 12, '0'))::uuid,
       (timestamptz '2023-10-02 08:00-04' + (g * interval '78 minutes'))::date, '08:00', '11:00',
       timestamptz '2023-10-02 08:00-04' + (g * interval '78 minutes'), timestamptz '2023-10-02 11:00-04' + (g * interval '78 minutes'), '[]', 'completed'
  from generate_series(1, 20000) g;

set session_replication_role = origin;
select set_config('request.jwt.claims', '', false);
analyze public.jobs; analyze public.invoices; analyze public.payments; analyze public.clients;
analyze public.schedule_events; analyze public.quotes; analyze public.pipeline_deals; analyze public.time_entries;
