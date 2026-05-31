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
// SECURITY: In production builds these helpers are no-ops. An XSS or malicious
// browser extension could otherwise set `localStorage['lume-dev-role-override']
// = 'owner'` and the SPA would honor it for client-side permission gating.
// Server-side checks aren't affected, but client-side route gating was.
const DEV_ROLE_KEY = 'lume-dev-role-override';
const IS_DEV = import.meta.env.DEV || (typeof window !== 'undefined' && (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
));

// ⚠️ TEMPORARY (QA): set to `true` to let the role switcher work on the
// DEPLOYED site for role testing. This is a CLIENT-SIDE UI preview only —
// the server (RBAC) and Supabase RLS still enforce your real role for data.
// Set back to `false` (or delete this flag) once role testing is done.
const ALLOW_ROLE_OVERRIDE_IN_PROD = true;
const ROLE_OVERRIDE_ENABLED = IS_DEV || ALLOW_ROLE_OVERRIDE_IN_PROD;

export function setDevRoleOverride(role: TeamRole | null) {
  if (!ROLE_OVERRIDE_ENABLED) return;
  if (role) {
    localStorage.setItem(DEV_ROLE_KEY, role);
  } else {
    localStorage.removeItem(DEV_ROLE_KEY);
  }
}

export function getDevRoleOverride(): TeamRole | null {
  if (!ROLE_OVERRIDE_ENABLED) {
    // Defensive: even if a stale override was written before this guard
    // existed, ignore it when overrides are disabled.
    return null;
  }
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
