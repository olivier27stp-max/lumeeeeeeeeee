/* Command Palette — Ctrl+K global search & quick actions
   Uses the shared global search API (single source of truth).
*/

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Plus, Users, Contact, Briefcase, FileText, ClipboardList,
  Calendar, Settings, MessageSquare, ArrowRight,
  CreditCard, TrendingUp, StickyNote, Zap, Receipt, UsersRound, CalendarDays,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import {
  SearchEntityItem, SearchEntityType, fetchSearchSuggestions,
} from '../lib/globalSearchApi';
import { getSearchItemHref } from '../lib/searchHelpers';
import { useTranslation } from '../i18n';
import { usePermissions } from '../hooks/usePermissions';
import { hasPermission, isFinanciallyRestricted } from '../lib/permissions';

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: React.ElementType;
  action: () => void;
  section: string;
  keywords?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  language: string;
}

const ENTITY_ICONS: Record<SearchEntityType, React.ElementType> = {
  client: Users, job: Briefcase, lead: Contact, invoice: Receipt,
  quote: FileText, request: ClipboardList, team: UsersRound, event: CalendarDays,
};

const ENTITY_SECTION_LABELS: Record<SearchEntityType, { en: string; fr: string }> = {
  client: { en: 'Clients', fr: 'Clients' },
  job: { en: 'Jobs', fr: 'Jobs' },
  lead: { en: 'Leads', fr: 'Prospects' },
  invoice: { en: 'Invoices', fr: 'Factures' },
  quote: { en: 'Quotes', fr: 'Devis' },
  request: { en: 'Requests', fr: 'Demandes' },
  team: { en: 'Teams', fr: 'Equipes' },
  event: { en: 'Calendar', fr: 'Calendrier' },
};

