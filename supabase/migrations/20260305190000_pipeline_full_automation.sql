begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- Leads columns + stage model
-- ------------------------------------------------------------------
alter table public.leads add column if not exists stage text;
alter table public.leads add column if not exists lost_at timestamptz;
alter table public.leads add column if not exists closed_at timestamptz;
alter table public.leads add column if not exists converted_job_id uuid;
alter table public.leads add column if not exists converted_at timestamptz;
alter table public.leads add column if not exists deleted_at timestamptz;
alter table public.leads add column if not exists deleted_by uuid;

alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads
  add constraint leads_stage_check
  check (stage in ('qualified', 'quote_sent', 'contacted', 'closed', 'lost'));

update public.leads
set stage = case lower(coalesce(stage, status, 'qualified'))
  when 'new' then 'qualified'
  when 'qualified' then 'qualified'
  when 'contacted' then 'contacted'
  when 'quote_sent' then 'quote_sent'
  when 'proposal' then 'quote_sent'
  when 'negotiation' then 'contacted'
  when 'won' then 'closed'
  when 'closed' then 'closed'
  when 'lost' then 'lost'
  else 'qualified'
end
where stage is null
   or lower(coalesce(stage, '')) not in ('qualified', 'quote_sent', 'contacted', 'closed', 'lost');

update public.leads
set lost_at = coalesce(lost_at, now())
where stage = 'lost' and lost_at is null;

update public.leads
set closed_at = coalesce(closed_at, now())
where stage = 'closed' and closed_at is null;

create index if not exists leads_org_deleted_idx on public.leads(org_id, deleted_at);
create index if not exists leads_org_stage_idx on public.leads(org_id, stage);
create index if not exists leads_org_lost_at_idx on public.leads(org_id, lost_at) where deleted_at is null;
create index if not exists leads_org_converted_job_idx on public.leads(org_id, converted_job_id);

-- ------------------------------------------------------------------
-- Jobs columns + status normalization
-- ------------------------------------------------------------------
alter table public.jobs add column if not exists deleted_at timestamptz;
alter table public.jobs add column if not exists deleted_by uuid;
alter table public.jobs add column if not exists completed_at timestamptz;

update public.jobs
set status = case lower(coalesce(status, 'draft'))
  when 'scheduled' then 'scheduled'
  when 'in_progress' then 'in_progress'
  when 'completed' then 'completed'
  when 'cancelled' then 'cancelled'
  when 'canceled' then 'cancelled'
  when 'closed' then 'completed'
  when 'lost' then 'cancelled'
  when 'qualified' then 'draft'
  when 'quote_sent' then 'draft'
  when 'new' then 'draft'
  when 'unscheduled' then 'draft'
  when 'late' then 'scheduled'
  when 'action_required' then 'draft'
  when 'requires_invoicing' then 'completed'
  else 'draft'
end
where lower(coalesce(status, 'draft')) not in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled')
   or lower(coalesce(status, 'draft')) in ('canceled', 'closed', 'lost', 'qualified', 'quote_sent', 'new', 'unscheduled', 'late', 'action_required', 'requires_invoicing');

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs
  add constraint jobs_status_check
  check (status in ('draft', 'scheduled', 'in_progress', 'completed', 'cancelled'));

create index if not exists idx_jobs_org_deleted_at on public.jobs(org_id, deleted_at);
create index if not exists idx_jobs_org_status on public.jobs(org_id, status);

-- ------------------------------------------------------------------
-- Invoices idempotency by job
-- ------------------------------------------------------------------
alter table public.invoices add column if not exists job_id uuid;
alter table public.invoices drop constraint if exists invoices_job_id_fkey;
alter table public.invoices
  add constraint invoices_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete set null;

create unique index if not exists uq_invoices_org_job_active
  on public.invoices(org_id, job_id)
  where deleted_at is null and job_id is not null;

-- ------------------------------------------------------------------
-- Notifications table (for payment success)
-- ------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  type text not null,
  ref_id uuid null,
  title text not null,
  body text null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists idx_notifications_org_created on public.notifications(org_id, created_at desc);
