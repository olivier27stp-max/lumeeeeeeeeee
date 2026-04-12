/**
 * RBAC — Server-side Role-Based Access Control
 *
 * Provides permission checking, scope validation, and middleware
 * for Express route handlers. Uses the memberships table.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import express from 'express';
import { requireAuthedClient, getServiceClient } from './supabase';

// ── Types ───────────────────────────────────────────────────────────

export type TeamRole = 'owner' | 'admin' | 'manager' | 'sales_rep' | 'technician' | 'support' | 'viewer';
export type Scope = 'self' | 'assigned' | 'team' | 'department' | 'company';

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
    role: data.role as TeamRole,
    scope: (data.scope || 'company') as Scope,
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
 * Other roles check the permissions JSONB with role defaults as fallback.
 */
export function hasPermission(ctx: UserContext, key: string): boolean {
  if (ctx.role === 'owner') return true;

  // Check custom override first
  if (key in ctx.permissions) return ctx.permissions[key] === true;

  // Admin gets everything except owner-protected actions
  if (ctx.role === 'admin') {
    if (key === 'users.delete') return false; // Cannot delete owner
    return true;
  }

  // For other roles, if no override exists, deny by default
  // (the frontend should have set permissions from role presets)
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
    case 'department':
      return !resource.department_id || resource.department_id === ctx.departmentId;
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
