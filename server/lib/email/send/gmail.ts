/* ═══════════════════════════════════════════════════════════════
   Gmail Send
   Sends a new email, a reply, or a forward via the Gmail API.
   Builds an RFC 2822 message; for replies it sets In-Reply-To /
   References and reuses the Gmail threadId so the message stays in
   the conversation. Uses getValidAccessToken() for auto-refresh.
   ═══════════════════════════════════════════════════════════════ */

import { getServiceClient } from '../../supabase';
import { getValidAccessToken } from '../accountService';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

function base64Url(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Encode a header value that may contain non-ASCII (RFC 2047).
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

interface SendParams {
  accountId: string;
  fromEmail: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml: string;
  // Threading (replies/forwards)
  threadId?: string;          // Gmail threadId to attach to
  inReplyTo?: string;         // RFC Message-ID of the message being replied to
  references?: string;        // References chain
}

/**
 * Build the raw RFC 2822 message and send it via Gmail.
 * Returns the sent message's Gmail id.
 */
export async function sendGmail(params: SendParams): Promise<{ id: string; threadId: string }> {
  const accessToken = await getValidAccessToken(params.accountId);
  if (!accessToken) throw new Error('No valid access token — please reconnect the mailbox.');

  const fromHeader = params.fromName
    ? `${encodeHeader(params.fromName)} <${params.fromEmail}>`
    : params.fromEmail;

  const lines: string[] = [];
  lines.push(`From: ${fromHeader}`);
  lines.push(`To: ${params.to.join(', ')}`);
  if (params.cc && params.cc.length) lines.push(`Cc: ${params.cc.join(', ')}`);
  lines.push(`Subject: ${encodeHeader(params.subject)}`);
  if (params.inReplyTo) {
    lines.push(`In-Reply-To: ${params.inReplyTo}`);
    lines.push(`References: ${params.references || params.inReplyTo}`);
  }
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 8bit');
  lines.push('');
  lines.push(params.bodyHtml);

  const raw = base64Url(lines.join('\r\n'));

  const payload: Record<string, unknown> = { raw };
  if (params.threadId) payload.threadId = params.threadId;

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Gmail send failed: ${json.error?.message || res.status}`);
  }

  // Record the outbound message locally so it appears in the thread immediately.
  try {
    await recordOutbound(params, json.id, json.threadId);
  } catch { /* non-critical */ }

  return { id: json.id, threadId: json.threadId };
}

async function recordOutbound(params: SendParams, messageId: string, gmailThreadId: string) {
  const db = getServiceClient();
  const { data: account } = await db
    .from('email_accounts')
    .select('user_id, org_id')
    .eq('id', params.accountId)
    .maybeSingle();
  if (!account) return;

  // Find the local thread by Gmail threadId (or the one we replied into).
  const { data: thread } = await db
    .from('email_threads')
    .select('id')
    .eq('account_id', params.accountId)
    .eq('provider_thread_id', gmailThreadId)
    .maybeSingle();

  if (!thread) return; // new-conversation threads get picked up on next sync

  const now = new Date().toISOString();
  await db.from('email_messages').insert({
    thread_id: thread.id,
    account_id: params.accountId,
    user_id: account.user_id,
    provider_message_id: messageId,
    from_name: params.fromName || null,
    from_email: params.fromEmail,
    to_emails: params.to,
    cc_emails: params.cc || [],
    subject: params.subject,
    snippet: '',
    body_html: params.bodyHtml,
    body_text: null,
    direction: 'outbound',
    is_read: true,
    has_attachments: false,
    attachments: [],
    sent_at: now,
  });

  await db.from('email_threads').update({ last_message_at: now, snippet: 'Vous: …' }).eq('id', thread.id);
}
