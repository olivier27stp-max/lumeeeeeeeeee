/**
 * LUME CRM — Step-up 2FA Enforcement Middleware (SMS + trusted devices)
 * =====================================================================
 * Risk-based, payment-scoped step-up authentication.
 *
 * For owners/admins performing a PAYMENT-sensitive action from an
 * unrecognized device, we require a one-time SMS code. A device that has
 * passed the SMS challenge is trusted for 30 days (via an `x-device-token`
 * the client stores) and is not re-challenged. This mirrors how modern
 * field-service CRMs handle it: no friction for everyday actions, SMS only
 * for money-related surface on new devices.
 *
 * Non-payment actions (invites, roles, general settings) are NOT gated.
 * The 2FA is tied to the account + a verified phone, independent of whether
 * the user signed in with Google or email/password.
 */

import { Request, Response, NextFunction } from 'express';
import { requireAuthedClient, isOrgAdminOrOwner, getServiceClient } from './supabase';
import { isSmsConfigured, getVerifiedPhone, isDeviceTrusted } from './mfa-sms';

/**
 * Routes that require step-up MFA for admin/owner roles.
 * Matched by prefix — scoped to payment-sensitive endpoints only. Member
 * management (invitations, roles) and general security settings deliberately
 * do NOT require MFA.
 */
const MFA_REQUIRED_PREFIXES = [
  '/api/payments/keys',
  '/api/billing/cancel',
  // NOTE: '/api/connect/create-account' intentionally NOT gated. There is no
  // SMS-enrollment UI yet, so gating it locked owners out of Lume Payments with
  // no way forward. Connecting a bank already goes through Stripe Connect's own
  // identity verification (KYC), so the step-up here was redundant. Re-add once
  // an SMS enrollment/challenge modal exists.
];

export function mfaEnforcementMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only state-changing calls.
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    // Match exact path or "<prefix>/<sub>" so '/api/billing/cancel-scheduled-change'
    // does NOT match the '/api/billing/cancel' prefix.
    const requiresMfa = MFA_REQUIRED_PREFIXES.some(
      (prefix) => req.path === prefix || req.path.startsWith(prefix + '/'),
    );
    if (!requiresMfa) return next();

    const authHeader = req.header('authorization');
    if (!authHeader) return next(); // Let downstream auth handle it.

    try {
      const auth = await requireAuthedClient(req, res);
      if (!auth) return; // 401 already sent.

      // Only owners/admins (who touch payments) need step-up.
      const isAdmin = await isOrgAdminOrOwner(auth.client, auth.user.id, auth.orgId);
      if (!isAdmin) return next();

      // If SMS isn't configured on the server, don't lock owners out.
      if (!isSmsConfigured()) return next();

      const admin = getServiceClient();
      const deviceToken = req.header('x-device-token');

      // Recognized device → no challenge.
      if (await isDeviceTrusted(admin, auth.user.id, deviceToken)) return next();

      // Unrecognized device → require SMS step-up.
      const phone = await getVerifiedPhone(admin, auth.user.id);
      if (!phone) {
        return res.status(403).json({
          error: 'Set up SMS verification to perform this payment action.',
          code: 'sms_enroll_required',
        });
      }
      return res.status(403).json({
        error: 'Enter the SMS code to continue.',
        code: 'sms_challenge_required',
        phone_hint: phone.replace(/\D/g, '').slice(-4),
      });
    } catch (err: any) {
      // Never hard-block on an enforcement error — fail open but log.
      console.error('[mfa-enforcement] check failed:', err?.message);
      next();
    }
  };
}
