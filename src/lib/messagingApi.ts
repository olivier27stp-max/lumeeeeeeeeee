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
}

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

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
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

export async function markConversationRead(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .update({ unread_count: 0 })
    .eq('id', conversationId);
  if (error) throw error;
}

// ─── Messages ────────────────────────────────────────────────────────
export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const orgId = await getCurrentOrgIdOrThrow();
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('org_id', orgId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as Message[];
}

// ─── Send SMS (via backend → Twilio) ─────────────────────────────────
export async function sendSms(payload: {
  phone_number: string;
  message_text: string;
  client_id?: string;
  client_name?: string;
}): Promise<Message> {
  const headers = await getAuthHeaders();
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
