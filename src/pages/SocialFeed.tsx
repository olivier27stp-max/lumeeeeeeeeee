// Team chat (Messenger-style) wired to internal_conversations / internal_messages.
// Requires internal_team_messaging migrations applied (live in prod).
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Button } from '../components/d2d/button';
import { Avatar } from '../components/d2d/avatar';
import { getRepAvatar } from '../lib/constants/avatars';
import { cn } from '../lib/utils';
import { useCompany } from '../contexts/CompanyContext';
import {
  listConversations,
  createConversation,
  listMessages,
  markConversationRead,
  sendMessage as apiSendMessage,
  listParticipants,
  listOrgMembers,
  type InternalConversation,
  type InternalMessage,
  type OrgMember,
} from '../lib/internalMessagingApi';
import {
  Send,
  Search,
  Plus,
  ImageIcon,
  Users,
  X,
  Check,
  Loader2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays < 7) return d.toLocaleDateString('fr-CA', { weekday: 'short' });
  return d.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });
}

function displayNameFor(userId: string | null, members: Map<string, OrgMember>, fallback = 'Inconnu'): string {
  if (!userId) return fallback;
  const m = members.get(userId);
  return m?.full_name || userId.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Stacked avatars for groups
// ---------------------------------------------------------------------------

function StackedAvatars({
  userIds,
  members,
  max = 3,
  size = 'sm',
}: {
  userIds: string[];
  members: Map<string, OrgMember>;
  max?: number;
  size?: 'sm' | 'md';
}) {
  const shown = userIds.slice(0, max);
  const extra = userIds.length - max;
  const px = size === 'sm' ? 'h-6 w-6' : 'h-8 w-8';
  const offset = size === 'sm' ? 'ml-[-8px]' : 'ml-[-10px]';
  const textSize = size === 'sm' ? 'text-[8px]' : 'text-[9px]';

  return (
    <div className="flex items-center">
      {shown.map((id, i) => {
        const name = displayNameFor(id, members);
        return (
          <div key={id} className={cn(i > 0 && offset)} style={{ zIndex: shown.length - i }}>
            <Avatar
              name={name}
              src={getRepAvatar(name)}
              size={size}
              className={cn(px, 'ring-2 ring-white')}
            />
          </div>
        );
      })}
      {extra > 0 && (
        <div
          className={cn(
            offset,
            px,
            textSize,
            'flex items-center justify-center rounded-full bg-surface-elevated text-text-muted font-medium ring-2 ring-white',
          )}
          style={{ zIndex: 0 }}
        >
          +{extra}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function D2DSocialFeed() {
  const { currentOrgId, userId, loading: companyLoading } = useCompany();

  const [conversations, setConversations] = useState<InternalConversation[]>([]);
  const [participantsByConvo, setParticipantsByConvo] = useState<Record<string, string[]>>({});
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<string | null>(null);
  const [messagesByConvo, setMessagesByConvo] = useState<Record<string, InternalMessage[]>>({});

  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);

  const [messageInput, setMessageInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Create group modal
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Member lookup map (user_id → OrgMember)
  const membersMap = useMemo(() => {
    const m = new Map<string, OrgMember>();
    for (const om of orgMembers) m.set(om.user_id, om);
    return m;
  }, [orgMembers]);

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConvo) || null,
    [conversations, selectedConvo],
  );

  const chatMessages = selectedConvo ? (messagesByConvo[selectedConvo] || []) : [];
  const selectedParticipants = selectedConvo ? (participantsByConvo[selectedConvo] || []) : [];

  // Derive conversation display name (title or participants' names for DMs)
  const conversationTitle = useCallback(
    (convo: InternalConversation): string => {
      if (convo.title) return convo.title;
      const pIds = (participantsByConvo[convo.id] || []).filter((id) => id !== userId);
      if (pIds.length === 0) return '(conversation vide)';
      if (pIds.length === 1) return displayNameFor(pIds[0], membersMap);
      return pIds.map((id) => displayNameFor(id, membersMap)).join(', ');
    },
    [participantsByConvo, membersMap, userId],
  );

  // ── Load org members ────────────────────────────────────────────────
  useEffect(() => {
    if (!currentOrgId) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listOrgMembers(currentOrgId);
        if (!cancelled) setOrgMembers(rows);
      } catch (err) {
        console.error('[SocialFeed] failed to load org members', err);
        if (!cancelled) toast.error('Impossible de charger les membres de l\'équipe');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentOrgId]);

  // ── Load conversations + their participants ─────────────────────────
  const refreshConversations = useCallback(async () => {
    if (!currentOrgId) return;
    setLoadingConversations(true);
    try {
      const convos = await listConversations(currentOrgId);
      setConversations(convos);

      // Fetch participants for each convo in parallel
      const entries = await Promise.all(
        convos.map(async (c) => {
          try {
            const parts = await listParticipants(c.id);
            return [c.id, parts.map((p) => p.user_id)] as const;
          } catch {
            return [c.id, [] as string[]] as const;
          }
        }),
      );
      const byId: Record<string, string[]> = {};
      for (const [id, ids] of entries) byId[id] = ids;
      setParticipantsByConvo(byId);
    } catch (err) {
      console.error('[SocialFeed] failed to load conversations', err);
      toast.error('Impossible de charger les conversations');
    } finally {
      setLoadingConversations(false);
    }
  }, [currentOrgId]);

  useEffect(() => {
    if (!currentOrgId) return;
    void refreshConversations();
  }, [currentOrgId, refreshConversations]);

  // ── Load messages when a conversation is selected ───────────────────
  const loadMessages = useCallback(
    async (convoId: string) => {
      setLoadingMessages(true);
      try {
        const msgs = await listMessages(convoId);
        setMessagesByConvo((prev) => ({ ...prev, [convoId]: msgs }));
        if (userId) {
          try {
            await markConversationRead(convoId, userId);
          } catch (err) {
            console.warn('[SocialFeed] markConversationRead failed', err);
          }
        }
      } catch (err) {
        console.error('[SocialFeed] failed to load messages', err);
        toast.error('Impossible de charger les messages');
      } finally {
        setLoadingMessages(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    if (!selectedConvo) return;
    void loadMessages(selectedConvo);
  }, [selectedConvo, loadMessages]);

  // TODO: subscribe to Supabase Realtime channels on `internal_messages` filtered
  // by `conversation_id=in.(...)` to receive new messages live. For now we rely
  // on refetch after send and on next selection.

  // ── Auto-scroll to bottom on new messages ───────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  // ── Filtered conversation list ──────────────────────────────────────
  const filteredConversations = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return conversations.filter((c) => conversationTitle(c).toLowerCase().includes(q));
  }, [conversations, searchQuery, conversationTitle]);

  // ── Handlers ────────────────────────────────────────────────────────
  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function handleSendMessage() {
    if (!selectedConvo || !userId) return;
    const text = messageInput.trim();
    if (!text) return; // TODO: upload image to Supabase storage + attach URL when ready
    setSending(true);
    try {
      const msg = await apiSendMessage(selectedConvo, userId, text);
      setMessagesByConvo((prev) => ({
        ...prev,
        [selectedConvo]: [...(prev[selectedConvo] || []), msg],
      }));
      // Optimistic bump of conversation preview; authoritative value comes from DB trigger on refresh.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedConvo
            ? { ...c, last_message_text: text, last_message_at: msg.created_at }
            : c,
        ),
      );
      setMessageInput('');
      setImagePreview(null);
    } catch (err) {
      console.error('[SocialFeed] sendMessage failed', err);
      toast.error('Envoi du message échoué');
    } finally {
      setSending(false);
    }
  }

  function toggleMember(id: string) {
    setSelectedMembers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  }

  async function handleCreateGroup() {
    if (!currentOrgId || !userId) return;
    if (!groupName.trim() || selectedMembers.length < 2) return;
    setCreatingGroup(true);
    try {
      const created = await createConversation({
        org_id: currentOrgId,
        created_by: userId,
        participant_user_ids: selectedMembers,
        title: groupName.trim(),
        is_group: true,
      });
      await refreshConversations();
      setSelectedConvo(created.id);
      setShowCreateGroup(false);
      setGroupName('');
      setSelectedMembers([]);
      setMemberSearch('');
      toast.success('Groupe créé');
    } catch (err) {
      console.error('[SocialFeed] createGroup failed', err);
      toast.error('Création du groupe échouée');
    } finally {
      setCreatingGroup(false);
    }
  }

  const filteredContactsForPicker = useMemo(() => {
    const q = memberSearch.toLowerCase();
    return orgMembers
      .filter((m) => m.user_id !== userId)
      .filter((m) => (m.full_name || m.user_id).toLowerCase().includes(q));
  }, [orgMembers, memberSearch, userId]);

  // ── Render ──────────────────────────────────────────────────────────

  if (companyLoading) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!currentOrgId) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center text-[12px] text-text-muted">
        Aucune organisation active.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] relative">
      <div className="flex flex-1 min-h-0 relative">

        {/* ================================================================ */}
        {/* LEFT — Conversation list */}
        {/* ================================================================ */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-border-subtle">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2.5">
            <h2 className="text-[13px] font-semibold text-text-primary">Messages</h2>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowCreateGroup(true)}
              title="Créer un groupe"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {/* Search */}
          <div className="px-3 py-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border-subtle bg-surface-elevated px-2 py-1">
              <Search className="h-3 w-3 text-text-muted" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-[11px] text-text-primary placeholder:text-text-muted outline-none"
              />
            </div>
          </div>

          {/* Conversation items */}
          <div className="flex-1 overflow-y-auto">
            {loadingConversations ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="px-3 py-8 text-center text-[11px] text-text-muted">
                Aucune conversation. Créez un groupe pour commencer.
              </div>
            ) : (
              filteredConversations.map((convo) => {
                const name = conversationTitle(convo);
                const pIds = participantsByConvo[convo.id] || [];
                const lastTime = formatTime(convo.last_message_at);
                return (
                  <button
                    key={convo.id}
                    onClick={() => setSelectedConvo(convo.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors',
                      selectedConvo === convo.id
                        ? 'bg-surface-elevated'
                        : 'hover:bg-surface-hover',
                    )}
                  >
                    <div className="relative shrink-0">
                      {convo.is_group ? (
                        <StackedAvatars userIds={pIds} members={membersMap} max={3} size="sm" />
                      ) : (
                        <Avatar name={name} src={getRepAvatar(name)} size="sm" />
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] font-medium text-text-primary truncate">{name}</p>
                        <span className="shrink-0 text-[9px] text-text-muted">{lastTime}</span>
                      </div>
                      <p className="truncate text-[10px] text-text-muted">
                        {convo.last_message_text || '(aucun message)'}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ================================================================ */}
        {/* RIGHT — Chat */}
        {/* ================================================================ */}
        <div className="flex flex-1 flex-col">
          {/* Chat header */}
          {selectedConversation && (
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                {selectedConversation.is_group ? (
                  <StackedAvatars userIds={selectedParticipants} members={membersMap} max={3} size="sm" />
                ) : (
                  <Avatar
                    name={conversationTitle(selectedConversation)}
                    src={getRepAvatar(conversationTitle(selectedConversation))}
                    size="sm"
                  />
                )}
                <div>
                  <p className="text-[12px] font-semibold text-text-primary">
                    {conversationTitle(selectedConversation)}
                  </p>
                  {selectedConversation.is_group && (
                    <p className="text-[10px] text-text-muted">
                      {selectedParticipants.length} membres
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2.5">
            {!selectedConvo ? (
              <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                Sélectionnez une conversation pour commencer.
              </div>
            ) : loadingMessages && chatMessages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                Aucun message pour l'instant.
              </div>
            ) : (
              chatMessages.map((msg) => {
                const isOwn = msg.sender_id === userId;
                const senderName = displayNameFor(msg.sender_id, membersMap);
                const timeStr = formatTime(msg.created_at);
                return (
                  <div
                    key={msg.id}
                    className={cn('flex', isOwn ? 'justify-end' : 'justify-start')}
                  >
                    <div className={cn('flex max-w-[65%] gap-2', isOwn && 'flex-row-reverse')}>
                      {!isOwn && (
                        <Avatar
                          name={senderName}
                          src={getRepAvatar(senderName)}
                          size="sm"
                          className="!h-6 !w-6 mt-0.5"
                        />
                      )}
                      <div>
                        {!isOwn && selectedConversation?.is_group && (
                          <p className="mb-0.5 text-[9px] font-medium text-text-muted">{senderName}</p>
                        )}
                        <div
                          className={cn(
                            'rounded-lg px-3 py-2',
                            isOwn
                              ? 'bg-text-primary text-surface rounded-br-sm'
                              : 'bg-surface-elevated text-text-primary rounded-bl-sm',
                          )}
                        >
                          <p className="text-[12px] leading-relaxed">{msg.message_text}</p>
                        </div>
                        <p className={cn('mt-0.5 text-[9px] text-text-muted', isOwn ? 'text-right' : 'text-left')}>
                          {timeStr}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Message input */}
          {selectedConvo && (
            <div className="border-t border-border-subtle p-3">
              {/* Image preview — TODO: upload to Supabase storage before send */}
              {imagePreview && (
                <div className="mb-2 flex items-start gap-2">
                  <div className="relative">
                    <img src={imagePreview} alt="Preview" className="h-20 w-20 rounded-lg object-cover border border-border-subtle" />
                    <button
                      onClick={() => setImagePreview(null)}
                      className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-error text-white text-[8px] shadow"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageSelect}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                  title="Envoyer une photo (bientôt)"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                </button>
                <div className="flex flex-1 items-center rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2">
                  <input
                    type="text"
                    placeholder="Écrire un message..."
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendMessage();
                      }
                    }}
                    disabled={sending}
                    className="w-full bg-transparent text-[12px] text-text-primary placeholder:text-text-muted outline-none disabled:opacity-50"
                  />
                </div>
                <Button
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  disabled={!messageInput.trim() || sending}
                  onClick={() => void handleSendMessage()}
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ================================================================ */}
        {/* Create Group Modal */}
        {/* ================================================================ */}
        {showCreateGroup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowCreateGroup(false)}>
            <div
              className="w-[380px] rounded-xl border border-border-subtle bg-white p-5 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[14px] font-semibold text-text-primary">Créer un groupe</h3>
                <button onClick={() => setShowCreateGroup(false)} className="rounded-md p-1 text-text-muted hover:bg-surface-hover">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Group name */}
              <div className="mb-3">
                <label className="mb-1 block text-[11px] font-medium text-text-secondary">Nom du groupe</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Ex: Équipe Sunset Valley"
                  className="w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted outline-none focus:border-outline-strong"
                />
              </div>

              {/* Selected members */}
              {selectedMembers.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {selectedMembers.map((id) => {
                    const name = displayNameFor(id, membersMap);
                    return (
                      <span
                        key={id}
                        className="flex items-center gap-1 rounded-full bg-surface-tertiary px-2 py-0.5 text-[10px] font-medium text-text-primary"
                      >
                        {name}
                        <button onClick={() => toggleMember(id)} className="hover:text-text-secondary">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Search members */}
              <div className="mb-2">
                <div className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-elevated px-2.5 py-1.5">
                  <Search className="h-3 w-3 text-text-muted" />
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Rechercher un membre..."
                    className="w-full bg-transparent text-[11px] text-text-primary placeholder:text-text-muted outline-none"
                  />
                </div>
              </div>

              {/* Contact list */}
              <div className="max-h-[200px] overflow-y-auto rounded-lg border border-border-subtle">
                {filteredContactsForPicker.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[10px] text-text-muted">
                    Aucun membre trouvé.
                  </div>
                ) : (
                  filteredContactsForPicker.map((contact) => {
                    const isSelected = selectedMembers.includes(contact.user_id);
                    const name = contact.full_name || contact.user_id.slice(0, 8);
                    return (
                      <button
                        key={contact.user_id}
                        onClick={() => toggleMember(contact.user_id)}
                        className={cn(
                          'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-hover',
                          isSelected && 'bg-surface-secondary',
                        )}
                      >
                        <Avatar name={name} src={getRepAvatar(name)} size="sm" className="!h-7 !w-7" />
                        <div className="flex-1">
                          <p className="text-[11px] font-medium text-text-primary">{name}</p>
                        </div>
                        {isSelected && (
                          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-text-primary text-surface">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Create button */}
              <Button
                className="mt-4 w-full"
                disabled={!groupName.trim() || selectedMembers.length < 2 || creatingGroup}
                onClick={() => void handleCreateGroup()}
              >
                {creatingGroup ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Users className="mr-1.5 h-3.5 w-3.5" />
                )}
                Créer le groupe ({selectedMembers.length} membres)
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
