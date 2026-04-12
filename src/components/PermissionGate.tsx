import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { type PermissionKey, hasPermission, checkScope, can } from '../lib/permissions';

interface PermissionGateProps {
  /** Single permission to check */
  permission?: PermissionKey;
  /** Multiple permissions — all required (AND) */
  permissions?: PermissionKey[];
  /** Multiple permissions — any required (OR) */
  anyPermission?: PermissionKey[];
  /** Optional resource context for scope check */
  resource?: {
    owner_id?: string | null;
    team_id?: string | null;
    department_id?: string | null;
  };
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

const DefaultFallback: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-20 text-center">
    <div className="w-14 h-14 rounded-2xl bg-danger/10 flex items-center justify-center mb-4">
      <ShieldAlert size={24} className="text-danger" />
    </div>
    <h2 className="text-[16px] font-bold text-text-primary mb-1">
      Access Restricted
    </h2>
    <p className="text-[13px] text-text-tertiary max-w-sm">
      You don't have permission to view this page. Contact your administrator if you believe this is an error.
    </p>
  </div>
);

export default function PermissionGate({ permission, permissions: allPerms, anyPermission, resource, children, fallback }: PermissionGateProps) {
  const ctx = usePermissions();

  if (ctx.loading) return null;

  // Owner bypasses everything
  if (ctx.role === 'owner') return <>{children}</>;

  const perms = ctx.permissions;

  // Single permission check
  if (permission) {
    if (resource && ctx.role && ctx.userId) {
      const allowed = can(
        { role: ctx.role, permissions: perms, scope: ctx.scope, userId: ctx.userId, teamId: ctx.teamId, departmentId: ctx.departmentId },
        permission,
        resource
      );
      if (!allowed) return <>{fallback ?? <DefaultFallback />}</>;
    } else {
      if (!hasPermission(perms, permission, ctx.role ?? undefined)) {
        return <>{fallback ?? <DefaultFallback />}</>;
      }
    }
  }

  // All permissions required (AND)
  if (allPerms) {
    const allOk = allPerms.every((p) => hasPermission(perms, p, ctx.role ?? undefined));
    if (!allOk) return <>{fallback ?? <DefaultFallback />}</>;
  }

  // Any permission required (OR)
  if (anyPermission) {
    const anyOk = anyPermission.some((p) => hasPermission(perms, p, ctx.role ?? undefined));
    if (!anyOk) return <>{fallback ?? <DefaultFallback />}</>;
  }

  return <>{children}</>;
}
