// CRM messaging. The actual SMS is sent via the device's native composer
// (Twilio is server-only and unreachable here), but we LOG the outbound message
// into the same conversations/messages tables the web uses, so the client's
// thread in the CRM reflects what the tech sent. RLS allows org members to
// read/insert these rows directly.

import { supabase } from '../supabase';

export interface MessageRow {
  id: string;
  conversation_id: string;
  direction: 'outbound' | 'inbound' | string;
  message_text: string;
  status: string | null;
  created_at: string;
}

/** Best-effort E.164 normalization for North-American numbers. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (raw.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

async function findOrCreateConversation(params: {
  orgId: string;
  phone: string;
  clientId?: string | null;
  clientName?: string | null;
}): Promise<string> {
  const { orgId, phone, clientId, clientName } = params;
  const norm = normalizePhone(phone);

  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('org_id', orgId)
    .eq('phone_number', norm)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      org_id: orgId,
      phone_number: norm,
      client_id: clientId ?? null,
      client_name: clientName ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Record an outbound message in the CRM (after sending it natively). */
export async function logOutboundMessage(params: {
  orgId: string;
  phone: string;
  text: string;
  userId: string;
  clientId?: string | null;
  clientName?: string | null;
}): Promise<void> {
  const norm = normalizePhone(params.phone);
  const conversationId = await findOrCreateConversation({
    orgId: params.orgId,
    phone: norm,
    clientId: params.clientId,
    clientName: params.clientName,
  });

  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    org_id: params.orgId,
    client_id: params.clientId ?? null,
    phone_number: norm,
    direction: 'outbound',
    message_text: params.text,
    status: 'sent',
    sender_user_id: params.userId,
  });
  if (error) throw new Error(error.message);

  await supabase
    .from('conversations')
    .update({ last_message_text: params.text, last_message_at: new Date().toISOString() })
    .eq('id', conversationId);
}

/** Recent messages for a phone number's conversation (thread preview). */
export async function listRecentMessages(orgId: string, phone: string, limit = 20): Promise<MessageRow[]> {
  const norm = normalizePhone(phone);
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('org_id', orgId)
    .eq('phone_number', norm)
    .limit(1)
    .maybeSingle();
  if (!conv?.id) return [];

  const { data, error } = await supabase
    .from('messages')
    .select('id, conversation_id, direction, message_text, status, created_at')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as MessageRow[];
}
