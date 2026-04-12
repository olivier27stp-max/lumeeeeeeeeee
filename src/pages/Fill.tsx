/* ═══════════════════════════════════════════════════════════════
   Page — Fill (Internal Sales Team Messaging)
   Same layout as Messages — but for internal team conversations only.
   Access: sales_rep, manager, admin, owner
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MessageSquare,
  Search,
  Send,
  ArrowLeft,
  Plus,
  Users,
  X,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { useTranslation } from '../i18n';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';
import PermissionGate from '../components/PermissionGate';
import {
  listInternalConversations,
  listInternalMessages,
  sendInternalMessage,
  markConversationRead,
  createConversation,
  listSalesTeamMembers,
  type InternalConversation,
  type InternalMessage,
  type TeamMemberOption,
} from '../lib/internalMessagingApi';

// ─── New Internal Conversation Modal ────────────────────────────────
function NewConversationModal({
  open,
  onClose,
  onSend,
  fr,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (userId: string, message: string) => Promise<void>;
  fr: boolean;
}) {
  const [members, setMembers] = useState<TeamMemberOption[]>([]);
  const [search, setSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<TeamMemberOption | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelectedMember(null);
      setMessage('');
      return;
    }
    setLoadingMembers(true);
    listSalesTeamMembers()
      .then(setMembers)
      .catch(() => toast.error(fr ? 'Erreur chargement équipe' : 'Failed to load team'))
      .finally(() => setLoadingMembers(false));
  }, [open, fr]);

  const filtered = search
    ? members.filter(m => m.full_name.toLowerCase().includes(search.toLowerCase()))
    : members;

  const handleSend = async () => {
    if (!selectedMember || !message.trim()) return;
    setSending(true);
    try {
      await onSend(selectedMember.user_id, message.trim());
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Error');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const roleLabel = (role: string) => {
    const map: Record<string, string> = fr
      ? { owner: 'Propriétaire', admin: 'Admin', manager: 'Gestionnaire', sales_rep: 'Vendeur' }
      : { owner: 'Owner', admin: 'Admin', manager: 'Manager', sales_rep: 'Sales Rep' };
    return map[role] || role;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-surface rounded-2xl border border-outline shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline">
          <h3 className="text-[15px] font-bold text-text-primary">
            {fr ? 'Nouvelle conversation' : 'New Conversation'}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-tertiary text-text-tertiary">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Member search */}
          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
              {fr ? 'Membre de l\'équipe' : 'Team member'}
            </label>
            {selectedMember ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg text-[13px]">
                <UnifiedAvatar id={selectedMember.user_id} name={selectedMember.full_name} size={24} />
                <span className="font-medium text-text-primary">{selectedMember.full_name}</span>
                <span className="text-[11px] text-text-tertiary">({roleLabel(selectedMember.role)})</span>
                <button onClick={() => { setSelectedMember(null); setSearch(''); }} className="ml-auto text-text-tertiary hover:text-danger">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={fr ? 'Rechercher un membre...' : 'Search member...'}
                  className="glass-input w-full"
                />
                <div className="mt-1 border border-outline rounded-xl overflow-hidden bg-surface max-h-48 overflow-y-auto">
                  {loadingMembers ? (
                    <div className="p-4 text-center"><Loader2 size={16} className="animate-spin mx-auto text-text-tertiary" /></div>
                  ) : filtered.length === 0 ? (
                    <div className="p-3 text-center text-[13px] text-text-tertiary">
                      {fr ? 'Aucun membre trouvé' : 'No members found'}
                    </div>
                  ) : (
                    filtered.map((m) => (
                      <button
                        key={m.user_id}
                        className="w-full text-left px-3 py-2.5 hover:bg-surface-tertiary text-[13px] flex items-center gap-2.5"
                        onClick={() => { setSelectedMember(m); setSearch(''); }}
                      >
                        <UnifiedAvatar id={m.user_id} name={m.full_name} size={28} />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-text-primary block truncate">{m.full_name}</span>
                          <span className="text-[11px] text-text-tertiary">{roleLabel(m.role)}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Message */}
          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder={fr ? 'Écrivez votre message...' : 'Type your message...'}
              className="glass-input w-full resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="glass-button text-[13px] px-4 py-2">
            {fr ? 'Annuler' : 'Cancel'}
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !selectedMember || !message.trim()}
            className="glass-button-primary text-[13px] px-4 py-2 flex items-center gap-2 disabled:opacity-50"
          >
            <Send size={13} />
            {sending ? (fr ? 'Envoi...' : 'Sending...') : (fr ? 'Envoyer' : 'Send')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Time formatting (same as Messages) ─────────────────────────────
function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatFullTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// ─── Main Fill Page ─────────────────────────────────────────────────
export default function Fill() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const [conversations, setConversations] = useState<InternalConversation[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<InternalConversation | null>(null);
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Get current user id
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id || null));
  }, []);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const data = await listInternalConversations();
      setConversations(data);
    } catch (err: any) {
      console.error('Failed to load internal conversations:', err);
    } finally {
      setLoadingConvos(false);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Real-time: internal_messages + internal_conversations
  useEffect(() => {
    const channel = supabase
      .channel('internal-msg-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'internal_messages' }, (payload) => {
        const newMsg = payload.new as InternalMessage;
        if (selectedConvo && newMsg.conversation_id === selectedConvo.id) {
          setMessages((prev) => {
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
        loadConversations();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'internal_conversations' }, () => {
        loadConversations();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedConvo, loadConversations]);

  // Load messages when conversation selected
  useEffect(() => {
    if (!selectedConvo) { setMessages([]); return; }
    let cancelled = false;

    const load = async () => {
      setLoadingMessages(true);
      try {
        const data = await listInternalMessages(selectedConvo.id);
        if (!cancelled) setMessages(data);
        if ((selectedConvo.unread_count || 0) > 0) {
          await markConversationRead(selectedConvo.id);
          loadConversations();
        }
      } catch (err: any) {
        if (!cancelled) toast.error(fr ? 'Erreur de chargement' : 'Failed to load messages');
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [selectedConvo?.id]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message
  const handleSend = async () => {
    if (!newMessage.trim() || !selectedConvo || sending) return;
    const text = newMessage.trim();
    setNewMessage('');
    setSending(true);

    try {
      const msg = await sendInternalMessage(selectedConvo.id, text);
      setMessages((prev) => [...prev, { ...msg, sender_name: 'You' }]);
      loadConversations();
    } catch (err: any) {
      toast.error(err?.message || (fr ? "Erreur d'envoi" : 'Failed to send'));
      setNewMessage(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // New conversation
  const handleNewConvoSend = async (userId: string, messageText: string) => {
    await createConversation(userId, messageText);
    const convos = await listInternalConversations();
    setConversations(convos);
    // Select the most recent one (just created)
    if (convos.length > 0) setSelectedConvo(convos[0]);
  };

  // Keyboard: Enter to send
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Filter
  const filteredConvos = conversations.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.display_name || '').toLowerCase().includes(q) ||
      (c.last_message_text || '').toLowerCase().includes(q)
    );
  });

  // Group messages by date
  const groupedMessages: Array<{ date: string; messages: InternalMessage[] }> = [];
  let currentDateKey = '';
  for (const msg of messages) {
    const dateKey = new Date(msg.created_at).toDateString();
    if (dateKey !== currentDateKey) {
      currentDateKey = dateKey;
      groupedMessages.push({ date: msg.created_at, messages: [msg] });
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg);
    }
  }

  return (
    <PermissionGate
      anyPermission={['door_to_door.access', 'clients.create']}
      fallback={
        <div className="flex items-center justify-center h-[60vh]">
          <div className="text-center">
            <Users size={40} className="mx-auto text-text-tertiary opacity-30 mb-3" />
            <h2 className="text-[16px] font-bold text-text-primary">{fr ? 'Accès restreint' : 'Access Restricted'}</h2>
            <p className="text-[13px] text-text-tertiary mt-1">{fr ? 'Réservé à l\'équipe de vente et gestionnaires.' : 'Reserved for the sales team and managers.'}</p>
          </div>
        </div>
      }
    >
    <>
      <div className="bg-surface rounded-2xl border border-border overflow-hidden flex" style={{ height: 'calc(100vh - 180px)' }}>

        {/* ── Left: Conversation Sidebar ── */}
        <div className={cn(
          "w-[300px] border-r border-border flex flex-col shrink-0 bg-surface",
          selectedConvo ? "hidden md:flex" : "flex w-full md:w-[300px]"
        )}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div className="flex items-center gap-2">
              <Users size={18} className="text-text-secondary" />
              <h2 className="text-[20px] font-bold text-text-primary">{fr ? 'Fil interne' : 'Team Feed'}</h2>
            </div>
            <button
              onClick={() => setShowNewModal(true)}
              className="w-[30px] h-[30px] rounded-full border border-border flex items-center justify-center hover:bg-surface-secondary transition-colors"
            >
              <Plus size={16} className="text-text-secondary" />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 pb-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={fr ? 'Rechercher une conversation...' : 'Search conversations...'}
                className="w-full h-[36px] pl-9 pr-3 rounded-lg bg-surface-secondary border-0 text-[13px] text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-border"
              />
            </div>
          </div>

          {/* Conversations list */}
          <div className="flex-1 overflow-y-auto">
            {loadingConvos ? (
              <div className="p-6 text-center">
                <div className="w-5 h-5 border-2 border-border border-t-text-primary rounded-full animate-spin mx-auto" />
              </div>
            ) : filteredConvos.length === 0 ? (
              <div className="p-6 text-center text-text-tertiary text-[13px]">
                {searchQuery ? (fr ? 'Aucun résultat' : 'No results found') : (fr ? 'Aucune conversation' : 'No conversations yet')}
                {!searchQuery && (
                  <button
                    onClick={() => setShowNewModal(true)}
                    className="mt-3 text-text-primary font-semibold hover:underline block mx-auto"
                  >
                    {fr ? 'Démarrer une conversation' : 'Start a conversation'}
                  </button>
                )}
              </div>
            ) : (
              filteredConvos.map((convo) => {
                const hasUnread = (convo.unread_count || 0) > 0;
                const isActive = selectedConvo?.id === convo.id;

                return (
                  <button
                    key={convo.id}
                    onClick={() => setSelectedConvo(convo)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-[12px] transition-colors text-left',
                      isActive ? 'bg-surface-secondary' : 'bg-surface hover:bg-surface-secondary'
                    )}
                  >
                    <UnifiedAvatar id={convo.other_user_id || convo.id} name={convo.display_name || ''} size={40} />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn(
                          'text-[14px] truncate leading-tight',
                          hasUnread ? 'font-bold text-text-primary' : 'font-semibold text-text-primary'
                        )}>
                          {convo.display_name}
                        </span>
                        {convo.last_message_at && (
                          <span className="text-[12px] text-text-tertiary shrink-0 leading-tight">
                            {formatMessageTime(convo.last_message_at)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-[3px]">
                        <p className={cn(
                          'text-[13px] truncate leading-tight',
                          hasUnread ? 'text-text-secondary font-medium' : 'text-text-secondary'
                        )}>
                          {convo.last_message_text || (fr ? 'Nouvelle conversation' : 'New conversation')}
                        </p>

                        {hasUnread && (
                          <span className="bg-[#22C55E] text-white text-[11px] font-bold rounded-full min-w-[20px] h-[20px] flex items-center justify-center px-[6px] shrink-0">
                            {convo.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: Conversation Thread or Empty State ── */}
        <div className={cn(
          "flex-1 flex flex-col bg-surface",
          !selectedConvo ? "hidden md:flex" : "flex"
        )}>
          {!selectedConvo ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <img src="https://api.dicebear.com/9.x/notionists/svg?seed=team-feed-empty&size=300&backgroundColor=transparent" alt="" width={200} height={200} className="mx-auto" />
                <p className="mt-4 text-[14px] text-text-tertiary">{fr ? 'Sélectionnez une conversation' : 'Select a conversation'}</p>
              </div>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-surface shrink-0">
                <button
                  onClick={() => setSelectedConvo(null)}
                  className="md:hidden p-1 rounded-lg hover:bg-surface-secondary text-text-secondary"
                >
                  <ArrowLeft size={18} />
                </button>
                <UnifiedAvatar id={selectedConvo.other_user_id || selectedConvo.id} name={selectedConvo.display_name || ''} size={36} />
                <div className="flex-1 min-w-0">
                  <h3 className="text-[14px] font-bold text-text-primary truncate">
                    {selectedConvo.display_name}
                  </h3>
                  <p className="text-[11px] text-text-secondary flex items-center gap-1">
                    <Users size={10} />
                    {fr ? 'Conversation interne' : 'Internal conversation'}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-5 h-5 border-2 border-border border-t-text-primary rounded-full animate-spin" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-12 text-text-tertiary text-[13px]">
                    {fr ? 'Aucun message encore' : 'No messages yet'}
                  </div>
                ) : (
                  groupedMessages.map((group, gIdx) => (
                    <div key={gIdx}>
                      <div className="flex items-center justify-center my-4">
                        <span className="text-[11px] text-text-secondary bg-surface px-3 py-1 rounded-full font-medium border border-border">
                          {formatDateSeparator(group.date)}
                        </span>
                      </div>
                      {group.messages.map((msg) => {
                        const isMe = msg.sender_id === myUserId;
                        return (
                          <div key={msg.id} className={cn("flex mb-2", isMe ? "justify-end" : "justify-start")}>
                            {!isMe && (
                              <div className="shrink-0 mr-2 mt-auto">
                                <UnifiedAvatar id={msg.sender_id} name={msg.sender_name || ''} size={28} />
                              </div>
                            )}
                            <div className={cn(
                              "max-w-[75%] rounded-2xl px-4 py-2.5",
                              isMe
                                ? "bg-primary text-white rounded-br-md"
                                : "bg-surface border border-border text-text-primary rounded-bl-md"
                            )}>
                              {!isMe && (
                                <p className="text-[11px] font-semibold mb-0.5 text-text-secondary">
                                  {msg.sender_name}
                                </p>
                              )}
                              <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                                {msg.message_text}
                              </p>
                              <div className={cn("flex items-center gap-1 mt-1", isMe ? "justify-end" : "justify-start")}>
                                <span className={cn("text-[10px]", isMe ? "text-white/50" : "text-text-tertiary")}>
                                  {formatFullTime(msg.created_at)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              <div className="px-4 py-3 border-t border-border bg-surface shrink-0">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder={fr ? 'Écrivez un message...' : 'Type a message...'}
                    className="flex-1 resize-none text-[13px] min-h-[40px] max-h-[120px] px-3 py-2.5 rounded-lg bg-surface-secondary border-0 text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-border"
                    style={{ height: 'auto', overflow: 'auto' }}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement;
                      target.style.height = 'auto';
                      target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                    }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!newMessage.trim() || sending}
                    className={cn(
                      "p-2.5 rounded-xl transition-all shrink-0",
                      newMessage.trim() && !sending
                        ? "bg-primary text-white hover:bg-primary-hover"
                        : "bg-surface-secondary text-text-tertiary"
                    )}
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showNewModal && (
          <NewConversationModal
            open={showNewModal}
            onClose={() => setShowNewModal(false)}
            onSend={handleNewConvoSend}
            fr={fr}
          />
        )}
      </AnimatePresence>
    </>
    </PermissionGate>
  );
}
