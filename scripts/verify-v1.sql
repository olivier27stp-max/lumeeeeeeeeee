-- V1 post-migration verification — safe READ-ONLY queries.

-- 1. Tables that should now exist
with expected as (
  select unnest(array[
    'org_invoice_sequences',
    'sms_opt_outs',
    'dead_letters',
    'field_sales_reps',
    'field_sales_teams',
    'field_sales_team_members',
    'consents',
    'dsar_requests'
  ]) as name
)
select e.name as table_name,
       case when to_regclass('public.' || e.name) is not null then 'OK' else 'MISSING' end as status
from expected e
order by e.name;
