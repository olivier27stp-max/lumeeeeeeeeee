/* ═══════════════════════════════════════════════════════════════
   Migration — Automation Engine & Activity Log
   1. Expand lead statuses
   2. Unified activity_log table
   3. automation_rules (event-driven)
   4. automation_scheduled_tasks (delayed execution queue)
   5. automation_execution_logs
   6. satisfaction_surveys (Google Review flow)
   7. google_review_url on company_settings
   ═══════════════════════════════════════════════════════════════ */

-- ═══════════════════════════════════════════════════════════════
-- 1. EXPAND LEAD STATUSES
-- ═══════════════════════════════════════════════════════════════

-- Drop old constraints if they exist
do $$ begin
  alter table public.leads drop constraint if exists leads_status_check;
  alter table public.leads drop constraint if exists leads_stage_check;
exception when others then null;
end $$;

-- New status constraint: new, contacted, estimate_sent, follow_up, won, closed, archived, lost
alter table public.leads
  add constraint leads_status_check
  check (status in ('new', 'contacted', 'estimate_sent', 'follow_up', 'won', 'closed', 'archived', 'lost',
                     'lead', 'proposal', 'negotiation', 'qualified', 'quote_sent'));

-- New stage constraint matching pipeline stages
alter table public.leads
  add constraint leads_stage_check
  check (stage in ('new', 'contacted', 'estimate_sent', 'follow_up', 'won', 'closed', 'lost',
                    'qualified', 'quote_sent'));

-- Backfill old values to new ones
update public.leads set status = 'new' where status = 'lead';
update public.leads set status = 'new' where status = 'qualified';
update public.leads set status = 'contacted' where status = 'proposal';
update public.leads set status = 'contacted' where status = 'negotiation';
update public.leads set status = 'estimate_sent' where status = 'quote_sent' and stage = 'quote_sent';
update public.leads set stage = 'new' where stage = 'qualified';
update public.leads set stage = 'estimate_sent' where stage = 'quote_sent';

-- Backfill pipeline_deals stages to match new naming
do $$ begin
  alter table public.pipeline_deals drop constraint if exists pipeline_deals_stage_check;
exception when others then null;
end $$;

-- Normalize all stage values to lowercase first
update public.pipeline_deals set stage = lower(trim(stage)) where stage is distinct from lower(trim(stage));

-- Map legacy values
update public.pipeline_deals set stage = 'new'            where stage in ('qualified', 'new');
update public.pipeline_deals set stage = 'contacted'      where stage in ('contact', 'contacted');
update public.pipeline_deals set stage = 'estimate_sent'  where stage in ('quote_sent', 'quote sent', 'estimate_sent', 'estimate sent');
update public.pipeline_deals set stage = 'follow_up'      where stage in ('follow-up', 'follow_up', 'followup');
update public.pipeline_deals set stage = 'won'            where stage = 'won';
update public.pipeline_deals set stage = 'closed'         where stage = 'closed';
update public.pipeline_deals set stage = 'lost'           where stage = 'lost';

-- Catch any remaining unknown values → default to 'new'
update public.pipeline_deals set stage = 'new'
  where stage not in ('new', 'contacted', 'estimate_sent', 'follow_up', 'won', 'closed', 'lost');

alter table public.pipeline_deals
  add constraint pipeline_deals_stage_check
  check (stage in ('new', 'contacted', 'estimate_sent', 'follow_up', 'won', 'closed', 'lost'));

-- ═══════════════════════════════════════════════════════════════
-- 2. UNIFIED ACTIVITY LOG
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.activity_log (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  entity_type       text not null,
  entity_id         uuid not null,
  related_entity_type text default null,
  related_entity_id uuid default null,
  event_type        text not null,
  actor_id          uuid default null references auth.users(id),
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now()
);

create index if not exists idx_activity_log_entity
  on public.activity_log(org_id, entity_type, entity_id, created_at desc);
