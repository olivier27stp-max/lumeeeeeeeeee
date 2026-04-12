import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  MessageSquare,
  Search,
  Send,
  Phone,
  ArrowLeft,
  Check,
  CheckCheck,
  AlertCircle,
  Clock,
  Plus,
  User,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { useTranslation } from '../i18n';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';
import PermissionGate from '../components/PermissionGate';
import {
  fetchConversations,
  fetchMessages,
  sendSms,
  markConversationRead,
  formatPhoneDisplay,
  formatE164,
  type Conversation,
  type Message,
} from '../lib/messagingApi';

// ─── New Conversation Modal ──────────────────────────────────────────
function NewConversationModal({
  open,
  onClose,
  onSend,
  language,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (phone: string, message: string, clientId?: string, clientName?: string) => Promise<void>;
  language: string;
}) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<Array<{ id: string; first_name: string; last_name: string; phone: string | null }>>([]);
  const [selectedClient, setSelectedClient] = useState<typeof clients[0] | null>(null);

  useEffect(() => {
    if (!open) {
      setPhone('');
      setMessage('');
      setClientSearch('');
      setClients([]);
      setSelectedClient(null);
    }
  }, [open]);

  useEffect(() => {
    if (clientSearch.length < 2) { setClients([]); return; }
    const timeout = setTimeout(async () => {
      const orgId = await getCurrentOrgIdOrThrow();
      const { data } = await supabase
        .from('clients')
        .select('id, first_name, last_name, phone')
        .eq('org_id', orgId)
        .or(`first_name.ilike.%${clientSearch}%,last_name.ilike.%${clientSearch}%,phone.ilike.%${clientSearch}%`)
        .limit(8);
      setClients(data || []);
    }, 300);
    return () => clearTimeout(timeout);
  }, [clientSearch]);

  const handleSend = async () => {
    const targetPhone = selectedClient?.phone || phone;
    if (!targetPhone || !message.trim()) return;
    setSending(true);
    try {
      await onSend(
        targetPhone,
        message.trim(),
        selectedClient?.id,
        selectedClient ? `${selectedClient.first_name} ${selectedClient.last_name}`.trim() : undefined,
      );
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

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
            {t.messaging.newMessage}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-tertiary text-text-tertiary">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Client search */}
          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
              {t.messaging.searchClient}
            </label>
            <input
              type="text"
              value={clientSearch}
              onChange={(e) => { setClientSearch(e.target.value); setSelectedClient(null); }}
              placeholder={t.messaging.nameOrPhone}
              className="glass-input w-full"
            />
            {clients.length > 0 && !selectedClient && (
              <div className="mt-1 border border-outline rounded-xl overflow-hidden bg-surface max-h-40 overflow-y-auto">
                {clients.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 hover:bg-surface-tertiary text-[13px] flex justify-between"
                    onClick={() => {
                      setSelectedClient(c);
                      setPhone(c.phone || '');
                      setClientSearch(`${c.first_name} ${c.last_name}`);
                    }}
                  >
                    <span className="font-medium text-text-primary">{c.first_name} {c.last_name}</span>
                    <span className="text-text-tertiary">{c.phone ? formatPhoneDisplay(c.phone) : '—'}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedClient && (
              <div className="mt-1.5 flex items-center gap-2 px-3 py-1.5 bg-primary/5 border border-primary/20 rounded-lg text-[12px]">
                <User size={12} className="text-primary" />
                <span className="text-text-primary font-medium">{selectedClient.first_name} {selectedClient.last_name}</span>
                <button onClick={() => { setSelectedClient(null); setClientSearch(''); }} className="ml-auto text-text-tertiary hover:text-danger">
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Phone number */}
          {!selectedClient && (
            <div>
              <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">
                {t.messaging.phoneNumber}
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (819) 388-9150"
                className="glass-input w-full"
              />
            </div>
          )}

          {/* Message */}
          <div>
            <label className="block text-[12px] font-semibold text-text-secondary mb-1.5">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder={t.messaging.typeYourMessage}
              className="glass-input w-full resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-outline flex justify-end gap-2">
          <button onClick={onClose} className="glass-button text-[13px] px-4 py-2">
            {t.advancedNotes.cancel}
          </button>
          <button
            onClick={handleSend}
            disabled={sending || (!phone && !selectedClient?.phone) || !message.trim()}
            className="glass-button-primary text-[13px] px-4 py-2 flex items-center gap-2 disabled:opacity-50"
          >
            <Send size={13} />
            {sending ? (t.invoiceDetails.sending) : (t.invoices.send)}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Status Icon ─────────────────────────────────────────────────────
function MessageStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'delivered':
      return <CheckCheck size={12} className="text-primary" />;
    case 'sent':
      return <Check size={12} className="text-text-tertiary" />;
    case 'failed':
      return <AlertCircle size={12} className="text-danger" />;
    case 'queued':
      return <Clock size={12} className="text-text-tertiary" />;
    default:
      return null;
  }
}

// ─── Time formatting ─────────────────────────────────────────────────
function formatMessageTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatFullTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── Date separator ──────────────────────────────────────────────────
function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// ─── Main Messages Page ──────────────────────────────────────────────
export default function Messages() {
  const { t, language } = useTranslation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch (err: any) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoadingConvos(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Real-time subscription for new messages
  useEffect(() => {
    const channel = supabase
      .channel('messages-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const newMsg = payload.new as Message;
        // If we're viewing this conversation, add the message
        if (selectedConvo && newMsg.conversation_id === selectedConvo.id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
        // Refresh conversation list
        loadConversations();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
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
        const data = await fetchMessages(selectedConvo.id);
        if (!cancelled) setMessages(data);
        // Mark as read
        if (selectedConvo.unread_count > 0) {
          await markConversationRead(selectedConvo.id);
          loadConversations();
        }
      } catch (err: any) {
        if (!cancelled) toast.error(t.messaging.failedToLoadMessages);
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [selectedConvo?.id]);

  // Auto-scroll to bottom
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
      const msg = await sendSms({
        phone_number: selectedConvo.phone_number,
        message_text: text,
        client_id: selectedConvo.client_id || undefined,
        client_name: selectedConvo.client_name || undefined,
      });
      setMessages((prev) => [...prev, msg]);
      loadConversations();
    } catch (err: any) {
      toast.error(err?.message || (language === 'fr' ? 'Erreur d\'envoi' : 'Failed to send'));
      setNewMessage(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // New conversation send
  const handleNewConvoSend = async (phone: string, messageText: string, clientId?: string, clientName?: string) => {
    const msg = await sendSms({
      phone_number: phone,
      message_text: messageText,
      client_id: clientId,
      client_name: clientName,
    });
    // Single fetch — no duplicate
    const convos = await fetchConversations();
    setConversations(convos);
    const target = convos.find((c: any) => c.id === msg.conversation_id);
    if (target) setSelectedConvo(target);
  };

  // Keyboard: Enter to send (Shift+Enter for newline)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Filter conversations
  const filteredConvos = conversations.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.client_name || '').toLowerCase().includes(q) ||
      c.phone_number.includes(q) ||
      (c.last_message_text || '').toLowerCase().includes(q)
    );
  });

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);

  // Group messages by date
  const groupedMessages: Array<{ date: string; messages: Message[] }> = [];
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
    <PermissionGate permission="automations.update">
    <>
      {/* ── Full-height messaging layout matching reference ── */}
      <div className="bg-surface rounded-2xl border border-border overflow-hidden flex" style={{ height: 'calc(100vh - 180px)' }}>

        {/* ── Left: Conversation Sidebar ── */}
        <div className={cn(
          "w-[300px] border-r border-border flex flex-col shrink-0 bg-surface",
          selectedConvo ? "hidden md:flex" : "flex w-full md:w-[300px]"
        )}>
          {/* Header: Chats + New button */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="text-[20px] font-bold text-text-primary">{t.messaging.messages}</h2>
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
                placeholder={t.messaging.searchConversations}
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
                {searchQuery ? t.messaging.noResultsFound : t.messaging.noConversationsYet}
                {!searchQuery && (
                  <button
                    onClick={() => setShowNewModal(true)}
                    className="mt-3 text-text-primary font-semibold hover:underline block mx-auto"
                  >
                    {t.messaging.sendYourFirstMessage}
                  </button>
                )}
              </div>
            ) : (
              filteredConvos.map((convo) => {
                const hasUnread = (convo.unread_count || 0) > 0;
                const isActive = selectedConvo?.id === convo.id;
                const displayName = convo.client_name || formatPhoneDisplay(convo.phone_number);

                return (
                  <button
                    key={convo.id}
                    onClick={() => setSelectedConvo(convo)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-[12px] transition-colors text-left',
                      isActive ? 'bg-surface-secondary' : 'bg-surface hover:bg-surface-secondary'
                    )}
                  >
                    {/* Avatar — uses client_id so it matches the Clients tab */}
                    <UnifiedAvatar id={convo.client_id || convo.id} name={displayName} size={40} />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn(
                          'text-[14px] truncate leading-tight',
                          hasUnread ? 'font-bold text-text-primary' : 'font-semibold text-text-primary'
                        )}>
                          {displayName}
                        </span>
                        <span className="text-[12px] text-text-tertiary shrink-0 leading-tight">
                          {formatMessageTime(convo.last_message_at)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-[3px]">
                        <div className="flex items-center gap-1 min-w-0 flex-1">
                          <CheckCheck size={14} className="text-text-tertiary shrink-0" />
                          <p className={cn(
                            'text-[13px] truncate leading-tight',
                            hasUnread ? 'text-text-secondary font-medium' : 'text-text-secondary'
                          )}>
                            {convo.last_message_text || '—'}
                          </p>
                        </div>

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
            /* Empty state — centered illustration */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <img src="https://api.dicebear.com/9.x/notionists/svg?seed=messages-empty&size=300&backgroundColor=transparent" alt="" width={200} height={200} className="mx-auto" />
                <p className="mt-4 text-[14px] text-text-tertiary">{language === 'fr' ? 'Sélectionnez une conversation' : 'Select a conversation'}</p>
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
                <UnifiedAvatar id={selectedConvo.client_id || selectedConvo.id} name={selectedConvo.client_name || formatPhoneDisplay(selectedConvo.phone_number)} size={36} />
                <div className="flex-1 min-w-0">
                  <h3 className="text-[14px] font-bold text-text-primary truncate">
                    {selectedConvo.client_name || formatPhoneDisplay(selectedConvo.phone_number)}
                  </h3>
                  <p className="text-[11px] text-text-secondary flex items-center gap-1">
                    <Phone size={10} />
                    {formatPhoneDisplay(selectedConvo.phone_number)}
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
                    {t.messaging.noMessagesYet}
                  </div>
                ) : (
                  groupedMessages.map((group, gIdx) => (
                    <div key={gIdx}>
                      <div className="flex items-center justify-center my-4">
                        <span className="text-[11px] text-text-secondary bg-surface px-3 py-1 rounded-full font-medium border border-border">
                          {formatDateSeparator(group.date)}
                        </span>
                      </div>
                      {group.messages.map((msg) => (
                        <div key={msg.id} className={cn("flex mb-2", msg.direction === 'outbound' ? "justify-end" : "justify-start")}>
                          <div className={cn(
                            "max-w-[75%] rounded-2xl px-4 py-2.5",
                            msg.direction === 'outbound'
                              ? "bg-primary text-white rounded-br-md"
                              : "bg-surface border border-border text-text-primary rounded-bl-md"
                          )}>
                            <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                              {msg.message_text}
                            </p>
                            <div className={cn("flex items-center gap-1 mt-1", msg.direction === 'outbound' ? "justify-end" : "justify-start")}>
                              <span className={cn("text-[10px]", msg.direction === 'outbound' ? "text-white/50" : "text-text-tertiary")}>
                                {formatFullTime(msg.created_at)}
                              </span>
                              {msg.direction === 'outbound' && <MessageStatusIcon status={msg.status} />}
                            </div>
                          </div>
                        </div>
                      ))}
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
                    placeholder={t.messaging.typeAMessage}
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
            language={language}
          />
        )}
      </AnimatePresence>
    </>
    </PermissionGate>
  );
}
