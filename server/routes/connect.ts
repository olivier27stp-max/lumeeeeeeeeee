import { Router } from 'express';
import { requireAuthedClient, isOrgMember, isOrgAdminOrOwner } from '../lib/supabase';
import { parseOrgId, resolvePublicBaseUrl } from '../lib/helpers';
import {
  createConnectedAccount,
  createOnboardingLink,
  refreshAccountStatus,
  getConnectedAccount,
} from '../lib/stripe-connect';
import { validate, createConnectedAccountSchema } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

// ── Create connected account ──

router.post('/connect/create-account', validate(createConnectedAccountSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const orgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, orgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can activate payments.' });

    const country = String(req.body.country || 'CA').toUpperCase();
    const account = await createConnectedAccount(orgId, country);

    return res.json({ account });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to create connected account.', '[connect/create-account]');
  }
});

// ── Create onboarding link ──

router.post('/connect/create-onboarding-link', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const orgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, orgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can manage payments.' });

    const baseUrl = resolvePublicBaseUrl(req);
    const returnUrl = `${baseUrl}/settings/payments?onboarding=complete`;
    const refreshUrl = `${baseUrl}/settings/payments?onboarding=refresh`;

    const link = await createOnboardingLink(orgId, returnUrl, refreshUrl);
    return res.json(link);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to create onboarding link.', '[connect/create-onboarding-link]');
  }
});

// ── Refresh onboarding link (same as create, for when link expires) ──

router.post('/connect/refresh-onboarding-link', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const orgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, orgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can manage payments.' });

    const baseUrl = resolvePublicBaseUrl(req);
    const returnUrl = `${baseUrl}/settings/payments?onboarding=complete`;
    const refreshUrl = `${baseUrl}/settings/payments?onboarding=refresh`;

    const link = await createOnboardingLink(orgId, returnUrl, refreshUrl);
    return res.json(link);
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to refresh onboarding link.', '[connect/refresh-onboarding-link]');
  }
});

// ── Get account status ──

router.get('/connect/account-status', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const orgId = parseOrgId(req.query.orgId) || auth.orgId;
    const member = await isOrgMember(auth.client, auth.user.id, orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    // Refresh from Stripe to get latest state
    const account = await refreshAccountStatus(orgId);
    if (!account) {
      return res.json({ connected: false, account: null });
    }

    return res.json({ connected: true, account });
  } catch (error: any) {
    // If Stripe key not configured, return not-connected
    if (error?.message?.includes('STRIPE_SECRET_KEY')) {
      return res.json({ connected: false, account: null, warning: 'Stripe is not configured on the server.' });
    }
    return sendSafeError(res, error, 'Failed to fetch account status.', '[connect/account-status]');
  }
});

export default router;