create index if not exists idx_notifications_org_unread on public.notifications(org_id, read_at) where deleted_at is null;

alter table public.notifications enable row level security;
drop policy if exists notifications_select_org on public.notifications;
drop policy if exists notifications_insert_org on public.notifications;
drop policy if exists notifications_update_org on public.notifications;

create policy notifications_select_org on public.notifications
for select to authenticated
using (public.has_org_membership(auth.uid(), org_id));

create policy notifications_insert_org on public.notifications
for insert to authenticated
with check (public.has_org_membership(auth.uid(), org_id));

create policy notifications_update_org on public.notifications
for update to authenticated
using (public.has_org_membership(auth.uid(), org_id))
with check (public.has_org_membership(auth.uid(), org_id));

-- Add to realtime publication if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END;
$$;

-- ------------------------------------------------------------------
-- Keep lead.stage in sync with pipeline moves
-- ------------------------------------------------------------------
create or replace function public.sync_lead_stage_from_deal()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_stage text;
begin
  if new.lead_id is null then
    return new;
  end if;

  v_stage := case lower(coalesce(new.stage, 'qualified'))
    when 'qualified' then 'qualified'
    when 'quote sent' then 'quote_sent'
    when 'contact' then 'contacted'
    when 'closed' then 'closed'
    when 'lost' then 'lost'
    else 'qualified'
  end;

  update public.leads
  set stage = v_stage,
      lost_at = case when v_stage = 'lost' then coalesce(lost_at, now()) else null end,
      closed_at = case when v_stage = 'closed' then coalesce(closed_at, now()) else null end,
      updated_at = now()
  where id = new.lead_id
    and org_id = new.org_id
    and deleted_at is null;

  return new;
end;
$fn$;

drop trigger if exists trg_pipeline_deals_sync_lead_stage on public.pipeline_deals;
create trigger trg_pipeline_deals_sync_lead_stage
after insert or update of stage on public.pipeline_deals
for each row execute function public.sync_lead_stage_from_deal();

