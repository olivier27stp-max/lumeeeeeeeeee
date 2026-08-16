import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Briefcase, Calendar, ClipboardList, Command, Contact, CreditCard, FileSignature, Inbox,
  MapPin, Plus, Search, Users, UsersRound, Wallet, Zap,
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
import { entityIconClass } from '../lib/entityColors';
import { useTranslation } from '../i18n';
import { usePermissions } from '../hooks/usePermissions';
import { hasPermission, isFinanciallyRestricted } from '../lib/permissions';

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

// ── Icon mapping — same icons as the sidebar nav, rendered bare (no chip) ──

const ENTITY_ICONS: Record<SearchEntityType, React.ElementType> = {
  client: Users,
  property: MapPin,
  job: Briefcase,
  agreement: FileSignature,
  payment: CreditCard,
  lead: Contact,
  invoice: Wallet,
  quote: ClipboardList,
  request: Inbox,
  team: UsersRound,
  event: Calendar,
};

// Singular type label for the secondary line ("Property · Olivier St-Pierre")
const ENTITY_TYPE_LABELS: Record<SearchEntityType, { en: string; fr: string }> = {
  client: { en: 'Client', fr: 'Client' },
  property: { en: 'Property', fr: 'Propriété' },
  job: { en: 'Job', fr: 'Job' },
  agreement: { en: 'Agreement', fr: 'Contrat' },
  payment: { en: 'Payment', fr: 'Paiement' },
  lead: { en: 'Lead', fr: 'Prospect' },
  invoice: { en: 'Invoice', fr: 'Facture' },
  quote: { en: 'Quote', fr: 'Devis' },
  request: { en: 'Request', fr: 'Demande' },
  team: { en: 'Team', fr: 'Équipe' },
  event: { en: 'Event', fr: 'Événement' },
};

// ── Quick Actions ──

interface QuickAction {
  id: string;
  label: string;
  labelFr: string;
  icon: React.ElementType;
  destination: string;
  keywords: string;
  /** Entity identity color for the icon, when the action targets a CRM section. */
  entity?: 'request' | 'quote' | 'job' | 'invoice';
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'qa-new-client', label: 'Create New Client', labelFr: 'Nouveau client', icon: Plus, destination: '/clients?action=new', keywords: 'create add new client customer nouveau' },
  { id: 'qa-new-lead', label: 'Create New Lead', labelFr: 'Nouveau prospect', icon: Plus, destination: '/leads?action=new', keywords: 'create add new lead prospect nouveau' },
  { id: 'qa-new-job', label: 'Create New Job', labelFr: 'Nouvelle job', icon: Plus, destination: '/jobs?action=new', keywords: 'create add new job work travail nouveau' },
  { id: 'qa-new-quote', label: 'Create New Quote', labelFr: 'Nouveau devis', icon: Plus, destination: '/quotes?action=new', keywords: 'create add new quote estimate devis nouveau' },
  { id: 'qa-new-invoice', label: 'Create New Invoice', labelFr: 'Nouvelle facture', icon: Plus, destination: '/invoices?action=new', keywords: 'create add new invoice bill facture nouveau' },
  { id: 'qa-calendar', label: 'Go to Calendar', labelFr: 'Calendrier', icon: Calendar, destination: '/calendar', keywords: 'calendar schedule horaire' },
  { id: 'qa-invoices', label: 'Go to Invoices', labelFr: 'Factures', icon: Wallet, destination: '/invoices', keywords: 'invoices billing factures', entity: 'invoice' },
  { id: 'qa-quotes', label: 'Go to Quotes', labelFr: 'Devis', icon: ClipboardList, destination: '/quotes', keywords: 'quotes estimates devis', entity: 'quote' },
];

// ── Helpers ──

function highlightText(text: string, query: string) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return text;

  const tokens = normalized.split(' ').map((tk) => tk.trim()).filter(Boolean).slice(0, 4);
  if (tokens.length === 0) return text;

  const matcher = new RegExp(`(${tokens.map((tk) => escapeRegExp(tk)).join('|')})`, 'ig');
  const parts = text.split(matcher);

  return parts.map((part, index) => {
    const isMatch = tokens.some((tk) => tk.toLowerCase() === part.toLowerCase());
    if (!isMatch) return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    return (
      <mark key={`${part}-${index}`} className="bg-transparent font-extrabold text-text-primary">
        {part}
      </mark>
    );
  });
}

// ── Entity groups order ──

const ENTITY_DISPLAY_ORDER: EntityGroupKey[] = ['clients', 'properties', 'jobs', 'quotes', 'agreements', 'requests', 'invoices', 'payments', 'leads', 'teams', 'events'];

const ENTITY_KEY_TO_TYPE: Record<EntityGroupKey, SearchEntityType> = {
  clients: 'client', properties: 'property', jobs: 'job', agreements: 'agreement', payments: 'payment',
  leads: 'lead', invoices: 'invoice', quotes: 'quote', requests: 'request', teams: 'team', events: 'event',
};

// ── Component ──

