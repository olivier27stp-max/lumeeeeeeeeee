/**
 * Permission cascade tests — SettingsRoles UI logic.
 *
 * Validates:
 *   - Disabling a prerequisite cascades down to every dependent.
 *   - Enabling a permission auto-enables all its prerequisites.
 *   - Technician's financial hard-block survives cascade.
 *   - The input map is never mutated.
 *   - Cycles / repeated visits don't cause infinite recursion.
 *   - Cross-module financial dependencies (invoices ↔ financial.view_invoices) work.
 */

import { describe, it, expect } from 'vitest';
import {
  PERMISSION_KEYS,
  ROLE_PRESETS,
  FINANCIAL_PERMISSION_KEYS,
  type PermissionKey,
  type PermissionsMap,
} from '../../src/lib/permissions';
import { applyCascade, DEPENDS_ON, DEPENDENTS } from '../../src/lib/permissionsCascade';

function allTrue(): PermissionsMap {
  const m = {} as PermissionsMap;
  for (const k of PERMISSION_KEYS) m[k] = true;
  return m;
}

function allFalse(): PermissionsMap {
  const m = {} as PermissionsMap;
  for (const k of PERMISSION_KEYS) m[k] = false;
  return m;
}

describe('applyCascade — disable cascades to dependents', () => {
  it('unchecking clients.read disables create/update/delete', () => {
    const next = applyCascade(allTrue(), 'clients.read', false, 'admin');
    expect(next['clients.read']).toBe(false);
    expect(next['clients.create']).toBe(false);
    expect(next['clients.update']).toBe(false);
    expect(next['clients.delete']).toBe(false);
  });

  it('unchecking jobs.read disables create/update/delete/assign/complete', () => {
    const next = applyCascade(allTrue(), 'jobs.read', false, 'admin');
    for (const k of ['jobs.create', 'jobs.update', 'jobs.delete', 'jobs.assign', 'jobs.complete'] as PermissionKey[]) {
      expect(next[k]).toBe(false);
    }
  });

  it('unchecking financial.view_invoices cascades to invoices.* entirely', () => {
    const next = applyCascade(allTrue(), 'financial.view_invoices', false, 'admin');
    expect(next['financial.view_invoices']).toBe(false);
    expect(next['invoices.read']).toBe(false);
    expect(next['invoices.create']).toBe(false);
    expect(next['invoices.update']).toBe(false);
    expect(next['invoices.delete']).toBe(false);
    expect(next['invoices.send']).toBe(false);
  });

  it('unchecking financial.view_payments cascades to payments.*', () => {
    const next = applyCascade(allTrue(), 'financial.view_payments', false, 'admin');
    expect(next['payments.read']).toBe(false);
    expect(next['payments.create']).toBe(false);
    expect(next['payments.refund']).toBe(false);
  });

  it('unchecking users.invite cascades to update_role/disable/delete', () => {
    const next = applyCascade(allTrue(), 'users.invite', false, 'admin');
    expect(next['users.invite']).toBe(false);
    expect(next['users.update_role']).toBe(false);
    expect(next['users.disable']).toBe(false);
    expect(next['users.delete']).toBe(false);
  });

  it('unchecking external_agent.use cascades to review + admin', () => {
    const next = applyCascade(allTrue(), 'external_agent.use', false, 'admin');
    expect(next['external_agent.review']).toBe(false);
    expect(next['external_agent.admin']).toBe(false);
  });
});

describe('applyCascade — enable auto-enables prerequisites', () => {
  it('checking clients.create auto-enables clients.read', () => {
    const start = allFalse();
    const next = applyCascade(start, 'clients.create', true, 'admin');
    expect(next['clients.create']).toBe(true);
    expect(next['clients.read']).toBe(true);
  });

  it('checking invoices.send enables read + financial.view_invoices', () => {
    const next = applyCascade(allFalse(), 'invoices.send', true, 'admin');
    expect(next['invoices.send']).toBe(true);
    expect(next['invoices.read']).toBe(true);
    expect(next['financial.view_invoices']).toBe(true);
  });

  it('checking users.delete enables invite + disable transitively', () => {
    const next = applyCascade(allFalse(), 'users.delete', true, 'admin');
    expect(next['users.delete']).toBe(true);
    expect(next['users.invite']).toBe(true);
    expect(next['users.disable']).toBe(true);
  });

  it('checking external_agent.admin enables use + review transitively', () => {
    const next = applyCascade(allFalse(), 'external_agent.admin', true, 'admin');
    expect(next['external_agent.admin']).toBe(true);
    expect(next['external_agent.review']).toBe(true);
    expect(next['external_agent.use']).toBe(true);
  });

  it('checking payments.refund enables read + financial.view_payments', () => {
    const next = applyCascade(allFalse(), 'payments.refund', true, 'admin');
    expect(next['payments.refund']).toBe(true);
    expect(next['payments.read']).toBe(true);
    expect(next['financial.view_payments']).toBe(true);
  });
});

