/**
 * RBAC Permission Matrix Tests
 *
 * Validates that:
 * 1. Only 4 roles exist: owner, admin, sales_rep, technician
 * 2. Technician has ZERO financial permissions
 * 3. Financial permissions cannot be overridden for technician
 * 4. Permission matrix is complete and coherent
 * 5. Deprecated roles are properly mapped
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_ROLES,
  ASSIGNABLE_ROLES,
  ROLE_PRESETS,
  PERMISSION_KEYS,
  FINANCIAL_PERMISSION_KEYS,
  FINANCIAL_ENTITY_TYPES,
  isFinanciallyRestricted,
  hasAnyFinancialAccess,
  hasPermission,
  resolvePermissions,
  getDefaultPermissions,
  normalizeRole,
  type TeamRole,
  type PermissionsMap,
} from '../../src/lib/permissions';

describe('Role definitions', () => {
  it('should have exactly 4 roles', () => {
    expect(ALL_ROLES).toHaveLength(4);
    expect(ALL_ROLES).toEqual(['owner', 'admin', 'sales_rep', 'technician']);
  });

  it('should only allow assigning admin, sales_rep, technician', () => {
    expect(ASSIGNABLE_ROLES).toEqual(['admin', 'sales_rep', 'technician']);
    expect(ASSIGNABLE_ROLES).not.toContain('owner');
  });

  it('should not include deprecated roles', () => {
    expect(ALL_ROLES).not.toContain('manager');
    expect(ALL_ROLES).not.toContain('support');
    expect(ALL_ROLES).not.toContain('viewer');
  });
});

describe('Technician — ZERO financial access', () => {
  const techPerms = ROLE_PRESETS.technician;

  it('should be marked as financially restricted', () => {
    expect(isFinanciallyRestricted('technician')).toBe(true);
  });

  it('should NOT be marked as financially restricted for other roles', () => {
    expect(isFinanciallyRestricted('owner')).toBe(false);
    expect(isFinanciallyRestricted('admin')).toBe(false);
    expect(isFinanciallyRestricted('sales_rep')).toBe(false);
  });

  it('should have no financial permissions in preset', () => {
    for (const key of FINANCIAL_PERMISSION_KEYS) {
      expect(techPerms[key]).toBe(false);
    }
  });

  it('should not have invoice permissions', () => {
    expect(techPerms['invoices.create']).toBe(false);
    expect(techPerms['invoices.read']).toBe(false);
    expect(techPerms['invoices.update']).toBe(false);
    expect(techPerms['invoices.delete']).toBe(false);
    expect(techPerms['invoices.send']).toBe(false);
  });

  it('should not have payment permissions', () => {
    expect(techPerms['payments.read']).toBe(false);
    expect(techPerms['payments.create']).toBe(false);
    expect(techPerms['payments.refund']).toBe(false);
  });

  it('should not have report/analytics permissions', () => {
    expect(techPerms['reports.read']).toBe(false);
    expect(techPerms['analytics.view']).toBe(false);
  });

  it('should not have global search permission', () => {
    expect(techPerms['search.global']).toBe(false);
  });

  it('should not have export permission', () => {
    expect(techPerms['financial.export_data']).toBe(false);
  });

  it('should have zero financial access via hasAnyFinancialAccess', () => {
    expect(hasAnyFinancialAccess(techPerms, 'technician')).toBe(false);
  });

  it('should have operational permissions only', () => {
    // Technician CAN do these
    expect(techPerms['jobs.read']).toBe(true);
    expect(techPerms['jobs.update']).toBe(true);
    expect(techPerms['jobs.complete']).toBe(true);
    expect(techPerms['calendar.read']).toBe(true);
    expect(techPerms['calendar.update']).toBe(true);
    expect(techPerms['timesheets.read']).toBe(true);
    expect(techPerms['timesheets.update']).toBe(true);
    expect(techPerms['messages.read']).toBe(true);
    expect(techPerms['messages.send']).toBe(true);
    expect(techPerms['clients.read']).toBe(true);
    expect(techPerms['gps.read']).toBe(true);
  });
});

describe('Financial permission override protection', () => {
  it('should block financial permission overrides for technician', () => {
    const overrides: Record<string, boolean> = {
      'financial.view_pricing': true,
      'financial.view_invoices': true,
      'invoices.read': true,
      'payments.read': true,
      'reports.read': true,
    };

    const resolved = resolvePermissions('technician', overrides);

    expect(resolved['financial.view_pricing']).toBe(false);
    expect(resolved['financial.view_invoices']).toBe(false);
    expect(resolved['invoices.read']).toBe(false);
    expect(resolved['payments.read']).toBe(false);
    expect(resolved['reports.read']).toBe(false);
  });

  it('should allow non-financial overrides for technician', () => {
    const overrides: Record<string, boolean> = {
      'clients.create': true,
    };
    const resolved = resolvePermissions('technician', overrides);
    expect(resolved['clients.create']).toBe(true);
  });

  it('should allow financial overrides for sales_rep', () => {
    const overrides: Record<string, boolean> = {
      'financial.view_invoices': true,
    };
    const resolved = resolvePermissions('sales_rep', overrides);
    expect(resolved['financial.view_invoices']).toBe(true);
  });
});

describe('Owner permissions', () => {
  it('should have all permissions set to true', () => {
    const ownerPerms = ROLE_PRESETS.owner;
    for (const key of PERMISSION_KEYS) {
      expect(ownerPerms[key]).toBe(true);
    }
  });

  it('should bypass permission checks via hasPermission', () => {
    expect(hasPermission(null, 'invoices.read', 'owner')).toBe(true);
    expect(hasPermission(null, 'financial.view_margins', 'owner')).toBe(true);
  });
});

describe('Admin permissions', () => {
  const adminPerms = ROLE_PRESETS.admin;

  it('should have all permissions except users.delete', () => {
    expect(adminPerms['users.delete']).toBe(false);
    expect(adminPerms['financial.view_pricing']).toBe(true);
    expect(adminPerms['financial.view_invoices']).toBe(true);
    expect(adminPerms['invoices.read']).toBe(true);
  });

  it('should have full financial access', () => {
    expect(hasAnyFinancialAccess(adminPerms, 'admin')).toBe(true);
  });
});

describe('Sales Rep permissions', () => {
  const salesPerms = ROLE_PRESETS.sales_rep;

  it('should have pricing access for quotes', () => {
    expect(salesPerms['financial.view_pricing']).toBe(true);
    expect(salesPerms['quotes.read']).toBe(true);
    expect(salesPerms['quotes.create']).toBe(true);
  });

  it('should not have analytics or margin access by default', () => {
    expect(salesPerms['financial.view_analytics']).toBe(false);
    expect(salesPerms['financial.view_margins']).toBe(false);
    expect(salesPerms['financial.view_reports']).toBe(false);
  });

  it('should have global search', () => {
    expect(salesPerms['search.global']).toBe(true);
  });
});

describe('Deprecated role mapping', () => {
  it('should map manager to admin', () => {
    expect(normalizeRole('manager')).toBe('admin');
  });

  it('should map support to sales_rep', () => {
    expect(normalizeRole('support')).toBe('sales_rep');
  });

  it('should map viewer to sales_rep', () => {
    expect(normalizeRole('viewer')).toBe('sales_rep');
  });

  it('should pass through valid roles unchanged', () => {
    expect(normalizeRole('owner')).toBe('owner');
    expect(normalizeRole('admin')).toBe('admin');
    expect(normalizeRole('sales_rep')).toBe('sales_rep');
    expect(normalizeRole('technician')).toBe('technician');
  });

  it('should default unknown roles to sales_rep', () => {
    expect(normalizeRole('unknown_role')).toBe('sales_rep');
    expect(normalizeRole('')).toBe('sales_rep');
  });
});

describe('Permission completeness', () => {
  it('every role preset should have all permission keys', () => {
    for (const role of ALL_ROLES) {
      const preset = ROLE_PRESETS[role];
      for (const key of PERMISSION_KEYS) {
        expect(typeof preset[key]).toBe('boolean');
      }
    }
  });

  it('FINANCIAL_PERMISSION_KEYS should only contain valid keys', () => {
    for (const key of FINANCIAL_PERMISSION_KEYS) {
      expect(PERMISSION_KEYS).toContain(key);
    }
  });
});
