/* ═══════════════════════════════════════════════════════════════
   Page — Automations / Workflows

   Shows ALL automation rules (from automation_rules table) in a
   single unified view. Default presets are seeded once via DB
   migration — the page only reads, never auto-seeds.

   RESTCRM design: strict black/white/gray palette, no accent colors.
   ═══════════════════════════════════════════════════════════════ */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, Clock, Mail, Bell, FileText, CalendarClock, MessageSquare,
  ToggleLeft, ToggleRight, Loader2, Send, UserPlus, AlertTriangle,
  Heart, Star, Sun, UserX, CreditCard, Banknote, Search,
  CheckCircle, Shield, Sparkles, ChevronDown,
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

// ── Preset metadata ─────────────────────────────────────────
const PRESET_META: Record<string, { icon: typeof Bell; categoryFr: string; categoryEn: string }> = {
  job_reminder_7d:          { icon: CalendarClock, categoryFr: 'Rendez-vous', categoryEn: 'Appointments' },
  job_reminder_1d:          { icon: CalendarClock, categoryFr: 'Rendez-vous', categoryEn: 'Appointments' },
  appointment_confirmation: { icon: CalendarClock, categoryFr: 'Rendez-vous', categoryEn: 'Appointments' },
  no_show_followup:         { icon: UserX,         categoryFr: 'Rendez-vous', categoryEn: 'Appointments' },
  quote_followup_1d:        { icon: Mail,          categoryFr: 'Devis',       categoryEn: 'Quotes' },
  estimate_followup:        { icon: Mail,          categoryFr: 'Devis',       categoryEn: 'Quotes' },
  invoice_sent_reminder_1d: { icon: FileText,      categoryFr: 'Factures',    categoryEn: 'Invoices' },
  invoice_sent_reminder_3d: { icon: FileText,      categoryFr: 'Factures',    categoryEn: 'Invoices' },
  invoice_sent_reminder_7d: { icon: FileText,      categoryFr: 'Factures',    categoryEn: 'Invoices' },
  invoice_sent_reminder_30d:{ icon: AlertTriangle,  categoryFr: 'Factures',    categoryEn: 'Invoices' },
  thank_you_after_job:      { icon: Heart,         categoryFr: 'Suivi',       categoryEn: 'Follow-up' },
  cross_sell_30d:           { icon: Send,          categoryFr: 'Suivi',       categoryEn: 'Follow-up' },
  post_appointment_survey:  { icon: Star,          categoryFr: 'Suivi',       categoryEn: 'Follow-up' },
  welcome_new_lead:         { icon: UserPlus,      categoryFr: 'Devis', categoryEn: 'Quotes' },
  stale_lead_7d:            { icon: AlertTriangle, categoryFr: 'Devis', categoryEn: 'Quotes' },
  lost_lead_reengagement:   { icon: UserX,         categoryFr: 'Devis', categoryEn: 'Quotes' },
  client_anniversary:       { icon: Star,          categoryFr: 'Client',      categoryEn: 'Client' },
  seasonal_reminder_6m:     { icon: Sun,           categoryFr: 'Client',      categoryEn: 'Client' },
  payment_confirmation:     { icon: CreditCard,    categoryFr: 'Paiement',    categoryEn: 'Payment' },
  deposit_received:         { icon: Banknote,      categoryFr: 'Paiement',    categoryEn: 'Payment' },
  google_review:            { icon: Star,          categoryFr: 'Avis',        categoryEn: 'Reviews' },
};

// Core 7 presets that should be ON by default
const DEFAULT_ACTIVE_PRESETS = new Set([
  'job_reminder_7d', 'job_reminder_1d', 'quote_followup_1d',
  'invoice_sent_reminder_1d', 'invoice_sent_reminder_3d',
  'invoice_sent_reminder_7d', 'invoice_sent_reminder_30d',
]);

