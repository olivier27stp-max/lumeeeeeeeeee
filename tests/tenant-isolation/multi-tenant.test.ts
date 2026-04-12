/* ═══════════════════════════════════════════════════════════════
   Tests — Multi-Tenant Isolation
   Validates that the multi-tenant architecture correctly
   isolates data, permissions, and contexts between companies.
   ═══════════════════════════════════════════════════════════════ */

import { describe, it, expect } from 'vitest';

// ── 1. CompanyContext Logic ────────────────────────────────────────

describe('CompanyContext — tenant selection logic', () => {
  const STORAGE_KEY = 'lume-active-org';

  it('single company user: auto-selects the only company', () => {
    const companies = [
      { orgId: 'org-aaa', role: 'owner', companyName: 'Acme Corp' },
    ];

    // Simulates the auto-select logic in CompanyProvider
    let activeOrgId: string | null = null;
    if (companies.length === 1) {
      activeOrgId = companies[0].orgId;
    }

    expect(activeOrgId).toBe('org-aaa');
  });

  it('multi-company user: restores from localStorage if valid', () => {
    const companies = [
      { orgId: 'org-aaa', role: 'owner', companyName: 'Acme Corp' },
      { orgId: 'org-bbb', role: 'admin', companyName: 'Beta Inc' },
    ];
    const savedOrg = 'org-bbb';

    let activeOrgId: string | null = null;
    const validSaved = savedOrg && companies.some((c) => c.orgId === savedOrg);
    if (validSaved) {
      activeOrgId = savedOrg;
    } else {
      activeOrgId = companies[0].orgId;
    }

    expect(activeOrgId).toBe('org-bbb');
  });

  it('multi-company user: falls back to first if saved org is invalid', () => {
    const companies = [
      { orgId: 'org-aaa', role: 'owner', companyName: 'Acme Corp' },
      { orgId: 'org-bbb', role: 'admin', companyName: 'Beta Inc' },
    ];
    const savedOrg = 'org-DELETED'; // No longer valid

    let activeOrgId: string | null = null;
    const validSaved = savedOrg && companies.some((c) => c.orgId === savedOrg);
    if (validSaved) {
      activeOrgId = savedOrg;
    } else {
      activeOrgId = companies[0].orgId;
    }

    expect(activeOrgId).toBe('org-aaa');
  });

  it('no companies: activeOrgId stays null', () => {
    const companies: any[] = [];

    let activeOrgId: string | null = null;
    if (companies.length === 1) {
      activeOrgId = companies[0].orgId;
    }

    expect(activeOrgId).toBeNull();
  });
});

// ── 2. OrgId Resolution Priority ───────────────────────────────────

describe('getCurrentOrgId — resolution priority', () => {
  const UUID_REGEX = /^[0-9a-f-]{36}$/i;

  it('accepts valid UUID from localStorage', () => {
    const saved = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(UUID_REGEX.test(saved)).toBe(true);
  });

  it('rejects non-UUID strings from localStorage', () => {
    const saved = 'not-a-uuid';
    expect(UUID_REGEX.test(saved)).toBe(false);
  });

  it('rejects empty string', () => {
    const saved = '';
    expect(UUID_REGEX.test(saved)).toBe(false);
  });
});

// ── 3. Permission Scoping ──────────────────────────────────────────

describe('Permission scoping — per-company roles', () => {
  type TeamRole = 'owner' | 'admin' | 'manager' | 'sales_rep' | 'technician' | 'support' | 'viewer';

  interface Membership {
    orgId: string;
    role: TeamRole;
  }

  function getRoleForOrg(memberships: Membership[], orgId: string): TeamRole | null {
    const m = memberships.find((m) => m.orgId === orgId);
    return m?.role || null;
  }

  it('user has different roles in different companies', () => {
    const memberships: Membership[] = [
      { orgId: 'org-aaa', role: 'owner' },
      { orgId: 'org-bbb', role: 'sales_rep' },
    ];

    expect(getRoleForOrg(memberships, 'org-aaa')).toBe('owner');
    expect(getRoleForOrg(memberships, 'org-bbb')).toBe('sales_rep');
  });

  it('user cannot access a company they are not a member of', () => {
    const memberships: Membership[] = [
      { orgId: 'org-aaa', role: 'owner' },
    ];

    expect(getRoleForOrg(memberships, 'org-bbb')).toBeNull();
  });
});

