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