-- ------------------------------------------------------------------
-- RPC: soft_delete_lead
-- ------------------------------------------------------------------
create or replace function public.soft_delete_lead(p_org_id uuid, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_lead_count integer := 0;
  v_deal_count integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_org_id is null or p_lead_id is null then
    raise exception 'p_org_id and p_lead_id are required' using errcode = '22023';
  end if;
  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete leads' using errcode = '42501';
  end if;

  update public.leads
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where id = p_lead_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_lead_count = row_count;

  if v_lead_count = 0 then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  update public.pipeline_deals
  set deleted_at = now(),
      updated_at = now()
  where org_id = p_org_id
    and lead_id = p_lead_id
    and deleted_at is null;
  get diagnostics v_deal_count = row_count;

  return jsonb_build_object('lead', v_lead_count, 'deals', v_deal_count);
end;
$fn$;

revoke all on function public.soft_delete_lead(uuid, uuid) from public;
grant execute on function public.soft_delete_lead(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- RPC: soft_delete_client_conditional
-- ------------------------------------------------------------------
create or replace function public.soft_delete_client_conditional(p_org_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_client integer := 0;
  v_leads integer := 0;
  v_jobs_deleted integer := 0;
  v_jobs_kept integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_org_id is null or p_client_id is null then
    raise exception 'p_org_id and p_client_id are required' using errcode = '22023';
  end if;
  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can delete clients' using errcode = '42501';
  end if;

  update public.clients
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where id = p_client_id
    and org_id = p_org_id
    and deleted_at is null;
  get diagnostics v_client = row_count;

  update public.leads
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where org_id = p_org_id
    and converted_to_client_id = p_client_id
    and coalesce(converted_job_id::text, '') = ''
    and deleted_at is null;
  get diagnostics v_leads = row_count;

  update public.jobs
  set deleted_at = now(),
      deleted_by = v_uid,
      updated_at = now()
  where org_id = p_org_id
    and client_id = p_client_id
    and lower(coalesce(status, 'draft')) not in ('scheduled', 'in_progress', 'completed')
    and deleted_at is null;
  get diagnostics v_jobs_deleted = row_count;

  select count(*)::integer into v_jobs_kept
  from public.jobs
  where org_id = p_org_id
    and client_id = p_client_id
    and lower(coalesce(status, 'draft')) in ('scheduled', 'in_progress', 'completed')
    and deleted_at is null;

  return jsonb_build_object(
    'client', v_client,
    'leads_deleted', v_leads,
    'jobs_deleted', v_jobs_deleted,
    'jobs_kept', v_jobs_kept
  );
end;
$fn$;

revoke all on function public.soft_delete_client_conditional(uuid, uuid) from public;
grant execute on function public.soft_delete_client_conditional(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- RPC: create_job_from_lead
-- ------------------------------------------------------------------
create or replace function public.create_job_from_lead(
  p_org_id uuid,
  p_lead_id uuid,
  p_title text default null,
  p_address text default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_team_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_lead record;
  v_job jsonb;
  v_job_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_org_id is null or p_lead_id is null then
    raise exception 'p_org_id and p_lead_id are required' using errcode = '22023';
  end if;
  if not public.has_org_admin_role(v_uid, p_org_id) then
    raise exception 'Only owner/admin can create jobs from leads' using errcode = '42501';
  end if;

  select * into v_lead
  from public.leads
  where id = p_lead_id
    and org_id = p_org_id
    and deleted_at is null
  limit 1;

  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  select public.rpc_create_job_with_optional_schedule(
    p_lead_id := p_lead_id,
    p_client_id := coalesce(v_lead.converted_to_client_id, null),
    p_team_id := p_team_id,
    p_title := coalesce(nullif(trim(p_title), ''), concat_ws(' ', coalesce(v_lead.first_name,''), coalesce(v_lead.last_name,''))),
    p_address := coalesce(nullif(trim(p_address), ''), nullif(trim(v_lead.address), ''), '-'),
    p_status := case when p_start_at is null then 'draft' else 'scheduled' end,
    p_scheduled_at := p_start_at,
    p_end_at := p_end_at
  ) into v_job;

  v_job_id := (v_job->>'job_id')::uuid;

  update public.leads
  set converted_job_id = v_job_id,
      converted_at = now(),
      stage = 'closed',
      closed_at = coalesce(closed_at, now()),
      updated_at = now()
  where id = p_lead_id
    and org_id = p_org_id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'event_id', v_job->>'event_id'
  );
end;
$fn$;

revoke all on function public.create_job_from_lead(uuid, uuid, text, text, timestamptz, timestamptz, uuid) from public;
grant execute on function public.create_job_from_lead(uuid, uuid, text, text, timestamptz, timestamptz, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Wrapper RPC: create_invoice_from_job(org, job)
-- ------------------------------------------------------------------
create or replace function public.create_invoice_from_job(p_org_id uuid, p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
begin
  return public.create_invoice_from_job(p_org_id, p_job_id, false);
end;
$fn$;

revoke all on function public.create_invoice_from_job(uuid, uuid) from public;
grant execute on function public.create_invoice_from_job(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------
-- Lost cleanup after 10 days
-- ------------------------------------------------------------------
create or replace function public.cleanup_lost_leads_10d()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer := 0;
begin
  update public.leads
  set deleted_at = now(),
      updated_at = now()
  where stage = 'lost'
    and deleted_at is null
    and coalesce(converted_job_id::text, '') = ''
    and lost_at is not null
    and lost_at <= now() - interval '10 days';

  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.cleanup_lost_leads_10d() from public;
grant execute on function public.cleanup_lost_leads_10d() to authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_cron;
    EXCEPTION WHEN others THEN
      NULL;
    END;

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_lost_leads_10d_daily') THEN
      PERFORM cron.unschedule('cleanup_lost_leads_10d_daily');
    END IF;

    PERFORM cron.schedule(
      'cleanup_lost_leads_10d_daily',
      '0 3 * * *',
      $$select public.cleanup_lost_leads_10d();$$
    );
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END;
$$;

commit;