create index if not exists idx_activity_log_event
  on public.activity_log(org_id, event_type);
create index if not exists idx_activity_log_related
  on public.activity_log(related_entity_type, related_entity_id)
  where related_entity_id is not null;

alter table public.activity_log enable row level security;

drop policy if exists "activity_log_select_org" on public.activity_log;
create policy "activity_log_select_org" on public.activity_log
  for select to authenticated
  using (org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid()));

drop policy if exists "activity_log_insert_org" on public.activity_log;
create policy "activity_log_insert_org" on public.activity_log
  for insert to authenticated
  with check (org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid()));

-- Service role can always insert (for backend automation)
drop policy if exists "activity_log_insert_service" on public.activity_log;
create policy "activity_log_insert_service" on public.activity_log
  for insert to service_role
  with check (true);

drop policy if exists "activity_log_select_service" on public.activity_log;
create policy "activity_log_select_service" on public.activity_log
  for select to service_role
  using (true);

-- ═══════════════════════════════════════════════════════════════
-- 3. AUTOMATION RULES (event-driven)
-- ═══════════════════════════════════════════════════════════════

-- Drop tables from any previous partial migration (wrong schema)
drop table if exists public.automation_execution_logs cascade;
drop table if exists public.automation_scheduled_tasks cascade;
drop table if exists public.automation_rules cascade;

create table public.automation_rules (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id) on delete cascade,
  name              text not null,
  description       text default '',
  trigger_event     text not null,
  conditions        jsonb not null default '{}',
  delay_seconds     integer not null default 0,
  actions           jsonb not null default '[]',
  is_active         boolean not null default true,
  is_preset         boolean not null default false,
  preset_key        text default null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_automation_rules_org on public.automation_rules(org_id);
create index if not exists idx_automation_rules_trigger on public.automation_rules(org_id, trigger_event) where is_active = true;

alter table public.automation_rules enable row level security;

drop policy if exists "automation_rules_select_org" on public.automation_rules;
create policy "automation_rules_select_org" on public.automation_rules
  for select to authenticated
  using (org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid()));

drop policy if exists "automation_rules_insert_org" on public.automation_rules;
create policy "automation_rules_insert_org" on public.automation_rules
  for insert to authenticated
  with check (org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid()));

drop policy if exists "automation_rules_update_org" on public.automation_rules;
create policy "automation_rules_update_org" on public.automation_rules
  for update to authenticated
  using (org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid()));

drop policy if exists "automation_rules_delete_org" on public.automation_rules;
create policy "automation_rules_delete_org" on public.automation_rules
  for delete to authenticated
  using (org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid()));

-- Service role
drop policy if exists "automation_rules_service" on public.automation_rules;
create policy "automation_rules_service" on public.automation_rules
  for all to service_role
  using (true) with check (true);

-- updated_at trigger
create or replace function public.set_automation_rules_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_automation_rules_updated on public.automation_rules;
create trigger trg_automation_rules_updated
  before update on public.automation_rules
  for each row execute function public.set_automation_rules_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 4. AUTOMATION SCHEDULED TASKS (delayed execution queue)
-- ═══════════════════════════════════════════════════════════════

create table public.automation_scheduled_tasks (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  automation_rule_id  uuid not null references public.automation_rules(id) on delete cascade,
  entity_type         text not null,
  entity_id           uuid not null,
  action_config       jsonb not null default '{}',
  execute_at          timestamptz not null,
  status              text not null default 'pending'
                      check (status in ('pending', 'running', 'completed', 'failed', 'cancelled')),
  execution_key       text not null,
  attempts            integer not null default 0,
  last_error          text default null,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz default null
);

create index if not exists idx_scheduled_tasks_pending
  on public.automation_scheduled_tasks(execute_at)
  where status = 'pending';
create index if not exists idx_scheduled_tasks_org
  on public.automation_scheduled_tasks(org_id);
