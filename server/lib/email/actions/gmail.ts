/* ═══════════════════════════════════════════════════════════════
   Gmail Actions
   Mark read/unread, archive, trash — propagated to the real mailbox
   via the Gmail API, then mirrored in our local tables.
   ═══════════════════════════════════════════════════════════════ */

import { getServiceClient } from '../../supabase';
import { getValidAccessToken } from '../accountService';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function modifyGmail(accessToken: string, messageId: string, add: string[], remove: string[]) {
  const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail modify ${res.status}: ${body.slice(0, 150)}`);
  }
}

async function trashGmail(accessToken: string, messageId: string) {
  const res = await fetch(`${GMAIL_API}/messages/${messageId}/trash`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail trash ${res.status}: ${body.slice(0, 150)}`);
  }
}

/**
 * Apply an action to every Gmail message in a thread, then update local state.
 */
export async function applyGmailThreadAction(
  accountId: string,
  threadId: string,
  action: 'read' | 'unread' | 'archive' | 'trash',
): Promise<void> {
  const accessToken = await getValidAccessToken(accountId);
  if (!accessToken) throw new Error('No valid access token — please reconnect the mailbox.');

  const db = getServiceClient();

  // Get all provider message IDs in this thread
  const { data: msgs } = await db
    .from('email_messages')
    .select('provider_message_id')
    .eq('thread_id', threadId);
  const providerIds = (msgs || []).map((m) => m.provider_message_id).filter(Boolean);

  for (const pid of providerIds) {
    try {
      if (action === 'read') await modifyGmail(accessToken, pid, [], ['UNREAD']);
      else if (action === 'unread') await modifyGmail(accessToken, pid, ['UNREAD'], []);
      else if (action === 'archive') await modifyGmail(accessToken, pid, [], ['INBOX']);
      else if (action === 'trash') await trashGmail(accessToken, pid);
    } catch {
      /* keep going for the rest of the thread */
    }
  }

  // Mirror locally
  if (action === 'read') await db.from('email_threads').update({ is_read: true }).eq('id', threadId);
  else if (action === 'unread') await db.from('email_threads').update({ is_read: false }).eq('id', threadId);
  else if (action === 'archive') await db.from('email_threads').update({ folder: 'archive' }).eq('id', threadId);
  else if (action === 'trash') await db.from('email_threads').update({ folder: 'trash' }).eq('id', threadId);
}