const TRIGGER_DISPLAY: Record<string, { en: string; fr: string }> = {
  'appointment.created':   { en: 'Appointment created',   fr: 'Rendez-vous créé' },
  'appointment.updated':   { en: 'Appointment updated',   fr: 'Rendez-vous modifié' },
  'appointment.cancelled': { en: 'Appointment cancelled', fr: 'Rendez-vous annulé' },
  'estimate.sent':         { en: 'Quote sent',            fr: 'Devis envoyé' },
  'invoice.sent':          { en: 'Invoice sent',          fr: 'Facture envoyée' },
  'invoice.paid':          { en: 'Invoice paid',          fr: 'Facture payée' },
  'invoice.overdue':       { en: 'Invoice overdue',       fr: 'Facture en retard' },
  'job.completed':         { en: 'Job completed',         fr: 'Job terminé' },
  'lead.created':          { en: 'Lead created',          fr: 'Lead créé' },
  'lead.status_changed':   { en: 'Lead status changed',   fr: 'Statut lead changé' },
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

// ═════════════════════════════════════════════════════════════

export default function Automations() {
  const { language } = useTranslation();
  const fr = language === 'fr';

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Load (read only — no auto-seed) ──
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAutomationRules();
      // Client-side safety: deduplicate by preset_key (keep first per key)
      const seen = new Set<string>();
      const deduped = data.filter((r) => {
        if (!r.preset_key) return true; // custom rules always kept
        if (seen.has(r.preset_key)) return false;
        seen.add(r.preset_key);
        return true;
      });
      setRules(deduped);
    } catch (e: any) {
      console.error('Failed to load rules:', e.message);
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

  // ── Derive categories ──
  const getCategory = (r: AutomationRule) => {
    const meta = PRESET_META[r.preset_key || ''];
    return meta ? (fr ? meta.categoryFr : meta.categoryEn) : (t.automations.custom);
  };
  const categories = Array.from(new Set(rules.map(getCategory))).sort();

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

  // ── Counts (from filtered-visible list only) ──
  const totalCount = rules.length;
  const activeCount = rules.filter((r) => r.is_active).length;
  const inactiveCount = totalCount - activeCount;
  const presetCount = rules.filter((r) => r.is_preset).length;

  return (
    <PermissionGate permission="settings.edit_automations">
    <div className="space-y-5 max-w-[1100px] mx-auto">

      {/* ── Header ── */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-text-primary">
          Workflows
        </h1>
        <p className="text-[13px] text-text-tertiary mt-0.5">
          {fr
            ? 'Automatisations événementielles pour votre entreprise'
            : 'Event-driven automations for your business'}
        </p>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total', value: totalCount },
          { label: t.automations.active, value: activeCount },
          { label: t.automations.inactive, value: inactiveCount },
          { label: t.automations.presets, value: presetCount },
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
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
          className="glass-input text-[13px] py-2"
        >
          <option value="all">{t.automations.all}</option>
          <option value="active">{t.automations.active}</option>
          <option value="inactive">{t.automations.inactive}</option>
        </select>
        <span className="text-[11px] text-text-tertiary ml-auto">
          {filtered.length} {t.automations.results}
        </span>
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-text-tertiary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="section-card p-10 text-center">
          <Zap size={28} className="mx-auto text-text-tertiary/30 mb-3" />
          <p className="text-[13px] text-text-tertiary">
            {search ? (t.automations.noResults) : (t.automations.noWorkflows)}
          </p>
        </div>
      ) : (
        <div className="section-card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-outline bg-surface-secondary/40">
                {[
                  { label: 'Workflow', cls: 'text-left' },
                  { label: t.automations.category, cls: 'text-left hidden md:table-cell' },
                  { label: t.automations.trigger, cls: 'text-left hidden md:table-cell' },
                  { label: t.automations.timing, cls: 'text-left hidden lg:table-cell' },
                  { label: t.automations.channels, cls: 'text-left hidden lg:table-cell' },
                  { label: t.automations.status, cls: 'text-center w-[80px]' },
                  { label: '', cls: 'text-right w-[60px]' },
                ].map((col) => (
                  <th key={col.label || 'action'} className={cn('px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-tertiary', col.cls)}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((rule) => {
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
                              <span className="font-semibold text-text-primary truncate">{rule.name}</span>
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

                      {/* Category */}
                      <td className="px-4 py-3 text-[12px] text-text-tertiary hidden md:table-cell">
                        {getCategory(rule)}
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
                            ? 'bg-text-primary/8 text-text-primary'
                            : 'bg-surface-tertiary text-text-tertiary',
                        )}>
                          {rule.is_active ? (t.requestForm.active) : (t.automations.off)}
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
                        <td colSpan={7} className="px-6 py-4">
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
                                    <span>{a.type.replace(/_/g, ' ')}</span>
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
        </div>
      )}
    </div>
    </PermissionGate>
  );
}
