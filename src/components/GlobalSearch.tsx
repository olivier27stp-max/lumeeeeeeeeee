import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Briefcase, CalendarDays, ClipboardList, Command, Contact, CreditCard, FileText,
  Plus, Receipt, Search, Users, UsersRound, Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  SearchEntityItem,
  SearchEntityType,
  EntityGroupKey,
  ALL_ENTITY_GROUP_KEYS,
  fetchSearchSuggestions,
} from '../lib/globalSearchApi';
import { cn } from '../lib/utils';
import {
  getCommandSuggestions,
  normalizeSearchQuery,
  resolveCommand,
  resolveDateInput,
} from '../lib/searchParsing';
import { escapeRegExp, getSearchEntityLabel, getSearchItemHref } from '../lib/searchHelpers';
import { useTranslation } from '../i18n';

// ── Types ──

type SuggestionKind = 'command' | 'date' | 'entity' | 'quick_action' | 'see_all';

interface SuggestionAction {
  id: string;
  kind: SuggestionKind;
  label: string;
  subtitle?: string | null;
  destination: string;
  entityType?: SearchEntityType;
  status?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  date?: string | null;
  clientName?: string | null;
}

// ── Constants ──

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 200;
const MAX_SUGGESTIONS = 12;

// ── Icon mapping ──

const ENTITY_ICONS: Record<SearchEntityType, React.ElementType> = {
  client: Users,
  job: Briefcase,
  lead: Contact,
  invoice: Receipt,
  quote: FileText,
  request: ClipboardList,
  team: UsersRound,
  event: CalendarDays,
};

const ENTITY_COLORS: Record<SearchEntityType, string> = {
  client: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10',
  job: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10',
  lead: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10',
  invoice: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10',
  quote: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10',
  request: 'text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-500/10',
  team: 'text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-500/10',
  event: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10',
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  draft: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-500/15 dark:text-neutral-400',
  sent: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-500/15 dark:text-neutral-400',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  declined: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  cancelled: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-500/15 dark:text-neutral-400',
  scheduled: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-500/15 dark:text-neutral-400',
  'in progress': 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  new: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-500/15 dark:text-neutral-400',
  action_required: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  void: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-500/15 dark:text-neutral-500',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  awaiting_response: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  converted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  expired: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-500/15 dark:text-neutral-500',
  unscheduled: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-500/15 dark:text-neutral-400',
};

// ── Quick Actions ──

interface QuickAction {
  id: string;
  label: string;
  labelFr: string;
  icon: React.ElementType;
  destination: string;
  keywords: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'qa-new-client', label: 'Create New Client', labelFr: 'Nouveau client', icon: Plus, destination: '/clients?action=new', keywords: 'create add new client customer nouveau' },
  { id: 'qa-new-lead', label: 'Create New Quote', labelFr: 'Nouveau devis', icon: Plus, destination: '/leads?action=new', keywords: 'create add new quote devis prospect nouveau' },
  { id: 'qa-new-job', label: 'Create New Job', labelFr: 'Nouvelle job', icon: Plus, destination: '/jobs?action=new', keywords: 'create add new job work travail nouveau' },
  { id: 'qa-new-quote', label: 'Create New Quote', labelFr: 'Nouveau devis', icon: Plus, destination: '/quotes?action=new', keywords: 'create add new quote estimate devis nouveau' },
  { id: 'qa-new-invoice', label: 'Create New Invoice', labelFr: 'Nouvelle facture', icon: Plus, destination: '/invoices?action=new', keywords: 'create add new invoice bill facture nouveau' },
  { id: 'qa-calendar', label: 'Go to Calendar', labelFr: 'Calendrier', icon: CalendarDays, destination: '/calendar', keywords: 'calendar schedule horaire' },
  { id: 'qa-invoices', label: 'Go to Invoices', labelFr: 'Factures', icon: Receipt, destination: '/invoices', keywords: 'invoices billing factures' },
  { id: 'qa-quotes', label: 'Go to Quotes', labelFr: 'Devis', icon: FileText, destination: '/quotes', keywords: 'quotes estimates devis' },
];

// ── Helpers ──

function highlightText(text: string, query: string) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return text;

  const tokens = normalized.split(' ').map((t) => t.trim()).filter(Boolean).slice(0, 4);
  if (tokens.length === 0) return text;

  const matcher = new RegExp(`(${tokens.map((t) => escapeRegExp(t)).join('|')})`, 'ig');
  const parts = text.split(matcher);

  return parts.map((part, index) => {
    const isMatch = tokens.some((t) => t.toLowerCase() === part.toLowerCase());
    if (!isMatch) return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    return (
      <mark key={`${part}-${index}`} className="rounded bg-primary/15 px-0.5 text-inherit">
        {part}
      </mark>
    );
  });
}

