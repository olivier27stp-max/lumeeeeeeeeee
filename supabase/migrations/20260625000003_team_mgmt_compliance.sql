-- =====================================================================
-- Team Management Compliance — 2026-04-21
-- Bloc 5 : hard delete avec période de grâce, MFA toggle, audit per-user,
--          ownership reassignment
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Add compliance columns to team_members
-- ---------------------------------------------------------------------
alter table public.team_members
  add column if not exists suspended_at       timestamptz,
  add column if not exists deletion_scheduled_at timestamptz,
  add column if not exists deletion_requested_by uuid references auth.users(id),
  add column if not exists mfa_required       boolean not null default false,
  add column if not exists password_reset_required boolean not null default false;

comment on column public.team_members.deletion_scheduled_at is
  'When non-null, this employee is in 30-day grace period before permanent deletion.';
comment on column public.team_members.mfa_required is
  'Admin-forced MFA: user must enable 2FA on next login.';

-- Index for the cleanup cron
create index if not exists idx_team_members_deletion_scheduled
  on public.team_members(deletion_scheduled_at)
  where deletion_scheduled_at is not null;

-- ---------------------------------------------------------------------
-- 2. RPC : request_hard_delete_member
--    Flag an employee for permanent deletion in 30 days.
--    Also suspends immediately (deactivates access) and reassigns ownership.
-- ---------------------------------------------------------------------
create or replace function public.request_hard_delete_member(
  p_member_id      uuid,
  p_reassign_to    uuid        -- REQUIRED: user to receive leads/jobs/tasks
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $FUNC$
declare
  v_org       uuid;
  v_target    uuid;
  v_reassign_org uuid;
begin
  select org_id, user_id into v_org, v_target
    from public.team_members where id = p_member_id;
  if v_org is null then raise exception 'Team member not found'; end if;

  -- Caller must be admin or owner of this org
  if not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can request member deletion';
  end if;

  -- Cannot delete yourself via this flow
  if v_target = auth.uid() then
    raise exception 'Cannot request deletion of your own account here';
  end if;

  -- Reassignment target must be in the same org
  select org_id into v_reassign_org from public.memberships
    where user_id = p_reassign_to and org_id = v_org limit 1;
  if v_reassign_org is null then
    raise exception 'Reassignment target must be a member of the same organization';
  end if;

  -- Reassign ownership of records owned by this user in this org
  update public.leads  set created_by = p_reassign_to
    where org_id = v_org and created_by = v_target;
  update public.clients set created_by = p_reassign_to
    where org_id = v_org and created_by = v_target;
  update public.jobs   set created_by = p_reassign_to
    where org_id = v_org and created_by = v_target;

  -- Best-effort reassignment for assigned_to fields (ignore if columns don't exist)
  begin execute 'update public.leads set assigned_to = $1 where org_id = $2 and assigned_to = $3'
    using p_reassign_to, v_org, v_target; exception when undefined_column then null; end;
  begin execute 'update public.tasks set assigned_to = $1 where org_id = $2 and assigned_to = $3'
    using p_reassign_to, v_org, v_target; exception when undefined_column then null; end;

  -- Suspend team_member + schedule hard delete in 30 days
  update public.team_members
     set status = 'inactive',
         suspended_at = now(),
         deletion_scheduled_at = now() + interval '30 days',
         deletion_requested_by = auth.uid(),
         updated_at = now()
   where id = p_member_id;

  -- Revoke membership so they lose RLS access immediately
  update public.memberships
     set status = 'suspended'
   where user_id = v_target and org_id = v_org;

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'request_hard_delete', 'team_member', p_member_id,
    jsonb_build_object('target_user', v_target, 'reassigned_to', p_reassign_to, 'scheduled_at', now() + interval '30 days'));
end $FUNC$;

revoke all on function public.request_hard_delete_member(uuid, uuid) from public;
grant execute on function public.request_hard_delete_member(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. RPC : cancel_hard_delete_member
--    During the 30-day grace period, admin can cancel the scheduled deletion.
-- ---------------------------------------------------------------------
create or replace function public.cancel_hard_delete_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $FUNC$
declare v_org uuid; v_target uuid;
begin
  select org_id, user_id into v_org, v_target
    from public.team_members where id = p_member_id;
  if v_org is null then raise exception 'Team member not found'; end if;
  if not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can cancel deletion';
  end if;

  update public.team_members
     set deletion_scheduled_at = null,
         deletion_requested_by = null,
         updated_at = now()
   where id = p_member_id;

  -- Reactivate membership
  update public.memberships
     set status = 'active'
   where user_id = v_target and org_id = v_org;

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'cancel_hard_delete', 'team_member', p_member_id,
    jsonb_build_object('target_user', v_target));
end $FUNC$;

revoke all on function public.cancel_hard_delete_member(uuid) from public;
grant execute on function public.cancel_hard_delete_member(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. RPC : execute_scheduled_member_deletions
--    Cron job: actually hard-delete members whose grace period has expired.
-- ---------------------------------------------------------------------
create or replace function public.execute_scheduled_member_deletions()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $FUNC$
declare
  v_rec record;
  v_count bigint := 0;
begin
  for v_rec in
    select id, org_id, user_id from public.team_members
     where deletion_scheduled_at is not null
       and deletion_scheduled_at < now()
  loop
    -- Delete memberships (FK cascade from team_members if configured, else explicit)
    delete from public.memberships where user_id = v_rec.user_id and org_id = v_rec.org_id;
    -- Delete the team_member row
    delete from public.team_members where id = v_rec.id;

    insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_rec.org_id, null, 'execute_hard_delete', 'team_member', v_rec.id,
      jsonb_build_object('target_user', v_rec.user_id, 'method', 'scheduled_30d'));

    v_count := v_count + 1;
  end loop;
  return v_count;
end $FUNC$;

revoke all on function public.execute_scheduled_member_deletions() from public;
grant execute on function public.execute_scheduled_member_deletions() to service_role;

-- Hook into the daily retention cron (runs at 04:00 UTC)
create or replace function public.run_retention_job()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $FUNC$
declare
  v_leads bigint; v_clients bigint; v_tokens bigint; v_audit bigint; v_members bigint;
begin
  v_leads   := public.anonymize_inactive_leads(24);
  v_clients := public.anonymize_old_soft_deleted_clients(180);
  v_tokens  := public.purge_expired_portal_tokens();
  v_audit   := public.purge_old_audit_events(1095);
  v_members := public.execute_scheduled_member_deletions();

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, null, 'retention_run', 'system', null,
    jsonb_build_object(
      'anonymized_leads', v_leads, 'anonymized_clients', v_clients,
      'purged_portal_tokens', v_tokens, 'purged_audit_events', v_audit,
      'hard_deleted_members', v_members, 'at', now()));

  return jsonb_build_object(
    'anonymized_leads', v_leads, 'anonymized_clients', v_clients,
    'purged_portal_tokens', v_tokens, 'purged_audit_events', v_audit,
    'hard_deleted_members', v_members);
