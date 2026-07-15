/* ═══════════════════════════════════════════════════════════════
   EventsPanel — Unified "EVENTS" feed for a client or job.
   Merges three sources into one chronological timeline:
     1. activity_log  (business events: invoice/quote/job/payment…)
     2. communications (emails & SMS, incl. bounced)
     3. activity_notes (free-text notes added via "Add a note")
   Plus: add-note input, condensed/detailed toggle, realtime updates.
   Additive — does not replace existing timelines.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Edit2, RefreshCw, ArrowRight, Archive, Trash2,
  Send, Check, X, Calendar, Briefcase, CheckCircle,
  FileText, ReceiptText, AlertCircle, Bell, Mail,
  MessageCircle, Star, StickyNote, Search, CreditCard,
  Paperclip, PanelRightClose,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchActivityLog, EVENT_TYPE_LABELS, type ActivityLogEntry } from '../../lib/activityApi';
import { fetchCommunications, type CommunicationMessage } from '../../lib/communicationsApi';
import { fetchNotes, addNote, deleteNote, type ActivityNote } from '../../lib/activityNotesApi';
import { formatDate } from '../../lib/utils';
import { useTranslation } from '../../i18n';
import { toast } from 'sonner';

const ICON_MAP: Record<string, React.ReactNode> = {
  plus: <Plus size={14} />, edit: <Edit2 size={14} />, refresh: <RefreshCw size={14} />,
  'arrow-right': <ArrowRight size={14} />, archive: <Archive size={14} />, trash: <Trash2 size={14} />,
  send: <Send size={14} />, check: <Check size={14} />, x: <X size={14} />,
  calendar: <Calendar size={14} />, 'calendar-x': <Calendar size={14} />, briefcase: <Briefcase size={14} />,
  'check-circle': <CheckCircle size={14} />, 'file-text': <FileText size={14} />,
  'receipt-text': <ReceiptText size={14} />, 'alert-circle': <AlertCircle size={14} />,
  bell: <Bell size={14} />, mail: <Mail size={14} />, 'message-circle': <MessageCircle size={14} />,
  star: <Star size={14} />, note: <StickyNote size={14} />, 'credit-card': <CreditCard size={14} />,
};

const EVENT_COLORS: Record<string, string> = {
  invoice_created: 'bg-blue-100 text-blue-600',
  invoice_sent: 'bg-indigo-100 text-indigo-600',
  invoice_paid: 'bg-green-100 text-green-600',
  invoice_overdue: 'bg-red-100 text-red-600',
  invoice_reminded: 'bg-amber-100 text-amber-600',
  estimate_sent: 'bg-indigo-100 text-indigo-600',
  quote_sent: 'bg-indigo-100 text-indigo-600',
  quote_approved: 'bg-green-100 text-green-600',
  quote_declined: 'bg-red-100 text-red-600',
  job_created: 'bg-neutral-100 text-neutral-600',
  job_completed: 'bg-green-100 text-green-600',
  appointment_created: 'bg-sky-100 text-sky-600',
  status_changed: 'bg-surface-secondary text-text-secondary',
  lead_converted: 'bg-green-100 text-green-600',
  note: 'bg-amber-100 text-amber-600',
  email: 'bg-blue-100 text-blue-600',
  email_bounced: 'bg-red-100 text-red-600',
  sms: 'bg-sky-100 text-sky-600',
};

// A unified row that can come from any of the 3 sources.
interface FeedItem {
  key: string;
  kind: 'event' | 'email' | 'sms' | 'note';
  eventType: string;          // for color/label lookup
  title: string;
  detail?: string;
  actorName?: string | null;
  timestamp: string;
  colorKey: string;
  iconKey: string;
  noteId?: string;            // for delete
  email?: CommunicationMessage; // for expandable email card
}

interface EventsPanelProps {
  entityType: 'client' | 'job';
  entityId: string;
  clientId?: string; // when on a job, its client (lets notes/comms merge)
}

function eventLabel(eventType: string, lang: 'en' | 'fr'): string {
  const info = EVENT_TYPE_LABELS[eventType];
  if (info) return lang === 'fr' ? info.fr : info.en;
  return eventType.replace(/_/g, ' ');
}

export default function EventsPanel({ entityType, entityId, clientId }: EventsPanelProps) {
  const { t, language } = useTranslation();
  const lang = (language === 'fr' ? 'fr' : 'en') as 'en' | 'fr';
  const tp = t.eventsPanel;

  const [events, setEvents] = useState<ActivityLogEntry[]>([]);
  const [comms, setComms] = useState<CommunicationMessage[]>([]);
  const [notes, setNotes] = useState<ActivityNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [condensed, setCondensed] = useState(true);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  const commClientId = clientId || (entityType === 'client' ? entityId : undefined);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [ev, cm, nt] = await Promise.all([
        fetchActivityLog(entityType, entityId, { limit: 50 }).catch(() => [] as ActivityLogEntry[]),
        fetchCommunications({
          job_id: entityType === 'job' ? entityId : undefined,
          client_id: commClientId,
          limit: 50,
        }).catch(() => [] as CommunicationMessage[]),
        fetchNotes(entityType, entityId).catch(() => [] as ActivityNote[]),
      ]);
      if (!cancelled) {
        setEvents(ev);
        setComms(cm);
        setNotes(nt);
        setLoading(false);
      }
    }

    load();

    // Realtime: new activity_log rows for this entity or related.
    const channel = supabase
      .channel(`events-${entityType}-${entityId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, (payload) => {
        const e = payload.new as ActivityLogEntry;
        if (
          (e.entity_type === entityType && e.entity_id === entityId) ||
          (e.related_entity_type === entityType && e.related_entity_id === entityId)
        ) {
          setEvents((prev) => [e, ...prev]);
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [entityType, entityId, commClientId]);

  // Merge the three sources into one sorted feed.
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];

    for (const e of events) {
      items.push({
        key: `ev-${e.id}`,
        kind: 'event',
        eventType: e.event_type,
        title: eventLabel(e.event_type, lang),
        detail: e.event_type === 'status_changed'
          ? `${e.metadata?.old_status || '?'} › ${e.metadata?.new_status || '?'}`
          : (e.metadata?.invoice_number ? `#${e.metadata.invoice_number}`
            : e.metadata?.amount_cents ? `$${(Number(e.metadata.amount_cents) / 100).toFixed(2)}` : ''),
        timestamp: e.created_at,
        colorKey: e.event_type,
        iconKey: EVENT_TYPE_LABELS[e.event_type]?.icon || 'plus',
      });
    }

    for (const m of comms) {
      const isEmail = m.channel_type === 'email';
      const bounced = m.status === 'bounced' || m.status === 'failed';
      const label = isEmail
        ? (bounced ? (lang === 'fr' ? 'Courriel non livré' : 'Email bounced')
          : (lang === 'fr' ? 'Courriel envoyé' : 'Email sent'))
        : (lang === 'fr' ? 'SMS' : 'SMS');
      items.push({
        key: `cm-${m.id}`,
        kind: isEmail ? 'email' : 'sms',
        eventType: bounced ? 'email_bounced' : (isEmail ? 'email' : 'sms'),
        title: label,
        detail: m.subject || (m.body_text ? m.body_text.slice(0, 60) : ''),
        timestamp: m.created_at,
        colorKey: bounced ? 'email_bounced' : (isEmail ? 'email' : 'sms'),
        iconKey: isEmail ? (bounced ? 'alert-circle' : 'mail') : 'message-circle',
        email: isEmail ? m : undefined,
      });
    }

    for (const n of notes) {
      items.push({
        key: `nt-${n.id}`,
        kind: 'note',
        eventType: 'note',
        title: lang === 'fr' ? 'Note' : 'Note',
        detail: n.body,
        timestamp: n.created_at,
        colorKey: 'note',
        iconKey: 'note',
        noteId: n.id,
      });
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return items.filter((i) =>
        i.title.toLowerCase().includes(q) || (i.detail || '').toLowerCase().includes(q));
    }
    return items;
  }, [events, comms, notes, lang, search]);

  async function handleAddNote() {
    const body = noteDraft.trim();
    if (!body || adding) return;
    setAdding(true);
    try {
      const created = await addNote(entityType, entityId, body);
      setNotes((prev) => [created, ...prev]);
      setNoteDraft('');
    } catch (err: any) {
      toast.error(err?.message || (lang === 'fr' ? 'Échec de l\'ajout' : 'Failed to add note'));
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteNote(id: string) {
    try {
      await deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err: any) {
      toast.error(err?.message || (lang === 'fr' ? 'Échec de la suppression' : 'Failed to delete'));
    }
  }

  return (
    <div className="section-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-outline flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
          {tp.title}
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSearch((s) => !s)}
            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
            title={tp.search}
          >
            <Search size={14} />
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
            title={collapsed ? tp.expand : tp.collapse}
          >
            <PanelRightClose size={14} className={collapsed ? 'rotate-180' : ''} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Add note + search */}
          <div className="px-5 py-3 border-b border-outline-subtle space-y-2.5">
            <div className="flex items-center gap-2">
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddNote(); }}
                placeholder={tp.addNotePlaceholder}
                className="flex-1 text-[13px] px-3 py-2 rounded-lg border border-outline bg-surface-secondary text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                onClick={handleAddNote}
                disabled={!noteDraft.trim() || adding}
                className="text-[12px] font-semibold px-3 py-2 rounded-lg bg-primary text-white disabled:opacity-40 hover:bg-primary/90 transition-colors shrink-0"
              >
                {tp.add}
              </button>
            </div>
            {showSearch && (
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tp.search}
                className="w-full text-[13px] px-3 py-2 rounded-lg border border-outline bg-surface-secondary text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
            <div className="flex items-center justify-end gap-2">
              <span className="text-[11px] text-text-tertiary">{tp.condensedView}</span>
              <button
                onClick={() => setCondensed((c) => !c)}
                className={`relative w-9 h-5 rounded-full transition-colors ${condensed ? 'bg-primary' : 'bg-surface-tertiary'}`}
                role="switch"
                aria-checked={condensed}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${condensed ? 'translate-x-4' : ''}`} />
              </button>
            </div>
          </div>

          {/* Feed */}
          <div className="p-4 max-h-[600px] overflow-y-auto">
            {loading ? (
              <div className="animate-pulse space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-surface-secondary" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3 bg-surface-secondary rounded w-3/4" />
                      <div className="h-2 bg-surface-secondary rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : feed.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-6">{tp.noEventsYet}</p>
            ) : (
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
                <div className="space-y-3">
                  {feed.map((item) => {
                    const colorClass = EVENT_COLORS[item.colorKey] || 'bg-gray-100 text-gray-500';
                    const isEmailExpanded = !condensed && item.email && expandedEmail === item.key;
                    return (
                      <div key={item.key} className="flex gap-3 relative pl-1 group">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 ${colorClass}`}>
                          {ICON_MAP[item.iconKey] || <Plus size={14} />}
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[13px] font-semibold text-text-primary">{item.title}</p>
                            <span className="text-[10px] text-text-tertiary shrink-0 mt-0.5">
                              {formatDate(item.timestamp)}
                            </span>
                          </div>
                          {item.detail && (
                            <p className={`text-[12px] text-text-secondary mt-0.5 ${condensed ? 'line-clamp-1' : 'whitespace-pre-wrap'}`}>
                              {item.detail}
                            </p>
                          )}
                          {item.actorName && (
                            <p className="text-[11px] text-text-tertiary mt-0.5">{tp.by} {item.actorName}</p>
                          )}

                          {/* Expandable email card (detailed view only) */}
                          {item.email && !condensed && (
                            <div className="mt-2 rounded-lg border border-outline-subtle bg-surface-secondary p-3">
                              <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 uppercase">Email</span>
                                {(item.email.status === 'bounced' || item.email.status === 'failed') && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 uppercase">Bounce</span>
                                )}
                                {Array.isArray((item.email.metadata as any)?.attachments) && (item.email.metadata as any).attachments.length > 0 && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary flex items-center gap-1">
                                    <Paperclip size={10} />
                                    {(item.email.metadata as any).attachments.length} {tp.attachment}
                                  </span>
                                )}
                              </div>
                              {item.email.to_value && (
                                <p className="text-[11px] text-text-tertiary"><span className="font-semibold">{tp.to}:</span> {item.email.to_value}</p>
                              )}
                              {item.email.subject && (
                                <p className="text-[11px] text-text-tertiary"><span className="font-semibold">{tp.subject}:</span> {item.email.subject}</p>
                              )}
                              {item.email.body_text && (
                                <p className="text-[11px] text-text-secondary mt-1.5 whitespace-pre-wrap line-clamp-6">{item.email.body_text}</p>
                              )}
                            </div>
                          )}

                          {/* Note delete */}
                          {item.noteId && (
                            <button
                              onClick={() => handleDeleteNote(item.noteId!)}
                              className="mt-1 text-[10px] text-text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              {tp.delete}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
