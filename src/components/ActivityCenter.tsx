import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  UserPlus,
  FileText,
  Briefcase,
  CreditCard,
  Send,
  Trash2,
  Edit3,
  MessageSquare,
  Contact,
  CheckSquare,
  Calendar,
  Activity,
  Eye,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { useTranslation } from '../i18n';

interface ActivityItem {
  id: string;
  type: string;
  icon: typeof Activity;
  iconColor: string;
  title: string;
  subtitle: string;
  timestamp: string;
  link?: string;
  actionLabel?: string;
}

function timeAgo(dateStr: string, lang: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);

  if (lang === 'fr') {
    if (diffSec < 60) return 'À l\'instant';
    if (diffMin < 60) return `Il y a ${diffMin} min`;
    if (diffHour < 24) return `Il y a ${diffHour}h`;
    if (diffDay === 1) return 'Hier';
    if (diffDay < 7) return `Il y a ${diffDay} jours`;
    if (diffWeek < 4) return `Il y a ${diffWeek} sem.`;
    return date.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });
  }

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay === 1) return 'Yesterday';
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffWeek < 4) return `${diffWeek}w ago`;
  return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}

const ICON_MAP: Record<string, { icon: typeof Activity; color: string }> = {
  client_created: { icon: UserPlus, color: 'text-success bg-success/10' },
  client_updated: { icon: Edit3, color: 'text-primary bg-primary/10' },
  client_deleted: { icon: Trash2, color: 'text-danger bg-danger/10' },
  lead_created: { icon: Contact, color: 'text-text-secondary bg-surface-tertiary' },
  lead_updated: { icon: Edit3, color: 'text-text-secondary bg-surface-tertiary' },
  job_created: { icon: Briefcase, color: 'text-text-secondary bg-surface-tertiary' },
  job_updated: { icon: Edit3, color: 'text-text-secondary bg-surface-tertiary' },
  invoice_created: { icon: FileText, color: 'text-success bg-success/10' },
  invoice_sent: { icon: Send, color: 'text-primary bg-primary/10' },
  payment_received: { icon: CreditCard, color: 'text-success bg-success/10' },
  message_sent: { icon: MessageSquare, color: 'text-text-secondary bg-surface-tertiary' },
  message_received: { icon: MessageSquare, color: 'text-text-secondary bg-surface-tertiary' },
  task_completed: { icon: CheckSquare, color: 'text-text-secondary bg-surface-tertiary' },
  quote_opened: { icon: Eye, color: 'text-text-secondary bg-surface-tertiary' },
  event_created: { icon: Calendar, color: 'text-text-secondary bg-surface-tertiary' },
};

function getLabel(type: string, name: string, lang: string): { title: string; subtitle: string } {
  const labels: Record<string, { fr: string; en: string }> = {
    client_created: { fr: 'Nouveau client', en: 'New client' },
    client_updated: { fr: 'Client modifié', en: 'Client updated' },
    client_deleted: { fr: 'Client supprimé', en: 'Client deleted' },
    lead_created: { fr: 'Nouveau lead', en: 'New lead' },
    lead_updated: { fr: 'Lead modifié', en: 'Lead updated' },
    job_created: { fr: 'Nouveau job', en: 'New job' },
    job_updated: { fr: 'Job modifié', en: 'Job updated' },
    invoice_created: { fr: 'Facture créée', en: 'Invoice created' },
    invoice_sent: { fr: 'Facture envoyée', en: 'Invoice sent' },
    payment_received: { fr: 'Paiement reçu', en: 'Payment received' },
    message_sent: { fr: 'Message envoyé', en: 'Message sent' },
    message_received: { fr: 'Message reçu', en: 'Message received' },
    task_completed: { fr: 'Tâche complétée', en: 'Task completed' },
    event_created: { fr: 'Événement créé', en: 'Event created' },
    quote_opened: { fr: 'Devis ouvert', en: 'Quote opened' },
  };

  const l = labels[type] || { fr: type, en: type };
  return {
    title: lang === 'fr' ? l.fr : l.en,
    subtitle: name,
  };
}

