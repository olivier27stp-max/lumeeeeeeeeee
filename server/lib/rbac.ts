/**
 * RBAC — Server-side Role-Based Access Control
 *
 * Provides permission checking, scope validation, field masking,
 * and middleware for Express route handlers.
 * Uses the memberships table.
 *
 * Roles: owner | admin | sales_rep | technician
 * Removed: manager, support, viewer (migrated)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import express from 'express';
import { requireAuthedClient, getServiceClient } from './supabase';

// ── Types ───────────────────────────────────────────────────────────

export type TeamRole = 'owner' | 'admin' | 'manager' | 'sales_rep' | 'technician';
export type Scope = 'self' | 'assigned' | 'team' | 'company';

export interface UserContext {
  userId: string;
  orgId: string;
  role: TeamRole;
  scope: Scope;
  teamId: string | null;
  departmentId: string | null;
  managerId: string | null;
  permissions: Record<string, boolean>;
}

// ── Deprecated role mapping ─────────────────────────────────────────

const DEPRECATED_ROLE_MAP: Record<string, TeamRole> = {
  manager: 'admin',
  support: 'sales_rep',
  viewer: 'sales_rep',
};

function normalizeRole(role: string): TeamRole {
  const validRoles: TeamRole[] = ['owner', 'admin', 'sales_rep', 'technician'];
  if (validRoles.includes(role as TeamRole)) return role as TeamRole;
  return DEPRECATED_ROLE_MAP[role] ?? 'sales_rep';
}

// ── Financial field masking ─────────────────────────────────────────

/** Fields that must be stripped for financially restricted users */
const FINANCIAL_FIELDS = new Set([
  'total_cents', 'total', 'subtotal', 'subtotal_cents',
  'tax_total', 'tax_cents', 'tax_lines',
  'cost_cents', 'unit_price_cents', 'line_total_cents',
  'balance_cents', 'amount_cents', 'amountCents',
  'profit', 'profit_cents', 'margin', 'margin_percent',
  'revenue', 'revenue_cents',
  'invoice_id', 'invoice_number', 'invoice_link',
  'payment_history', 'payout_amount',
]);

/** Permission keys in the financial category */
const FINANCIAL_PERMISSION_KEYS = [
  'financial.view_pricing', 'financial.view_invoices', 'financial.view_payments',
  'financial.view_reports', 'financial.view_analytics', 'financial.view_margins',
  'financial.export_data',
  'invoices.create', 'invoices.read', 'invoices.update', 'invoices.delete', 'invoices.send',
  'payments.read', 'payments.create', 'payments.refund',
  'reports.read', 'analytics.view',
];

/** Check if role has zero financial access */
export function isFinanciallyRestricted(ctx: UserContext): boolean {
  return ctx.role === 'technician';
}

/**
 * Strip financial fields from a data object.
 * For technicians: removes ALL financial fields.
 * For other roles: checks specific permissions.
 */
export function stripFinancialFields<T extends Record<string, any>>(
  ctx: UserContext,
  data: T,
): T {
  if (ctx.role === 'owner' || ctx.role === 'admin') return data;

  // Technician: hard strip ALL financial data
  if (isFinanciallyRestricted(ctx)) {
    const result = { ...data };
    for (const field of FINANCIAL_FIELDS) {
      if (field in result) {
        (result as any)[field] = null;
      }
    }
    return result;
  }

  // Other roles: check permissions per field
  const result = { ...data };
  if (!hasPermission(ctx, 'financial.view_pricing')) {
    for (const f of ['total_cents', 'total', 'subtotal', 'subtotal_cents', 'tax_total', 'tax_cents', 'tax_lines', 'unit_price_cents', 'line_total_cents', 'amountCents', 'amount_cents']) {
      if (f in result) (result as any)[f] = null;
    }
  }
  if (!hasPermission(ctx, 'financial.view_margins')) {
    for (const f of ['cost_cents', 'profit', 'profit_cents', 'margin', 'margin_percent']) {
      if (f in result) (result as any)[f] = null;
    }
  }
  return result;
}

/**
 * Strip financial fields from an array of objects.
 */
export function stripFinancialFieldsArray<T extends Record<string, any>>(
  ctx: UserContext,
  data: T[],
): T[] {
  if (ctx.role === 'owner' || ctx.role === 'admin') return data;
  return data.map(item => stripFinancialFields(ctx, item));
}

/**
 * Filter out financial entity types from search results.
 * Removes invoices, quotes (amounts), payments for restricted users.
 */
export function filterFinancialEntities<T extends { type?: string; entity_type?: string }>(
  ctx: UserContext,
  items: T[],
): T[] {
  if (ctx.role === 'owner' || ctx.role === 'admin') return items;

  const blocked = new Set<string>();
  if (!hasPermission(ctx, 'financial.view_invoices')) {
    blocked.add('invoice').add('invoices');
  }
  if (!hasPermission(ctx, 'financial.view_payments')) {
    blocked.add('payment').add('payments');
  }

  return items.filter(item => {
    const entityType = item.type || item.entity_type || '';
    return !blocked.has(entityType);
  });
}