function formatAmount(cents: number, currency?: string | null) {
  const amount = cents / 100;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatShortDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  } catch { return null; }
}

function StatusBadge({ status }: { status: string }) {
  const display = status.replace(/_/g, ' ');
  const colorClass = STATUS_BADGE_COLORS[status.toLowerCase()] || STATUS_BADGE_COLORS[display.toLowerCase()] || 'bg-neutral-100 text-neutral-600 dark:bg-neutral-500/15 dark:text-neutral-400';
  return (
    <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide leading-none', colorClass)}>
      {display}
    </span>
  );
}

// ── Entity groups order ──

const ENTITY_DISPLAY_ORDER: EntityGroupKey[] = ['clients', 'jobs', 'quotes', 'requests', 'invoices', 'leads', 'teams', 'events'];

const ENTITY_KEY_TO_TYPE: Record<EntityGroupKey, SearchEntityType> = {
  clients: 'client', jobs: 'job', leads: 'lead', invoices: 'invoice',
  quotes: 'quote', requests: 'request', teams: 'team', events: 'event',
};

// ── Component ──

export default function GlobalSearch() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [entitySuggestions, setEntitySuggestions] = useState<SearchEntityItem[]>([]);
  const [groupedSuggestions, setGroupedSuggestions] = useState<Record<EntityGroupKey, SearchEntityItem[]>>({
    clients: [], jobs: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [],
  });

  const normalizedQuery = useMemo(() => normalizeSearchQuery(query), [query]);
  const exactCommand = useMemo(() => resolveCommand(normalizedQuery), [normalizedQuery]);
  const parsedDate = useMemo(() => resolveDateInput(normalizedQuery), [normalizedQuery]);

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(normalizeSearchQuery(query));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetch suggestions
  useEffect(() => {
    let cancelled = false;

    async function loadSuggestions() {
      if (debouncedQuery.length < MIN_QUERY_LENGTH) {
        setEntitySuggestions([]);
        setGroupedSuggestions({ clients: [], jobs: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [] });
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const payload = await fetchSearchSuggestions(debouncedQuery, MAX_SUGGESTIONS);
        if (!cancelled) {
          setEntitySuggestions(payload.items || []);
          setGroupedSuggestions(payload.grouped || { clients: [], jobs: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [] });
        }
      } catch {
        if (!cancelled) {
          setEntitySuggestions([]);
          setGroupedSuggestions({ clients: [], jobs: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [] });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSuggestions();
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  // Cleanup blur timer
  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  // Build suggestion items
  const { allItems, sections } = useMemo(() => {
    const secs: Array<{ key: string; label: string; items: SuggestionAction[] }> = [];
    const all: SuggestionAction[] = [];

    // Quick actions when query matches
    if (normalizedQuery.length >= 1) {
      const q = normalizedQuery.toLowerCase();
      const matchedActions = QUICK_ACTIONS.filter((a) =>
        a.label.toLowerCase().includes(q) || a.labelFr.toLowerCase().includes(q) || a.keywords.includes(q)
      ).slice(0, 4);

      if (matchedActions.length > 0) {
        const actionItems: SuggestionAction[] = matchedActions.map((a) => ({
          id: a.id,
          kind: 'quick_action' as const,
          label: fr ? a.labelFr : a.label,
          destination: a.destination,
        }));
        secs.push({ key: 'quick_actions', label: t.globalSearch.quickActions, items: actionItems });
        all.push(...actionItems);
      }
    }

    // Date matches
    if (parsedDate && !exactCommand) {
      const dateItem: SuggestionAction = {
        id: `date-${parsedDate.isoDate}`,
        kind: 'date',
        label: `${t.globalSearch.openCalendarOn} ${parsedDate.label}`,
        subtitle: parsedDate.source,
        destination: `/calendar?date=${encodeURIComponent(parsedDate.isoDate)}`,
      };
      secs.push({ key: 'dates', label: t.globalSearch.dates, items: [dateItem] });
      all.push(dateItem);
    }

    // Command suggestions
    const commandSuggestions = getCommandSuggestions(normalizedQuery, 3);
    if (commandSuggestions.length > 0) {
      const cmdItems: SuggestionAction[] = commandSuggestions.map((c) => ({
        id: `command-${c.command}`,
        kind: 'command' as const,
        label: c.label,
        subtitle: c.aliases.join(' / '),
        destination: c.path,
      }));
      secs.push({ key: 'commands', label: t.commandPalette.navigation, items: cmdItems });
      all.push(...cmdItems);
    }

    // Entity results grouped by type
    for (const groupKey of ENTITY_DISPLAY_ORDER) {
      const groupItems = groupedSuggestions[groupKey];
      if (!groupItems || groupItems.length === 0) continue;

      const entityItems: SuggestionAction[] = groupItems.slice(0, 4).map((entity) => ({
        id: `entity-${entity.type}-${entity.id}`,
        kind: 'entity' as const,
        entityType: entity.type,
        label: entity.title,
        subtitle: entity.subtitle,
        destination: getSearchItemHref(entity.type, entity.id),
        status: entity.status,
        amountCents: entity.amountCents,
        currency: entity.currency,
        date: entity.date,
        clientName: entity.clientName,
      }));

      secs.push({ key: groupKey, label: getSearchEntityLabel(ENTITY_KEY_TO_TYPE[groupKey]), items: entityItems });
      all.push(...entityItems);
    }

    // See all results
    if (normalizedQuery.length >= MIN_QUERY_LENGTH && entitySuggestions.length > 0) {
      const seeAllItem: SuggestionAction = {
        id: 'see-all',
        kind: 'see_all',
        label: `${t.globalSearch.seeAllResults} "${normalizedQuery}"`,
        destination: `/search?q=${encodeURIComponent(normalizedQuery)}&tab=all`,
      };
      all.push(seeAllItem);
    }

    return { allItems: all, sections: secs };
  }, [entitySuggestions, groupedSuggestions, exactCommand, normalizedQuery, parsedDate, fr, t]);

  const flatItems = useMemo(() => allItems.filter((i) => i.kind !== 'see_all'), [allItems]);
  const seeAllItem = useMemo(() => allItems.find((i) => i.kind === 'see_all') || null, [allItems]);

  // Clamp active index
  useEffect(() => {
    if (activeIndex >= flatItems.length) {
      setActiveIndex(Math.max(-1, flatItems.length - 1));
    }
  }, [activeIndex, flatItems.length]);

  function closeDropdown() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function resetAfterNavigate() {
    setQuery('');
    setDebouncedQuery('');
    setEntitySuggestions([]);
    setGroupedSuggestions({ clients: [], jobs: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [] });
    closeDropdown();
  }

  function handleSelect(item: SuggestionAction) {
    navigate(item.destination);
    resetAfterNavigate();
  }

  function handleSubmitFromEnter() {
    if (activeIndex >= 0 && activeIndex < flatItems.length) {
      handleSelect(flatItems[activeIndex]);
      return;
    }

    const cleanQuery = normalizeSearchQuery(query);
    if (!cleanQuery) {
      closeDropdown();
      return;
    }

    const commandMatch = resolveCommand(cleanQuery);
    if (commandMatch) {
      navigate(commandMatch.destination);
      resetAfterNavigate();
      return;
    }

    const dateMatch = resolveDateInput(cleanQuery);
    if (dateMatch) {
      navigate(`/calendar?date=${encodeURIComponent(dateMatch.isoDate)}`);
      resetAfterNavigate();
      return;
    }

    navigate(`/search?q=${encodeURIComponent(cleanQuery)}&tab=all`);
    resetAfterNavigate();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSubmitFromEnter();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      if (flatItems.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % flatItems.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      if (flatItems.length === 0) return;
      setActiveIndex((prev) => (prev <= 0 ? flatItems.length - 1 : prev - 1));
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDropdown();
    }
  }

  function handleFocus() {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (normalizedQuery) setOpen(true);
  }

  function handleBlur() {
    blurTimerRef.current = setTimeout(() => {
      closeDropdown();
    }, 160);
  }

  const showDropdown = open && normalizedQuery.length > 0;

  return (
    <div ref={rootRef} className="relative w-full max-w-3xl" onBlur={handleBlur}>
      {/* Search Input */}
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={t.globalSearch.placeholder}
          className="glass-input w-full pl-9 pr-16"
          aria-label="Global search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 && flatItems[activeIndex]
              ? `${listboxId}-option-${flatItems[activeIndex].id}`
              : undefined
          }
          aria-autocomplete="list"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded border border-outline px-1.5 py-0.5 text-[10px] font-mono text-text-tertiary sm:inline-flex">
          Ctrl K
        </kbd>
      </div>

      {/* Dropdown */}
      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[520px] overflow-y-auto rounded-xl border border-outline bg-surface shadow-2xl"
        >
          {/* Loading state */}
          {loading && flatItems.length === 0 ? (
            <div className="px-4 py-6">
              <div className="space-y-2">
                <div className="h-5 w-2/3 animate-pulse rounded bg-surface-tertiary" />
                <div className="h-5 w-1/2 animate-pulse rounded bg-surface-tertiary" />
                <div className="h-5 w-3/4 animate-pulse rounded bg-surface-tertiary" />
              </div>
            </div>
          ) : null}

          {/* Empty state */}
          {!loading && flatItems.length === 0 && !seeAllItem ? (
            <div className="px-4 py-6 text-center">
              <Search size={20} className="mx-auto mb-2 text-text-tertiary" />
              <p className="text-[13px] text-text-secondary">{t.globalSearch.noSuggestions}</p>
            </div>
          ) : null}

          {/* Results */}
          {flatItems.length > 0 || seeAllItem ? (
            <div className="py-1">
              {sections.map((section) => (
                <div key={section.key}>
                  <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                    {section.label}
                  </p>
                  {section.items.map((item) => {
                    const flatIndex = flatItems.findIndex((f) => f.id === item.id);
                    const isActive = flatIndex === activeIndex;
                    return (
                      <SearchResultRow
                        key={item.id}
                        item={item}
                        isActive={isActive}
                        listboxId={listboxId}
                        query={normalizedQuery}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => handleSelect(item)}
                      />
                    );
                  })}
                </div>
              ))}

              {/* See all results */}
              {seeAllItem ? (
                <div className="border-t border-outline px-2 py-2">
                  <button
                    type="button"
                    onClick={() => handleSelect(seeAllItem)}
                    className="w-full rounded-lg px-3 py-2 text-left text-[13px] font-medium text-primary transition-colors hover:bg-primary/5"
                  >
                    <div className="flex items-center gap-2">
                      <Search size={13} />
                      <span>{seeAllItem.label}</span>
                    </div>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Footer hints */}
          {flatItems.length > 0 ? (
            <div className="flex items-center gap-4 border-t border-outline px-3 py-1.5 text-[10px] text-text-tertiary">
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-outline px-1 py-0.5 font-mono">↑↓</kbd>
                {t.commandPalette.navigate}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-outline px-1 py-0.5 font-mono">↵</kbd>
                {t.commandPalette.open}
              </span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-outline px-1 py-0.5 font-mono">esc</kbd>
                {t.commandPalette.close}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Result Row Component ──

function SearchResultRow({
  item,
  isActive,
  listboxId,
  query,
  onMouseEnter,
  onClick,
}: {
  key?: React.Key;
  item: SuggestionAction;
  isActive: boolean;
  listboxId: string;
  query: string;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const Icon = item.entityType
    ? ENTITY_ICONS[item.entityType]
    : item.kind === 'date'
      ? CalendarDays
      : item.kind === 'command'
        ? Command
        : item.kind === 'quick_action'
          ? (QUICK_ACTIONS.find((a) => a.id === item.id)?.icon || Zap)
          : Search;

  const iconColor = item.entityType
    ? ENTITY_COLORS[item.entityType]
    : isActive
      ? 'text-white bg-white/20'
      : 'text-text-secondary bg-surface-tertiary';

  return (
    <button
      id={`${listboxId}-option-${item.id}`}
      type="button"
      role="option"
      aria-selected={isActive}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        'mx-1 w-[calc(100%-0.5rem)] rounded-lg px-2.5 py-2 text-left transition-colors',
        isActive ? 'bg-primary text-white' : 'hover:bg-surface-secondary'
      )}
    >
      <div className="flex items-center gap-2.5">
        {/* Icon */}
        <span
          className={cn(
            'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
            isActive ? 'bg-white/20 text-white' : iconColor
          )}
        >
          <Icon size={14} strokeWidth={1.75} />
        </span>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn('truncate text-[13px] font-medium', isActive ? 'text-white' : 'text-text-primary')}>
              {item.kind === 'entity' ? highlightText(item.label, query) : item.label}
            </p>
            {item.status ? (
              isActive ? (
                <span className="inline-flex items-center rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide leading-none text-white">
                  {item.status.replace(/_/g, ' ')}
                </span>
              ) : (
                <StatusBadge status={item.status} />
              )
            ) : null}
          </div>
          {(item.subtitle || item.amountCents || item.clientName) ? (
            <div className={cn('flex items-center gap-1.5 text-[11px]', isActive ? 'text-white/70' : 'text-text-secondary')}>
              {item.subtitle ? (
                <span className="truncate">
                  {item.kind === 'entity' ? highlightText(item.subtitle, query) : item.subtitle}
                </span>
              ) : null}
              {item.clientName && item.clientName !== item.subtitle && item.clientName !== item.label ? (
                <>
                  {item.subtitle ? <span className="shrink-0">·</span> : null}
                  <span className="truncate">{item.clientName}</span>
                </>
              ) : null}
              {item.amountCents != null && item.amountCents > 0 ? (
                <>
                  <span className="shrink-0">·</span>
                  <span className="shrink-0 font-medium">{formatAmount(item.amountCents, item.currency)}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Date on the right */}
        {item.date ? (
          <span className={cn('shrink-0 text-[10px]', isActive ? 'text-white/60' : 'text-text-tertiary')}>
            {formatShortDate(item.date)}
          </span>
        ) : null}
      </div>
    </button>
  );
}
