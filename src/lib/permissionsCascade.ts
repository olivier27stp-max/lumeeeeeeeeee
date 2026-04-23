// ══════════════════════════════════════════════════════════════════════
// Permission cascade — dependency graph for the role settings UI
// Pure logic, no React. Designed to be unit-tested.
// ══════════════════════════════════════════════════════════════════════

import {
  FINANCIAL_PERMISSION_KEYS,
  type PermissionKey,
  type PermissionsMap,
  type TeamRole,
} from './permissions';

/**
 * When enabling a permission, its prerequisites are also enabled.
 * When disabling a permission, anything that depends on it is also disabled.
 *
 * Rule of thumb: write/delete/assign/send require read on the same module.
 * Invoices and payments also require their `financial.view_*` sibling
 * so we can't have "create invoices" while the whole module is hidden.
 */
export const DEPENDS_ON: Partial<Record<PermissionKey, PermissionKey[]>> = {
  'clients.create': ['clients.read'],
  'clients.update': ['clients.read'],
  'clients.delete': ['clients.read'],
  'leads.create': ['leads.read'],
  'leads.update': ['leads.read'],
  'leads.delete': ['leads.read'],
  'leads.assign': ['leads.read'],
  'quotes.create': ['quotes.read'],
  'quotes.update': ['quotes.read'],
  'quotes.delete': ['quotes.read'],
  'quotes.send': ['quotes.read'],
  'quotes.approve': ['quotes.read'],
  'jobs.create': ['jobs.read'],
  'jobs.update': ['jobs.read'],
  'jobs.delete': ['jobs.read'],
  'jobs.assign': ['jobs.read'],
  'jobs.complete': ['jobs.read'],
  'invoices.create': ['invoices.read', 'financial.view_invoices'],
  'invoices.update': ['invoices.read', 'financial.view_invoices'],
  'invoices.delete': ['invoices.read', 'financial.view_invoices'],
  'invoices.send': ['invoices.read', 'financial.view_invoices'],
  'invoices.read': ['financial.view_invoices'],
  'payments.create': ['payments.read', 'financial.view_payments'],
  'payments.refund': ['payments.read', 'financial.view_payments'],
  'payments.read': ['financial.view_payments'],
  'messages.send': ['messages.read'],
  'calendar.update': ['calendar.read'],
  'door_to_door.edit': ['door_to_door.access'],
  'door_to_door.convert': ['door_to_door.access'],
  'settings.update': ['settings.read'],
  'automations.update': ['automations.read'],
  'integrations.update': ['integrations.read'],
  'team.update': ['team.read'],
  'timesheets.update': ['timesheets.read'],
  'analytics.view': ['financial.view_analytics'],
  'reports.read': ['financial.view_reports'],
  'external_agent.review': ['external_agent.use'],
  'external_agent.admin': ['external_agent.use', 'external_agent.review'],
  'users.update_role': ['users.invite'],
  'users.disable': ['users.invite'],
  'users.delete': ['users.invite', 'users.disable'],
};

/** Reverse index: which permissions depend on this one? */
export const DEPENDENTS: Partial<Record<PermissionKey, PermissionKey[]>> = (() => {
  const r: Partial<Record<PermissionKey, PermissionKey[]>> = {};
  for (const [key, deps] of Object.entries(DEPENDS_ON)) {
    for (const d of deps as PermissionKey[]) {
      (r[d] ??= []).push(key as PermissionKey);
    }
  }
  return r;
})();

/**
 * Apply a checkbox change to a permissions map, cascading through
 * the dependency graph.
 *
 * Invariants:
 *   - Enabling a permission also enables all its prerequisites (transitively).
 *   - Disabling a permission also disables every permission that depends on it.
 *   - Technician can never gain a financial permission, even indirectly.
 *   - The input map is never mutated.
 */
export function applyCascade(
  current: PermissionsMap,
  key: PermissionKey,
  value: boolean,
  role: TeamRole,
): PermissionsMap {
  const next = { ...current };
  const visited = new Set<PermissionKey>();

  function enable(k: PermissionKey) {
    if (visited.has(k)) return;
    visited.add(k);
    // Hard security: technician can never gain financial perms.
    if (role === 'technician' && FINANCIAL_PERMISSION_KEYS.includes(k)) return;
    next[k] = true;
    for (const dep of DEPENDS_ON[k] ?? []) enable(dep);
  }

  function disable(k: PermissionKey) {
    if (visited.has(k)) return;
    visited.add(k);
    next[k] = false;
    for (const child of DEPENDENTS[k] ?? []) disable(child);
  }

  if (value) enable(key);
  else disable(key);

  return next;
}
