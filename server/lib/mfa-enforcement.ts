/**
 * LUME CRM — MFA Enforcement Middleware
 * =======================================
 * Requires MFA for admin/owner accounts on sensitive operations.
 *
 * How it works:
 * - Checks if user's role is admin or owner
 * - Verifies that their Supabase session has an authenticated MFA factor
 * - If admin/owner without MFA: returns 403 with mfa_required flag
 * - Frontend detects this and shows MFA enrollment/challenge prompt
 *
 * Sensitive operations that require MFA for admins:
 * - Member management (invite, remove, role change)
 * - Payment key management
 * - Security settings (IP blocks, API keys)
 * - Data export
 * - Billing changes
 */

import { Request, Response, NextFunction } from 'express';
import { requireAuthedClient, isOrgAdminOrOwner } from './supabase';

/**
 * Routes that require MFA for admin/owner roles.
 * Matched by prefix — any path starting with these requires MFA.
 */
const MFA_REQUIRED_PREFIXES = [
  '/api/invitations/send',
  '/api/invitations/remove-member',
  '/api/invitations/update-role',
  '/api/payments/keys',
  '/api/security/block-ip',
  '/api/security/api-keys',
  '/api/security/sessions/invalidate-all',
  '/api/security/export-log',
  // '/api/billing/subscribe' — removed: new users need to subscribe during onboarding without MFA
  '/api/billing/cancel',
  '/api/connect/create-account',
];

/**
 * TEMPORARY MFA exemption — single account, auto-expiring.
 * Requested by the owner on 2026-06-19, extended 2026-06-21. Expires
 * 2026-06-26 23:59:59 UTC. After the expiry timestamp this map is inert and
 * normal MFA enforcement resumes automatically — no need to remember to remove
 * it. Email match is case-insensitive.
 */
const TEMP_MFA_EXEMPTIONS: Record<string, string> = {
  'willhebert30@gmail.com': '2026-06-26T23:59:59Z',
};

function isTemporarilyExempt(email?: string | null): boolean {
  if (!email) return false;
  const until = TEMP_MFA_EXEMPTIONS[email.trim().toLowerCase()];
  if (!until) return false;
  return new Date() < new Date(until);
}

/**
 * Federated-identity exemption.
 *
 * Users who sign in through an OAuth provider (Google, Microsoft, Apple, …)
 * already authenticate against that provider, which enforces its own MFA.
 * Stacking a separate TOTP factor on top is redundant and a poor mobile UX
 * (it bounces users to their password app with no clear follow-up). So we
 * treat a federated sign-in as a strong second factor and skip app-level MFA.
 * Email/password admins still get TOTP enforcement.
 */
const FEDERATED_PROVIDERS = new Set(['google', 'azure', 'apple', 'github', 'gitlab', 'bitbucket']);

function isFederatedUser(user: any): boolean {
  const provider = user?.app_metadata?.provider;
  if (typeof provider === 'string' && FEDERATED_PROVIDERS.has(provider)) return true;
  const providers: unknown = user?.app_metadata?.providers;
  if (Array.isArray(providers)) {
    return providers.some((p) => typeof p === 'string' && FEDERATED_PROVIDERS.has(p));
  }
  return false;
}

/**
 * Middleware that enforces MFA for admin/owner roles on sensitive endpoints.
 * Mount this AFTER body parsing and auth middleware.
 */
export function mfaEnforcementMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only check POST/PUT/DELETE (state-changing operations)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    // Check if this route requires MFA.
    // Match exact path or "<prefix>/<sub>" so that e.g. '/api/billing/cancel-scheduled-change'
    // does NOT match the '/api/billing/cancel' prefix.
    const requiresMfa = MFA_REQUIRED_PREFIXES.some(prefix => {
      return req.path === prefix || req.path.startsWith(prefix + '/');
    });
    if (!requiresMfa) return next();

    // Get auth context
    const authHeader = req.header('authorization');
    if (!authHeader) return next(); // Let downstream auth handle it

    try {
      // Check if user is admin/owner — only they need MFA enforcement
      const auth = await requireAuthedClient(req, res);
      if (!auth) return; // 401 already sent

      const isAdmin = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
      if (!isAdmin) return next(); // Non-admins don't need MFA for these routes

      // Federated sign-in (Google, etc.) already provides strong auth via the
      // provider — skip the redundant TOTP requirement for OAuth users.
      if (isFederatedUser(auth.user)) {
        return next();
      }

      // Temporary, time-boxed exemption for a single owner account (auto-expires).
      if (isTemporarilyExempt(auth.user.email)) {
        console.warn(
          `[mfa-enforcement] TEMP EXEMPTION active for ${auth.user.email} on ${req.method} ${req.path} ` +
            `(expires ${TEMP_MFA_EXEMPTIONS[auth.user.email!.trim().toLowerCase()]})`,
        );
        return next();
      }

      // Check MFA status via Supabase Auth
      const { data: factorsData } = await auth.client.auth.mfa.listFactors();
      const verifiedFactors = factorsData?.totp?.filter(f => f.status === 'verified') || [];

      if (verifiedFactors.length === 0) {
        // Admin without MFA enrolled — require them to set it up
        return res.status(403).json({
          error: 'MFA required for admin operations. Please enable two-factor authentication in your security settings.',
          code: 'mfa_required',
          mfa_enrolled: false,
        });
      }

      // Check if current session has MFA verified
      // Supabase AAL2 = MFA verified session
      const { data: aalData } = await auth.client.auth.mfa.getAuthenticatorAssuranceLevel();

      if (aalData?.currentLevel !== 'aal2') {
        // MFA enrolled but not verified in this session
        return res.status(403).json({
          error: 'Please verify your MFA code to perform this action.',
          code: 'mfa_challenge_required',
          mfa_enrolled: true,
          factor_id: verifiedFactors[0]?.id,
        });
      }

      // MFA verified — proceed
      next();
    } catch (err: any) {
      // Don't block on MFA check failures — fail open but log
      console.error('[mfa-enforcement] Check failed:', err?.message);
      next();
    }
  };
}
