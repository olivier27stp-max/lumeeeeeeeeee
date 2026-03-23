/* ═══════════════════════════════════════════════════════════════
   ActivityTimeline — Unified activity history for any entity.
   Shows a chronological timeline of events with real-time updates.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useState } from 'react';
import {
  Plus, Edit2, RefreshCw, ArrowRight, Archive, Trash2,
  Send, Check, X, Calendar, Briefcase, CheckCircle,
  FileText, DollarSign, AlertCircle, Bell, Mail,
  MessageCircle, Star,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchActivityLog, EVENT_TYPE_LABELS, type ActivityLogEntry } from '../lib/activityApi';
import { formatDate } from '../lib/utils';
import { useTranslation } from '../i18n';

const ICON_MAP: Record<string, React.ReactNode> = {
  plus: <Plus size={14} />,
  edit: <Edit2 size={14} />,
  refresh: <RefreshCw size={14} />,
  'arrow-right': <ArrowRight size={14} />,
  archive: <Archive size={14} />,
  trash: <Trash2 size={14} />,
  send: <Send size={14} />,
  check: <Check size={14} />,
  x: <X size={14} />,
  calendar: <Calendar size={14} />,
  'calendar-x': <Calendar size={14} />,
  briefcase: <Briefcase size={14} />,
  'check-circle': <CheckCircle size={14} />,
  'file-text': <FileText size={14} />,
  'dollar-sign': <DollarSign size={14} />,
  'alert-circle': <AlertCircle size={14} />,
  bell: <Bell size={14} />,
  mail: <Mail size={14} />,
  'message-circle': <MessageCircle size={14} />,
  star: <Star size={14} />,
};

const EVENT_COLORS: Record<string, string> = {
  lead_created: 'bg-neutral-100 text-neutral-600',
  lead_converted: 'bg-green-100 text-green-600',
  status_changed: 'bg-purple-100 text-purple-600',
  job_created: 'bg-neutral-100 text-neutral-600',
  job_completed: 'bg-green-100 text-green-600',
  invoice_paid: 'bg-green-100 text-green-600',
  invoice_overdue: 'bg-red-100 text-red-600',
  invoice_reminded: 'bg-amber-100 text-amber-600',
  estimate_sent: 'bg-indigo-100 text-indigo-600',
  estimate_accepted: 'bg-green-100 text-green-600',
  estimate_rejected: 'bg-red-100 text-red-600',
  client_archived: 'bg-gray-100 text-gray-600',
  client_deleted: 'bg-red-100 text-red-600',
  feedback_received: 'bg-amber-100 text-amber-600',
  review_requested: 'bg-yellow-100 text-yellow-600',
  follow_up_sent: 'bg-indigo-100 text-indigo-600',
};

interface ActivityTimelineProps {
  entityType: string;
  entityId: string;
}

function getEventDetail(entry: ActivityLogEntry, lang: 'en' | 'fr'): string {
  const meta = entry.metadata || {};

  if (entry.event_type === 'status_changed') {
    return lang === 'fr'
      ? `${meta.old_status || '?'} → ${meta.new_status || '?'}`
      : `${meta.old_status || '?'} → ${meta.new_status || '?'}`;
  }
  if (entry.event_type === 'lead_converted') {
    return meta.job_title ? `→ ${meta.job_title}` : '';
  }
  if (entry.event_type === 'invoice_reminded') {
    return meta.days_overdue ? `J+${meta.days_overdue}` : '';
  }
  if (entry.event_type === 'feedback_received') {
    return meta.rating ? `${meta.rating}/5` : '';
  }
  return '';
}

export default function ActivityTimeline({ entityType, entityId }: ActivityTimelineProps) {
  const { t, language } = useTranslation();
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await fetchActivityLog(entityType, entityId, { limit: 50 });
        if (!cancelled) setEntries(data);
      } catch (err) {
        console.error('[ActivityTimeline] fetch failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    // Real-time subscription
    const channel = supabase
      .channel(`activity-${entityType}-${entityId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'activity_log',
      }, (payload) => {
        const newEntry = payload.new as ActivityLogEntry;
        if (
          (newEntry.entity_type === entityType && newEntry.entity_id === entityId) ||
          (newEntry.related_entity_type === entityType && newEntry.related_entity_id === entityId)
        ) {
          setEntries((prev) => [newEntry, ...prev]);
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [entityType, entityId]);

  if (loading) {
    return (
      <div className="section-card p-4">
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
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="section-card p-4 text-center">
        <p className="text-sm text-text-tertiary">
          {t.activityTimeline.noActivityYet}
        </p>
      </div>
    );
  }

  return (
    <div className="section-card p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-4">
        {language === 'fr' ? 'Historique d\'activité' : 'Activity History'}
      </h3>
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

        <div className="space-y-4">
          {entries.map((entry) => {
            const eventInfo = EVENT_TYPE_LABELS[entry.event_type];
            const label = eventInfo
              ? (language === 'fr' ? eventInfo.fr : eventInfo.en)
              : entry.event_type;
            const iconKey = eventInfo?.icon || 'plus';
            const colorClass = EVENT_COLORS[entry.event_type] || 'bg-gray-100 text-gray-500';
            const detail = getEventDetail(entry, language as 'en' | 'fr');

            return (
              <div key={entry.id} className="flex gap-3 relative pl-1">
                {/* Icon */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 ${colorClass}`}>
                  {ICON_MAP[iconKey] || <Plus size={14} />}
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <p className="text-[13px] font-medium text-text-primary">
                    {label}
                    {detail && (
                      <span className="ml-1.5 text-text-secondary font-normal">{detail}</span>
                    )}
                  </p>
                  <p className="text-[11px] text-text-tertiary mt-0.5">
                    {formatDate(entry.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
