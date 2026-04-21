-- =====================================================================
-- Breach Response & Incident Tracking — 2026-04-21
-- Bloc 6 : Loi 25 art. 3.5 / 3.8 — registre incidents + notifications
--          RGPD art. 33-34 — notification 72h + personnes si risque élevé
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. security_incidents — registre obligatoire Loi 25 art. 3.8
-- ---------------------------------------------------------------------
create table if not exists public.security_incidents (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid references public.orgs(id) on delete cascade,

  -- Type: unauthorized_access, data_leak, loss_of_access, ransomware,
  --       misdirected_email, internal_misuse, lost_device, phishing, other
  incident_type         text not null,
  severity              text not null default 'low' check (severity in ('low','medium','high','critical')),
  status                text not null default 'detected' check (status in ('detected','triaging','contained','notified','closed')),

  -- Detection
  detected_at           timestamptz not null default now(),
  detected_by           uuid references auth.users(id),
  detection_method      text,                        -- 'automatic', 'user-report', 'third-party', 'audit'

  -- Scope
  affected_users        int default 0,
  affected_records      int default 0,
  data_categories       text[] default array[]::text[],
                        -- e.g. ['identity','contact','financial','health']

  -- Risk assessment (Loi 25 art. 3.5 : "incident à risque sérieux")
  risk_serious          boolean default false,
  risk_rationale        text,

  -- Description
  title                 text not null,
  description           text,
  root_cause            text,
  containment_actions   text,

  -- Notifications (Loi 25 art. 3.5 / RGPD art. 33-34)
  cai_notified_at       timestamptz,                  -- Commission d'accès à l'information du Québec
  cnil_notified_at      timestamptz,                  -- CNIL (si clients UE)
  opc_notified_at       timestamptz,                  -- Office of the Privacy Commissioner (Canada federal)
  affected_notified_at  timestamptz,
  notification_method   text,

  -- Post-incident
  resolved_at           timestamptz,
  lessons_learned       text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_incidents_org_status on public.security_incidents(org_id, status, detected_at desc);
create index if not exists idx_incidents_severity on public.security_incidents(severity, detected_at desc);
create index if not exists idx_incidents_unresolved on public.security_incidents(detected_at) where resolved_at is null;

alter table public.security_incidents enable row level security;

create policy incidents_select_org on public.security_incidents for select
  using (public.has_org_admin_role(auth.uid(), org_id));
create policy incidents_insert_org on public.security_incidents for insert
  with check (public.has_org_membership(auth.uid(), org_id));
create policy incidents_update_admin on public.security_incidents for update
  using (public.has_org_admin_role(auth.uid(), org_id))
  with check (public.has_org_admin_role(auth.uid(), org_id));

-- ---------------------------------------------------------------------
-- 2. incident_timeline — journal des actions/événements liés à l'incident
-- ---------------------------------------------------------------------
create table if not exists public.incident_timeline (
  id             uuid primary key default gen_random_uuid(),
  incident_id    uuid not null references public.security_incidents(id) on delete cascade,
  actor_id       uuid references auth.users(id),
  event_type     text not null,   -- 'note', 'status_change', 'notification_sent', 'evidence_attached'
  payload        jsonb default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_incident_timeline on public.incident_timeline(incident_id, created_at);

alter table public.incident_timeline enable row level security;

create policy timeline_select_org on public.incident_timeline for select
  using (exists (
    select 1 from public.security_incidents si
     where si.id = incident_timeline.incident_id
       and public.has_org_admin_role(auth.uid(), si.org_id)
  ));
create policy timeline_insert_org on public.incident_timeline for insert
  with check (exists (
    select 1 from public.security_incidents si
     where si.id = incident_timeline.incident_id
       and public.has_org_admin_role(auth.uid(), si.org_id)
  ));

-- ---------------------------------------------------------------------
-- 3. failed_login_attempts — pour détection anomalies
-- ---------------------------------------------------------------------
create table if not exists public.failed_login_attempts (
  id             uuid primary key default gen_random_uuid(),
  email          text,
  ip_address     inet,
  user_agent     text,
  reason         text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_failed_login_email_time on public.failed_login_attempts(email, created_at desc);
create index if not exists idx_failed_login_ip_time    on public.failed_login_attempts(ip_address, created_at desc);

-- Service role writes only (from server), no client access
alter table public.failed_login_attempts enable row level security;

-- Purge > 90d (no legitimate need beyond)
create or replace function public.purge_old_failed_logins()
returns bigint language plpgsql security definer set search_path = public, pg_temp as $FUNC$
declare v_count bigint := 0;
begin
  delete from public.failed_login_attempts where created_at < now() - interval '90 days';
  get diagnostics v_count = row_count;
  return v_count;
end $FUNC$;

revoke all on function public.purge_old_failed_logins() from public;
grant execute on function public.purge_old_failed_logins() to service_role;

-- ---------------------------------------------------------------------
-- 4. RPC : record_failed_login (server-side call after auth failure)
-- ---------------------------------------------------------------------
create or replace function public.record_failed_login(
  p_email text, p_ip inet default null, p_user_agent text default null, p_reason text default 'invalid_credentials'
) returns void
language sql
security definer
set search_path = public, pg_temp
as $FUNC$
  insert into public.failed_login_attempts(email, ip_address, user_agent, reason)
  values (lower(coalesce(p_email,'')), p_ip, p_user_agent, p_reason);
$FUNC$;

revoke all on function public.record_failed_login(text, inet, text, text) from public;
grant execute on function public.record_failed_login(text, inet, text, text) to service_role;

-- ---------------------------------------------------------------------
-- 5. RPC : detect_login_anomalies
--    Returns rows flagging brute-force or distributed attacks.
-- ---------------------------------------------------------------------
create or replace function public.detect_login_anomalies(p_minutes int default 15)
returns table(kind text, key text, count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $FUNC$
  with window as (
    select email, ip_address from public.failed_login_attempts
     where created_at > now() - make_interval(mins => p_minutes)
  )
  select 'brute_force_email'::text, email, count(*)::bigint
    from window where email <> '' group by email having count(*) >= 5
  union all
  select 'brute_force_ip'::text, host(ip_address), count(*)::bigint
    from window where ip_address is not null group by ip_address having count(*) >= 20;
$FUNC$;

revoke all on function public.detect_login_anomalies(int) from public;
grant execute on function public.detect_login_anomalies(int) to service_role;

-- ---------------------------------------------------------------------
-- 6. RPC : create_incident (org-scoped, admin only)
-- ---------------------------------------------------------------------
create or replace function public.create_incident(
  p_title         text,
  p_type          text,
  p_severity      text,
  p_description   text default null,
  p_detection     text default 'manual'
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $FUNC$
declare
  v_org uuid;
  v_id  uuid;
begin
  v_org := (select org_id from public.memberships where user_id = auth.uid() limit 1);
  if v_org is null then raise exception 'No organization context'; end if;
  if not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can declare incidents';
  end if;

  insert into public.security_incidents(
    org_id, incident_type, severity, status, title, description,
    detected_by, detection_method
  ) values (
    v_org, p_type, coalesce(p_severity,'low'), 'detected', p_title, p_description,
    auth.uid(), p_detection
  ) returning id into v_id;

  insert into public.incident_timeline(incident_id, actor_id, event_type, payload)
  values (v_id, auth.uid(), 'status_change', jsonb_build_object('to','detected','via','create_incident'));

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'incident_declared', 'security_incident', v_id,
    jsonb_build_object('type', p_type, 'severity', p_severity));

  return v_id;
end $FUNC$;

revoke all on function public.create_incident(text, text, text, text, text) from public;
grant execute on function public.create_incident(text, text, text, text, text) to authenticated, service_role;

-- Hook purge_old_failed_logins into daily retention job
create or replace function public.run_retention_job()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $FUNC$
declare v_leads bigint; v_clients bigint; v_tokens bigint; v_audit bigint; v_members bigint; v_logins bigint;
begin
  v_leads   := public.anonymize_inactive_leads(24);
  v_clients := public.anonymize_old_soft_deleted_clients(180);
  v_tokens  := public.purge_expired_portal_tokens();
  v_audit   := public.purge_old_audit_events(1095);
  v_members := public.execute_scheduled_member_deletions();
  v_logins  := public.purge_old_failed_logins();
  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, null, 'retention_run', 'system', null,
    jsonb_build_object(
      'anonymized_leads', v_leads, 'anonymized_clients', v_clients,
      'purged_portal_tokens', v_tokens, 'purged_audit_events', v_audit,
      'hard_deleted_members', v_members, 'purged_failed_logins', v_logins,
      'at', now()));
  return jsonb_build_object(
    'anonymized_leads', v_leads, 'anonymized_clients', v_clients,
    'purged_portal_tokens', v_tokens, 'purged_audit_events', v_audit,
    'hard_deleted_members', v_members, 'purged_failed_logins', v_logins);
end $FUNC$;