// Cache to avoid repeated DB lookups within the same request
const contextCache = new Map<string, { ctx: UserContext; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

// ── Fetch user context ──────────────────────────────────────────────

export async function getUserContext(
  client: SupabaseClient,
  userId: string,
  orgId: string
): Promise<UserContext | null> {
  const cacheKey = `${userId}:${orgId}`;
  const cached = contextCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.ctx;

  const sc = getServiceClient();
  const { data, error } = await sc
    .from('memberships')
    .select('role, scope, team_id, department_id, manager_id, permissions')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) return null;

  const ctx: UserContext = {
    userId,
    orgId,
    role: normalizeRole(data.role),
    scope: (['self', 'assigned', 'team', 'company'].includes(data.scope) ? data.scope : 'company') as Scope,
    teamId: data.team_id,
    departmentId: data.department_id,
    managerId: data.manager_id,
    permissions: (data.permissions as Record<string, boolean>) || {},
  };

  contextCache.set(cacheKey, { ctx, ts: Date.now() });
  return ctx;
}

// ── Permission check ────────────────────────────────────────────────

/**
 * Check if user has a specific permission.
 * Owner always returns true. Admin returns true except protected actions.
 * Technician NEVER gets financial permissions regardless of overrides.
 */
export function hasPermission(ctx: UserContext, key: string): boolean {
  if (ctx.role === 'owner') return true;

  // Technician: hard block all financial permissions
  if (ctx.role === 'technician' && FINANCIAL_PERMISSION_KEYS.includes(key)) {
    return false;
  }

  // Check custom override first
  if (key in ctx.permissions) return ctx.permissions[key] === true;

  // Admin gets everything except owner-protected actions
  if (ctx.role === 'admin') {
    if (key === 'users.delete') return false;
    return true;
  }

  // For other roles, if no override exists, deny by default
  return ctx.permissions[key] === true;
}

// ── Scope check ─────────────────────────────────────────────────────

/**
 * Check if user's scope allows access to a resource.
 */
export function checkScope(
  ctx: UserContext,
  resource: {
    owner_id?: string | null;
    team_id?: string | null;
    department_id?: string | null;
  }
): boolean {
  if (ctx.role === 'owner' || ctx.role === 'admin') return true;

  switch (ctx.scope) {
    case 'company': return true;
    case 'team':
      return !resource.team_id || resource.team_id === ctx.teamId;
    case 'assigned':
    case 'self':
      return !resource.owner_id || resource.owner_id === ctx.userId;
    default: return false;
  }
}

/**
 * Combined check: permission + scope.
 */
export function can(
  ctx: UserContext,
  action: string,
  resource?: {
    owner_id?: string | null;
    team_id?: string | null;
    department_id?: string | null;
  }
): boolean {
  if (!hasPermission(ctx, action)) return false;
  if (!resource) return true;
  return checkScope(ctx, resource);
}

// ── Express middleware ───────────────────────────────────────────────

/**
 * Middleware that requires a specific permission.
 * Returns 403 if denied. Attaches UserContext to req.
 */
export function requirePermission(permissionKey: string) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return; // 401 already sent

    const ctx = await getUserContext(auth.client, auth.user.id, auth.orgId);
    if (!ctx) {
      res.status(403).json({ error: 'No active membership found.' });
      return;
    }

    if (!hasPermission(ctx, permissionKey)) {
      res.status(403).json({ error: `Permission denied: ${permissionKey}` });
      return;
    }

    // Attach context for downstream handlers
    (req as any).userContext = ctx;
    next();
  };
}

/**
 * Middleware that requires any of the specified roles.
 */
export function requireRole(...roles: TeamRole[]) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const ctx = await getUserContext(auth.client, auth.user.id, auth.orgId);
    if (!ctx) {
      res.status(403).json({ error: 'No active membership found.' });
      return;
    }

    if (!roles.includes(ctx.role)) {
      res.status(403).json({ error: `Role required: ${roles.join(' or ')}` });
      return;
    }

    (req as any).userContext = ctx;
    next();
  };
}

/**
 * Middleware that blocks financially restricted roles from accessing a route.
 * Use on invoice, payment, report, analytics routes.
 */
export function requireFinancialAccess(permissionKey?: string) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const ctx = await getUserContext(auth.client, auth.user.id, auth.orgId);
    if (!ctx) {
      res.status(403).json({ error: 'No active membership found.' });
      return;
    }

    if (isFinanciallyRestricted(ctx)) {
      res.status(403).json({ error: 'Financial access denied.' });
      return;
    }

    if (permissionKey && !hasPermission(ctx, permissionKey)) {
      res.status(403).json({ error: `Permission denied: ${permissionKey}` });
      return;
    }

    (req as any).userContext = ctx;
    next();
  };
}

/**
 * Invalidate cache for a specific user (call after role/permission changes).
 */
export function invalidateUserCache(userId: string, orgId: string) {
  contextCache.delete(`${userId}:${orgId}`);
}

/**
 * Clear entire cache (call on deploy or major config change).
 */
export function clearRbacCache() {
  contextCache.clear();
}
