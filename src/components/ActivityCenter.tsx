import React, { useEffect, useRef, useState } from 'react';
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
  SlidersHorizontal,
  Check,
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
}

interface NotifRow {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  created_at: string;
  actor_name?: string | null;
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

/** En-tête de groupe : Aujourd'hui / Hier / « mardi 15 juillet ». */
function dayLabel(dateStr: string, lang: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays <= 0) return lang === 'fr' ? 'Aujourd\'hui' : 'Today';
  if (diffDays === 1) return lang === 'fr' ? 'Hier' : 'Yesterday';
  return d.toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

// Icône nue (sans cercle ni fond) teintée couleur d'entité ou sémantique.
const ICON_MAP: Record<string, { icon: typeof Activity; color: string }> = {
  client_created: { icon: UserPlus, color: 'text-success' },
  client_updated: { icon: Edit3, color: 'text-text-tertiary' },
  client_deleted: { icon: Trash2, color: 'text-text-tertiary' },
  lead_created: { icon: Contact, color: 'text-text-tertiary' },
  lead_updated: { icon: Edit3, color: 'text-text-tertiary' },
  request_created: { icon: Inbox, color: 'text-entity-request' },
  job_created: { icon: Briefcase, color: 'text-entity-job' },
  job_updated: { icon: Edit3, color: 'text-entity-job' },
  quote_created: { icon: FileText, color: 'text-entity-quote' },
  quote_updated: { icon: Edit3, color: 'text-entity-quote' },
  quote_sent: { icon: Send, color: 'text-entity-quote' },
  quote_approved: { icon: CheckCircle2, color: 'text-success' },
  quote_accepted: { icon: CheckCircle2, color: 'text-success' },
  quote_declined: { icon: XCircle, color: 'text-danger' },
  quote_changes_requested: { icon: Edit3, color: 'text-warning' },
  quote_archived: { icon: Archive, color: 'text-entity-quote' },
  quote_deleted: { icon: Trash2, color: 'text-entity-quote' },
  quote_opened: { icon: Eye, color: 'text-entity-quote' },
  invoice_created: { icon: FileText, color: 'text-entity-invoice' },
  invoice_updated: { icon: Edit3, color: 'text-entity-invoice' },
  invoice_sent: { icon: Send, color: 'text-entity-invoice' },
  invoice_paid: { icon: CheckCircle2, color: 'text-success' },
  invoice_deleted: { icon: Trash2, color: 'text-entity-invoice' },
  payment_received: { icon: CreditCard, color: 'text-success' },
  payment_failed: { icon: AlertCircle, color: 'text-danger' },
  payment_refunded: { icon: RotateCcw, color: 'text-warning' },
  payment_updated: { icon: Edit3, color: 'text-entity-invoice' },
  payment_deleted: { icon: Trash2, color: 'text-entity-invoice' },
  note_created: { icon: StickyNote, color: 'text-text-secondary' },
  note_deleted: { icon: Trash2, color: 'text-text-secondary' },
  review_received: { icon: Star, color: 'text-warning' },
  card_saved: { icon: CreditCard, color: 'text-primary' },
  message_sent: { icon: MessageSquare, color: 'text-text-secondary' },
  message_received: { icon: MessageSquare, color: 'text-text-secondary' },
  task_completed: { icon: CheckSquare, color: 'text-text-secondary' },
  event_created: { icon: Calendar, color: 'text-entity-job' },
};

// Libellés localisés par type — fallback quand l'événement n'a pas d'acteur.
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
  quote_accepted: { fr: 'Devis approuvé', en: 'Quote approved' },
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

// Titres « acteur en premier » : « William Hébert a créé une facture ».
// payment_failed est volontairement absent — un échec d'autopay n'a pas
// d'acteur, on garde le libellé neutre.
const ACTOR_VERBS: Record<string, { fr: string; en: string }> = {
  quote_created: { fr: 'a créé un devis', en: 'created a quote' },
  quote_updated: { fr: 'a modifié un devis', en: 'updated a quote' },
  quote_sent: { fr: 'a envoyé un devis', en: 'sent a quote' },
  quote_approved: { fr: 'a approuvé un devis', en: 'approved a quote' },
  quote_accepted: { fr: 'a approuvé un devis', en: 'approved a quote' },
  quote_declined: { fr: 'a refusé un devis', en: 'declined a quote' },
  quote_changes_requested: { fr: 'a demandé des modifications', en: 'requested changes' },
  quote_archived: { fr: 'a archivé un devis', en: 'archived a quote' },
  quote_deleted: { fr: 'a supprimé un devis', en: 'deleted a quote' },
  invoice_created: { fr: 'a créé une facture', en: 'created an invoice' },
  invoice_updated: { fr: 'a modifié une facture', en: 'updated an invoice' },
  invoice_sent: { fr: 'a envoyé une facture', en: 'sent an invoice' },
  invoice_paid: { fr: 'a payé une facture', en: 'paid an invoice' },
  invoice_deleted: { fr: 'a supprimé une facture', en: 'deleted an invoice' },
  payment_received: { fr: 'a effectué un paiement', en: 'made a payment' },
  payment_refunded: { fr: 'a été remboursé', en: 'was refunded' },
  payment_updated: { fr: 'a modifié un paiement', en: 'edited a payment' },
  payment_deleted: { fr: 'a supprimé un paiement', en: 'deleted a payment' },
  note_created: { fr: 'a ajouté une note', en: 'added a note' },
  note_deleted: { fr: 'a supprimé une note', en: 'deleted a note' },
  review_received: { fr: 'a laissé un avis', en: 'left a review' },
  card_saved: { fr: 'a enregistré une carte', en: 'saved a card' },
};

// ── Customize center : les 11 catégories, toutes visibles par défaut ──
const CATEGORIES: Array<{ key: string; fr: string; en: string }> = [
  { key: 'clients', fr: 'Clients', en: 'Clients' },
  { key: 'requests', fr: 'Demandes', en: 'Requests' },
  { key: 'quotes', fr: 'Devis', en: 'Quotes' },
  { key: 'jobs', fr: 'Jobs', en: 'Jobs' },
  { key: 'visits', fr: 'Visites', en: 'Visits' },
  { key: 'invoices', fr: 'Factures', en: 'Invoices' },
  { key: 'payments', fr: 'Paiements', en: 'Payments' },
  { key: 'notes', fr: 'Notes', en: 'Notes' },
  { key: 'reviews', fr: 'Avis', en: 'Reviews' },
  { key: 'marketing', fr: 'Marketing', en: 'Marketing' },
  { key: 'timesheets', fr: 'Feuilles de temps', en: 'Timesheets' },
];

/** Catégorie d'un type d'événement — null = toujours visible (non catégorisé). */
function categoryOf(type: string): string | null {
  if (type.startsWith('client_') || type.startsWith('lead_')) return 'clients';
  if (type.startsWith('request_')) return 'requests';
  if (type.startsWith('quote_')) return 'quotes';
  if (type.startsWith('job_')) return 'jobs';
  if (type.startsWith('visit_') || type === 'event_created') return 'visits';
  if (type.startsWith('invoice_')) return 'invoices';
  if (type.startsWith('payment_') || type === 'card_saved') return 'payments';
  if (type.startsWith('note_')) return 'notes';
  if (type === 'review_received') return 'reviews';
  if (type.startsWith('campaign_') || type.startsWith('marketing_')) return 'marketing';
  if (type.startsWith('timesheet_') || type.startsWith('timeclock_')) return 'timesheets';
  return null;
}

const HIDDEN_KEY = 'lume-activity-center-hidden';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extrait le dernier montant $X du body pour le remonter dans le titre. */
function extractAmount(body: string): { amount: string | null; rest: string } {
  const matches = body.match(/\$[\d,]+(?:\.\d{2})?/g);
  if (!matches) return { amount: null, rest: body };
  const amount = matches[matches.length - 1];
  let rest = body.replace(new RegExp('\\s*·\\s*' + escapeRegExp(amount)), '');
  rest = rest.replace(new RegExp('^' + escapeRegExp(amount) + '\\s*·\\s*'), '');
  if (rest.trim() === amount) rest = '';
  return { amount, rest };
}

/** Compose l'item affiché à partir d'une ligne notifications. */
function buildNotifItem(n: NotifRow, language: string): ActivityItem {
  const iconInfo = ICON_MAP[n.type] || { icon: Activity, color: 'text-text-tertiary' };
  const { amount, rest } = extractAmount(n.body || '');
  const actor = (n.actor_name || '').trim() || null;

  // Ligne 2 : le body, sans le montant (remonté au titre) ni l'acteur (déjà au titre).
  let subtitle = rest;
  if (actor && subtitle) {
    subtitle = subtitle
      .replace(new RegExp('\\s*·\\s*' + escapeRegExp(actor)), '')
      .replace(new RegExp('^' + escapeRegExp(actor) + '\\s*·\\s*'), '');
    if (subtitle.trim() === actor) subtitle = '';
  }

  // Ligne 1 : « acteur + verbe » quand on connaît l'acteur, sinon libellé localisé.
  const verb = actor ? ACTOR_VERBS[n.type] : undefined;
  const label = TYPE_LABELS[n.type];
  let title = verb && actor
    ? `${actor} ${language === 'fr' ? verb.fr : verb.en}`
    : (label ? (language === 'fr' ? label.fr : label.en) : n.title);
  if (amount) title += ` — ${amount}`;

  return {
    id: `notif-${n.id}`,
    type: n.type,
    icon: iconInfo.icon,
    iconColor: iconInfo.color,
    title,
    subtitle: subtitle.trim(),
    timestamp: n.created_at,
    link: n.link || undefined,
  };
}

export default function ActivityCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(() => desktopNotificationPermission());
  const [notifOn, setNotifOn] = useState<boolean>(() => desktopNotificationsEnabled());
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'));
    } catch {
      return new Set<string>();
    }
  });

  function toggleCategory(key: string) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch { /* quota */ }
      return next;
    });
  }

  // Fermer le menu Customize au clic à l'extérieur
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

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
        (payload: { new: NotifRow & { is_read: boolean } }) => {
          const newItem = buildNotifItem(payload.new, language);
          setActivities((prev) => [newItem, ...prev].slice(0, 100));
          // Mark as read immediately since panel is open
          supabase.from('notifications').update({ is_read: true }).eq('id', payload.new.id).then(() => {});
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

      // Clients récents (créés / modifiés) — pas encore couverts par les triggers
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
        const iconInfo = ICON_MAP[type];
        const title = isNew && name
          ? (language === 'fr' ? `${name} est maintenant client` : `${name} became a client`)
          : `${language === 'fr' ? TYPE_LABELS[type].fr : TYPE_LABELS[type].en}`;
        items.push({
          id: `client-${c.id}`,
          type,
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title,
          subtitle: isNew && name ? '' : name,
          timestamp: isNew ? c.created_at : c.updated_at,
          link: `/clients/${c.id}`,
        });
      }

      // Leads récents (clients avec status='lead')
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
        const iconInfo = ICON_MAP['lead_created'];
        items.push({
          id: `lead-${l.id}`,
          type: 'lead_created',
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title: language === 'fr' ? TYPE_LABELS.lead_created.fr : TYPE_LABELS.lead_created.en,
          subtitle: name,
          timestamp: l.created_at,
          link: `/clients/${l.id}`,
        });
      }

      // Jobs récents — pas encore couverts par les triggers
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, title, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(8);

      for (const j of jobs || []) {
        const iconInfo = ICON_MAP['job_created'];
        items.push({
          id: `job-${j.id}`,
          type: 'job_created',
          icon: iconInfo.icon,
          iconColor: iconInfo.color,
          title: language === 'fr' ? TYPE_LABELS.job_created.fr : TYPE_LABELS.job_created.en,
          subtitle: j.title || '',
          timestamp: j.created_at,
          link: `/jobs/${j.id}`,
        });
      }

      // Le journal d'événements (devis, factures, paiements, notes, avis,
      // cartes — via triggers DB) + types historiques. select('*') pour
      // tolérer l'absence de actor_name tant que la migration n'est pas
      // appliquée (supabase-js avale les erreurs de colonne inconnue).
      const { data: notifications } = await supabase
        .from('notifications')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(60);

      for (const n of (notifications || []) as NotifRow[]) {
        items.push(buildNotifItem(n, language));
      }

      // Sort all by timestamp descending
      items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      setActivities(items.slice(0, 100));
    } catch (err) {
      console.error('Failed to load activities:', err);
    } finally {
      setLoading(false);
    }
  }

  const visibleItems = activities.filter(a => {
    const cat = categoryOf(a.type);
    return !cat || !hidden.has(cat);
  });

  // Rendu groupé par jour avec en-têtes collants
  const feedNodes: React.ReactNode[] = [];
  let currentDay: string | null = null;
  for (const item of visibleItems) {
    const day = dayLabel(item.timestamp, language);
    if (day !== currentDay) {
      currentDay = day;
      feedNodes.push(
        <div
          key={`day-${day}`}
          className="sticky top-0 z-10 bg-surface-card/95 backdrop-blur-sm px-5 sm:px-7 pt-3.5 pb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-text-tertiary"
        >
          {day}
        </div>
      );
    }
    feedNodes.push(
      <div
        key={item.id}
        className={cn(
          'flex gap-4 px-5 sm:px-7 py-[17px] border-b border-outline-subtle last:border-b-0 transition-colors',
          item.link ? 'cursor-pointer hover:bg-surface-secondary/60' : 'hover:bg-surface-secondary/40',
        )}
        onClick={item.link ? () => { navigate(item.link!); onClose(); } : undefined}
      >
        <div className="shrink-0 pt-0.5">
          <item.icon size={18} strokeWidth={1.8} className={item.iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold text-text-primary leading-snug">{item.title}</p>
          {item.subtitle && (
            <p className="text-[13px] text-text-secondary leading-snug mt-0.5">{item.subtitle}</p>
          )}
          <p className="text-[11.5px] text-text-tertiary mt-1 tabular-nums">
            {timeAgo(item.timestamp, language)}
          </p>
        </div>
      </div>
    );
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
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/30"
            onClick={onClose}
          />
          {/* Modale centrée (plein écran sur mobile) */}
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="pointer-events-auto bg-surface-card w-full h-full sm:w-[600px] sm:h-[720px] sm:max-h-[86vh] sm:rounded-2xl sm:border sm:border-outline shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 sm:px-7 pt-5 sm:pt-6 pb-3">
                <h2 className="text-lg font-bold text-text-primary tracking-tight">
                  {language === 'fr' ? 'Centre d\'activités' : 'Activity Center'}
                </h2>
                <button
                  onClick={onClose}
                  className="p-2 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Toolbar — Customize center */}
              <div className="px-5 sm:px-7 pb-3.5 border-b border-outline-subtle">
                <div ref={menuRef} className="relative inline-block">
                  <button
                    onClick={() => setMenuOpen(o => !o)}
                    aria-haspopup="true"
                    aria-expanded={menuOpen}
                    className="inline-flex items-center gap-2 h-8 px-3 rounded-lg bg-surface-secondary border border-outline text-[12.5px] font-semibold text-text-primary hover:bg-surface-tertiary transition-colors"
                  >
                    <SlidersHorizontal size={14} className="text-text-tertiary" />
                    {language === 'fr' ? 'Personnaliser le centre' : 'Customize center'}
                  </button>
                  {menuOpen && (
                    <div className="absolute top-full left-0 mt-1 w-56 max-h-[340px] overflow-y-auto bg-surface-card border border-outline rounded-xl shadow-lg z-30 p-1.5">
                      <p className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
                        {language === 'fr' ? 'Afficher dans le fil' : 'Show in feed'}
                      </p>
                      {CATEGORIES.map(c => {
                        const checked = !hidden.has(c.key);
                        return (
                          <button
                            key={c.key}
                            role="menuitemcheckbox"
                            aria-checked={checked}
                            onClick={() => toggleCategory(c.key)}
                            className={cn(
                              'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-left transition-colors hover:bg-surface-secondary',
                              checked ? 'text-text-primary' : 'text-text-tertiary',
                            )}
                          >
                            <span
                              className={cn(
                                'w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0 transition-colors',
                                checked ? 'bg-primary border-primary' : 'bg-surface-card border-outline-strong',
                              )}
                            >
                              {checked && <Check size={11} strokeWidth={3.2} className="text-primary-foreground" />}
                            </span>
                            {language === 'fr' ? c.fr : c.en}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Desktop notifications opt-in — fires native OS alerts when Lume
                  is open but not the focused tab. Hidden once blocked at the browser level. */}
              {desktopNotificationsSupported() && notifPerm !== 'denied' && (
                <div className="px-5 sm:px-7 py-2.5 border-b border-outline-subtle flex items-center justify-between gap-3">
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

              {/* Feed — une seule colonne, groupée par jour */}
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {loading ? (
                  <div className="p-10 flex justify-center">
                    <div className="w-5 h-5 border-2 border-outline-subtle border-t-text-primary rounded-full animate-spin" />
                  </div>
                ) : visibleItems.length === 0 ? (
                  <div className="p-12 text-center text-text-tertiary text-[13px]">
                    {activities.length > 0
                      ? (language === 'fr'
                        ? 'Tout est masqué — réactivez des catégories dans « Personnaliser le centre ».'
                        : 'Everything is hidden — re-enable categories in Customize center.')
                      : t.activityCenter.noRecentActivity}
                  </div>
                ) : (
                  <div className="pb-2">{feedNodes}</div>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
