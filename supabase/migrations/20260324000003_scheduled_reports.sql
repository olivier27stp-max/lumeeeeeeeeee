begin;

-- ═══════════════════════════════════════════════════════════════
-- Scheduled Reports — email delivery of insights
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.current_org_id(),
  created_by uuid not null default auth.uid(),
  recipient_email text not null,
  frequency text not null default 'weekly' check (frequency in ('daily', 'weekly', 'monthly')),
  day_of_week int default 1, -- 0=Sunday, 1=Monday, etc. (for weekly)
  day_of_month int default 1, -- (for monthly)
  enabled boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.scheduled_reports enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'scheduled_reports' and policyname = 'scheduled_reports_select_org') then
    create policy scheduled_reports_select_org on public.scheduled_reports for select to authenticated using (has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'scheduled_reports' and policyname = 'scheduled_reports_insert_org') then
    create policy scheduled_reports_insert_org on public.scheduled_reports for insert to authenticated with check (has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'scheduled_reports' and policyname = 'scheduled_reports_update_org') then
    create policy scheduled_reports_update_org on public.scheduled_reports for update to authenticated using (has_org_membership(auth.uid(), org_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'scheduled_reports' and policyname = 'scheduled_reports_delete_org') then
    create policy scheduled_reports_delete_org on public.scheduled_reports for delete to authenticated using (has_org_membership(auth.uid(), org_id));
  end if;
end $$;

commit;
