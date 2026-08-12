import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { TeamRole, Scope, PermissionsMap } from '../lib/permissions';
import { resolvePermissions, getDefaultPermissions, getDefaultScope } from '../lib/permissions';
import { getDevRoleOverride } from '../hooks/usePermissions';
import { setSentryOrgContext } from '../lib/sentry';

// ── Types ─────────────────────────────────────────────────────────────

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

export interface CompanyContextValue {
  /** Current active company membership (null while loading or if none) */
  current: CompanyMembership | null;
  /** Shortcut: current org_id */
  currentOrgId: string | null;
  /** Shortcut: current role */
  currentRole: TeamRole | null;
  /** Shortcut: current scope */
  currentScope: Scope;
  /** Shortcut: current permissions map */
  currentPermissions: PermissionsMap | null;
  /** All companies the user belongs to (active memberships) */
  companies: CompanyMembership[];
  /** True while the initial load is in progress */
  loading: boolean;
  /** True if user has more than one active company */
  isMultiCompany: boolean;
  /** True if user has zero companies (needs onboarding or invitation) */
  hasNoCompany: boolean;
  /** Switch to a different company (for multi-membership users) */
  switchCompany: (orgId: string) => void;
  /** Re-fetch memberships from DB (call after role/permission change) */
  refresh: () => Promise<void>;
  /** The authenticated user's ID */
  userId: string | null;
}

const STORAGE_KEY = 'lume-active-org';

// ── Context ───────────────────────────────────────────────────────────

export const CompanyContext = createContext<CompanyContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────

