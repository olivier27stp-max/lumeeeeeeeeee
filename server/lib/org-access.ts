/**
 * Compliance — server-side org_id re-validation
 *
 * When a route uses getServiceClient() (bypasses RLS), ANY org_id read from
 * the request body is untrusted. Call `assertOrgAccess()` before any write
 * or read scoped to that org_id to prevent cross-tenant override.
 *
 * See: compliance_audit.md §6 — "Risques identifiés"
 */

import type { Request } from 'express';
import { getServiceClient } from './supabase';

export class OrgAccessError extends Error {
  status = 403;
  constructor(msg = 'Forbidden: user does not belong to this organization') {
    super(msg);
    this.name = 'OrgAccessError';
  }
}

/**
 * Returns true iff `userId` is a member of `orgId`.
 * Uses the `verify_org_access` RPC (SECURITY DEFINER, search_path locked).
 */
export async function verifyOrgAccess(userId: string, orgId: string): Promise<boolean> {
  if (!userId || !orgId) return false;
  const svc = getServiceClient();
  const { data, error } = await svc.rpc('verify_org_access', {
    p_user_id: userId,
    p_org_id: orgId,
  });
  if (error) {
    console.error('[org-access] verify_org_access rpc failed:', error.message);
    return false;
  }
  return data === true;
}

/**
 * Throws OrgAccessError if the authenticated user cannot access `orgId`.
 * `req.user` is populated by the auth middleware (see server/lib/auth.ts).
 */
export async function assertOrgAccess(
  req: Request & { user?: { id?: string } },
  orgId: string | null | undefined,
): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new OrgAccessError('Unauthenticated');
  if (!orgId) throw new OrgAccessError('Missing org_id');
  const ok = await verifyOrgAccess(userId, orgId);
  if (!ok) throw new OrgAccessError();
}
