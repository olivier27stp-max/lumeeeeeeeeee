/**
 * Financial Data Leak Audit Tests
 *
 * Validates that financial data never leaks to technician role:
 * - Server-side field masking strips financial fields
 * - Search results exclude financial entities
 * - Route permissions block financial endpoints
 */

import { describe, it, expect } from 'vitest';
import {
  isFinanciallyRestricted,
  hasPermission as serverHasPermission,
  stripFinancialFields,
  stripFinancialFieldsArray,
  filterFinancialEntities,
  type UserContext,
} from '../../server/lib/rbac';

function makeTechnicianCtx(overrides?: Partial<UserContext>): UserContext {
  return {
    userId: 'tech-user-123',
    orgId: 'org-456',
    role: 'technician',
    scope: 'assigned',
    teamId: null,
    departmentId: null,
    managerId: null,
    permissions: {},
    ...overrides,
  };
}

function makeAdminCtx(): UserContext {
  return {
    userId: 'admin-user-789',
    orgId: 'org-456',
    role: 'admin',
    scope: 'company',
    teamId: null,
    departmentId: null,
    managerId: null,
    permissions: {},
  };
}

describe('Server-side financial restriction', () => {
  const techCtx = makeTechnicianCtx();

  it('should identify technician as financially restricted', () => {
    expect(isFinanciallyRestricted(techCtx)).toBe(true);
  });

  it('should deny all financial permissions for technician', () => {
    const financialKeys = [
      'financial.view_pricing',
      'financial.view_invoices',
      'financial.view_payments',
      'financial.view_reports',
      'financial.view_analytics',
      'financial.view_margins',
      'financial.export_data',
      'invoices.create', 'invoices.read', 'invoices.update', 'invoices.delete', 'invoices.send',
      'payments.read', 'payments.create', 'payments.refund',
      'reports.read', 'analytics.view',
    ];

    for (const key of financialKeys) {
      expect(serverHasPermission(techCtx, key)).toBe(false);
    }
  });

  it('should deny financial permissions even with overrides', () => {
    const ctxWithOverrides = makeTechnicianCtx({
      permissions: {
        'financial.view_pricing': true,
        'invoices.read': true,
        'payments.read': true,
      },
    });

    expect(serverHasPermission(ctxWithOverrides, 'financial.view_pricing')).toBe(false);
    expect(serverHasPermission(ctxWithOverrides, 'invoices.read')).toBe(false);
    expect(serverHasPermission(ctxWithOverrides, 'payments.read')).toBe(false);
  });

  it('should allow non-financial permissions for technician', () => {
    const ctxWithPerms = makeTechnicianCtx({
      permissions: {
        'jobs.read': true,
        'jobs.complete': true,
        'calendar.read': true,
        'timesheets.read': true,
      },
    });

    expect(serverHasPermission(ctxWithPerms, 'jobs.read')).toBe(true);
    expect(serverHasPermission(ctxWithPerms, 'jobs.complete')).toBe(true);
  });
});

describe('Financial field stripping', () => {
  const techCtx = makeTechnicianCtx();
  const adminCtx = makeAdminCtx();

  it('should strip financial fields from job data for technician', () => {
    const jobData = {
      id: 'job-1',
      title: 'Fix AC',
      total_cents: 15000,
      subtotal: 130,
      tax_total: 20,
      cost_cents: 8000,
      unit_price_cents: 5000,
      status: 'in_progress',
    };

    const stripped = stripFinancialFields(techCtx, jobData);

    expect(stripped.id).toBe('job-1');
    expect(stripped.title).toBe('Fix AC');
    expect(stripped.status).toBe('in_progress');
    expect(stripped.total_cents).toBeNull();
    expect(stripped.subtotal).toBeNull();
    expect(stripped.tax_total).toBeNull();
    expect(stripped.cost_cents).toBeNull();
    expect(stripped.unit_price_cents).toBeNull();
  });

  it('should NOT strip financial fields for admin', () => {
    const jobData = {
      id: 'job-1',
      total_cents: 15000,
      cost_cents: 8000,
    };

    const result = stripFinancialFields(adminCtx, jobData);
    expect(result.total_cents).toBe(15000);
    expect(result.cost_cents).toBe(8000);
  });

  it('should strip amountCents from search results for technician', () => {
    const searchResult = {
      id: 'job-1',
      title: 'Fix AC',
      amountCents: 15000,
      type: 'job',
    };

    const stripped = stripFinancialFields(techCtx, searchResult);
    expect(stripped.amountCents).toBeNull();
  });

  it('should strip fields from arrays', () => {
    const items = [
      { id: '1', total_cents: 100, title: 'A' },
      { id: '2', total_cents: 200, title: 'B' },
    ];

    const stripped = stripFinancialFieldsArray(techCtx, items);
    expect(stripped[0].total_cents).toBeNull();
    expect(stripped[1].total_cents).toBeNull();
    expect(stripped[0].title).toBe('A');
  });
});

describe('Financial entity filtering', () => {
  const techCtx = makeTechnicianCtx();
  const adminCtx = makeAdminCtx();

  it('should filter out invoices from search results for technician', () => {
    const items = [
      { type: 'client', id: '1', title: 'John' },
      { type: 'job', id: '2', title: 'Fix AC' },
      { type: 'invoice', id: '3', title: 'INV-001' },
      { type: 'payment', id: '4', title: 'Payment' },
    ];

    const filtered = filterFinancialEntities(techCtx, items);
    expect(filtered).toHaveLength(2);
    expect(filtered.map(i => i.type)).toEqual(['client', 'job']);
  });

  it('should NOT filter entities for admin', () => {
    const items = [
      { type: 'client', id: '1', title: 'John' },
      { type: 'invoice', id: '2', title: 'INV-001' },
    ];

    const filtered = filterFinancialEntities(adminCtx, items);
    expect(filtered).toHaveLength(2);
  });
});