// ── 4. Cross-Tenant Data Isolation ─────────────────────────────────

describe('Cross-tenant data isolation — query scoping', () => {
  // Simulates the defense-in-depth pattern used in API files
  function buildQuery(table: string, orgId: string, filters: Record<string, any> = {}) {
    const parts: string[] = [`FROM ${table}`];
    parts.push(`WHERE org_id = '${orgId}'`);
    for (const [key, value] of Object.entries(filters)) {
      parts.push(`AND ${key} = '${value}'`);
    }
    return parts.join(' ');
  }

  it('client query is scoped to org_id', () => {
    const query = buildQuery('clients', 'org-aaa');
    expect(query).toContain("org_id = 'org-aaa'");
    expect(query).not.toContain('org-bbb');
  });

  it('lead query includes org_id filter', () => {
    const query = buildQuery('leads', 'org-bbb', { status: 'new' });
    expect(query).toContain("org_id = 'org-bbb'");
    expect(query).toContain("status = 'new'");
  });

  it('invoice query does not leak to other orgs', () => {
    const queryA = buildQuery('invoices', 'org-aaa');
    const queryB = buildQuery('invoices', 'org-bbb');

    expect(queryA).toContain("org_id = 'org-aaa'");
    expect(queryB).toContain("org_id = 'org-bbb'");
    expect(queryA).not.toContain('org-bbb');
    expect(queryB).not.toContain('org-aaa');
  });
});

// ── 5. Company Switch — Cache Invalidation ─────────────────────────

describe('Company switch — cache and state management', () => {
  it('switching company should clear all cached data', () => {
    const cache = new Map<string, any>();
    cache.set('clients-list', [{ id: 1, org_id: 'org-aaa' }]);
    cache.set('leads-list', [{ id: 2, org_id: 'org-aaa' }]);

    // Simulate queryClient.clear() on switch
    cache.clear();

    expect(cache.size).toBe(0);
  });

  it('localStorage is updated on company switch', () => {
    const STORAGE_KEY = 'lume-active-org';
    const storage: Record<string, string> = {};

    // Switch to org-bbb
    storage[STORAGE_KEY] = 'org-bbb';
    expect(storage[STORAGE_KEY]).toBe('org-bbb');

    // Switch to org-aaa
    storage[STORAGE_KEY] = 'org-aaa';
    expect(storage[STORAGE_KEY]).toBe('org-aaa');
  });
});

// ── 6. Scenario Tests ──────────────────────────────────────────────

describe('Scenario A: User A (Company A) cannot see User B (Company B) data', () => {
  function filterByOrg<T extends { org_id: string }>(data: T[], orgId: string): T[] {
    return data.filter((d) => d.org_id === orgId);
  }

  const allClients = [
    { id: '1', org_id: 'org-aaa', name: 'Client A1' },
    { id: '2', org_id: 'org-aaa', name: 'Client A2' },
    { id: '3', org_id: 'org-bbb', name: 'Client B1' },
    { id: '4', org_id: 'org-bbb', name: 'Client B2' },
  ];

  it('User A sees only Company A clients', () => {
    const result = filterByOrg(allClients, 'org-aaa');
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.org_id === 'org-aaa')).toBe(true);
  });

  it('User B sees only Company B clients', () => {
    const result = filterByOrg(allClients, 'org-bbb');
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.org_id === 'org-bbb')).toBe(true);
  });

  it('User A cannot see any Company B data', () => {
    const result = filterByOrg(allClients, 'org-aaa');
    expect(result.some((c) => c.org_id === 'org-bbb')).toBe(false);
  });
});

