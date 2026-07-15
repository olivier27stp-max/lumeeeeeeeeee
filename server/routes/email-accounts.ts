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
import { getServiceClient } from '../lib/supabase';
import { syncGmailInbox } from '../lib/email/sync/gmail';
import { sendGmail } from '../lib/email/send/gmail';
import { applyGmailThreadAction } from '../lib/email/actions/gmail';
import { getValidAccessToken } from '../lib/email/accountService';

const router = Router();

// Verify the account belongs to the caller (defence in depth on top of RLS).
async function ownedAccount(userId: string, accountId: string) {
  const { data } = await getServiceClient()
    .from('email_accounts')
    .select('id, provider, user_id')
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle();
  return data || null;
}

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

// ── Sync a mailbox (fetch recent emails from the provider) ────
router.post('/email/accounts/:id/sync', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const account = await ownedAccount(ctx.user.id, req.params.id);
    if (!account) { res.status(404).json({ error: 'Mailbox not found' }); return; }

    const max = Math.min(Math.max(parseInt(String(req.body?.max || '25'), 10) || 25, 10), 100);
    let synced = 0;
    if (account.provider === 'gmail') {
      synced = await syncGmailInbox(account.id, max);
    } else {
      // Outlook sync arrives in the next step.
      res.status(400).json({ error: 'Outlook sync not available yet' });
      return;
    }
    res.json({ ok: true, synced });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

// ── List threads for a mailbox ────────────────────────────────
router.get('/email/accounts/:id/threads', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const account = await ownedAccount(ctx.user.id, req.params.id);
    if (!account) { res.status(404).json({ error: 'Mailbox not found' }); return; }

    const { data, error } = await getServiceClient()
      .from('email_threads')
      .select('id, subject, snippet, from_name, from_email, last_message_at, is_read, has_attachments, message_count, folder')
      .eq('account_id', account.id)
      .eq('folder', 'inbox')
      .order('last_message_at', { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);
    res.json({ threads: data || [] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load threads' });
  }
});

// ── Get one thread with its messages ──────────────────────────
router.get('/email/threads/:threadId', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const db = getServiceClient();
    const { data: thread } = await db
      .from('email_threads')
      .select('*')
      .eq('id', req.params.threadId)
      .eq('user_id', ctx.user.id)  // ownership
      .maybeSingle();

    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }

    const { data: messages } = await db
      .from('email_messages')
      .select('id, from_name, from_email, to_emails, cc_emails, subject, body_html, body_text, snippet, direction, is_read, has_attachments, attachments, sent_at')
      .eq('thread_id', thread.id)
      .order('sent_at', { ascending: true });

    // Mark thread as read (best-effort, local only for now)
    if (!thread.is_read) {
      await db.from('email_threads').update({ is_read: true }).eq('id', thread.id);
    }

    res.json({ thread, messages: messages || [] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load thread' });
  }
});

// ── Send / reply / forward ────────────────────────────────────
// Body: { accountId, to[], cc?[], subject, bodyHtml, threadId? }
// If threadId is provided → it's a reply into that thread (threading applied).
router.post('/email/send', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const { accountId, to, cc, subject, bodyHtml, threadId } = req.body || {};
    if (!accountId || !Array.isArray(to) || to.length === 0 || !subject || !bodyHtml) {
      res.status(400).json({ error: 'accountId, to[], subject and bodyHtml are required' });
      return;
    }

    const account = await ownedAccount(ctx.user.id, accountId);
    if (!account) { res.status(404).json({ error: 'Mailbox not found' }); return; }
    if (account.provider !== 'gmail') { res.status(400).json({ error: 'Only Gmail sending is available yet' }); return; }

    const db = getServiceClient();

    // Fetch the mailbox address (the From).
    const { data: acc } = await db.from('email_accounts').select('email_address').eq('id', accountId).maybeSingle();
    const fromEmail = acc?.email_address || '';

    // Reply threading: pull the thread's provider_thread_id + last inbound Message-ID.
    let gmailThreadId: string | undefined;
    let inReplyTo: string | undefined;
    let references: string | undefined;
    if (threadId) {
      const { data: thread } = await db
        .from('email_threads')
        .select('provider_thread_id')
        .eq('id', threadId)
        .eq('user_id', ctx.user.id)
        .maybeSingle();
      if (thread) {
        gmailThreadId = thread.provider_thread_id;
        const { data: lastMsg } = await db
          .from('email_messages')
          .select('rfc_message_id')
          .eq('thread_id', threadId)
          .not('rfc_message_id', 'is', null)
          .order('sent_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastMsg?.rfc_message_id) {
          inReplyTo = lastMsg.rfc_message_id;
          references = lastMsg.rfc_message_id;
        }
      }
    }

    const result = await sendGmail({
      accountId,
      fromEmail,
      to,
      cc: Array.isArray(cc) ? cc : [],
      subject,
      bodyHtml,
      threadId: gmailThreadId,
      inReplyTo,
      references,
    });

    res.json({ ok: true, id: result.id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send email' });
  }
});

// ── Thread action: read / unread / archive / trash ───────────
router.post('/email/threads/:threadId/action', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const action = String(req.body?.action || '');
    if (!['read', 'unread', 'archive', 'trash'].includes(action)) {
      res.status(400).json({ error: 'Invalid action' });
      return;
    }

    const db = getServiceClient();
    const { data: thread } = await db
      .from('email_threads')
      .select('id, account_id')
      .eq('id', req.params.threadId)
      .eq('user_id', ctx.user.id) // ownership
      .maybeSingle();
    if (!thread) { res.status(404).json({ error: 'Thread not found' }); return; }

    const account = await ownedAccount(ctx.user.id, thread.account_id);
    if (!account || account.provider !== 'gmail') {
      res.status(400).json({ error: 'Only Gmail actions are available yet' });
      return;
    }

    await applyGmailThreadAction(thread.account_id, thread.id, action as 'read' | 'unread' | 'archive' | 'trash');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Action failed' });
  }
});

// ── Download an attachment from a message ─────────────────────
router.get('/email/messages/:messageId/attachments/:attachmentId', async (req, res) => {
  try {
    const ctx = await requireAuthedClient(req, res);
    if (!ctx) return;

    const db = getServiceClient();
    // Find the local message (ownership) + its account + provider message id.
    const { data: msg } = await db
      .from('email_messages')
      .select('account_id, provider_message_id, attachments')
      .eq('id', req.params.messageId)
      .eq('user_id', ctx.user.id)
      .maybeSingle();
    if (!msg) { res.status(404).json({ error: 'Message not found' }); return; }

    const account = await ownedAccount(ctx.user.id, msg.account_id);
    if (!account || account.provider !== 'gmail') { res.status(400).json({ error: 'Unsupported provider' }); return; }

    const meta = (msg.attachments as Array<{ attachmentId: string; filename: string; mimeType: string }> | null)
      ?.find((a) => a.attachmentId === req.params.attachmentId);
    if (!meta) { res.status(404).json({ error: 'Attachment not found' }); return; }

    const accessToken = await getValidAccessToken(msg.account_id);
    if (!accessToken) { res.status(400).json({ error: 'Reconnect the mailbox' }); return; }

    const gRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.provider_message_id}/attachments/${req.params.attachmentId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!gRes.ok) { res.status(502).json({ error: 'Failed to fetch attachment' }); return; }
    const json = await gRes.json();
    const data = Buffer.from(String(json.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${meta.filename.replace(/"/g, '')}"`);
    res.send(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Download failed' });
  }
});

export default router;