describe('applyCascade — technician hard security boundary', () => {
  it('cannot enable financial.view_invoices on technician', () => {
    const next = applyCascade(allFalse(), 'financial.view_invoices', true, 'technician');
    expect(next['financial.view_invoices']).toBe(false);
  });

  it('checking invoices.send on technician enables nothing financial', () => {
    // invoices.send depends on financial.view_invoices, but technician is blocked.
    // The target key itself is also financial-related (invoices.send is in FINANCIAL_PERMISSION_KEYS).
    const next = applyCascade(allFalse(), 'invoices.send', true, 'technician');
    expect(next['invoices.send']).toBe(false);
    expect(next['invoices.read']).toBe(false);
    expect(next['financial.view_invoices']).toBe(false);
  });

  it('every financial key stays false when forced true on technician', () => {
    for (const key of FINANCIAL_PERMISSION_KEYS) {
      const next = applyCascade(allFalse(), key, true, 'technician');
      expect(next[key], `technician gained ${key}`).toBe(false);
    }
  });

  it('technician can still enable a non-financial permission', () => {
    const next = applyCascade(allFalse(), 'calendar.update', true, 'technician');
    expect(next['calendar.update']).toBe(true);
    expect(next['calendar.read']).toBe(true);
  });
});

describe('applyCascade — invariants', () => {
  it('does not mutate the input map', () => {
    const start = allTrue();
    const snapshot = { ...start };
    applyCascade(start, 'clients.read', false, 'admin');
    expect(start).toEqual(snapshot);
  });

  it('toggling off then on restores the dependent chain', () => {
    const off = applyCascade(allTrue(), 'clients.read', false, 'admin');
    expect(off['clients.create']).toBe(false);
    const back = applyCascade(off, 'clients.read', true, 'admin');
    expect(back['clients.read']).toBe(true);
    // Note: we don't auto-re-enable dependents on enable — only prerequisites.
    // Dependents are user-chosen, so they stay false until explicitly re-checked.
    expect(back['clients.create']).toBe(false);
  });

  it('all PERMISSION_KEYS in DEPENDS_ON are valid keys', () => {
    const keySet = new Set<string>(PERMISSION_KEYS);
    for (const [key, deps] of Object.entries(DEPENDS_ON)) {
      expect(keySet.has(key), `DEPENDS_ON key ${key} is not a valid permission`).toBe(true);
      for (const d of deps as string[]) {
        expect(keySet.has(d), `DEPENDS_ON dep ${d} is not a valid permission`).toBe(true);
      }
    }
  });

  it('DEPENDENTS reverse index matches DEPENDS_ON', () => {
    for (const [key, deps] of Object.entries(DEPENDS_ON)) {
      for (const d of deps as PermissionKey[]) {
        expect(DEPENDENTS[d]).toContain(key as PermissionKey);
      }
    }
  });

  it('handles a key with no deps and no dependents without error', () => {
    // search.global has no deps and nothing depends on it.
    const next = applyCascade(allFalse(), 'search.global', true, 'admin');
    expect(next['search.global']).toBe(true);
    const off = applyCascade(allTrue(), 'search.global', false, 'admin');
    expect(off['search.global']).toBe(false);
  });
});

describe('applyCascade — real presets coherence', () => {
  it('disabling clients.read on sales_rep preset cascades', () => {
    const start = { ...ROLE_PRESETS.sales_rep };
    const next = applyCascade(start, 'clients.read', false, 'sales_rep');
    expect(next['clients.read']).toBe(false);
    expect(next['clients.create']).toBe(false);
    expect(next['clients.update']).toBe(false);
  });

  it('enabling jobs.complete on technician works (non-financial)', () => {
    const start = { ...ROLE_PRESETS.technician };
    const next = applyCascade(start, 'jobs.complete', true, 'technician');
    expect(next['jobs.complete']).toBe(true);
    expect(next['jobs.read']).toBe(true);
  });
});
