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
  BellRing,
  Inbox,
  CheckCircle2,
  XCircle,
  Archive,
  AlertCircle,
  StickyNote,
  Star,
  RotateCcw,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import { useTranslation } from '../i18n';
import {
  desktopNotificationsSupported,
  desktopNotificationPermission,
  desktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
  requestDesktopNotificationPermission,
  showDesktopNotification,
} from '../lib/desktopNotifications';
import { toast } from 'sonner';

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
  request_created: { icon: Inbox, color: 'text-entity-request bg-entity-request/10' },
  lead_updated: { icon: Edit3, color: 'text-text-secondary bg-surface-tertiary' },
  job_created: { icon: Briefcase, color: 'text-entity-job bg-entity-job/10' },
  job_updated: { icon: Edit3, color: 'text-entity-job bg-entity-job/10' },
  // Devis — événements des triggers DB (migration 20260747000000)
  quote_created: { icon: FileText, color: 'text-entity-quote bg-entity-quote/10' },
  quote_updated: { icon: Edit3, color: 'text-entity-quote bg-entity-quote/10' },
  quote_sent: { icon: Send, color: 'text-entity-quote bg-entity-quote/10' },
  quote_approved: { icon: CheckCircle2, color: 'text-success bg-success/10' },
  quote_accepted: { icon: CheckCircle2, color: 'text-success bg-success/10' },
  quote_declined: { icon: XCircle, color: 'text-danger bg-danger/10' },
  quote_changes_requested: { icon: Edit3, color: 'text-warning bg-warning/10' },
  quote_archived: { icon: Archive, color: 'text-entity-quote bg-entity-quote/10' },
  quote_deleted: { icon: Trash2, color: 'text-entity-quote bg-entity-quote/10' },
  quote_opened: { icon: Eye, color: 'text-entity-quote bg-entity-quote/10' },
  // Factures
  invoice_created: { icon: FileText, color: 'text-entity-invoice bg-entity-invoice/10' },
  invoice_updated: { icon: Edit3, color: 'text-entity-invoice bg-entity-invoice/10' },
  invoice_sent: { icon: Send, color: 'text-entity-invoice bg-entity-invoice/10' },
  invoice_paid: { icon: CheckCircle2, color: 'text-success bg-success/10' },
  invoice_deleted: { icon: Trash2, color: 'text-entity-invoice bg-entity-invoice/10' },
  // Paiements (manuels et automatiques)
  payment_received: { icon: CreditCard, color: 'text-success bg-success/10' },
  payment_failed: { icon: AlertCircle, color: 'text-danger bg-danger/10' },
  payment_refunded: { icon: RotateCcw, color: 'text-warning bg-warning/10' },
  payment_updated: { icon: Edit3, color: 'text-entity-invoice bg-entity-invoice/10' },
  payment_deleted: { icon: Trash2, color: 'text-entity-invoice bg-entity-invoice/10' },
  // Notes, avis, cartes
  note_created: { icon: StickyNote, color: 'text-text-secondary bg-surface-tertiary' },
  note_deleted: { icon: Trash2, color: 'text-text-secondary bg-surface-tertiary' },
  review_received: { icon: Star, color: 'text-warning bg-warning/10' },
  card_saved: { icon: CreditCard, color: 'text-primary bg-primary/10' },
  message_sent: { icon: MessageSquare, color: 'text-text-secondary bg-surface-tertiary' },
  message_received: { icon: MessageSquare, color: 'text-text-secondary bg-surface-tertiary' },
  task_completed: { icon: CheckSquare, color: 'text-text-secondary bg-surface-tertiary' },
  event_created: { icon: Calendar, color: 'text-text-secondary bg-surface-tertiary' },
};

