-- Fix leads_status_check constraint to match actual statuses used by the app
-- Old: ('new', 'contacted', 'qualified', 'won', 'lost')
-- New: adds follow_up_1, follow_up_2, follow_up_3, closed, lead + legacy values

begin;

alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check
  check (status in (
    'new', 'contacted', 'qualified', 'won', 'lost',
    'follow_up_1', 'follow_up_2', 'follow_up_3', 'closed',
    'lead', 'proposal', 'negotiation', 'archived'
  ));

commit;
