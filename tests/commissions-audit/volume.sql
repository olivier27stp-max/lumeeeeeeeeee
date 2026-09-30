-- ============================================================================
-- Tenant VOLUMINEUX (org V) pour la mesure de performance — base LOCALE seulement.
-- 60 reps, 24 mois, ~200 000 factures payées et autant de commissions,
-- 20 000 estimations. Insertion en masse (triggers coupés : on mesure les
-- lectures et les index, pas les triggers d'écriture).
--   psql … -v ON_ERROR_STOP=1 -f tests/commissions-audit/volume.sql
-- ============================================================================
\set org '\'cc000000-0000-4000-8000-0000000000a4\''
\set vic '\'cc000000-0000-4000-8000-000000000401\''
begin;
set local session_replication_role = replica;

delete from fs_commission_entries where org_id = :org;
delete from invoices where org_id = :org;
delete from jobs where org_id = :org;
delete from memberships where org_id = :org and user_id <> :vic;
delete from team_members where org_id = :org and user_id <> :vic;
delete from auth.users where id::text like 'cc000000-0000-4000-8000-0000005%';

-- 60 reps (comptes minimaux, jamais connectés)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', ('cc000000-0000-4000-8000-0000005' || lpad(to_hex(g), 5, '0'))::uuid,
       'authenticated', 'authenticated', 'rep' || g || '@fixture-v.test', '', now(), now(), now(), '{}', '{}'
from generate_series(1, 60) g;
insert into memberships (user_id, org_id, role, status, full_name)
select ('cc000000-0000-4000-8000-0000005' || lpad(to_hex(g), 5, '0'))::uuid, :org, 'sales_rep', 'active', 'Rep volume ' || g
from generate_series(1, 60) g;
insert into team_members (org_id, user_id, email, first_name, last_name, role, status, compensation_mode)
select :org, ('cc000000-0000-4000-8000-0000005' || lpad(to_hex(g), 5, '0'))::uuid, 'rep' || g || '@fixture-v.test', 'Rep', 'Volume ' || g, 'sales_rep', 'active', 'commission'
from generate_series(1, 60) g;

insert into fs_commission_rules (id, org_id, name, type, is_active, priority, base_kind, base_percent, assigned_user_ids)
values ('cc000000-0000-4000-8000-0000000005d1', :org, 'Volume 10 %', 'percentage', true, 0, 'percent', 10,
        array(select ('cc000000-0000-4000-8000-0000005' || lpad(to_hex(g), 5, '0'))::uuid from generate_series(1, 60) g))
on conflict (id) do nothing;

-- 200 000 factures payées, réparties sur 24 mois
insert into invoices (id, org_id, invoice_number, status, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, issued_at, paid_at, created_at, created_by)
select gen_random_uuid(), :org, 'V-' || g, 'paid', s, round(s * 0.14975), s + round(s * 0.14975), s + round(s * 0.14975), 0, t, t, t, :vic
from (select g, 10000 + (g * 7919) % 190000 as s,
             timestamptz '2024-10-01 04:00+00' + ((g::bigint * 104729) % (730 * 86400)) * interval '1 second' as t
      from generate_series(1, 200000) g) x;

insert into fs_commission_entries (org_id, user_id, rule_id, invoice_id, status, amount, base_amount, description, triggered_at, created_at, calc_breakdown)
select i.org_id,
       ('cc000000-0000-4000-8000-0000005' || lpad(to_hex(1 + (abs(hashtext(i.id::text)) % 60)), 5, '0'))::uuid,
       'cc000000-0000-4000-8000-0000000005d1', i.id,
       case when i.paid_at < now() - interval '60 days' then 'paid' when abs(hashtext(i.id::text)) % 20 = 0 then 'reversed' else 'approved' end,
       round(i.subtotal_cents * 0.10) / 100.0, i.subtotal_cents / 100.0, 'Commission on invoice payment', i.paid_at, i.paid_at,
       jsonb_build_object('base_kind', 'percent', 'base_value', 10)
from invoices i where i.org_id = :org;

-- 20 000 estimations (jobs non payés)
insert into jobs (id, org_id, title, job_number, status, subtotal_cents, tax_cents, total_cents, created_at, created_by)
select gen_random_uuid(), :org, 'Job volume ' || g, 'V-J' || g, 'scheduled', 50000, 7488, 57488,
       timestamptz '2026-01-01 05:00+00' + (g % 270) * interval '1 day', :vic
from generate_series(1, 20000) g;
insert into fs_commission_entries (org_id, user_id, rule_id, job_id, status, amount, base_amount, description, triggered_at, created_at)
select j.org_id, ('cc000000-0000-4000-8000-0000005' || lpad(to_hex(1 + (abs(hashtext(j.id::text)) % 60)), 5, '0'))::uuid,
       'cc000000-0000-4000-8000-0000000005d1', j.id, 'pending', 50.00, 500.00, 'Estimation', j.created_at, j.created_at
from jobs j where j.org_id = :org;

commit;
analyze fs_commission_entries; analyze invoices; analyze jobs; analyze memberships;
select count(*) as entrees_v from fs_commission_entries where org_id = :org;