// Libellés localisés par type. Les notifications créées par les triggers DB
// portent un titre français générique — quand le type est connu ici, on le
// remplace par le libellé dans la langue de l'utilisateur.
const TYPE_LABELS: Record<string, { fr: string; en: string }> = {
  client_created: { fr: 'Nouveau client', en: 'New client' },
  client_updated: { fr: 'Client modifié', en: 'Client updated' },
  client_deleted: { fr: 'Client supprimé', en: 'Client deleted' },
  lead_created: { fr: 'Nouveau lead', en: 'New lead' },
  lead_updated: { fr: 'Lead modifié', en: 'Lead updated' },
  job_created: { fr: 'Nouveau job', en: 'New job' },
  job_updated: { fr: 'Job modifié', en: 'Job updated' },
  quote_created: { fr: 'Devis créé', en: 'Quote created' },
  quote_updated: { fr: 'Devis modifié', en: 'Quote updated' },
  quote_sent: { fr: 'Devis envoyé', en: 'Quote sent' },
  quote_approved: { fr: 'Devis approuvé', en: 'Quote approved' },
  quote_declined: { fr: 'Devis refusé', en: 'Quote declined' },
  quote_changes_requested: { fr: 'Modifications demandées', en: 'Changes requested' },
  quote_archived: { fr: 'Devis archivé', en: 'Quote archived' },
  quote_deleted: { fr: 'Devis supprimé', en: 'Quote deleted' },
  quote_opened: { fr: 'Devis ouvert', en: 'Quote opened' },
  invoice_created: { fr: 'Facture créée', en: 'Invoice created' },
  invoice_updated: { fr: 'Facture modifiée', en: 'Invoice updated' },
  invoice_sent: { fr: 'Facture envoyée', en: 'Invoice sent' },
  invoice_paid: { fr: 'Facture payée', en: 'Invoice paid' },
  invoice_deleted: { fr: 'Facture supprimée', en: 'Invoice deleted' },
  payment_received: { fr: 'Paiement reçu', en: 'Payment received' },
  payment_failed: { fr: 'Paiement échoué', en: 'Payment failed' },
  payment_refunded: { fr: 'Paiement remboursé', en: 'Payment refunded' },
  payment_updated: { fr: 'Paiement modifié', en: 'Payment updated' },
  payment_deleted: { fr: 'Paiement supprimé', en: 'Payment deleted' },
  note_created: { fr: 'Note ajoutée', en: 'Note added' },
  note_deleted: { fr: 'Note supprimée', en: 'Note deleted' },
  review_received: { fr: 'Avis client reçu', en: 'Client review received' },
  card_saved: { fr: 'Carte enregistrée', en: 'Card saved' },
  message_sent: { fr: 'Message envoyé', en: 'Message sent' },
  message_received: { fr: 'Message reçu', en: 'Message received' },
  task_completed: { fr: 'Tâche complétée', en: 'Task completed' },
  event_created: { fr: 'Événement créé', en: 'Event created' },
};

function getLabel(type: string, name: string, lang: string): { title: string; subtitle: string } {
  const l = TYPE_LABELS[type] || { fr: type, en: type };
  return {
    title: lang === 'fr' ? l.fr : l.en,
    subtitle: name,
  };
}

/** Titre d'une notification : libellé localisé si le type est connu, sinon le titre stocké. */
function notifTitle(type: string, storedTitle: string, lang: string): string {
  const l = TYPE_LABELS[type];
  return l ? (lang === 'fr' ? l.fr : l.en) : storedTitle;
}

