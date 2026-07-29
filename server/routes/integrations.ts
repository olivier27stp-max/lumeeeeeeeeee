/* ═══════════════════════════════════════════════════════════════
   Integration Routes
   /api/integrations — connect, callback, test, disconnect, list
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { registerAllProviders } from '../lib/integrations/providers';
import { getProvider, getAllProviders } from '../lib/integrations/registry';
import { getBaseUrl } from '../lib/config';
import {
  listConnections,
  getConnection,
  startOAuth,
  handleOAuthCallback,
  connectWithCredentials,
  testConnection,
  disconnect,
  refreshOAuthToken,
} from '../lib/integrations/service';

// Register all providers on module load
registerAllProviders();

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

// ── List all connections for the org ───────────────────────────
router.get('/integrations', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const connections = await listConnections(ctx.orgId);
    res.json({ connections });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

// ── Native integrations status ────────────────────────────────
// Stripe and Twilio are not "connected" by the org through this store: they
// are provisioned by Lume itself (Connect account + plan-included SMS number).
// The Marketplace reads their real state here instead of showing a dead
// "Connect" button for something the org cannot action.
router.get('/integrations/native-status', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;
    const { orgId } = ctx;

    const [stripe, twilio] = await Promise.all([
      (async () => {
        try {
          const { refreshAccountStatus } = await import('../lib/stripe-connect');
          const account = await refreshAccountStatus(orgId);
          if (!account) return { active: false, detail: 'no_account' };
          // Only a fully onboarded account can actually take money.
          return {
            active: account.charges_enabled === true,
            payouts_enabled: account.payouts_enabled === true,
            detail: account.charges_enabled ? null : 'onboarding_incomplete',
          };
        } catch {
          // Stripe unconfigured on the server — report inactive, never 500.
          return { active: false };
        }
      })(),
      (async () => {
        try {
          const { getOrgSmsChannel, orgPlanIncludesSms } = await import('../lib/twilioProvisioning');
          const [channel, inPlan] = await Promise.all([
            getOrgSmsChannel(orgId),
            orgPlanIncludesSms(orgId),
          ]);
          const number = channel?.phone_number || null;
          // Both conditions must hold — same rule the send path enforces.
          if (!number) return { active: false, detail: 'not_provisioned' };
          if (!inPlan) return { active: false, number, detail: 'plan_excludes_sms' };
          return { active: true, number, detail: null };
        } catch {
          return { active: false };
        }
      })(),
    ]);

    res.json({ stripe, twilio });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

// ── Get single connection status ──────────────────────────────
router.get('/integrations/:appId/status', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const connection = await getConnection(ctx.orgId, req.params.appId);
    res.json({ connection });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

// ── Get provider info (credential fields, auth type) ──────────
router.get('/integrations/:appId/provider', async (req, res) => {
  const provider = getProvider(req.params.appId);
  if (!provider) {
    res.status(404).json({ error: `Unknown provider: ${req.params.appId}` });
    return;
  }

  res.json({
    slug: provider.slug,
    display_name: provider.display_name,
    auth_type: provider.auth_type,
    credential_fields: provider.credential_fields || [],
    scopes: provider.oauth?.scopes || [],
  });
});

// ── List registered providers ─────────────────────────────────
router.get('/integrations-providers', async (_req, res) => {
  const providers = getAllProviders().map((p) => ({
    slug: p.slug,
    display_name: p.display_name,
    auth_type: p.auth_type,
  }));
  res.json({ providers });
});

// ── Start OAuth flow ──────────────────────────────────────────
router.post('/integrations/:appId/connect/oauth', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const provider = getProvider(req.params.appId);
    if (!provider) {
      res.status(404).json({ error: `Unknown provider: ${req.params.appId}` });
      return;
    }

    if (provider.auth_type !== 'oauth') {
      res.status(400).json({ error: `Provider ${req.params.appId} does not use OAuth. Use /connect/credentials instead.` });
      return;
    }

    // Determine callback base URL
    const callbackBaseUrl = req.body.callback_base_url
      || `${req.protocol}://${req.get('host')}`;

    const result = await startOAuth({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      appId: req.params.appId,
      callbackBaseUrl,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start OAuth' });
  }
});

// ── OAuth callback (provider redirects here) ──────────────────
router.get('/integrations/:appId/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError, error_description } = req.query;

    if (oauthError) {
      // Provider returned an error (user denied, etc.)
      res.redirect(
        `${getBaseUrl()}/apps/callback?error=${encodeURIComponent(String(error_description || oauthError))}&app=${req.params.appId}`,
      );
      return;
    }

    if (!code || !state) {
      res.redirect(
        `${getBaseUrl()}/apps/callback?error=${encodeURIComponent('Missing code or state parameter')}&app=${req.params.appId}`,
      );
      return;
    }

    const callbackBaseUrl = `${req.protocol}://${req.get('host')}`;

    const result = await handleOAuthCallback({
      appId: req.params.appId,
      code: String(code),
      state: String(state),
      callbackBaseUrl,
    });

    const frontendUrl = getBaseUrl();
    if (result.success) {
      res.redirect(`${frontendUrl}/apps/callback?success=true&app=${req.params.appId}`);
    } else {
      res.redirect(`${frontendUrl}/apps/callback?error=${encodeURIComponent(result.error || 'Connection failed')}&app=${req.params.appId}`);
    }
  } catch (err) {
    const frontendUrl = getBaseUrl();
    res.redirect(`${frontendUrl}/apps/callback?error=${encodeURIComponent('Unexpected error during OAuth callback')}&app=${req.params.appId}`);
  }
});

// ── Connect with credentials (API key, etc.) ──────────────────
router.post('/integrations/:appId/connect/credentials', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const provider = getProvider(req.params.appId);
    if (!provider) {
      res.status(404).json({ error: `Unknown provider: ${req.params.appId}` });
      return;
    }

    if (provider.auth_type === 'oauth') {
      res.status(400).json({ error: `Provider ${req.params.appId} uses OAuth. Use /connect/oauth instead.` });
      return;
    }

    const { credentials } = req.body;
    if (!credentials || typeof credentials !== 'object') {
      res.status(400).json({ error: 'Missing credentials object in request body' });
      return;
    }

    const result = await connectWithCredentials({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      appId: req.params.appId,
      credentials,
    });

    if (result.success) {
      res.json({ success: true, connection: result.connection });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to connect' });
  }
});

// ── Test connection ───────────────────────────────────────────
router.post('/integrations/:appId/test', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const result = await testConnection(ctx.orgId, req.params.appId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Test failed' });
  }
});

// ── Disconnect ────────────────────────────────────────────────
router.post('/integrations/:appId/disconnect', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    await disconnect({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      appId: req.params.appId,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to disconnect' });
  }
});

// ── Refresh OAuth token ───────────────────────────────────────
router.post('/integrations/:appId/refresh', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const success = await refreshOAuthToken(ctx.orgId, req.params.appId);
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to refresh token' });
  }
});

export default router;
