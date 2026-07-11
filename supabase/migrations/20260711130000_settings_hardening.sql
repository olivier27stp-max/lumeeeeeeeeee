-- ============================================================
-- Settings audit hardening (3 fixes)
--
-- 1. memberships trigger: the role-escalation fix (20260711120000) guards the
--    `role` column only. But permission resolution also reads
--    `memberships.permissions` (overrides) and `scope` — and the UPDATE policy
--    allows a user to edit their OWN row. So a rep could still self-grant
--    all-true permission overrides. Extend the guard to those columns.
--
-- 2. orgs: the UPDATE policy allowed ANY org member to rename the org / change
--    its slug (Settings > Workspace). Restrict to owner/admin.
--
-- 3. team_members: 20260726 closed the cross-tenant hole but deliberately left
--    UPDATE/DELETE open to every org member ("product decision"). team_members
--    carries hourly rates (margin-sensitive) and status — restrict writes to
--    owner/admin. (SELECT stays org-wide: names/avatars feed team pickers.)
-- ============================================================

begin;

-- ── 1. memberships: guard role + permissions + scope ──
create or replace function public.enforce_membership_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role)
     or (new.permissions is distinct from old.permissions)
     or (new.scope is distinct from old.scope) then
    if auth.uid() is null then
      return new; -- service_role / server-side admin ops
    end if;
    if auth.uid() = old.user_id then
      raise exception 'You cannot change your own role or permissions.' using errcode = '42501';
    end if;
    if not public.has_org_admin_role(auth.uid(), new.org_id) then
      raise exception 'Only org owners or admins can change member roles or permissions.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
-- (trigger trg_enforce_membership_role_change from 20260711120000 already
--  points at this function; CREATE OR REPLACE is enough.)

-- ── 2. orgs: rename/update restricted to owner/admin ──
-- (owner_id fallback kept: during onboarding the org can be updated before the
--  owner membership row exists.)
drop policy if exists "orgs_update" on public.orgs;
create policy "orgs_update" on public.orgs
  for update to authenticated
  using (owner_id = auth.uid() or public.has_org_admin_role(auth.uid(), id))
  with check (owner_id = auth.uid() or public.has_org_admin_role(auth.uid(), id));

-- ── 3. team_members: writes restricted to owner/admin ──
drop policy if exists team_members_update_org on public.team_members;
create policy team_members_update_org on public.team_members
  for update to authenticated
  using      (public.has_org_admin_role(auth.uid(), org_id))
  with check (public.has_org_admin_role(auth.uid(), org_id));

drop policy if exists team_members_delete_org on public.team_members;
create policy team_members_delete_org on public.team_members
  for delete to authenticated
  using (public.has_org_admin_role(auth.uid(), org_id));

-- ── 4. company_settings: one row per org ──
-- Readers use `.limit(1).maybeSingle()` and the save flow now upserts on
-- org_id — both assume a single row. A transient load failure used to let the
-- client INSERT a duplicate; dedupe (keep the most recently updated row) then
-- enforce uniqueness.
delete from public.company_settings a
  using public.company_settings b
  where a.org_id = b.org_id
    and a.org_id is not null
    and (a.updated_at, a.id) < (b.updated_at, b.id);
create unique index if not exists company_settings_org_unique
  on public.company_settings(org_id);

commit;
