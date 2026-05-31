-- ════════════════════════════════════════════════════════════════════
-- RLS: restrict non-admin members (e.g. sales_rep) to their OWN records
-- ────────────────────────────────────────────────────────────────────
-- Goal: a sales_rep sees only the leads / clients / quotes / jobs they
-- own or are assigned to. Owners & admins keep full org-wide visibility.
--
-- Approach: RESTRICTIVE policies. A restrictive policy is AND-ed with the
-- existing permissive org policies (`*_select_org`), so it can only REDUCE
-- visibility, never expand it. We therefore do NOT need to drop or know
-- the existing policies — this layer is purely additive and safe.
--
-- Reads flow through security_invoker views (leads_active, clients_active,
-- jobs_active), so RLS on the base tables IS enforced for the querying user.
-- The service_role client (server admin ops) bypasses RLS entirely and is
-- unaffected.
--
-- ROLLBACK: drop the 4 policies + the helper function (see bottom of file).
-- ════════════════════════════════════════════════════════════════════

-- ── Helper: is this user restricted to their own records in this org? ──
-- True for every role except owner/admin. SECURITY DEFINER so it can read
-- memberships regardless of that table's RLS.
create or replace function public.org_restricted_to_own(p_user uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = p_user
      and m.org_id  = p_org
      and m.role not in ('owner', 'admin')
  );
$$;

-- ── LEADS — assigned to or created by the user ──
drop policy if exists leads_rep_own_scope on public.leads;
create policy leads_rep_own_scope on public.leads
  as restrictive for select to authenticated
  using (
    not public.org_restricted_to_own((select auth.uid()), org_id)
    or assigned_to = (select auth.uid())
    or created_by  = (select auth.uid())
  );

-- ── CLIENTS — created by the user ──
drop policy if exists clients_rep_own_scope on public.clients;
create policy clients_rep_own_scope on public.clients
  as restrictive for select to authenticated
  using (
    not public.org_restricted_to_own((select auth.uid()), org_id)
    or created_by = (select auth.uid())
  );

-- ── QUOTES — salesperson or creator ──
drop policy if exists quotes_rep_own_scope on public.quotes;
create policy quotes_rep_own_scope on public.quotes
  as restrictive for select to authenticated
  using (
    not public.org_restricted_to_own((select auth.uid()), org_id)
    or salesperson_id = (select auth.uid())
    or created_by     = (select auth.uid())
  );

-- ── JOBS — salesperson, creator, or explicitly assigned via job_assignments ──
drop policy if exists jobs_rep_own_scope on public.jobs;
create policy jobs_rep_own_scope on public.jobs
  as restrictive for select to authenticated
  using (
    not public.org_restricted_to_own((select auth.uid()), org_id)
    or salesperson_id = (select auth.uid())
    or created_by     = (select auth.uid())
    or exists (
      select 1 from public.job_assignments ja
      where ja.job_id = jobs.id
        and ja.user_id = (select auth.uid())
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (run manually to revert):
--   drop policy if exists leads_rep_own_scope   on public.leads;
--   drop policy if exists clients_rep_own_scope on public.clients;
--   drop policy if exists quotes_rep_own_scope  on public.quotes;
--   drop policy if exists jobs_rep_own_scope    on public.jobs;
--   drop function if exists public.org_restricted_to_own(uuid, uuid);
-- ════════════════════════════════════════════════════════════════════
