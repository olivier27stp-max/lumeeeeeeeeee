import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────
export type EmailProviderSlug = 'gmail' | 'outlook';
export type EmailAccountStatus = 'connected' | 'error' | 'reconnect_required' | 'disconnected';

export interface EmailAccount {
  id: string;
  provider: EmailProviderSlug;
  email_address: string;
  status: EmailAccountStatus;
  scopes: string[];
  last_error: string | null;
  last_synced_at: string | null;
  connected_at: string;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

// ─── List the caller's connected mailboxes ───────────────────────────
export async function listEmailAccounts(): Promise<EmailAccount[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/email/accounts`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load mailboxes');
  }
  const json = await res.json();
  return (json.accounts || []) as EmailAccount[];
}

// ─── Start the OAuth connect flow → returns the provider authorize URL ─
export async function startEmailConnect(provider: EmailProviderSlug): Promise<string> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/email/${provider}/connect`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to start connection');
  }
  const json = await res.json();
  return json.authorize_url as string;
}

/** Kick off the OAuth flow by redirecting the browser to the provider. */
export async function connectMailbox(provider: EmailProviderSlug): Promise<void> {
  const url = await startEmailConnect(provider);
  window.location.href = url;
}

// ─── Inbox types ─────────────────────────────────────────────────────
export interface EmailThread {
  id: string;
  subject: string | null;
  snippet: string | null;
  from_name: string | null;
  from_email: string | null;
  last_message_at: string | null;
  is_read: boolean;
  has_attachments: boolean;
  message_count: number;
  folder: string;
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface EmailMessage {
  id: string;
  from_name: string | null;
  from_email: string | null;
  to_emails: string[];
  cc_emails: string[];
  subject: string | null;
  body_html: string | null;
  body_text: string | null;
  snippet: string | null;
  direction: 'inbound' | 'outbound';
  is_read: boolean;
  has_attachments: boolean;
  attachments: EmailAttachment[];
  sent_at: string | null;
}

// ─── Sync a mailbox (pull latest from Gmail/Outlook) ─────────────────
export async function syncMailbox(accountId: string): Promise<number> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/email/accounts/${accountId}/sync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Sync failed');
  }
  const json = await res.json();
  return json.synced ?? 0;
}

// ─── List threads of a mailbox ───────────────────────────────────────
export async function fetchThreads(accountId: string): Promise<EmailThread[]> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/email/accounts/${accountId}/threads`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load threads');
  }
  const json = await res.json();
  return (json.threads || []) as EmailThread[];
}

// ─── Get one thread + its messages ───────────────────────────────────
export async function fetchThread(threadId: string): Promise<{ thread: EmailThread; messages: EmailMessage[] }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/email/threads/${threadId}`, { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to load thread');
  }
  return res.json();
}

// ─── Send / reply / forward ──────────────────────────────────────────
export async function sendEmail(payload: {
  accountId: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyHtml: string;
  threadId?: string; // present → reply into this thread
}): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/email/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send email');
  }
}

// ─── Thread actions: read / unread / archive / trash ─────────────────
export async function threadAction(
  threadId: string,
  action: 'read' | 'unread' | 'archive' | 'trash',
): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/email/threads/${threadId}/action`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Action failed');
  }
}

// ─── Disconnect a mailbox ────────────────────────────────────────────
export async function disconnectMailbox(accountId: string): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}/api/email/accounts/${accountId}/disconnect`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to disconnect');
  }
}