export function CompanyProvider({ children, userId }: { children: React.ReactNode; userId: string | null }) {
  const queryClient = useQueryClient();
  // Guards a one-time JWT refresh per user when the token's org claim is stale.
  const claimSyncedForUser = useRef<string | null>(null);
  const [companies, setCompanies] = useState<CompanyMembership[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() => {
    // Restore last active org from localStorage — validate UUID format
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved)) {
        return saved;
      }
      return null;
    } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  // ── Fetch all memberships for user ──────────────────────────────────
  const fetchMemberships = useCallback(async () => {
    if (!userId) {
      setCompanies([]);
      setLoading(false);
      return;
    }

    try {
      // 1. Get all active memberships
      const { data: memberships, error } = await supabase
        .from('memberships')
        .select('org_id, role, scope, permissions, team_id, department_id, manager_id, status, full_name, avatar_url')
        .eq('user_id', userId)
        .in('status', ['active', 'pending']);

      if (error) throw error;
      if (!memberships || memberships.length === 0) {
        setCompanies([]);
        setLoading(false);
        return;
      }

      // 2. Get company names for all orgs
      const orgIds = memberships.map((m: any) => m.org_id).filter(Boolean);
      let companyNames: Record<string, string> = {};

      if (orgIds.length > 0) {
        const { data: settings } = await supabase
          .from('company_settings')
          .select('org_id, company_name')
          .in('org_id', orgIds);

        if (settings) {
          for (const s of settings) {
            if (s.org_id && s.company_name) {
              companyNames[s.org_id] = s.company_name;
            }
          }
        }

        // Fallback: try org_billing_settings for orgs without company_settings
        const missingOrgs = orgIds.filter((id: string) => !companyNames[id]);
        if (missingOrgs.length > 0) {
          const { data: billing } = await supabase
            .from('org_billing_settings')
            .select('org_id, company_name')
            .in('org_id', missingOrgs);

          if (billing) {
            for (const b of billing) {
              if (b.org_id && b.company_name) {
                companyNames[b.org_id] = b.company_name;
              }
            }
          }
        }
      }

      // 3. Build CompanyMembership objects
      const devRole = getDevRoleOverride();
      const mapped: CompanyMembership[] = memberships
        .filter((m: any) => m.status === 'active')
        .map((m: any) => {
          let role = (m.role || 'sales_rep') as TeamRole;
          let scope = (m.scope || getDefaultScope(role)) as Scope;
          let permissions: PermissionsMap;

          if (devRole) {
            role = devRole;
            scope = getDefaultScope(devRole);
            permissions = resolvePermissions(devRole, null);
          } else {
            const overrides = m.permissions && typeof m.permissions === 'object'
              ? m.permissions as Record<string, boolean>
              : null;
            permissions = resolvePermissions(role, overrides);
          }

          return {
            orgId: m.org_id,
            role,
            scope,
            permissions,
            teamId: m.team_id || null,
            departmentId: m.department_id || null,
            managerId: m.manager_id || null,
            status: m.status || 'active',
            fullName: m.full_name || null,
            avatarUrl: m.avatar_url || null,
            companyName: companyNames[m.org_id] || null,
          };
        });

      setCompanies(mapped);

      // Keep the JWT org claim in sync with reality. If the token's org_ids
      // claim is stale (user was added to / removed from an org since the token
      // was issued), refresh the session ONCE so RLS's claim fast-path matches
      // actual memberships immediately instead of waiting for token expiry.
      // Correctness never depends on this (current_org_ids() falls back to the
      // memberships table); this just removes the propagation lag.
      if (userId && claimSyncedForUser.current !== userId) {
        claimSyncedForUser.current = userId; // mark attempted first — avoids refresh loops
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const claimOrgs: string[] = ((session?.user?.app_metadata as { org_ids?: string[] })?.org_ids) ?? [];
          const dbOrgs = mapped.map((m) => m.orgId);
          const stale = dbOrgs.length !== claimOrgs.length || dbOrgs.some((o) => !claimOrgs.includes(o));
          if (stale) await supabase.auth.refreshSession();
        } catch { /* non-fatal */ }
      }

      // 4. Auto-select company if needed
      if (mapped.length === 1) {
        // Single company — auto-select
        setActiveOrgId(mapped[0].orgId);
        try { localStorage.setItem(STORAGE_KEY, mapped[0].orgId); } catch {}
      } else if (mapped.length > 1) {
        // Multi-company — restore from localStorage or select first
        const savedOrg = localStorage.getItem(STORAGE_KEY);
        const validSaved = savedOrg && mapped.some((c) => c.orgId === savedOrg);
        if (validSaved) {
          setActiveOrgId(savedOrg);
        } else {
          // Default to first company
          setActiveOrgId(mapped[0].orgId);
          try { localStorage.setItem(STORAGE_KEY, mapped[0].orgId); } catch {}
        }
      }
    } catch (err) {
      console.error('[CompanyContext] Failed to fetch memberships:', err);
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // ── Load on mount and when userId changes ───────────────────────────
  useEffect(() => {
    setLoading(true);
    fetchMemberships();
  }, [fetchMemberships]);

  // ── Switch company ──────────────────────────────────────────────────
  const switchCompany = useCallback((orgId: string) => {
    // Validate UUID format to prevent XSS-driven localStorage poisoning
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
      console.warn('[CompanyContext] Invalid orgId format', orgId);
      return;
    }

    const target = companies.find((c) => c.orgId === orgId);
    if (!target) {
      console.warn('[CompanyContext] Cannot switch to org', orgId, '— not a member');
      return;
    }

    setActiveOrgId(orgId);
    try { localStorage.setItem(STORAGE_KEY, orgId); } catch {}

    // Invalidate ALL cached queries — data must reload for new tenant
    queryClient.clear();
  }, [companies, queryClient]);

  // ── Build context value ─────────────────────────────────────────────
  const current = useMemo(() => {
    if (!activeOrgId) return null;
    return companies.find((c) => c.orgId === activeOrgId) || null;
  }, [companies, activeOrgId]);

  // Étiquette les erreurs Sentry avec l'org active (id + nom lisible), et la
  // met à jour au changement de compagnie. No-op sans VITE_SENTRY_DSN.
  useEffect(() => {
    setSentryOrgContext(
      current ? { orgId: current.orgId, companyName: current.companyName, userId } : null,
    );
  }, [current, userId]);

  const value = useMemo<CompanyContextValue>(() => ({
    current,
    currentOrgId: current?.orgId || null,
    currentRole: current?.role || null,
    currentScope: current?.scope || 'self',
    currentPermissions: current?.permissions || null,
    companies,
    loading,
    isMultiCompany: companies.length > 1,
    hasNoCompany: !loading && companies.length === 0,
    switchCompany,
    refresh: fetchMemberships,
    userId,
  }), [current, companies, loading, switchCompany, fetchMemberships, userId]);

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within <CompanyProvider>');
  return ctx;
}

/** Shortcut: get the current org_id or throw (for API calls) */
export function useCurrentOrgId(): string {
  const { currentOrgId, loading } = useCompany();
  if (loading) throw new Error('Company context is still loading');
  if (!currentOrgId) throw new Error('No active company — user has no membership');
  return currentOrgId;
}
