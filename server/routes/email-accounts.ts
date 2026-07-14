/* ═══════════════════════════════════════════════════════════════
   Email Account Routes
   /api/email/accounts        → list the caller's connected mailboxes
   /api/email/:provider/connect  → start OAuth (returns authorize_url)
   /api/email/:provider/callback → OAuth redirect target
   /api/email/accounts/:id/disconnect → disconnect a mailbox

   Personal mailboxes (Gmail / Outlook), scoped per owner.
   Does NOT touch the org-scoped integrations system.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireAuthedClient } from '../lib/supabase';
import { getBaseUrl } from '../lib/config';
import { isEmailProvider } from '../lib/email/providers';
import {
  startEmailOAuth,
  handleEmailOAuthCallback,
  listEmailAccounts,
  disconnectEmailAccount,
} from '../lib/email/accountService';

const router = Router();

// ── List the caller's mailboxes ───────────────────────────────
router.get('/email/accounts', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;
    const accounts = await listEmailAccounts(ctx.user.id);
    res.json({ accounts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
});

// ── Start OAuth for a provider ────────────────────────────────
router.post('/email/:provider/connect', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const provider = req.params.provider;
    if (!isEmailProvider(provider)) {
      res.status(404).json({ error: `Unknown email provider: ${provider}` });
      return;
    }

    const callbackBaseUrl = `${req.protocol}://${req.get('host')}`;
    const result = await startEmailOAuth({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      provider,
      callbackBaseUrl,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to start OAuth' });
  }
});

// ── OAuth callback (provider redirects the browser here) ──────
router.get('/email/:provider/callback', async (req, res) => {
  const frontendUrl = getBaseUrl();
  const provider = req.params.provider;
  const done = (qs: string) => res.redirect(`${frontendUrl}/email/callback?${qs}&provider=${provider}`);

  try {
    const { code, state, error: oauthError, error_description } = req.query;

    if (oauthError) {
      done(`error=${encodeURIComponent(String(error_description || oauthError))}`);
      return;
    }
    if (!isEmailProvider(provider)) {
      done(`error=${encodeURIComponent('Unknown email provider')}`);
      return;
    }
    if (!code || !state) {
      done(`error=${encodeURIComponent('Missing code or state')}`);
      return;
    }

    const result = await handleEmailOAuthCallback({
      provider,
      code: String(code),
      state: String(state),
    });

    if (result.success) done('success=true');
    else done(`error=${encodeURIComponent(result.error || 'Connection failed')}`);
  } catch {
    done(`error=${encodeURIComponent('Unexpected error during OAuth callback')}`);
  }
});

// ── Disconnect a mailbox ──────────────────────────────────────
router.post('/email/accounts/:id/disconnect', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;
    await disconnectEmailAccount(ctx.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to disconnect' });
  }
});

export default router;
