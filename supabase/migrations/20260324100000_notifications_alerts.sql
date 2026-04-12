begin;

-- ═══════════════════════════════════════════════════════════════
-- Notifications + Automated Alerts System
-- ═══════════════════════════════════════════════════════════════

-- Notifications table (in-app inbox)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid, -- null = all org members
  type text not null, -- 'alert', 'info', 'success', 'action_required'
  category text not null, -- 'invoice_overdue', 'client_inactive', 'team_overload', 'payment_received', 'new_lead', 'job_completed', etc.
  title text not null,
  body text,
  entity_type text, -- 'invoice', 'client', 'job', 'lead', 'team'
  entity_id uuid,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on notifications (org_id, user_id, read_at, created_at desc);
create index if not exists idx_notifications_unread on notifications (org_id, user_id) where read_at is null and dismissed_at is null;

alter table notifications enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='notifications' and policyname='notifications_select_org') then
    create policy notifications_select_org on notifications for select to authenticated using (has_org_membership(auth.uid(), org_id) and (user_id is null or user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename='notifications' and policyname='notifications_update_org') then
    create policy notifications_update_org on notifications for update to authenticated using (has_org_membership(auth.uid(), org_id) and (user_id is null or user_id = auth.uid()));
  end if;
end $$;

-- Alert rules config (per org)
create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  rule_type text not null, -- 'invoice_overdue', 'client_inactive', 'team_overload', 'low_pipeline'
  enabled boolean not null default true,
  threshold_days int default 30, -- e.g. 30 days overdue
  threshold_count int default 5, -- e.g. 5 active jobs = overload
  notify_email boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, rule_type)
);

alter table alert_rules enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='alert_rules' and policyname='alert_rules_select_org') then
    create policy alert_rules_select_org on alert_rules for select to authenticated using (has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='alert_rules' and policyname='alert_rules_all_org') then
    create policy alert_rules_all_org on alert_rules for all to authenticated using (has_org_membership(auth.uid(), org_id));
  end if;
end $$;

-- Goal tracking table
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  created_by uuid not null default auth.uid(),
  metric text not null, -- 'revenue', 'jobs', 'leads', 'conversion_rate'
  target_value bigint not null,
  period text not null default 'monthly', -- 'weekly', 'monthly', 'quarterly', 'yearly'
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table goals enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='goals' and policyname='goals_select_org') then
    create policy goals_select_org on goals for select to authenticated using (has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='goals' and policyname='goals_all_org') then
    create policy goals_all_org on goals for all to authenticated using (has_org_membership(auth.uid(), org_id));
  end if;
end $$;

commit;
