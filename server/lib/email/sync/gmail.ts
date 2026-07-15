/* ═══════════════════════════════════════════════════════════════
   Gmail Sync
   Fetches recent messages from the Gmail API and stores them as
   threads + messages. Initial sync = last N messages in INBOX.
   Uses getValidAccessToken() so tokens auto-refresh.
   ═══════════════════════════════════════════════════════════════ */

import { getServiceClient } from '../../supabase';
import { getValidAccessToken } from '../accountService';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface GmailHeader { name: string; value: string; }
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value || '';
}

// Parse "Name <email@x.com>" → { name, email }
function parseAddress(raw: string): { name: string; email: string } {
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: '', email: raw.trim().toLowerCase() };
}

function parseAddressList(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((a) => parseAddress(a).email).filter(Boolean);
}

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

// Walk the MIME tree to extract html + text bodies + attachment metadata.
function extractBody(payload: GmailPart | undefined): {
  html: string;
  text: string;
  attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }>;
} {
  let html = '';
  let text = '';
  const attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> = [];

  function walk(part: GmailPart | undefined) {
    if (!part) return;
    const mime = part.mimeType || '';
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: mime,
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (mime === 'text/html' && part.body?.data) html ||= decodeBase64Url(part.body.data);
    else if (mime === 'text/plain' && part.body?.data) text ||= decodeBase64Url(part.body.data);
    (part.parts || []).forEach(walk);
  }
  walk(payload);
  return { html, text, attachments };
}

async function gmailFetch(accessToken: string, path: string): Promise<any> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Sync the most recent `max` inbox messages for an account.
 * Returns the number of messages upserted.
 */
export async function syncGmailInbox(accountId: string, max = 25): Promise<number> {
  const accessToken = await getValidAccessToken(accountId);
  if (!accessToken) throw new Error('No valid access token — please reconnect the mailbox.');

  const db = getServiceClient();
  const { data: account } = await db
    .from('email_accounts')
    .select('id, user_id, org_id')
    .eq('id', accountId)
    .maybeSingle();
  if (!account) throw new Error('Mailbox not found');

  // Sync each folder (Gmail label → our folder name + direction).
  const folders: Array<{ label: string; folder: string; direction: 'inbound' | 'outbound' }> = [
    { label: 'INBOX', folder: 'inbox', direction: 'inbound' },
    { label: 'SENT', folder: 'sent', direction: 'outbound' },
    { label: 'TRASH', folder: 'trash', direction: 'inbound' },
  ];

  let upserted = 0;
  for (const f of folders) {
    upserted += await syncFolder(db, accessToken, account, f.label, f.folder, f.direction, max);
  }

  await db
    .from('email_accounts')
    .update({ last_synced_at: new Date().toISOString(), status: 'connected' })
    .eq('id', accountId);

  return upserted;
}

// Sync one Gmail label into a local folder.
async function syncFolder(
  db: ReturnType<typeof getServiceClient>,
  accessToken: string,
  account: { id: string; user_id: string; org_id: string },
  label: string,
  folder: string,
  direction: 'inbound' | 'outbound',
  max: number,
): Promise<number> {
  let list: { messages?: Array<{ id: string }> };
  try {
    // TRASH needs includeSpamTrash=true to be listable.
    const extra = label === 'TRASH' ? '&includeSpamTrash=true' : '';
    list = await gmailFetch(accessToken, `/messages?maxResults=${max}&labelIds=${label}${extra}`);
  } catch {
    return 0;
  }
  const ids: string[] = (list.messages || []).map((m) => m.id);
  if (ids.length === 0) return 0;

  let upserted = 0;
  for (const id of ids) {
    let msg: GmailMessage;
    try {
      msg = await gmailFetch(accessToken, `/messages/${id}?format=full`);
    } catch {
      continue;
    }

    const headers = msg.payload?.headers;
    const from = parseAddress(header(headers, 'From'));
    const subject = header(headers, 'Subject');
    const dateMs = msg.internalDate ? parseInt(msg.internalDate, 10) : Date.now();
    const sentAt = new Date(dateMs).toISOString();
    const { html, text, attachments } = extractBody(msg.payload);
    const isRead = !(msg.labelIds || []).includes('UNREAD');

    const { data: thread } = await db
      .from('email_threads')
      .upsert({
        account_id: account.id,
        user_id: account.user_id,
        org_id: account.org_id,
        provider_thread_id: msg.threadId,
        subject,
        snippet: msg.snippet || '',
        from_name: from.name || from.email,
        from_email: from.email,
        last_message_at: sentAt,
        is_read: isRead,
        has_attachments: attachments.length > 0,
        folder,
      }, { onConflict: 'account_id,provider_thread_id' })
      .select('id')
      .single();

    if (!thread) continue;

    const { error: msgErr } = await db
      .from('email_messages')
      .upsert({
        thread_id: thread.id,
        account_id: account.id,
        user_id: account.user_id,
        provider_message_id: msg.id,
        rfc_message_id: header(headers, 'Message-ID') || null,
        from_name: from.name,
        from_email: from.email,
        to_emails: parseAddressList(header(headers, 'To')),
        cc_emails: parseAddressList(header(headers, 'Cc')),
        subject,
        snippet: msg.snippet || '',
        body_html: html || null,
        body_text: text || null,
        direction,
        is_read: isRead,
        has_attachments: attachments.length > 0,
        attachments,
        sent_at: sentAt,
      }, { onConflict: 'account_id,provider_message_id' });

    if (!msgErr) upserted++;
  }
  return upserted;
}