export default function ActivityCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    loadActivities();
    // Mark all notifications as read when opening (scoped to current org)
    getCurrentOrgIdOrThrow().then(oid =>
      supabase.from('notifications').update({ is_read: true }).eq('org_id', oid).eq('is_read', false).then(() => {})
    ).catch(() => {});

    // Subscribe to realtime notifications so new ones appear while panel is open
    const channel = supabase
      .channel('activity-center-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload: { new: { id: string; type: string; title: string; body?: string; link?: string; created_at: string; is_read: boolean } }) => {
          const n = payload.new;
          const iconInfo = ICON_MAP[n.type] || { icon: Activity, color: 'text-text-tertiary bg-surface-tertiary' };
          const newItem: ActivityItem = {
            id: `notif-${n.id}`,
            type: n.type,
            icon: iconInfo.icon,
            iconColor: iconInfo.color,
            title: n.title,
            subtitle: n.body || '',
            timestamp: n.created_at,
            link: n.link || undefined,
            actionLabel: n.link ? (t.activityCenter.view) : undefined,
          };
          setActivities((prev) => [newItem, ...prev].slice(0, 50));
          // Mark as read immediately since panel is open
          supabase.from('notifications').update({ is_read: true }).eq('id', n.id).then(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open]);

  async function loadActivities() {
    setLoading(true);
    try {
      const orgId = await getCurrentOrgIdOrThrow();
      const items: ActivityItem[] = [];

      // Fetch recent clients
      const { data: clients } = await supabase
        .from('clients')
        .select('id, first_name, last_name, created_at, updated_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10);

      for (const c of clients || []) {
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim();
        const isNew = new Date(c.updated_at).getTime() - new Date(c.created_at).getTime() < 5000;
        const type = isNew ? 'client_created' : 'client_updated';
        const label = getLabel(type, name, language);
        const iconInfo = ICON_MAP[type];
        items.push({
          id: `client-${c.id}`,
          type,
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title: label.title,
          subtitle: label.subtitle,
          timestamp: isNew ? c.created_at : c.updated_at,
          link: `/clients/${c.id}`,
          actionLabel: t.activityCenter.viewClient,
        });
      }

      // Fetch recent leads
      const { data: leads } = await supabase
        .from('leads')
        .select('id, first_name, last_name, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(8);

      for (const l of leads || []) {
        const name = `${l.first_name || ''} ${l.last_name || ''}`.trim();
        const label = getLabel('lead_created', name, language);
        const iconInfo = ICON_MAP['lead_created'];
        items.push({
          id: `lead-${l.id}`,
          type: 'lead_created',
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title: label.title,
          subtitle: label.subtitle,
          timestamp: l.created_at,
        });
      }

      // Fetch recent jobs
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, title, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(8);

      for (const j of jobs || []) {
        const label = getLabel('job_created', j.title || '', language);
        const iconInfo = ICON_MAP['job_created'];
        items.push({
          id: `job-${j.id}`,
          type: 'job_created',
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title: label.title,
          subtitle: label.subtitle,
          timestamp: j.created_at,
        });
      }

      // Fetch recent invoices
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, invoice_number, status, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(8);

      for (const inv of invoices || []) {
        const type = inv.status === 'sent' ? 'invoice_sent' : 'invoice_created';
        const label = getLabel(type, `#${inv.invoice_number || inv.id.slice(0, 8)}`, language);
        const iconInfo = ICON_MAP[type];
        items.push({
          id: `inv-${inv.id}`,
          type,
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title: label.title,
          subtitle: label.subtitle,
          timestamp: inv.created_at,
        });
      }

      // Fetch recent messages
      const { data: msgs } = await supabase
        .from('messages')
        .select('id, direction, phone_number, message_text, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(8);

      for (const m of msgs || []) {
        const type = m.direction === 'outbound' ? 'message_sent' : 'message_received';
        const preview = (m.message_text || '').slice(0, 40) + ((m.message_text || '').length > 40 ? '...' : '');
        const label = getLabel(type, preview, language);
        const iconInfo = ICON_MAP[type];
        items.push({
          id: `msg-${m.id}`,
          type,
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title: label.title,
          subtitle: label.subtitle,
          timestamp: m.created_at,
        });
      }

      // Fetch recent payments
      const { data: payments } = await supabase
        .from('payments')
        .select('id, amount_cents, currency, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(5);

      for (const p of payments || []) {
        const amount = ((p.amount_cents || 0) / 100).toFixed(2);
        const label = getLabel('payment_received', `$${amount} ${p.currency || 'CAD'}`, language);
        const iconInfo = ICON_MAP['payment_received'];
        items.push({
          id: `pay-${p.id}`,
          type: 'payment_received',
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title: label.title,
          subtitle: label.subtitle,
          timestamp: p.created_at,
        });
      }

      // Fetch notifications (quote opens, etc.)
      const { data: notifications } = await supabase
        .from('notifications')
        .select('id, type, title, body, link, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(10);

      for (const n of notifications || []) {
        const iconInfo = ICON_MAP[n.type] || { icon: Activity, color: 'text-text-tertiary bg-surface-tertiary' };
        items.push({
          id: `notif-${n.id}`,
          type: n.type,
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title: n.title,
          subtitle: n.body || '',
          timestamp: n.created_at,
        });
      }

      // Sort all by timestamp descending
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setActivities(items.slice(0, 50));
    } catch (err) {
      console.error('Failed to load activities:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20"
            onClick={onClose}
          />
          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-[400px] max-w-[90vw] bg-surface border-l border-outline/60 shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-outline/60">
              <div className="flex items-center gap-3">
                <Activity size={16} className="text-primary" />
                <h2 className="text-xl font-bold text-text-primary">
                  {language === 'fr' ? 'Centre d\'activités' : 'Activity Center'}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Activity list */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-10 flex justify-center">
                  <div className="w-5 h-5 border-2 border-outline-subtle border-t-text-primary rounded-full animate-spin" />
                </div>
              ) : activities.length === 0 ? (
                <div className="p-10 text-center text-text-tertiary text-[13px]">
                  {t.activityCenter.noRecentActivity}
                </div>
              ) : (
                <div className="py-3">
                  {activities.map((item, idx) => (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-start gap-3.5 px-6 py-3.5 transition-all duration-150",
                        item.link ? "hover:bg-surface-tertiary/50 cursor-pointer" : "",
                      )}
                      onClick={item.link ? () => { navigate(item.link!); onClose(); } : undefined}
                    >
                      <div className={cn("w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 mt-0.5", item.iconColor)}>
                        <item.icon size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold text-text-primary">{item.title}</p>
                        <p className="text-[12px] text-text-tertiary truncate mt-0.5">{item.subtitle}</p>
                        {item.actionLabel && item.link && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(item.link!); onClose(); }}
                            className="mt-1.5 text-[11px] font-bold text-primary hover:text-primary/80 transition-colors"
                          >
                            {item.actionLabel}
                          </button>
                        )}
                      </div>
                      <span className="text-[10px] font-medium text-text-tertiary shrink-0 mt-1">
                        {timeAgo(item.timestamp, language)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
