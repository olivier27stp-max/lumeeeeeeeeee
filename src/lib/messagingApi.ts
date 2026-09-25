import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

// ─── Types ───────────────────────────────────────────────────────────
export interface Conversation {
  id: string;
  org_id: string | null;
  client_id: string | null;
  phone_number: string;
  client_name: string | null;
  last_message_text: string | null;
  last_message_at: string;
  unread_count: number;
  status: 'active' | 'archived';
  created_at: string;
  /** Boîte unifiée : nom du bureau de la conversation. */
  office_name?: string;
  /** Personne assignée (membre du bureau de la conversation). */
  assigned_to?: string | null;
}

export interface InboxMember { user_id: string; name: string }
/** `members` : à qui l'on peut assigner une conversation de ce bureau. */
export interface InboxOffice { org_id: string; name: string; members?: InboxMember[] }

export interface Message {
  id: string;
  conversation_id: string;
  org_id: string | null;
  client_id: string | null;
  phone_number: string;
  direction: 'outbound' | 'inbound';
  message_text: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'received';
  provider_message_id: string | null;
  sender_user_id: string | null;
  error_message: string | null;
  created_at: string;
}

// ─── API base ────────────────────────────────────────────────────────
// Empty default → fetch uses a relative URL → same-origin (Vite proxies /api in dev,
// and in prod the API runs on the same domain as the SPA). Override with VITE_API_URL
// only when calling a backend on a different origin.
const API_BASE = import.meta.env.VITE_API_URL || '';

/** `bureau` : le bureau visé (celui de la conversation) ; sinon le wrapper met le bureau actif. */
async function getAuthHeaders(bureau?: string | null): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    ...(bureau ? { 'x-org-id': bureau } : {}),
  };
}

async function lireJson<T>(res: Response, repli: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || repli);
  }
  return res.json();
}

// ─── Boîte unifiée ───────────────────────────────────────────────────
/** Conversations de tous les bureaux où l'on a messages.read (même entreprise), chacune avec son bureau. */
export async function fetchInbox(): Promise<{ offices: InboxOffice[]; conversations: Conversation[] }> {
  const res = await fetch(`${API_BASE}/api/messages/inbox`, { headers: await getAuthHeaders() });
  return lireJson(res, 'Failed to load conversations');
}

// ─── Conversations ───────────────────────────────────────────────────
export async function fetchConversations(): Promise<Conversation[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('org_id', orgId)
    .order('last_message_at', { ascending: false });

  if (error) throw error;
  return (data || []) as Conversation[];
}

/** Passe par le serveur avec le bureau DE LA CONVERSATION (elle peut être d'un autre bureau que l'actif). */
export async function markConversationRead(conversationId: string, bureau: string | null): Promise<void> {
  const res = await fetch(`${API_BASE}/api/messages/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: 'POST',
    headers: await getAuthHeaders(bureau),
  });
  await lireJson(res, 'Failed to mark conversation read');
}

/** Assigner (ou désassigner avec null) une conversation, avec le bureau DE LA CONVERSATION. */
export async function assignConversation(conversationId: string, bureau: string | null, userId: string | null): Promise<void> {
  const res = await fetch(`${API_BASE}/api/messages/conversations/${encodeURIComponent(conversationId)}/assign`, {
    method: 'PATCH',
    headers: await getAuthHeaders(bureau),
    body: JSON.stringify({ assigned_to: userId }),
  });
  await lireJson(res, 'Failed to assign conversation');
}

// ─── Messages ────────────────────────────────────────────────────────
/** Fil d'une conversation, lu avec le bureau DE LA CONVERSATION. */
export async function fetchMessages(conversationId: string, bureau: string | null): Promise<Message[]> {
  const res = await fetch(`${API_BASE}/api/messages/conversations/${encodeURIComponent(conversationId)}/messages`, {
    headers: await getAuthHeaders(bureau),
  });
  return lireJson(res, 'Failed to load messages');
}

// ─── Send SMS (via backend → Twilio) ─────────────────────────────────
export async function sendSms(payload: {
  phone_number: string;
  message_text: string;
  client_id?: string;
  client_name?: string;
}, bureau?: string | null): Promise<Message> {
  // Le bureau de la conversation : la réponse part de SON numéro.
  const headers = await getAuthHeaders(bureau);
  const res = await fetch(`${API_BASE}/api/messages/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send SMS');
  }
  return res.json();
}

// ─── Phone number formatting ─────────────────────────────────────────
export function formatE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}

export function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}