export default function CommandPalette({ open, onClose, language }: CommandPaletteProps) {
  const { t } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const permsCtx = usePermissions();
  const financiallyRestricted = permsCtx.role ? isFinanciallyRestricted(permsCtx.role) : false;
  const canSeeInvoices = permsCtx.role === 'owner' || permsCtx.role === 'admin' ||
    hasPermission(permsCtx.permissions, 'financial.view_invoices', permsCtx.role ?? undefined);
  const canSeePayments = permsCtx.role === 'owner' || permsCtx.role === 'admin' ||
    hasPermission(permsCtx.permissions, 'financial.view_payments', permsCtx.role ?? undefined);
  const canSeeAnalytics = permsCtx.role === 'owner' || permsCtx.role === 'admin' ||
    hasPermission(permsCtx.permissions, 'financial.view_analytics', permsCtx.role ?? undefined);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<CommandItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Search history (localStorage)
  const [searchHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('lume-search-history') || '[]').slice(0, 5); } catch { return []; }
  });
  const saveToHistory = (q: string) => {
    if (!q.trim() || q.length < 3) return;
    try {
      const prev: string[] = JSON.parse(localStorage.getItem('lume-search-history') || '[]');
      const updated = [q, ...prev.filter(h => h !== q)].slice(0, 5);
      localStorage.setItem('lume-search-history', JSON.stringify(updated));
    } catch {}
  };

  // Navigation commands
  const navCommands = useMemo((): CommandItem[] => {
    const cmds: CommandItem[] = [
      { id: 'nav-dashboard', label: t.commandPalette.dashboard, icon: Search, action: () => navigate('/dashboard'), section: t.commandPalette.navigation, keywords: 'home accueil' },
      { id: 'nav-clients', label: 'Clients', icon: Users, action: () => navigate('/clients'), section: t.commandPalette.navigation, keywords: 'customers' },
      { id: 'nav-jobs', label: 'Jobs', icon: Briefcase, action: () => navigate('/jobs'), section: t.commandPalette.navigation, keywords: 'travaux' },
      { id: 'nav-calendar', label: t.commandPalette.calendar, icon: Calendar, action: () => navigate('/calendar'), section: t.commandPalette.navigation, keywords: 'schedule horaire' },
      ...(canSeeInvoices ? [{ id: 'nav-invoices', label: t.commandPalette.invoices, icon: FileText, action: () => navigate('/invoices'), section: t.commandPalette.navigation, keywords: 'bills' }] : []),
      { id: 'nav-quotes', label: t.clientDetails.quotes, icon: FileText, action: () => navigate('/quotes'), section: t.commandPalette.navigation, keywords: 'estimates' },
      ...(canSeePayments ? [{ id: 'nav-payments', label: t.commandPalette.payments, icon: CreditCard, action: () => navigate('/payments'), section: t.commandPalette.navigation }] : []),
      { id: 'nav-messages', label: 'Messages', icon: MessageSquare, action: () => navigate('/messages'), section: t.commandPalette.navigation, keywords: 'sms text' },
      ...(canSeeAnalytics ? [{ id: 'nav-insights', label: 'Insights', icon: TrendingUp, action: () => navigate('/insights'), section: t.commandPalette.navigation, keywords: 'analytics stats' }] : []),
      { id: 'nav-notes', label: 'Notes', icon: StickyNote, action: () => navigate('/notes'), section: t.commandPalette.navigation, keywords: 'boards whiteboard' },
      { id: 'nav-automations', label: 'Automations', icon: Zap, action: () => navigate('/automations'), section: t.commandPalette.navigation, keywords: 'automations workflows' },
      { id: 'nav-settings', label: t.commandPalette.settings, icon: Settings, action: () => navigate('/settings'), section: t.commandPalette.navigation },
    ];
    return cmds;
  }, [fr, navigate, canSeeInvoices, canSeePayments, canSeeAnalytics]);

  const actionCommands = useMemo((): CommandItem[] => {
    const cmds: CommandItem[] = [
      { id: 'act-new-quote', label: t.commandPalette.createQuote, icon: Plus, action: () => { navigate('/quotes'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-quote')), 300); }, section: t.automations.actions, keywords: 'add new prospect quote devis estimate' },
      { id: 'act-new-client', label: t.commandPalette.createClient, icon: Plus, action: () => { navigate('/clients'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-client')), 300); }, section: t.automations.actions, keywords: 'add new customer' },
      { id: 'act-new-job', label: t.commandPalette.createJob, icon: Plus, action: () => { navigate('/jobs'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-job')), 300); }, section: t.automations.actions, keywords: 'add new travail' },
      ...(canSeeInvoices ? [{ id: 'act-new-invoice', label: t.commandPalette.createInvoice, icon: Plus, action: () => { navigate('/invoices'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-invoice')), 300); }, section: t.automations.actions, keywords: 'add new bill' }] : []),
      // Smart filters
      { id: 'filter-jobs-late', label: fr ? 'Jobs en retard' : 'Late jobs', icon: Briefcase, action: () => navigate('/jobs'), section: fr ? 'Filtres rapides' : 'Quick Filters', keywords: 'overdue late retard' },
      { id: 'filter-jobs-today', label: fr ? 'Jobs aujourd\'hui' : 'Jobs today', icon: Calendar, action: () => navigate('/calendar'), section: fr ? 'Filtres rapides' : 'Quick Filters', keywords: 'today schedule' },
      ...(canSeeInvoices ? [
        { id: 'filter-invoices-overdue', label: fr ? 'Factures en retard' : 'Overdue invoices', icon: ClipboardList, action: () => navigate('/invoices?status=past_due'), section: fr ? 'Filtres rapides' : 'Quick Filters', keywords: 'unpaid late overdue impayé' },
        { id: 'filter-invoices-draft', label: fr ? 'Factures brouillon' : 'Draft invoices', icon: ClipboardList, action: () => navigate('/invoices?status=draft'), section: fr ? 'Filtres rapides' : 'Quick Filters', keywords: 'draft brouillon unsent' },
      ] : []),
      { id: 'filter-quotes-pending', label: fr ? 'Devis en attente' : 'Pending quotes', icon: FileText, action: () => navigate('/quotes'), section: fr ? 'Filtres rapides' : 'Quick Filters', keywords: 'pending waiting attente' },
    ];
    return cmds;
  }, [fr, navigate, canSeeInvoices]);

  // Global search via shared API
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const payload = await fetchSearchSuggestions(query.trim(), 10);
        const results: CommandItem[] = [];

        for (const item of payload.items) {
          const sectionLabel = ENTITY_SECTION_LABELS[item.type];
          results.push({
            id: `${item.type}-${item.id}`,
            label: item.title,
            sublabel: item.subtitle || item.clientName || undefined,
            icon: ENTITY_ICONS[item.type] || Search,
            action: () => navigate(getSearchItemHref(item.type, item.id)),
            section: fr ? sectionLabel.fr : sectionLabel.en,
          });
        }

        setSearchResults(results);
      } catch {
        setSearchResults([]);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, navigate, fr]);

  // Filter commands by query
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) {
      const historyItems: CommandItem[] = searchHistory.map((h, i) => ({
        id: `history-${i}`, label: h, icon: Search, section: fr ? 'Recherches récentes' : 'Recent Searches',
        action: () => setQuery(h),
      }));
      return [...historyItems, ...actionCommands, ...navCommands];
    }

    const match = (item: CommandItem) => {
      return item.label.toLowerCase().includes(q) ||
        item.sublabel?.toLowerCase().includes(q) ||
        item.keywords?.toLowerCase().includes(q);
    };

    return [
      ...searchResults,
      ...actionCommands.filter(match),
      ...navCommands.filter(match),
    ];
  }, [query, navCommands, actionCommands, searchResults]);

  // Group by section
  const sections = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of filtered) {
      const arr = map.get(item.section) || [];
      arr.push(item);
      map.set(item.section, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSearchResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIndex];
      if (item) { if (query.trim()) saveToHistory(query.trim()); item.action(); onClose(); }
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filtered, selectedIndex, onClose, query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  let flatIndex = -1;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[300] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-[301] flex items-start justify-center pt-[15vh] px-4 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -10 }}
          transition={{ duration: 0.12 }}
          className="w-full max-w-lg bg-surface border border-outline rounded-xl shadow-2xl overflow-hidden pointer-events-auto"
        >
          <div className="flex items-center gap-3 px-4 py-3 border-b border-outline">
            <Search size={16} className="text-text-tertiary shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.commandPalette.searchOrRunACommand}
              className="flex-1 bg-transparent border-none outline-none text-[14px] text-text-primary placeholder:text-text-tertiary"
            />
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded border border-outline text-[10px] text-text-tertiary font-mono">
              ESC
            </kbd>
          </div>

          <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="text-center text-[13px] text-text-tertiary py-8">
                {t.commandPalette.noResults}
              </p>
            )}
            {sections.map(([section, items]) => (
              <div key={section}>
                <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
                  {section}
                </p>
                {items.map((item) => {
                  flatIndex++;
                  const idx = flatIndex;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      data-index={idx}
                      onClick={() => { item.action(); onClose(); }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2 text-left transition-colors',
                        isSelected ? 'bg-primary/10 text-primary' : 'text-text-primary hover:bg-surface-secondary',
                      )}
                    >
                      <item.icon size={15} className={isSelected ? 'text-primary' : 'text-text-tertiary'} />
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-medium">{item.label}</span>
                        {item.sublabel && (
                          <span className="text-[11px] text-text-tertiary ml-2">{item.sublabel}</span>
                        )}
                      </div>
                      {isSelected && <ArrowRight size={13} className="text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4 px-4 py-2 border-t border-outline text-[10px] text-text-tertiary">
            <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-outline font-mono">↑↓</kbd> {t.commandPalette.navigate}</span>
            <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-outline font-mono">↵</kbd> {t.commandPalette.open}</span>
            <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-outline font-mono">esc</kbd> {t.commandPalette.close}</span>
          </div>
        </motion.div>
      </div>
    </>
  );
}
