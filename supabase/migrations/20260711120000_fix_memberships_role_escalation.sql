-- ============================================================
-- Fix: memberships privilege escalation (affects web AND mobile)
--
-- The UPDATE/INSERT/DELETE policies from 20260426_fix_memberships_rls were made
-- fully permissive (org-scoped only, no role check) to dodge an RLS recursion.
-- Consequence: ANY authenticated member of an org can rewrite ANY membership in
-- that org — including changing their own role to 'owner' — via a direct
-- PostgREST call with the anon key. The mobile `updateMemberRole` does exactly
-- `update({ role })`.
--
-- This restricts writes to org owners/admins via has_org_admin_role (already
-- SECURITY DEFINER → no recursion), while preserving the two legitimate
-- self-service paths and server-side admin ops:
--   • a user updating their OWN row's non-role fields (e.g. full_name)
--   • the owner-bootstrap insert when creating a brand-new (empty) org
--   • the server's service_role admin ops (auth.uid() is null → bypass)
-- A column-level rule (no self role change) is enforced by a trigger, because
-- RLS cannot gate individual columns.
-- ============================================================

begin;

-- UPDATE: own row OR org admin (row-level). Role-column change is gated by the
-- trigger below.
drop policy if exists memberships_update_org on public.memberships;
create policy memberships_update_org on public.memberships
  for update to authenticated
  using (user_id = auth.uid() or public.has_org_admin_role(auth.uid(), org_id))
  with check (user_id = auth.uid() or public.has_org_admin_role(auth.uid(), org_id));

-- DELETE: leave your own membership OR org admin removing someone.
drop policy if exists memberships_delete_org on public.memberships;
create policy memberships_delete_org on public.memberships
  for delete to authenticated
  using (user_id = auth.uid() or public.has_org_admin_role(auth.uid(), org_id));

-- Helper: is an org empty? SECURITY DEFINER so the INSERT policy can check it
-- without recursing through memberships RLS.
create or replace function public.org_has_no_members(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.memberships where org_id = p_org);
$$;
revoke all on function public.org_has_no_members(uuid) from public;
grant execute on function public.org_has_no_members(uuid) to authenticated, service_role;

-- INSERT: org admin adding a member, OR owner-bootstrap for a fresh org
-- (self as owner, org has no members yet).
drop policy if exists memberships_insert_org on public.memberships;
create policy memberships_insert_org on public.memberships
  for insert to authenticated
  with check (
    public.has_org_admin_role(auth.uid(), org_id)
    or (
      user_id = auth.uid()
      and lower(coalesce(role, '')) = 'owner'
      and public.org_has_no_members(org_id)
    )
  );

-- Column-level guard: block anyone from promoting THEMSELVES, and block a
-- non-admin from changing anyone's role. Fires only when role actually changes.
-- Server service_role ops have no auth.uid() and pass through.
create or replace function public.enforce_membership_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if auth.uid() is null then
      return new; -- service_role / server-side admin ops
    end if;
    if auth.uid() = old.user_id then
      raise exception 'You cannot change your own role.' using errcode = '42501';
    end if;
    if not public.has_org_admin_role(auth.uid(), new.org_id) then
      raise exception 'Only org owners or admins can change member roles.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_membership_role_change on public.memberships;
create trigger trg_enforce_membership_role_change
  before update on public.memberships
  for each row execute function public.enforce_membership_role_change();

commit;
