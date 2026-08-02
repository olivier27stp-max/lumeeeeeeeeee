-- Fix cohérence : request_hard_delete_member référençait la table leads
-- (supprimée) => la suppression planifiée d'un membre avec réassignation
-- plantait en 42P01. Retrait des 2 UPDATE public.leads morts. 2026-08-02.

CREATE OR REPLACE FUNCTION public.request_hard_delete_member(p_member_id uuid, p_reassign_to uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_org       uuid;
  v_target    uuid;
  v_reassign_org uuid;
begin
  select org_id, user_id into v_org, v_target
    from public.team_members where id = p_member_id;
  if v_org is null then raise exception 'Team member not found'; end if;

  -- Caller must be admin or owner of this org
  if auth.uid() is not null and not public.has_org_admin_role(auth.uid(), v_org) then
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
  -- (retiré 2026-08-02 : update public.leads — table supprimée, plantait en 42P01)
  update public.clients set created_by = p_reassign_to
    where org_id = v_org and created_by = v_target;
  update public.jobs   set created_by = p_reassign_to
    where org_id = v_org and created_by = v_target;

  -- Best-effort reassignment for assigned_to fields (ignore if columns don't exist)
  -- (retiré 2026-08-02 : update public.leads — table supprimée)
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
end $function$
