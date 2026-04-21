// Internal team messaging API — wraps internal_conversations / internal_conversation_participants / internal_messages.
// Requires migrations 20260616000000_internal_team_messaging.sql and
// 20260619000000_fix_internal_messaging_rls_recursion.sql to be applied.
// Without them, calls return Postgres 42P01 (relation does not exist).
//
// Used by SocialFeed.tsx (renamed from the ported Clostra feed page — it's
// actually a Messenger-style internal team chat, not a social posts feed).
import { supabase } from './supabase';

// ── Types ──────────────────────────────────────────────────────────────

export type InternalConversation = {
  id: string;
  org_id: string;
  title: string | null;
  is_group: boolean;
  created_by: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InternalParticipant = {
  id: string;
  conversation_id: string;
  user_id: string;
  unread_count: number;
  last_read_at: string | null;
  joined_at: string;
};

export type InternalMessage = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  message_text: string;
  created_at: string;
};

// ── Conversations ──────────────────────────────────────────────────────

export async function listConversations(orgId: string): Promise<InternalConversation[]> {
  const { data, error } = await supabase
    .from('internal_conversations')
    .select('*')
    .eq('org_id', orgId)
    .order('last_message_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as InternalConversation[];
}

export async function getConversation(id: string): Promise<InternalConversation | null> {
  const { data, error } = await supabase
    .from('internal_conversations')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as InternalConversation | null;
}

export async function createConversation(input: {
  org_id: string;
  created_by: string;
  participant_user_ids: string[];
  title?: string | null;
  is_group?: boolean;
}): Promise<InternalConversation> {
  const { participant_user_ids, ...conv } = input;
  const { data, error } = await supabase
    .from('internal_conversations')
    .insert({
      org_id: conv.org_id,
      created_by: conv.created_by,
      title: conv.title ?? null,
      is_group: conv.is_group ?? participant_user_ids.length > 2,
    })
    .select('*')
    .single();
  if (error) throw error;
  const created = data as InternalConversation;

  // Ensure creator is a participant, plus all given user_ids (deduped).
  const userIds = Array.from(new Set([conv.created_by, ...participant_user_ids]));
  const rows = userIds.map((user_id) => ({ conversation_id: created.id, user_id }));
  const { error: pErr } = await supabase
    .from('internal_conversation_participants')
    .insert(rows);
  if (pErr) throw pErr;

  return created;
}

// ── Participants ───────────────────────────────────────────────────────

export async function listParticipants(conversationId: string): Promise<InternalParticipant[]> {
  const { data, error } = await supabase
    .from('internal_conversation_participants')
    .select('*')
    .eq('conversation_id', conversationId);
  if (error) throw error;
  return (data ?? []) as InternalParticipant[];
}

export async function markConversationRead(
  conversationId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('internal_conversation_participants')
    .update({ unread_count: 0, last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ── Messages ───────────────────────────────────────────────────────────

export async function listMessages(
  conversationId: string,
  limit = 200
): Promise<InternalMessage[]> {
  const { data, error } = await supabase
    .from('internal_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as InternalMessage[];
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  messageText: string
): Promise<InternalMessage> {
  const { data, error } = await supabase
    .from('internal_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      message_text: messageText,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as InternalMessage;
}