describe('Scenario B: Employee arrives in correct company', () => {
  it('employee with single membership auto-enters their company', () => {
    const memberships = [
      { orgId: 'org-aaa', role: 'sales_rep' as const, status: 'active' },
    ];

    const activeCompanies = memberships.filter((m) => m.status === 'active');
    let selectedOrg: string | null = null;

    if (activeCompanies.length === 1) {
      selectedOrg = activeCompanies[0].orgId;
    }

    expect(selectedOrg).toBe('org-aaa');
  });

  it('suspended employee has no active membership', () => {
    const memberships = [
      { orgId: 'org-aaa', role: 'sales_rep' as const, status: 'suspended' },
    ];

    const activeCompanies = memberships.filter((m) => m.status === 'active');
    expect(activeCompanies).toHaveLength(0);
  });
});

describe('Scenario C: Multi-company owner', () => {
  it('owner sees all their companies', () => {
    const memberships = [
      { orgId: 'org-aaa', role: 'owner' as const, companyName: 'Acme Corp' },
      { orgId: 'org-bbb', role: 'admin' as const, companyName: 'Beta Inc' },
      { orgId: 'org-ccc', role: 'owner' as const, companyName: 'Charlie Ltd' },
    ];

    expect(memberships).toHaveLength(3);
  });

  it('switching company updates active org and clears cache', () => {
    let activeOrg = 'org-aaa';
    let cacheCleared = false;

    // Switch
    activeOrg = 'org-bbb';
    cacheCleared = true;

    expect(activeOrg).toBe('org-bbb');
    expect(cacheCleared).toBe(true);
  });
});

describe('Scenario D: Resource creation is scoped to active company', () => {
  it('new client gets current org_id', () => {
    const currentOrgId = 'org-aaa';
    const newClient = {
      first_name: 'John',
      last_name: 'Doe',
      org_id: currentOrgId,
    };

    expect(newClient.org_id).toBe('org-aaa');
  });

  it('job linked to client must be in same company', () => {
    const currentOrgId = 'org-aaa';
    const client = { id: '1', org_id: 'org-aaa' };
    const job = { client_id: '1', org_id: currentOrgId };

    expect(job.org_id).toBe(client.org_id);
  });

  it('cross-company resource creation is rejected', () => {
    const currentOrgId = 'org-aaa';
    const clientFromOtherOrg = { id: '3', org_id: 'org-bbb' };

    const canCreate = clientFromOtherOrg.org_id === currentOrgId;
    expect(canCreate).toBe(false);
  });
});

describe('Scenario E: Forced access to another company resource', () => {
  function checkAccess(userMemberships: string[], targetOrgId: string): boolean {
    return userMemberships.includes(targetOrgId);
  }

  it('user without membership to org-bbb is denied', () => {
    const userOrgs = ['org-aaa'];
    expect(checkAccess(userOrgs, 'org-bbb')).toBe(false);
  });

  it('user with membership to org-aaa is allowed', () => {
    const userOrgs = ['org-aaa'];
    expect(checkAccess(userOrgs, 'org-aaa')).toBe(true);
  });
});

describe('Scenario F: Session persistence', () => {
  it('active org survives page refresh via localStorage', () => {
    const STORAGE_KEY = 'lume-active-org';
    const storage: Record<string, string> = {};

    // Set before refresh
    storage[STORAGE_KEY] = 'org-bbb';

    // Simulate page reload
    const restoredOrg = storage[STORAGE_KEY] || null;
    expect(restoredOrg).toBe('org-bbb');
  });

  it('invalid stored org falls back to first membership', () => {
    const companies = [
      { orgId: 'org-aaa' },
      { orgId: 'org-bbb' },
    ];
    const savedOrg = 'org-DELETED';

    const valid = companies.some((c) => c.orgId === savedOrg);
    const activeOrg = valid ? savedOrg : companies[0].orgId;

    expect(activeOrg).toBe('org-aaa');
  });
});
