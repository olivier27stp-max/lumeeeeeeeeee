// Convenience hook over the membership context: role-aware permission checks.
// Same semantics as the web `hasPermission` so mobile and desktop agree.

import { useMembership } from './membership-context';
import { hasPermission, PermissionKey, TeamRole } from './permissions';

export function usePermissions() {
  const { current } = useMembership();
  const role: TeamRole | null = current?.role ?? null;
  const permissions = current?.permissions ?? null;

  const can = (key: PermissionKey) => hasPermission(permissions, key, role ?? undefined);

  return {
    role,
    permissions,
    orgId: current?.orgId ?? null,
    teamId: current?.teamId ?? null,
    scope: current?.scope ?? 'self',
    can,
    /** Can this user see money/pricing anywhere? Technicians: never. */
    canSeePricing: can('financial.view_pricing'),
    /** Can this user create jobs/clients? (admin/owner; technician: no) */
    canCreateJobs: can('jobs.create'),
    canCreateClients: can('clients.create'),
  };
}
