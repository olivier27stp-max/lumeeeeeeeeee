-- ============================================================================
-- RBAC: Roles, Scopes, Permissions — Enterprise-grade access control
-- ============================================================================

-- ============================================================================
-- 1. TEAMS table (sub-org grouping)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  leader_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  color       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams_select" ON public.teams
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "teams_modify" ON public.teams
  FOR ALL TO authenticated USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  ) WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  );

-- ============================================================================
-- 2. DEPARTMENTS table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "departments_select" ON public.departments
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "departments_modify" ON public.departments
  FOR ALL TO authenticated USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 3. ROLE TEMPLATES table — custom role definitions per org
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.role_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  default_scope text NOT NULL DEFAULT 'self' CHECK (default_scope IN ('self', 'assigned', 'team', 'department', 'company')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, slug)
);

ALTER TABLE public.role_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_templates_select" ON public.role_templates
  FOR SELECT TO authenticated USING (
    org_id IN (SELECT org_id FROM public.memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "role_templates_modify" ON public.role_templates
  FOR ALL TO authenticated USING (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  ) WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ============================================================================
-- 4. ALTER memberships — add scope, team, department, manager, language
-- ============================================================================

-- Add new role values
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('owner', 'admin', 'manager', 'sales_rep', 'technician', 'support', 'viewer', 'member'));

-- Add scope column
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'company'
  CHECK (scope IN ('self', 'assigned', 'team', 'department', 'company'));

-- Add team/department/manager links
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Additional metadata
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'fr';
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS team_name text;

-- Indexes for scoping queries
CREATE INDEX IF NOT EXISTS idx_memberships_team_id ON public.memberships(team_id);
CREATE INDEX IF NOT EXISTS idx_memberships_department_id ON public.memberships(department_id);
CREATE INDEX IF NOT EXISTS idx_memberships_manager_id ON public.memberships(manager_id);
CREATE INDEX IF NOT EXISTS idx_memberships_role ON public.memberships(org_id, role);

-- ============================================================================
-- 5. Add scope columns to invitations
-- ============================================================================

ALTER TABLE public.invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE public.invitations ADD CONSTRAINT invitations_role_check
  CHECK (role IN ('admin', 'manager', 'sales_rep', 'technician', 'support', 'viewer'));

ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'self'
  CHECK (scope IN ('self', 'assigned', 'team', 'department', 'company'));
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
ALTER TABLE public.invitations ADD COLUMN IF NOT EXISTS custom_permissions jsonb DEFAULT '{}'::jsonb;

-- ============================================================================
-- 6. RPC: has_permission — server-side permission check
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_permission(p_user uuid, p_org uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_perms jsonb;
  v_val boolean;
BEGIN
  IF p_user IS NULL OR p_org IS NULL THEN RETURN false; END IF;
  IF p_user = p_org THEN RETURN true; END IF;

  SELECT role, permissions INTO v_role, v_perms
  FROM public.memberships
  WHERE user_id = p_user AND org_id = p_org AND status = 'active'
  LIMIT 1;

  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'owner' THEN RETURN true; END IF;

  -- Check custom override first
  IF v_perms IS NOT NULL AND v_perms ? p_key THEN
    v_val := (v_perms ->> p_key)::boolean;
    RETURN COALESCE(v_val, false);
  END IF;

  -- Fallback: admin gets almost everything
  IF v_role = 'admin' THEN
    IF p_key = 'users.delete_owner' THEN RETURN false; END IF;
    RETURN true;
  END IF;

  -- Other roles: check permissions JSONB
  IF v_perms IS NOT NULL AND v_perms ? p_key THEN
    RETURN COALESCE((v_perms ->> p_key)::boolean, false);
  END IF;

  RETURN false;
END;
$$;

-- ============================================================================
-- 7. RPC: get_user_scope — returns user's scope for data filtering
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_scope(p_user uuid, p_org uuid)
RETURNS TABLE(scope text, team_id uuid, department_id uuid, manager_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT m.scope, m.team_id, m.department_id, m.manager_id
  FROM public.memberships m
  WHERE m.user_id = p_user AND m.org_id = p_org AND m.status = 'active'
  LIMIT 1;
END;
$$;

-- ============================================================================
-- 8. RPC: can_access_resource — checks if user can access a specific resource
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_access_resource(
  p_user uuid,
  p_org uuid,
  p_resource_owner uuid DEFAULT NULL,
  p_resource_team_id uuid DEFAULT NULL,
  p_resource_department_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text;
  v_team_id uuid;
  v_department_id uuid;
  v_role text;
BEGIN
  IF p_user IS NULL OR p_org IS NULL THEN RETURN false; END IF;

  SELECT m.role, m.scope, m.team_id, m.department_id
  INTO v_role, v_scope, v_team_id, v_department_id
  FROM public.memberships m
  WHERE m.user_id = p_user AND m.org_id = p_org AND m.status = 'active'
  LIMIT 1;

  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('owner', 'admin') THEN RETURN true; END IF;

  CASE v_scope
    WHEN 'company' THEN RETURN true;
    WHEN 'department' THEN
      RETURN p_resource_department_id IS NULL OR p_resource_department_id = v_department_id;
    WHEN 'team' THEN
      RETURN p_resource_team_id IS NULL OR p_resource_team_id = v_team_id;
    WHEN 'assigned' THEN
      RETURN p_resource_owner IS NULL OR p_resource_owner = p_user;
    WHEN 'self' THEN
      RETURN p_resource_owner IS NULL OR p_resource_owner = p_user;
    ELSE RETURN false;
  END CASE;
END;
$$;