export default function ActivityCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(() => desktopNotificationPermission());
  const [notifOn, setNotifOn] = useState<boolean>(() => desktopNotificationsEnabled());

  useEffect(() => {
    if (!open) return;
    loadActivities();
    // Mark all notifications as read when opening (scoped to current org)
    getCurrentOrgIdOrThrow().then(oid =>
      supabase.from('notifications').update({ is_read: true }).eq('org_id', oid).eq('is_read', false).then(() => {})
    ).catch(() => {});

    // Subscribe to realtime notifications so new ones appear while panel is open
    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const orgId = await getCurrentOrgIdOrThrow().catch(() => null);
      if (!orgId) return;
      channel = supabase
      .channel(`activity-center-realtime-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `org_id=eq.${orgId}` },
        (payload: { new: { id: string; type: string; title: string; body?: string; link?: string; created_at: string; is_read: boolean } }) => {
          const n = payload.new;
          const iconInfo = ICON_MAP[n.type] || { icon: Activity, color: 'text-text-tertiary bg-surface-tertiary' };
          const newItem: ActivityItem = {
            id: `notif-${n.id}`,
            type: n.type,
            icon: iconInfo.icon,
            iconColor: iconInfo.color,
            title: notifTitle(n.type, n.title, language),
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
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
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

      // Fetch recent leads (clients with status='lead')
      const { data: leads } = await supabase
        .from('clients')
        .select('id, first_name, last_name, created_at')
        .eq('org_id', orgId)
        .eq('status', 'lead')
        .is('deleted_at', null)
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

      // Factures et paiements : plus de scraping des tables — les triggers DB
      // (migration 20260747000000) journalisent créations, modifications,
      // envois, paiements (réussis ET échoués) et suppressions dans
      // notifications. Le scraping affichait les paiements échoués/supprimés
      // comme « Paiement reçu ».

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

      // Notifications : le journal d'événements (devis, factures, paiements,
      // notes, avis, cartes — via triggers DB) + les types historiques.
      const { data: notifications } = await supabase
        .from('notifications')
        .select('id, type, title, body, link, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(40);

      for (const n of notifications || []) {
        const iconInfo = ICON_MAP[n.type] || { icon: Activity, color: 'text-text-tertiary bg-surface-tertiary' };
        items.push({
          id: `notif-${n.id}`,
          type: n.type,
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title: notifTitle(n.type, n.title, language),
          subtitle: n.body || '',
          timestamp: n.created_at,
          link: n.link || undefined,
          actionLabel: n.link ? t.activityCenter.view : undefined,
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

            {/* Desktop notifications opt-in — fires native OS alerts when Lume
                is open but not the focused tab. Hidden once blocked at the browser level. */}
            {desktopNotificationsSupported() && notifPerm !== 'denied' && (
              <div className="px-6 py-3 border-b border-outline/60 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <BellRing size={14} className="text-primary shrink-0" />
                  <span className="text-[12px] text-text-secondary truncate">
                    {notifPerm === 'granted' && notifOn
                      ? (language === 'fr' ? 'Notifications bureau activées' : 'Desktop notifications on')
                      : (language === 'fr' ? 'Soyez alerté même sur un autre onglet' : 'Get alerted even on another tab')}
                  </span>
                </div>
                {notifPerm === 'granted' && notifOn ? (
                  <button
                    onClick={() => { setDesktopNotificationsEnabled(false); setNotifOn(false); }}
                    className="text-[11px] font-medium text-text-tertiary hover:text-text-primary shrink-0 transition-colors"
                  >
                    {language === 'fr' ? 'Désactiver' : 'Turn off'}
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      let perm: NotificationPermission = notifPerm;
                      if (perm === 'granted') {
                        setDesktopNotificationsEnabled(true);
                      } else {
                        perm = await requestDesktopNotificationPermission();
                        setNotifPerm(perm);
                      }
                      const enabled = desktopNotificationsEnabled();
                      setNotifOn(enabled);

                      if (enabled) {
                        // Immediate proof it works — force past the foreground guard.
                        showDesktopNotification({
                          title: 'Lume',
                          body: language === 'fr'
                            ? 'Notifications bureau activées ✅'
                            : 'Desktop notifications enabled ✅',
                          tag: 'lume-notif-test',
                          force: true,
                        });
                        toast.success(language === 'fr'
                          ? 'Notifications bureau activées'
                          : 'Desktop notifications enabled');
                      } else if (perm === 'denied') {
                        toast.error(language === 'fr'
                          ? 'Notifications bloquées dans le navigateur. Autorisez-les dans les réglages du site.'
                          : 'Notifications are blocked in the browser. Allow them in site settings.');
                      }
                    }}
                    className="text-[11px] font-semibold text-primary hover:underline shrink-0"
                  >
                    {language === 'fr' ? 'Activer' : 'Enable'}
                  </button>
                )}
              </div>
            )}

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
