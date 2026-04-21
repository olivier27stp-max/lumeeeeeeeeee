/* ═══════════════════════════════════════════════════════════════
   Page — Automations

   Shows ALL automation rules (from automation_rules table) in a
   single unified view, organized by functional category.
   Default presets are seeded via DB migration — the page only
   reads, never auto-seeds.

   Categories: Leads, Quotes, Jobs/Scheduling, Invoices,
   Payments, Follow-up, Reviews, Client
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, Clock, Mail, Bell, FileText, CalendarClock, MessageSquare,
  ToggleLeft, ToggleRight, Loader2, Send, UserPlus, AlertTriangle,
  Heart, Star, Sun, UserX, CreditCard, Banknote, Search,
  CheckCircle, Shield, Sparkles, ChevronDown, ChevronRight,
  Users, Briefcase, Receipt, ThumbsUp,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n';
import { toast } from 'sonner';
import PermissionGate from '../components/PermissionGate';
import {
  type AutomationRule,
  getAutomationRules,
  toggleAutomationRule,
} from '../lib/automationRulesApi';

// ── Automation name translations (for DB-seeded English names) ──
const AUTOMATION_NAME_FR: Record<string, string> = {
  'Lead — Welcome': 'Prospect — Bienvenue',
  'Lead Alert — 7 Days Stale': 'Alerte prospect — 7 jours inactif',
  'Lead Final Follow-Up — 14 Days': 'Dernier suivi prospect — 14 jours',
  'Lead Follow-Up — 1 Day': 'Suivi prospect — 1 jour',
  'Lead Follow-Up — 3 Days': 'Suivi prospect — 3 jours',
  'Lost Lead Re-engagement — 90 Days': 'Réengagement prospect perdu — 90 jours',
  'Estimate Follow-Up': "Suivi d'estimation",
  'Quote Follow-Up — 1 Day': 'Suivi de devis — 1 jour',
  'Quote Follow-Up — 3 Days': 'Suivi de devis — 3 jours',
  'Quote Follow-Up — 7 Days': 'Suivi de devis — 7 jours',
  'Quote Follow-Up — 14 Days': 'Suivi de devis — 14 jours',
  'Quote Follow-Up — 21 Days': 'Suivi de devis — 21 jours',
};

function localizeAutomationName(name: string, lang: string): string {
  if (lang !== 'fr') return name;
  return AUTOMATION_NAME_FR[name] ?? name;
}

// ── Category definitions ────────────────────────────────────
// Order matters — this defines the display order of sections
const CATEGORY_ORDER = [
  'Leads',
  'Quotes',
  'Jobs',
  'Invoices',
  'Payments',
  'Follow-up',
  'Reviews',
  'Client',
] as const;

type CategoryKey = (typeof CATEGORY_ORDER)[number];

const CATEGORY_META: Record<CategoryKey, {
  icon: typeof Bell;
  labelEn: string;
  labelFr: string;
  descEn: string;
  descFr: string;
}> = {
  Leads: {
    icon: UserPlus,
    labelEn: 'Leads',
    labelFr: 'Leads',
    descEn: 'Lead capture, assignment, and nurturing',
    descFr: 'Capture, assignation et suivi des leads',
  },
  Quotes: {
    icon: FileText,
    labelEn: 'Quotes & Estimates',
    labelFr: 'Devis et soumissions',
    descEn: 'Follow-ups after sending quotes',
    descFr: 'Relances après envoi de devis',
  },
  Jobs: {
    icon: Briefcase,
    labelEn: 'Jobs & Scheduling',
    labelFr: 'Jobs et rendez-vous',
    descEn: 'Booking confirmations and reminders',
    descFr: 'Confirmations et rappels de rendez-vous',
  },
  Invoices: {
    icon: Receipt,
    labelEn: 'Invoices',
    labelFr: 'Factures',
    descEn: 'Invoice reminders and escalations',
    descFr: 'Rappels de factures et escalades',
  },
  Payments: {
    icon: CreditCard,
    labelEn: 'Payments',
    labelFr: 'Paiements',
    descEn: 'Payment confirmations and deposit tracking',
    descFr: 'Confirmations de paiement et suivi des dépôts',
  },
  'Follow-up': {
    icon: Heart,
    labelEn: 'Follow-up',
    labelFr: 'Suivi',
    descEn: 'Post-service follow-ups and cross-sell',
    descFr: 'Suivis après service et ventes croisées',
  },
  Reviews: {
    icon: Star,
    labelEn: 'Reviews',
    labelFr: 'Avis',
    descEn: 'Review requests and reputation management',
    descFr: 'Demandes d\'avis et gestion de la réputation',
  },
  Client: {
    icon: Users,
    labelEn: 'Client Engagement',
    labelFr: 'Engagement client',
    descEn: 'Anniversaries, seasonal outreach, and retention',
    descFr: 'Anniversaires, relances saisonnières et rétention',
  },
};

// ── Preset → Category mapping ───────────────────────────────
const PRESET_META: Record<string, {
  icon: typeof Bell;
  category: CategoryKey;
}> = {
  // Leads
  welcome_new_lead:         { icon: UserPlus,       category: 'Leads' },
  lead_followup_1d:         { icon: Mail,           category: 'Leads' },
  lead_followup_3d:         { icon: Mail,           category: 'Leads' },
  stale_lead_7d:            { icon: AlertTriangle,  category: 'Leads' },
  lead_followup_14d:        { icon: AlertTriangle,  category: 'Leads' },
  lost_lead_reengagement:   { icon: UserX,          category: 'Leads' },

  // Quotes
  quote_followup_1d:        { icon: Mail,           category: 'Quotes' },
  quote_followup_3d:        { icon: Mail,           category: 'Quotes' },
  quote_followup_7d:        { icon: Mail,           category: 'Quotes' },
  quote_followup_14d:       { icon: AlertTriangle,  category: 'Quotes' },
  quote_followup_21d:       { icon: AlertTriangle,  category: 'Quotes' },
  estimate_followup:        { icon: Mail,           category: 'Quotes' },

  // Jobs
  job_reminder_7d:          { icon: CalendarClock,  category: 'Jobs' },
  job_reminder_1d:          { icon: CalendarClock,  category: 'Jobs' },
  job_reminder_2h:          { icon: CalendarClock,  category: 'Jobs' },
  appointment_confirmation: { icon: CalendarClock,  category: 'Jobs' },
  no_show_followup:         { icon: UserX,          category: 'Jobs' },

  // Invoices
  invoice_sent_reminder_1d: { icon: FileText,       category: 'Invoices' },
  invoice_sent_reminder_3d: { icon: FileText,       category: 'Invoices' },
  invoice_sent_reminder_7d: { icon: FileText,       category: 'Invoices' },
  invoice_sent_reminder_14d:{ icon: AlertTriangle,  category: 'Invoices' },
  invoice_sent_reminder_30d:{ icon: AlertTriangle,  category: 'Invoices' },
  invoice_reminder_1d:      { icon: FileText,       category: 'Invoices' },
  invoice_reminder_3d:      { icon: FileText,       category: 'Invoices' },
  invoice_reminder_5d:      { icon: FileText,       category: 'Invoices' },
  invoice_reminder_15d:     { icon: AlertTriangle,  category: 'Invoices' },
  invoice_reminder_30d:     { icon: AlertTriangle,  category: 'Invoices' },

  // Payments
  payment_confirmation:     { icon: CreditCard,     category: 'Payments' },
  deposit_received:         { icon: Banknote,       category: 'Payments' },
  deposit_reminder:         { icon: Banknote,       category: 'Payments' },
  deposit_followup_2d:      { icon: Banknote,       category: 'Payments' },

  // Follow-up
  thank_you_after_job:      { icon: Heart,          category: 'Follow-up' },
  cross_sell_30d:           { icon: Send,           category: 'Follow-up' },
  reengagement_90d:         { icon: Send,           category: 'Follow-up' },
  post_appointment_survey:  { icon: Star,           category: 'Follow-up' },

  // Reviews
  google_review:            { icon: Star,           category: 'Reviews' },
  review_reminder_7d:       { icon: Star,           category: 'Reviews' },

  // Client
  client_anniversary:       { icon: Star,           category: 'Client' },
  seasonal_reminder_6m:     { icon: Sun,            category: 'Client' },
};

// All presets are ON by default
const DEFAULT_ACTIVE_PRESETS = new Set(Object.keys(PRESET_META));

const TRIGGER_DISPLAY: Record<string, { en: string; fr: string }> = {
  'appointment.created':   { en: 'Appointment created',   fr: 'Rendez-vous créé' },
  'appointment.updated':   { en: 'Appointment updated',   fr: 'Rendez-vous modifié' },
  'appointment.cancelled': { en: 'Appointment cancelled', fr: 'Rendez-vous annulé' },
  'estimate.sent':         { en: 'Quote sent',            fr: 'Devis envoyé' },
  'quote.sent':            { en: 'Quote sent',            fr: 'Devis envoyé' },
  'quote.approved':        { en: 'Quote approved',        fr: 'Devis accepté' },
  'quote.declined':        { en: 'Quote declined',        fr: 'Devis refusé' },
  'invoice.sent':          { en: 'Invoice sent',          fr: 'Facture envoyée' },
  'invoice.paid':          { en: 'Invoice paid',          fr: 'Facture payée' },
  'invoice.overdue':       { en: 'Invoice overdue',       fr: 'Facture en retard' },
  'job.completed':         { en: 'Job completed',         fr: 'Job terminé' },
  'job.scheduled':         { en: 'Job scheduled',         fr: 'Job planifié' },
  'lead.created':          { en: 'Lead created',          fr: 'Lead créé' },
  'lead.status_changed':   { en: 'Lead status changed',   fr: 'Statut du lead changé' },
  'payment.received':      { en: 'Payment received',      fr: 'Paiement reçu' },
};

function formatDelay(seconds: number, lang: string): string {
  if (seconds === 0) return lang === 'fr' ? 'Immédiat' : 'Immediate';
  const abs = Math.abs(seconds);
  const before = seconds < 0;
  const dir = before ? (lang === 'fr' ? 'avant' : 'before') : (lang === 'fr' ? 'après' : 'after');
  if (abs < 3600) return `${Math.round(abs / 60)} min ${dir}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${dir}`;
  if (abs < 2592000) {
    const d = Math.round(abs / 86400);
    return `${d} ${lang === 'fr' ? (d > 1 ? 'jours' : 'jour') : (d > 1 ? 'days' : 'day')} ${dir}`;
  }
  const m = Math.round(abs / 2592000);
  return `${m} ${lang === 'fr' ? 'mois' : (m > 1 ? 'months' : 'month')} ${dir}`;
}

function getChannels(actions: AutomationRule['actions']): string[] {
  const channels: string[] = [];
  for (const a of actions) {
    if (a.type === 'send_sms' && !channels.includes('SMS')) channels.push('SMS');
    if (a.type === 'send_email' && !channels.includes('Email')) channels.push('Email');
    if (a.type === 'create_notification' && !channels.includes('Notif')) channels.push('Notif');
    if (a.type === 'create_task' && !channels.includes('Task')) channels.push('Task');
    if (a.type === 'request_review' && !channels.includes('Review')) channels.push('Review');
  }
  return channels;
}

function getActionLabel(type: string): string {
  const labels: Record<string, string> = {
    send_sms: 'Send SMS',
    send_email: 'Send Email',
    create_notification: 'Notification',
    create_task: 'Create Task',
    request_review: 'Request Review',
    update_status: 'Update Status',
    add_tag: 'Add Tag',
    assign_user: 'Assign User',
  };
  return labels[type] || type.replace(/_/g, ' ');
}

// ═════════════════════════════════════════════════════════════

export default function Automations() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // ── Load (read only — no auto-seed) ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAutomationRules();
      // Client-side safety: deduplicate by preset_key (keep first per key)
      const seen = new Set<string>();
      const deduped = data.filter((r) => {
        if (!r.preset_key) return true;
        if (seen.has(r.preset_key)) return false;
        seen.add(r.preset_key);
        return true;
      });
      setRules(deduped);
    } catch (e: any) {
      console.error('Failed to load rules:', e.message);
      toast.error(language === 'fr' ? 'Impossible de charger les automatisations' : 'Failed to load automations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Toggle ──
  const handleToggle = async (rule: AutomationRule) => {
    const newActive = !rule.is_active;
    setTogglingId(rule.id);
    setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: newActive } : r));
    try {
      await toggleAutomationRule(rule.id, newActive);
      toast.success(newActive
        ? (t.automations.workflowEnabled)
        : (t.automations.workflowDisabled));
    } catch {
      toast.error(t.automations.failedToUpdate);
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, is_active: rule.is_active } : r));
    } finally {
      setTogglingId(null);
    }
  };

  // ── Category resolution ──
  const getCategory = (r: AutomationRule): CategoryKey => {
    const meta = PRESET_META[r.preset_key || ''];
    return meta?.category || 'Follow-up';
  };

  // ── Filter ──
  const filtered = rules.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !(r.description || '').toLowerCase().includes(q)) return false;
    }
    if (filterStatus === 'active' && !r.is_active) return false;
    if (filterStatus === 'inactive' && r.is_active) return false;
    if (filterCategory !== 'all' && getCategory(r) !== filterCategory) return false;
    return true;
  });

  // ── Group by category, sorted alphabetically within each ──
  const grouped: Record<string, AutomationRule[]> = {};
  for (const r of filtered) {
    const cat = getCategory(r);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(r);
  }
  // Sort rules alphabetically within each category
  for (const cat of Object.keys(grouped)) {
    grouped[cat].sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── Counts ──
  const totalCount = rules.length;
  const activeCount = rules.filter((r) => r.is_active).length;
  const inactiveCount = totalCount - activeCount;

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  };

  return (
    <PermissionGate permission="automations.update">
    <div className="space-y-6 max-w-[1100px] mx-auto">

      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-text-primary">
          {fr ? 'Automatisations' : 'Automations'}
        </h1>
        <p className="text-[13px] text-text-tertiary mt-0.5">
          {fr
            ? 'Automatisations événementielles pour votre entreprise'
            : 'Event-driven automations for your business'}
        </p>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total', value: totalCount },
          { label: fr ? 'Actives' : 'Active', value: activeCount },
          { label: fr ? 'Inactives' : 'Inactive', value: inactiveCount },
        ].map((s) => (
          <div key={s.label} className="section-card px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{s.label}</p>
            <p className="text-lg font-bold text-text-primary tabular-nums mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            placeholder={t.automations.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glass-input w-full pl-9 text-[13px]"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="glass-input text-[13px] py-2"
        >
          <option value="all">{t.automations.allCategories}</option>
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {fr ? CATEGORY_META[c].labelFr : CATEGORY_META[c].labelEn}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
          className="glass-input text-[13px] py-2"
        >
          <option value="all">{fr ? 'Toutes' : 'All'}</option>
          <option value="active">{fr ? 'Actives' : 'Active'}</option>
          <option value="inactive">{fr ? 'Inactives' : 'Inactive'}</option>
        </select>
        <span className="text-[11px] text-text-tertiary ml-auto">
          {filtered.length} {t.automations.results}
        </span>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-text-tertiary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="section-card p-10 text-center">
          <Zap size={28} className="mx-auto text-text-tertiary/30 mb-3" />
          <p className="text-[13px] text-text-tertiary">
            {search
              ? (t.automations.noResults)
              : (t.automations.noWorkflows)}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {CATEGORY_ORDER.filter(cat => grouped[cat]?.length).map((cat) => {
            const catMeta = CATEGORY_META[cat];
            const CatIcon = catMeta.icon;
            const catRules = grouped[cat];
            const isCollapsed = collapsedCategories.has(cat);
            const catActiveCount = catRules.filter(r => r.is_active).length;

            return (
              <div key={cat} className="section-card overflow-hidden">
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary/30 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-tertiary flex items-center justify-center shrink-0">
                    <CatIcon size={15} className="text-text-secondary" />
                  </div>
                  <div className="text-left min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-text-primary">
                        {fr ? catMeta.labelFr : catMeta.labelEn}
                      </span>
                      <span className="text-[11px] text-text-tertiary">
                        {catActiveCount}/{catRules.length} {fr ? 'actives' : 'active'}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
                      {fr ? catMeta.descFr : catMeta.descEn}
                    </p>
                  </div>
                  {isCollapsed ? (
                    <ChevronRight size={16} className="text-text-tertiary shrink-0" />
                  ) : (
                    <ChevronDown size={16} className="text-text-tertiary shrink-0" />
                  )}
                </button>

                {/* Rules table */}
                {!isCollapsed && (
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-t border-b border-outline bg-surface-secondary/40">
                        {[
                          { label: fr ? 'Automatisation' : 'Automation', cls: 'text-left' },
                          { label: t.automations.trigger, cls: 'text-left hidden md:table-cell' },
                          { label: t.automations.timing, cls: 'text-left hidden lg:table-cell' },
                          { label: t.automations.channels, cls: 'text-left hidden lg:table-cell' },
                          { label: t.automations.status, cls: 'text-center w-[80px]' },
                          { label: '', cls: 'text-right w-[60px]' },
                        ].map((col) => (
                          <th key={col.label || 'action'} className={cn('px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary', col.cls)}>
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {catRules.map((rule) => {
                        const meta = PRESET_META[rule.preset_key || ''];
                        const Icon = meta?.icon || Zap;
                        const trigger = TRIGGER_DISPLAY[rule.trigger_event];
                        const isDefault = rule.is_preset && DEFAULT_ACTIVE_PRESETS.has(rule.preset_key || '');
                        const channels = getChannels(rule.actions);
                        const isExpanded = expandedId === rule.id;

                        return (
                          <React.Fragment key={rule.id}>
                            <tr
                              className={cn(
                                'border-b border-outline/40 transition-colors cursor-pointer',
                                !rule.is_active && 'opacity-50',
                                isExpanded ? 'bg-surface-secondary/50' : 'hover:bg-surface-secondary/30',
                              )}
                              onClick={() => setExpandedId(isExpanded ? null : rule.id)}
                            >
                              {/* Name */}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-7 h-7 rounded-md bg-surface-tertiary flex items-center justify-center shrink-0">
                                    <Icon size={13} className="text-text-secondary" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold text-text-primary truncate">{localizeAutomationName(rule.name, language)}</span>
                                      {isDefault && (
                                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary shrink-0">
                                          {t.automations.default}
                                        </span>
                                      )}
                                      {rule.is_preset && !isDefault && (
                                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-surface-tertiary text-text-tertiary shrink-0">
                                          {t.automations.optional}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Trigger */}
                              <td className="px-4 py-3 text-[12px] text-text-secondary hidden md:table-cell">
                                {trigger ? (fr ? trigger.fr : trigger.en) : rule.trigger_event}
                              </td>

                              {/* Timing */}
                              <td className="px-4 py-3 hidden lg:table-cell">
                                <span className="text-[12px] text-text-tertiary flex items-center gap-1">
                                  <Clock size={10} />
                                  {formatDelay(rule.delay_seconds, language)}
                                </span>
                              </td>

                              {/* Channels */}
                              <td className="px-4 py-3 hidden lg:table-cell">
                                <div className="flex gap-1">
                                  {channels.map((ch) => (
                                    <span key={ch} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-tertiary text-text-secondary">
                                      {ch}
                                    </span>
                                  ))}
                                </div>
                              </td>

                              {/* Status */}
                              <td className="px-4 py-3 text-center">
                                <span className={cn(
                                  'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                                  rule.is_active
                                    ? 'bg-primary/8 text-text-primary'
                                    : 'bg-surface-tertiary text-text-tertiary',
                                )}>
                                  {rule.is_active ? (fr ? 'Active' : 'Active') : (t.automations.off)}
                                </span>
                              </td>

                              {/* Toggle */}
                              <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => handleToggle(rule)}
                                  disabled={togglingId === rule.id}
                                  className="p-1 rounded-md hover:bg-surface-tertiary transition-colors inline-flex"
                                >
                                  {togglingId === rule.id ? (
                                    <Loader2 size={18} className="animate-spin text-text-tertiary" />
                                  ) : rule.is_active ? (
                                    <ToggleRight size={20} className="text-text-primary" />
                                  ) : (
                                    <ToggleLeft size={20} className="text-text-tertiary" />
                                  )}
                                </button>
                              </td>
                            </tr>

                            {/* Expanded detail row */}
                            {isExpanded && (
                              <tr className="bg-surface-secondary/30">
                                <td colSpan={6} className="px-6 py-4">
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-[12px]">
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">
                                        {t.automations.description}
                                      </p>
                                      <p className="text-text-secondary leading-relaxed">
                                        {rule.description || (t.automations.noDescription)}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">
                                        {t.automations.actions}
                                      </p>
                                      <div className="space-y-1">
                                        {rule.actions.map((a, i) => (
                                          <div key={i} className="flex items-center gap-1.5 text-text-secondary">
                                            <span className="w-1 h-1 rounded-full bg-text-tertiary shrink-0" />
                                            <span>{getActionLabel(a.type)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-1">
                                        {t.automations.details}
                                      </p>
                                      <div className="space-y-1 text-text-secondary">
                                        <div className="flex items-center gap-1.5">
                                          <Clock size={10} className="text-text-tertiary" />
                                          {formatDelay(rule.delay_seconds, language)}
                                        </div>
                                        {rule.preset_key && (
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-text-tertiary text-[10px]">key:</span>
                                            <code className="text-[10px] bg-surface-tertiary px-1 py-0.5 rounded">{rule.preset_key}</code>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    </PermissionGate>
  );
}
