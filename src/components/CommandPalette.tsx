/* Command Palette — Ctrl+K global search & quick actions
   Uses the shared global search API (single source of truth).
*/

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search, Plus, Users, Contact, Briefcase, FileText,
  Calendar, Kanban, Settings, MessageSquare, ArrowRight,
  CreditCard, TrendingUp, StickyNote, Zap, Receipt, UsersRound, CalendarDays,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils';
import {
  SearchEntityItem, SearchEntityType, fetchSearchSuggestions,
} from '../lib/globalSearchApi';
import { getSearchItemHref } from '../lib/searchHelpers';

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
  quote: FileText, team: UsersRound, event: CalendarDays,
};

const ENTITY_SECTION_LABELS: Record<SearchEntityType, { en: string; fr: string }> = {
  client: { en: 'Clients', fr: 'Clients' },
  job: { en: 'Jobs', fr: 'Jobs' },
  lead: { en: 'Leads', fr: 'Leads' },
  invoice: { en: 'Invoices', fr: 'Factures' },
  quote: { en: 'Quotes', fr: 'Devis' },
  team: { en: 'Teams', fr: 'Equipes' },
  event: { en: 'Calendar', fr: 'Calendrier' },
};

export default function CommandPalette({ open, onClose, language }: CommandPaletteProps) {
  const fr = language === 'fr';
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<CommandItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Navigation commands
  const navCommands = useMemo((): CommandItem[] => [
    { id: 'nav-dashboard', label: fr ? 'Accueil' : 'Dashboard', icon: Search, action: () => navigate('/dashboard'), section: fr ? 'Navigation' : 'Navigation', keywords: 'home accueil' },
    { id: 'nav-leads', label: 'Leads', icon: Contact, action: () => navigate('/leads'), section: fr ? 'Navigation' : 'Navigation', keywords: 'prospects' },
    { id: 'nav-pipeline', label: 'Pipeline', icon: Kanban, action: () => navigate('/pipeline'), section: fr ? 'Navigation' : 'Navigation', keywords: 'deals kanban' },
    { id: 'nav-clients', label: 'Clients', icon: Users, action: () => navigate('/clients'), section: fr ? 'Navigation' : 'Navigation', keywords: 'customers' },
    { id: 'nav-jobs', label: 'Jobs', icon: Briefcase, action: () => navigate('/jobs'), section: fr ? 'Navigation' : 'Navigation', keywords: 'travaux' },
    { id: 'nav-calendar', label: fr ? 'Calendrier' : 'Calendar', icon: Calendar, action: () => navigate('/calendar'), section: fr ? 'Navigation' : 'Navigation', keywords: 'schedule horaire' },
    { id: 'nav-invoices', label: fr ? 'Factures' : 'Invoices', icon: FileText, action: () => navigate('/invoices'), section: fr ? 'Navigation' : 'Navigation', keywords: 'bills' },
    { id: 'nav-quotes', label: fr ? 'Devis' : 'Quotes', icon: FileText, action: () => navigate('/quotes'), section: fr ? 'Navigation' : 'Navigation', keywords: 'estimates' },
    { id: 'nav-payments', label: fr ? 'Paiements' : 'Payments', icon: CreditCard, action: () => navigate('/payments'), section: fr ? 'Navigation' : 'Navigation' },
    { id: 'nav-messages', label: 'Messages', icon: MessageSquare, action: () => navigate('/messages'), section: fr ? 'Navigation' : 'Navigation', keywords: 'sms text' },
    { id: 'nav-insights', label: 'Insights', icon: TrendingUp, action: () => navigate('/insights'), section: fr ? 'Navigation' : 'Navigation', keywords: 'analytics stats' },
    { id: 'nav-notes', label: 'Notes', icon: StickyNote, action: () => navigate('/notes'), section: fr ? 'Navigation' : 'Navigation', keywords: 'boards whiteboard' },
    { id: 'nav-workflows', label: 'Workflows', icon: Zap, action: () => navigate('/workflows'), section: fr ? 'Navigation' : 'Navigation', keywords: 'automations' },
    { id: 'nav-settings', label: fr ? 'Parametres' : 'Settings', icon: Settings, action: () => navigate('/settings'), section: fr ? 'Navigation' : 'Navigation' },
  ], [fr, navigate]);

  const actionCommands = useMemo((): CommandItem[] => [
    { id: 'act-new-lead', label: fr ? 'Creer un lead' : 'Create lead', icon: Plus, action: () => { navigate('/leads'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-lead')), 300); }, section: fr ? 'Actions' : 'Actions', keywords: 'add new prospect' },
    { id: 'act-new-client', label: fr ? 'Creer un client' : 'Create client', icon: Plus, action: () => { navigate('/clients'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-client')), 300); }, section: fr ? 'Actions' : 'Actions', keywords: 'add new customer' },
    { id: 'act-new-job', label: fr ? 'Creer une job' : 'Create job', icon: Plus, action: () => { navigate('/jobs'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-job')), 300); }, section: fr ? 'Actions' : 'Actions', keywords: 'add new travail' },
    { id: 'act-new-invoice', label: fr ? 'Creer une facture' : 'Create invoice', icon: Plus, action: () => { navigate('/invoices'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-invoice')), 300); }, section: fr ? 'Actions' : 'Actions', keywords: 'add new bill' },
    { id: 'act-new-quote', label: fr ? 'Creer un devis' : 'Create quote', icon: Plus, action: () => { navigate('/quotes'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-quote')), 300); }, section: fr ? 'Actions' : 'Actions', keywords: 'add new estimate' },
    { id: 'act-new-deal', label: fr ? 'Creer un deal' : 'Create deal', icon: Plus, action: () => { navigate('/pipeline'); setTimeout(() => window.dispatchEvent(new CustomEvent('crm:open-new-deal')), 300); }, section: fr ? 'Actions' : 'Actions', keywords: 'add new' },
  ], [fr, navigate]);

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
    if (!q) return [...actionCommands, ...navCommands];

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
      if (item) { item.action(); onClose(); }
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filtered, selectedIndex, onClose]);

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
              placeholder={fr ? 'Chercher ou executer une commande...' : 'Search or run a command...'}
              className="flex-1 bg-transparent border-none outline-none text-[14px] text-text-primary placeholder:text-text-tertiary"
            />
            <kbd className="hidden sm:inline-flex px-1.5 py-0.5 rounded border border-outline text-[10px] text-text-tertiary font-mono">
              ESC
            </kbd>
          </div>

          <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="text-center text-[13px] text-text-tertiary py-8">
                {fr ? 'Aucun resultat' : 'No results'}
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
            <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-outline font-mono">↑↓</kbd> {fr ? 'naviguer' : 'navigate'}</span>
            <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-outline font-mono">↵</kbd> {fr ? 'ouvrir' : 'open'}</span>
            <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 rounded border border-outline font-mono">esc</kbd> {fr ? 'fermer' : 'close'}</span>
          </div>
        </motion.div>
      </div>
    </>
  );
}
