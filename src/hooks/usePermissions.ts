import { useContext, useMemo } from 'react';
import {
  type TeamRole,
  type Scope,
  type PermissionsMap,
} from '../lib/permissions';
import { CompanyContext } from '../contexts/CompanyContext';

export interface UserPermissionContext {
  permissions: PermissionsMap | null;
  role: TeamRole | null;
  scope: Scope;
  userId: string | null;
  teamId: string | null;
  departmentId: string | null;
  managerId: string | null;
  loading: boolean;
}

const EMPTY: UserPermissionContext = {
  permissions: null, role: null, scope: 'self',
  userId: null, teamId: null, departmentId: null, managerId: null,
  loading: false,
};

// ── Dev role override ──────────────────────────────────────────────
const DEV_ROLE_KEY = 'lume-dev-role-override';

export function setDevRoleOverride(role: TeamRole | null) {
  if (role) {
    localStorage.setItem(DEV_ROLE_KEY, role);
  } else {
    localStorage.removeItem(DEV_ROLE_KEY);
  }
}

export function getDevRoleOverride(): TeamRole | null {
  return (localStorage.getItem(DEV_ROLE_KEY) as TeamRole) || null;
}

// ── Hook — derives from CompanyContext (single source of truth) ────

/**
 * usePermissions now delegates to CompanyContext.
 * This avoids a duplicate memberships query and ensures permissions
 * always reflect the currently active company (not an arbitrary one).
 */
export function usePermissions(): UserPermissionContext {
  const company = useContext(CompanyContext);

  return useMemo<UserPermissionContext>(() => {
    // CompanyProvider not mounted — return loading state
    if (!company) return { ...EMPTY, loading: true };

    if (company.loading) return { ...EMPTY, loading: true };
    if (!company.current) return EMPTY;

    return {
      permissions: company.currentPermissions,
      role: company.currentRole,
      scope: company.currentScope,
      userId: company.userId,
      teamId: company.current.teamId,
      departmentId: company.current.departmentId,
      managerId: company.current.managerId,
      loading: false,
    };
  }, [company]);
}

/** Invalidate cache (call after role/permission change). */
export function invalidatePermissionsCache() {
  // No-op now — CompanyContext handles refresh via its own refresh() method.
}