export default function GlobalSearch() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const listboxId = useId();
  const permsCtx = usePermissions();
  const financiallyRestricted = permsCtx.role ? isFinanciallyRestricted(permsCtx.role) : false;
  const canSeeInvoices = permsCtx.role === 'owner' || permsCtx.role === 'admin' ||
    hasPermission(permsCtx.permissions, 'financial.view_invoices', permsCtx.role ?? undefined);
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
    clients: [], properties: [], jobs: [], agreements: [], payments: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [],
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
        setGroupedSuggestions({ clients: [], properties: [], jobs: [], agreements: [], payments: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [] });
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const payload = await fetchSearchSuggestions(debouncedQuery, MAX_SUGGESTIONS);
        if (!cancelled) {
          setEntitySuggestions(payload.items || []);
          setGroupedSuggestions(payload.grouped || { clients: [], properties: [], jobs: [], agreements: [], payments: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [] });
        }
      } catch {
        if (!cancelled) {
          setEntitySuggestions([]);
          setGroupedSuggestions({ clients: [], properties: [], jobs: [], agreements: [], payments: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [] });
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

  // Build suggestion items (sections still computed for ordering; rendered flat)
  const { allItems } = useMemo(() => {
    const secs: Array<{ key: string; label: string; items: SuggestionAction[] }> = [];
    const all: SuggestionAction[] = [];

    // Quick actions when query matches
    if (normalizedQuery.length >= 1) {
      const q = normalizedQuery.toLowerCase();
      const matchedActions = QUICK_ACTIONS.filter((a) => {
        // Filter out invoice/payment quick actions for financially restricted roles
        if (!canSeeInvoices && (a.id === 'qa-new-invoice' || a.id === 'qa-invoices')) return false;
        return a.label.toLowerCase().includes(q) || a.labelFr.toLowerCase().includes(q) || a.keywords.includes(q);
      }).slice(0, 4);

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

    // Entity results grouped by type (filter financial entities for restricted roles)
    for (const groupKey of ENTITY_DISPLAY_ORDER) {
      // Skip financial groups for financially restricted users
      if (financiallyRestricted && (groupKey === 'invoices' || groupKey === 'quotes' || groupKey === 'payments')) continue;

      const groupItems = groupedSuggestions[groupKey];
      if (!groupItems || groupItems.length === 0) continue;

      const entityItems: SuggestionAction[] = groupItems.slice(0, 4).map((entity) => ({
        id: `entity-${entity.type}-${entity.id}`,
        kind: 'entity' as const,
        entityType: entity.type,
        label: entity.title,
        subtitle: entity.subtitle,
        destination: getSearchItemHref(entity.type, entity.id, { clientId: entity.clientId, refId: entity.refId }),
        status: entity.status,
        // Strip amounts for financially restricted users
        amountCents: financiallyRestricted ? null : entity.amountCents,
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
    setGroupedSuggestions({ clients: [], properties: [], jobs: [], agreements: [], payments: [], leads: [], invoices: [], quotes: [], requests: [], teams: [], events: [] });
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
    <div ref={rootRef} className="relative w-48 md:w-56 transition-[width] duration-300 ease-out focus-within:w-[20rem] md:focus-within:w-[28rem]" onBlur={handleBlur}>
      {/* Search Input */}
      <div className="relative group">
        <Search size={15} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary transition-colors duration-150 group-focus-within:text-text-secondary" />
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
          className="glass-input h-9 w-full rounded-lg pl-9 pr-4 focus:pr-16 py-0 text-[13px]"
          aria-label={fr ? 'Recherche globale' : 'Global search'}
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
        <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden items-center rounded-md border border-outline px-1.5 py-0.5 text-[10px] font-mono text-text-tertiary sm:group-focus-within:inline-flex">
          Ctrl K
        </kbd>
      </div>

      {/* Dropdown */}
      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[520px] overflow-y-auto rounded-xl border border-outline bg-surface-card shadow-lg"
        >
          {/* Loading state */}
          {loading && flatItems.length === 0 ? (
            <div className="px-4 py-8">
              <div className="space-y-3">
                <div className="h-4 w-2/3 animate-pulse rounded bg-surface-secondary" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-surface-secondary" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-surface-secondary" />
              </div>
            </div>
          ) : null}

          {/* Empty state */}
          {!loading && flatItems.length === 0 && !seeAllItem ? (
            <div className="px-4 py-8 text-center">
              <Search size={18} strokeWidth={1.75} className="mx-auto mb-2 text-text-tertiary" />
              <p className="text-[13px] text-text-secondary">{t.globalSearch.noSuggestions}</p>
            </div>
          ) : null}

          {/* Results — flat list, no section headers */}
          {flatItems.length > 0 || seeAllItem ? (
            <div className="py-1.5">
              {flatItems.map((item, index) => (
                <SearchResultRow
                  key={item.id}
                  item={item}
                  isActive={index === activeIndex}
                  fr={fr}
                  listboxId={listboxId}
                  query={normalizedQuery}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => handleSelect(item)}
                />
              ))}

              {/* See all results */}
              {seeAllItem ? (
                <div className="mt-2 border-t border-outline pt-1.5">
                  <button
                    type="button"
                    onClick={() => handleSelect(seeAllItem)}
                    className="mx-1.5 w-[calc(100%-0.75rem)] rounded-lg px-3 py-2.5 text-left text-[13px] font-medium text-text-secondary transition-colors duration-150 hover:bg-surface-secondary"
                  >
                    <div className="flex items-center gap-3.5">
                      <Search size={16} strokeWidth={1.75} className="shrink-0 text-text-tertiary" />
                      <span className="truncate">{seeAllItem.label}</span>
                    </div>
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Footer hints */}
          {flatItems.length > 0 ? (
            <div className="flex items-center gap-4 border-t border-outline px-[18px] py-2 text-[10px] text-text-tertiary">
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border border-outline px-1 py-0.5 font-mono">↑↓</kbd>
                {t.commandPalette.navigate}
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border border-outline px-1 py-0.5 font-mono">↵</kbd>
                {t.commandPalette.open}
              </span>
              <span className="flex items-center gap-1.5">
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

function formatMoney(cents: number, currency: string | null | undefined, fr = false) {
  return new Intl.NumberFormat(fr ? 'fr-CA' : 'en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// True when the query matched the subtitle (email or phone) rather than the
// title — phone comparison is digits-only so "514-555-1234" matches "(514) 555-1234".
function queryMatchesContact(subtitle: string, query: string) {
  if (subtitle.toLowerCase().includes(query.toLowerCase())) return true;
  const queryDigits = query.replace(/\D/g, '');
  if (queryDigits.length < 4) return false;
  return subtitle.replace(/\D/g, '').includes(queryDigits);
}

// One line per result: "Title (Client)". Bare numbers get their type as a
// prefix ("658" → "Invoice #658"); payments show their amount
// ("Payment – $1,092.26"); clients show their name alone.
function entityRowText(item: SuggestionAction, fr: boolean, query = ''): { main: string; context: string | null } {
  const typeLabel = item.entityType ? ENTITY_TYPE_LABELS[item.entityType][fr ? 'fr' : 'en'] : '';
  let main = item.label;
  const bareNumber = main.trim().match(/^#?(\d+)$/);
  if (bareNumber && typeLabel) main = `${typeLabel} #${bareNumber[1]}`;

  if (item.entityType === 'payment') {
    main = item.amountCents != null
      ? `${typeLabel} – ${formatMoney(item.amountCents, item.currency, fr)}`
      : typeLabel;
  }

  if (item.entityType === 'client' || item.entityType === 'lead') {
    // Name alone — unless the match came from the email/phone subtitle
    // (search by contact info), which is then shown to explain the hit.
    const contactContext =
      item.subtitle && query && queryMatchesContact(item.subtitle, query) ? item.subtitle : null;
    return { main, context: contactContext };
  }
  const context =
    item.clientName && item.clientName !== item.label
      ? item.clientName
      : item.subtitle && item.subtitle !== item.label
        ? item.subtitle
        : null;
  return { main, context };
}

function SearchResultRow({
  item,
  isActive,
  fr,
  listboxId,
  query,
  onMouseEnter,
  onClick,
}: {
  key?: React.Key;
  item: SuggestionAction;
  isActive: boolean;
  fr: boolean;
  listboxId: string;
  query: string;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const quickAction = item.kind === 'quick_action' ? QUICK_ACTIONS.find((a) => a.id === item.id) : undefined;
  const Icon = item.entityType
    ? ENTITY_ICONS[item.entityType]
    : item.kind === 'date'
      ? Calendar
      : item.kind === 'command'
        ? Command
        : item.kind === 'quick_action'
          ? (quickAction?.icon || Zap)
          : Search;

  const { main, context } = item.kind === 'entity'
    ? entityRowText(item, fr, query)
    : { main: item.label, context: null };

  return (
    <button
      id={`${listboxId}-option-${item.id}`}
      type="button"
      role="option"
      aria-selected={isActive}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        'mx-1.5 w-[calc(100%-0.75rem)] rounded-lg px-3 py-2.5 text-left transition-colors duration-150',
        isActive ? 'bg-surface-secondary' : 'hover:bg-surface-secondary'
      )}
    >
      <div className="flex items-center gap-3.5">
        {/* Bare icon — no chip, no halo; entity sections keep their identity color */}
        <Icon size={17} strokeWidth={2.5} className={cn('shrink-0', entityIconClass(item.entityType || quickAction?.entity))} aria-hidden />

        {/* One line: "Title (Client)" — wraps to 2 lines only when too long */}
        <p className="min-w-0 flex-1 text-[15px] font-extrabold leading-snug text-text-primary line-clamp-2">
          {item.kind === 'entity' ? highlightText(main, query) : main}
          {context ? (
            <span className="font-semibold text-text-secondary"> ({highlightText(context, query)})</span>
          ) : null}
        </p>
      </div>
    </button>
  );
}