end $FUNC$;

-- ---------------------------------------------------------------------
-- 5. RPC : set_member_mfa_required (admin toggle)
-- ---------------------------------------------------------------------
create or replace function public.set_member_mfa_required(p_member_id uuid, p_required boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $FUNC$
declare v_org uuid;
begin
  select org_id into v_org from public.team_members where id = p_member_id;
  if v_org is null then raise exception 'Team member not found'; end if;
  if not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can change MFA requirement';
  end if;

  update public.team_members
     set mfa_required = p_required, updated_at = now()
   where id = p_member_id;

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'set_mfa_required', 'team_member', p_member_id,
    jsonb_build_object('mfa_required', p_required));
end $FUNC$;

revoke all on function public.set_member_mfa_required(uuid, boolean) from public;
grant execute on function public.set_member_mfa_required(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. RPC : list_member_audit_events (per-user trail, org-scoped)
-- ---------------------------------------------------------------------
create or replace function public.list_member_audit_events(p_user_id uuid, p_limit int default 200)
returns setof public.audit_events
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $FUNC$
declare v_org uuid;
begin
  -- Find an org where both caller and target are members
  select m1.org_id into v_org
    from public.memberships m1
    join public.memberships m2 on m1.org_id = m2.org_id
   where m1.user_id = auth.uid()
     and m2.user_id = p_user_id
     and public.has_org_admin_role(auth.uid(), m1.org_id)
   limit 1;
  if v_org is null then raise exception 'Not authorized'; end if;

  return query
    select * from public.audit_events
     where org_id = v_org
       and (actor_id = p_user_id or entity_id = p_user_id)
     order by created_at desc
     limit greatest(1, least(p_limit, 1000));
end $FUNC$;

revoke all on function public.list_member_audit_events(uuid, int) from public;
grant execute on function public.list_member_audit_events(uuid, int) to authenticated, service_role;
