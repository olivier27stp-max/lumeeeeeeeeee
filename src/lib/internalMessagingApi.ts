import { supabase } from './supabase';
import { getCurrentOrgIdOrThrow } from './orgApi';

// ── Types ──

export interface InternalConversation {
  id: string;
  org_id: string;
  title: string | null;
  is_group: boolean;
  created_by: string;
  last_message_text: string | null;
  last_message_at: string | null;
  created_at: string;
  // joined from participants
  unread_count?: number;
  // resolved display
  display_name?: string;
  other_user_id?: string;
}

export interface InternalMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_text: string;
  created_at: string;
  // joined
  sender_name?: string;
}

export interface TeamMemberOption {
  user_id: string;
  full_name: string;
  role: string;
}

// ── Helpers ──

async function getMyUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

async function getMyOrgId(): Promise<string> {
  return getCurrentOrgIdOrThrow();
}

// ── Conversations ──

export async function listInternalConversations(): Promise<InternalConversation[]> {
  const uid = await getMyUserId();

  // Get conversations where I'm a participant
  const { data: participations, error: pErr } = await supabase
    .from('internal_conversation_participants')
    .select('conversation_id, unread_count')
    .eq('user_id', uid);

  if (pErr) throw pErr;
  if (!participations || participations.length === 0) return [];

  const convoIds = participations.map(p => p.conversation_id);
  const unreadMap = new Map(participations.map(p => [p.conversation_id, p.unread_count]));

  const { data: convos, error: cErr } = await supabase
    .from('internal_conversations')
    .select('*')
    .in('id', convoIds)
    .order('last_message_at', { ascending: false, nullsFirst: false });

  if (cErr) throw cErr;
  if (!convos) return [];

  // For 1:1 convos, resolve the other participant's name
  const result: InternalConversation[] = [];
  for (const c of convos) {
    const convo: InternalConversation = {
      ...c,
      unread_count: unreadMap.get(c.id) || 0,
    };

    if (!c.is_group) {
      // Get the other participant
      const { data: parts } = await supabase
        .from('internal_conversation_participants')
        .select('user_id')
        .eq('conversation_id', c.id)
        .neq('user_id', uid)
        .limit(1);

      if (parts && parts[0]) {
        convo.other_user_id = parts[0].user_id;
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', parts[0].user_id)
          .maybeSingle();
        convo.display_name = profile?.full_name || 'Team Member';
      }
    }

    if (!convo.display_name) convo.display_name = c.title || 'Group';
    result.push(convo);
  }

  return result;
}

export async function createConversation(otherUserId: string, firstMessage: string): Promise<InternalConversation> {
  const uid = await getMyUserId();
  const orgId = await getMyOrgId();

  // Check if 1:1 conversation already exists
  const { data: myConvos } = await supabase
    .from('internal_conversation_participants')
    .select('conversation_id')
    .eq('user_id', uid);

  if (myConvos && myConvos.length > 0) {
    const myConvoIds = myConvos.map(c => c.conversation_id);
    const { data: otherConvos } = await supabase
      .from('internal_conversation_participants')
      .select('conversation_id')
      .eq('user_id', otherUserId)
      .in('conversation_id', myConvoIds);

    if (otherConvos && otherConvos.length > 0) {
      // Check it's a 1:1 (not group)
      const { data: existing } = await supabase
        .from('internal_conversations')
        .select('*')
        .eq('id', otherConvos[0].conversation_id)
        .eq('is_group', false)
        .maybeSingle();

      if (existing) {
        // Send the message to existing conversation
        await sendInternalMessage(existing.id, firstMessage);
        return { ...existing, unread_count: 0, display_name: '' };
      }
    }
  }

  // Create new conversation
  const { data: convo, error: cErr } = await supabase
    .from('internal_conversations')
    .insert({ org_id: orgId, created_by: uid, is_group: false })
    .select('*')
    .single();

  if (cErr) throw cErr;

  // Add both participants
  await supabase.from('internal_conversation_participants').insert([
    { conversation_id: convo.id, user_id: uid },
    { conversation_id: convo.id, user_id: otherUserId },
  ]);

  // Send first message
  await sendInternalMessage(convo.id, firstMessage);

  return { ...convo, unread_count: 0, display_name: '' };
}

// ── Messages ──

export async function listInternalMessages(conversationId: string): Promise<InternalMessage[]> {
  const { data, error } = await supabase
    .from('internal_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (!data) return [];

  // Resolve sender names
  const senderIds = [...new Set(data.map(m => m.sender_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', senderIds);

  const nameMap = new Map((profiles || []).map(p => [p.id, p.full_name || 'Unknown']));

  return data.map(m => ({
    ...m,
    sender_name: nameMap.get(m.sender_id) || 'Unknown',
  }));
}

export async function sendInternalMessage(conversationId: string, text: string): Promise<InternalMessage> {
  const uid = await getMyUserId();

  const { data, error } = await supabase
    .from('internal_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: uid,
      message_text: text.trim(),
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const uid = await getMyUserId();
  await supabase
    .from('internal_conversation_participants')
    .update({ unread_count: 0, last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', uid);
}

// ── Team members list (for starting new conversations) ──

const SALES_ROLES = ['owner', 'admin', 'manager', 'sales_rep'];

export async function listSalesTeamMembers(): Promise<TeamMemberOption[]> {
  const orgId = await getMyOrgId();
  const uid = await getMyUserId();

  const { data: members, error } = await supabase
    .from('memberships')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .in('role', SALES_ROLES)
    .neq('user_id', uid);

  if (error) throw error;
  if (!members || members.length === 0) return [];

  const userIds = members.map(m => m.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds);

  const nameMap = new Map((profiles || []).map(p => [p.id, p.full_name || '']));

  return members.map(m => ({
    user_id: m.user_id,
    full_name: nameMap.get(m.user_id) || m.role,
    role: m.role,
  }));
}
