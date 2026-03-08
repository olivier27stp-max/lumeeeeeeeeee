import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Briefcase, CalendarDays, Command, Search, Users, Workflow } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SearchEntityItem, fetchSearchSuggestions } from '../lib/globalSearchApi';
import { cn } from '../lib/utils';
import {
  getCommandSuggestions,
  normalizeSearchQuery,
  resolveCommand,
  resolveDateInput,
} from '../lib/searchParsing';
import { escapeRegExp, getSearchEntityLabel, getSearchItemHref } from '../lib/searchHelpers';

type SuggestionAction = {
  id: string;
  kind: 'command' | 'date' | 'entity' | 'see_all';
  label: string;
  subtitle?: string | null;
  destination: string;
  entityType?: SearchEntityItem['type'];
};

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;
const MAX_ITEMS = 8;

function highlightText(text: string, query: string) {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return text;

  const tokens = normalized
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 4);

  if (tokens.length === 0) return text;

  const matcher = new RegExp(`(${tokens.map((token) => escapeRegExp(token)).join('|')})`, 'ig');
  const parts = text.split(matcher);

  return parts.map((part, index) => {
    const isMatch = tokens.some((token) => token.toLowerCase() === part.toLowerCase());
    if (!isMatch) return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    return (
      <mark key={`${part}-${index}`} className="rounded bg-primary-light px-0.5 text-inherit">
        {part}
      </mark>
    );
  });
}

