// Membership / role resolution for mobile — mirrors web `src/contexts/CompanyContext.tsx`.
// Reuses the exact same `memberships` table + `permissions.ts` rules so a user
// has identical rights on mobile and desktop.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';
import type { PermissionsMap, Scope, TeamRole } from './permissions';
import { getDefaultScope, resolvePermissions } from './permissions';

export interface CompanyMembership {
  orgId: string;
  role: TeamRole;
  scope: Scope;
  permissions: PermissionsMap;
  teamId: string | null;
  departmentId: string | null;
  managerId: string | null;
  status: string;
  fullName: string | null;
  avatarUrl: string | null;
  companyName: string | null;
}

/** AsyncStorage key for the last active org (multi-company users). */
export const ACTIVE_ORG_KEY = 'lume-active-org';
/** AsyncStorage key caching the resolved memberships for offline boot. */
export const MEMBERSHIP_CACHE_KEY = 'lume-mobile-memberships';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetch every active company membership for the user, resolving the full
 * permission map for each. Mirrors the web fetch shape exactly.
 */
export async function fetchMemberships(userId: string): Promise<CompanyMembership[]> {
  // 1. All active/pending memberships
  const { data: memberships, error } = await supabase
    .from('memberships')
    .select('org_id, role, scope, permissions, team_id, department_id, manager_id, status, full_name, avatar_url')
    .eq('user_id', userId)
    .in('status', ['active', 'pending']);

  if (error) throw error;
  if (!memberships || memberships.length === 0) return [];

  // 2. Company names (best-effort; same fallback chain as web)
  const orgIds = memberships.map((m: any) => m.org_id).filter(Boolean);
  const companyNames: Record<string, string> = {};

  if (orgIds.length > 0) {
    const { data: settings } = await supabase
      .from('company_settings')
      .select('org_id, company_name')
      .in('org_id', orgIds);
    for (const s of settings ?? []) {
      if (s.org_id && s.company_name) companyNames[s.org_id] = s.company_name;
    }
    const missing = orgIds.filter((id: string) => !companyNames[id]);
    if (missing.length > 0) {
      const { data: billing } = await supabase
        .from('org_billing_settings')
        .select('org_id, company_name')
        .in('org_id', missing);
      for (const b of billing ?? []) {
        if (b.org_id && b.company_name) companyNames[b.org_id] = b.company_name;
      }
    }
  }

  // 3. Build CompanyMembership objects (active only)
  return memberships
    .filter((m: any) => m.status === 'active')
    .map((m: any): CompanyMembership => {
      const role = (m.role || 'sales_rep') as TeamRole;
      const scope = (m.scope || getDefaultScope(role)) as Scope;
      const overrides =
        m.permissions && typeof m.permissions === 'object'
          ? (m.permissions as Record<string, boolean>)
          : null;
      return {
        orgId: m.org_id,
        role,
        scope,
        permissions: resolvePermissions(role, overrides),
        teamId: m.team_id || null,
        departmentId: m.department_id || null,
        managerId: m.manager_id || null,
        status: m.status || 'active',
        fullName: m.full_name || null,
        avatarUrl: m.avatar_url || null,
        companyName: companyNames[m.org_id] || null,
      };
    });
}

/** Pick the active membership from a list, honoring the saved org choice. */
export async function pickActiveMembership(
  list: CompanyMembership[],
): Promise<CompanyMembership | null> {
  if (list.length === 0) return null;
  if (list.length === 1) {
    await AsyncStorage.setItem(ACTIVE_ORG_KEY, list[0].orgId);
    return list[0];
  }
  const saved = await AsyncStorage.getItem(ACTIVE_ORG_KEY);
  if (saved && UUID_RE.test(saved)) {
    const match = list.find((m) => m.orgId === saved);
    if (match) return match;
  }
  await AsyncStorage.setItem(ACTIVE_ORG_KEY, list[0].orgId);
  return list[0];
}

/** Persist resolved memberships so the app can boot offline with the last role. */
export async function cacheMemberships(list: CompanyMembership[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MEMBERSHIP_CACHE_KEY, JSON.stringify(list));
  } catch {
    // non-fatal
  }
}

/** Read the cached memberships (for offline boot). */
export async function readCachedMemberships(): Promise<CompanyMembership[] | null> {
  try {
    const raw = await AsyncStorage.getItem(MEMBERSHIP_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CompanyMembership[]) : null;
  } catch {
    return null;
  }
}