create index if not exists idx_scheduled_tasks_entity
  on public.automation_scheduled_tasks(entity_type, entity_id);
create unique index if not exists idx_scheduled_tasks_dedup
  on public.automation_scheduled_tasks(execution_key)
  where status in ('pending', 'running');

alter table public.automation_scheduled_tasks enable row level security;

drop policy if exists "scheduled_tasks_select_org" on public.automation_scheduled_tasks;
create policy "scheduled_tasks_select_org" on public.automation_scheduled_tasks
  for select to authenticated
  using (org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid()));

drop policy if exists "scheduled_tasks_service" on public.automation_scheduled_tasks;
create policy "scheduled_tasks_service" on public.automation_scheduled_tasks
  for all to service_role
  using (true) with check (true);

-- ═══════════════════════════════════════════════════════════════
-- 5. AUTOMATION EXECUTION LOGS
-- ═══════════════════════════════════════════════════════════════

create table public.automation_execution_logs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete cascade,
  automation_rule_id  uuid references public.automation_rules(id) on delete set null,
  scheduled_task_id   uuid references public.automation_scheduled_tasks(id) on delete set null,
  trigger_event       text not null,
  entity_type         text not null,
  entity_id           uuid not null,
  action_type         text not null,
  action_config       jsonb not null default '{}',
  result_success      boolean not null default false,
  result_data         jsonb default null,
  result_error        text default null,
  duration_ms         integer default 0,
  created_at          timestamptz not null default now()
);

create index if not exists idx_execution_logs_org
  on public.automation_execution_logs(org_id, created_at desc);
create index if not exists idx_execution_logs_rule
  on public.automation_execution_logs(automation_rule_id);

alter table public.automation_execution_logs enable row level security;

drop policy if exists "execution_logs_select_org" on public.automation_execution_logs;
create policy "execution_logs_select_org" on public.automation_execution_logs
  for select to authenticated
  using (org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid()));

drop policy if exists "execution_logs_service" on public.automation_execution_logs;
create policy "execution_logs_service" on public.automation_execution_logs
  for all to service_role
  using (true) with check (true);

-- ═══════════════════════════════════════════════════════════════
-- 6. SATISFACTION SURVEYS
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.satisfaction_surveys (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  job_id        uuid references public.jobs(id) on delete set null,
  token         text not null unique,
  rating        integer default null check (rating between 1 and 5),
  feedback      text default null,
  submitted_at  timestamptz default null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_surveys_token on public.satisfaction_surveys(token);
create index if not exists idx_surveys_org on public.satisfaction_surveys(org_id);

alter table public.satisfaction_surveys enable row level security;

drop policy if exists "surveys_select_org" on public.satisfaction_surveys;
create policy "surveys_select_org" on public.satisfaction_surveys
  for select to authenticated
  using (org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid()));

drop policy if exists "surveys_insert_service" on public.satisfaction_surveys;
create policy "surveys_insert_service" on public.satisfaction_surveys
  for all to service_role
  using (true) with check (true);

-- Public access for survey submission (via token, no auth)
drop policy if exists "surveys_select_anon" on public.satisfaction_surveys;
create policy "surveys_select_anon" on public.satisfaction_surveys
  for select to anon
  using (true);

drop policy if exists "surveys_update_anon" on public.satisfaction_surveys;
create policy "surveys_update_anon" on public.satisfaction_surveys
  for update to anon
  using (submitted_at is null)
  with check (submitted_at is not null);

-- ═══════════════════════════════════════════════════════════════
-- 7. ADD google_review_url TO company_settings
-- ═══════════════════════════════════════════════════════════════

do $$ begin
  alter table public.company_settings add column if not exists google_review_url text default null;
exception when others then null;
end $$;

-- ═══════════════════════════════════════════════════════════════
-- 8. REALTIME for activity_log
-- ═══════════════════════════════════════════════════════════════

alter publication supabase_realtime add table public.activity_log;