function getItemIcon(item: SuggestionAction) {
  if (item.kind === 'date') return CalendarDays;
  if (item.kind === 'command') return Command;
  if (item.entityType === 'client') return Users;
  if (item.entityType === 'job') return Briefcase;
  return Workflow;
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [entitySuggestions, setEntitySuggestions] = useState<SearchEntityItem[]>([]);

  const normalizedQuery = useMemo(() => normalizeSearchQuery(query), [query]);
  const exactCommand = useMemo(() => resolveCommand(normalizedQuery), [normalizedQuery]);
  const parsedDate = useMemo(() => resolveDateInput(normalizedQuery), [normalizedQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(normalizeSearchQuery(query));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;

    async function loadSuggestions() {
      if (debouncedQuery.length < MIN_QUERY_LENGTH) {
        setEntitySuggestions([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const payload = await fetchSearchSuggestions(debouncedQuery, MAX_ITEMS);
        if (!cancelled) setEntitySuggestions(payload.items || []);
      } catch {
        if (!cancelled) setEntitySuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSuggestions();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    };
  }, []);

  const suggestionItems = useMemo<SuggestionAction[]>(() => {
    const items: SuggestionAction[] = [];
    const shouldShowSeeAll = normalizedQuery.length > 0;
    const maxCoreItems = shouldShowSeeAll ? MAX_ITEMS - 1 : MAX_ITEMS;

    if (parsedDate && !exactCommand) {
      items.push({
        id: `date-${parsedDate.isoDate}`,
        kind: 'date',
        label: `Open calendar on ${parsedDate.label}`,
        subtitle: parsedDate.source,
        destination: `/calendar?date=${encodeURIComponent(parsedDate.isoDate)}`,
      });
    }

    const commandSuggestions = getCommandSuggestions(normalizedQuery, 4);
    for (const command of commandSuggestions) {
      if (items.length >= maxCoreItems) break;
      items.push({
        id: `command-${command.command}`,
        kind: 'command',
        label: command.label,
        subtitle: command.aliases.join(' / '),
        destination: command.path,
      });
    }

    for (const entity of entitySuggestions) {
      if (items.length >= maxCoreItems) break;
      items.push({
        id: `entity-${entity.type}-${entity.id}`,
        kind: 'entity',
        entityType: entity.type,
        label: entity.title,
        subtitle: entity.subtitle,
        destination: getSearchItemHref(entity.type, entity.id),
      });
    }

    if (shouldShowSeeAll && items.length < MAX_ITEMS) {
      items.push({
        id: 'see-all',
        kind: 'see_all',
        label: `See all results for "${normalizedQuery}"`,
        destination: `/search?q=${encodeURIComponent(normalizedQuery)}&tab=all`,
      });
    }

    return items.slice(0, MAX_ITEMS);
  }, [entitySuggestions, exactCommand, normalizedQuery, parsedDate]);

  const groupedEntityItems = useMemo(() => {
    return {
      clients: suggestionItems.filter((item) => item.kind === 'entity' && item.entityType === 'client'),
      jobs: suggestionItems.filter((item) => item.kind === 'entity' && item.entityType === 'job'),
      leads: suggestionItems.filter((item) => item.kind === 'entity' && item.entityType === 'lead'),
    };
  }, [suggestionItems]);

  const actionItems = useMemo(
    () => suggestionItems.filter((item) => item.kind === 'command' || item.kind === 'date'),
    [suggestionItems]
  );

  const seeAllItem = useMemo(
    () => suggestionItems.find((item) => item.kind === 'see_all') || null,
    [suggestionItems]
  );

  const optionItems = useMemo(
    () => suggestionItems.filter((item) => item.kind !== 'see_all'),
    [suggestionItems]
  );

  useEffect(() => {
    if (activeIndex >= optionItems.length) {
      setActiveIndex(optionItems.length - 1);
    }
  }, [activeIndex, optionItems.length]);

  function closeDropdown() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function resetAfterNavigate() {
    setQuery('');
    setDebouncedQuery('');
    setEntitySuggestions([]);
    closeDropdown();
  }

  function handleSelect(item: SuggestionAction) {
    navigate(item.destination);
    resetAfterNavigate();
  }

  function handleSubmitFromEnter() {
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
      if (optionItems.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % optionItems.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      if (optionItems.length === 0) return;
      setActiveIndex((prev) => (prev <= 0 ? optionItems.length - 1 : prev - 1));
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
    }, 140);
  }

  const showDropdown = open && normalizedQuery.length > 0;

  return (
    <div ref={rootRef} className="relative w-full max-w-3xl" onBlur={handleBlur}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder="Search Lume... (clients, jobs, dates, commands)"
        className="glass-input w-full pl-10"
        aria-label="Global search"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-activedescendant={
          activeIndex >= 0 && optionItems[activeIndex] ? `${listboxId}-option-${optionItems[activeIndex].id}` : undefined
        }
        aria-autocomplete="list"
      />

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[420px] overflow-y-auto rounded-lg border border-border bg-surface p-3 shadow-xl"
        >
          {loading ? <p className="px-2 py-1 text-sm text-text-secondary">Searching...</p> : null}

          {!loading && actionItems.length === 0 && optionItems.length === 0 && !seeAllItem ? (
            <p className="px-2 py-1 text-sm text-text-secondary">No suggestions.</p>
          ) : null}

          {!loading ? (
            <div className="space-y-3">
              {actionItems.length > 0 ? (
                <div>
                  <p className="px-2 pb-1 text-[10px] uppercase tracking-widest text-text-tertiary">Quick Actions</p>
                  <div className="space-y-1">
                    {actionItems.map((item) => {
                      const optionIndex = optionItems.findIndex((row) => row.id === item.id);
                      const isActive = optionIndex === activeIndex;
                      const Icon = getItemIcon(item);
                      return (
                        <button
                          key={item.id}
                          id={`${listboxId}-option-${item.id}`}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onMouseEnter={() => setActiveIndex(optionIndex)}
                          onClick={() => handleSelect(item)}
                          className={cn(
                            'w-full rounded-lg px-2 py-2 text-left transition-colors',
                            isActive ? 'bg-primary text-white' : 'hover:bg-primary-lighter'
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <Icon size={14} className={cn('mt-1 shrink-0', isActive ? 'text-white' : 'text-text-secondary')} />
                            <div>
                              <p className={cn('text-sm font-medium', isActive ? 'text-white' : 'text-text-primary')}>
                                {highlightText(item.label, normalizedQuery)}
                              </p>
                              {item.subtitle ? (
                                <p className={cn('text-xs', isActive ? 'text-white/80' : 'text-text-secondary')}>
                                  {item.subtitle}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {(['clients', 'jobs', 'leads'] as const).map((groupKey) => {
                const groupItems = groupedEntityItems[groupKey];
                if (groupItems.length === 0) return null;

                return (
                  <div key={groupKey}>
                    <p className="px-2 pb-1 text-[10px] uppercase tracking-widest text-text-tertiary">
                      {getSearchEntityLabel(groupKey === 'clients' ? 'client' : groupKey === 'jobs' ? 'job' : 'lead')}
                    </p>
                    <div className="space-y-1">
                      {groupItems.map((item) => {
                        const optionIndex = optionItems.findIndex((row) => row.id === item.id);
                        const isActive = optionIndex === activeIndex;
                        const Icon = getItemIcon(item);
                        return (
                          <button
                            key={item.id}
                            id={`${listboxId}-option-${item.id}`}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseEnter={() => setActiveIndex(optionIndex)}
                            onClick={() => handleSelect(item)}
                            className={cn(
                              'w-full rounded-lg px-2 py-2 text-left transition-colors',
                              isActive ? 'bg-primary text-white' : 'hover:bg-primary-lighter'
                            )}
                          >
                            <div className="flex items-start gap-2">
                              <Icon size={14} className={cn('mt-1 shrink-0', isActive ? 'text-white' : 'text-text-secondary')} />
                              <div>
                                <p className={cn('text-sm font-medium', isActive ? 'text-white' : 'text-text-primary')}>
                                  {highlightText(item.label, normalizedQuery)}
                                </p>
                                {item.subtitle ? (
                                  <p className={cn('text-xs', isActive ? 'text-white/80' : 'text-text-secondary')}>
                                    {highlightText(item.subtitle, normalizedQuery)}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {seeAllItem ? (
                <button
                  type="button"
                  onClick={() => handleSelect(seeAllItem)}
                  className="w-full rounded-lg border border-border px-2 py-2 text-left text-sm font-medium text-primary transition-colors hover:bg-primary-lighter"
                >
                  {seeAllItem.label}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
