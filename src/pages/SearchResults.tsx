import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Contact, CreditCard, FileSignature, FileText,
  MapPin, ReceiptText, Search as SearchIcon, Users, UsersRound,
} from 'lucide-react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  SearchEntityItem, SearchEntityType, SearchResultsPayload, SearchTab,
  EntityGroupKey, ALL_ENTITY_GROUP_KEYS, fetchSearchResults,
} from '../lib/globalSearchApi';
import { cn } from '../lib/utils';
import { escapeRegExp, getSearchEntityLabel, getSearchItemHref } from '../lib/searchHelpers';
import { entityIconClass } from '../lib/entityColors';
import StatusBadge from '../components/ui/StatusBadge';
import PageHeader from '../components/ui/PageHeader';
import { useTranslation } from '../i18n';

const PAGE_SIZE = 20;

const ENTITY_ICONS: Record<SearchEntityType, React.ElementType> = {
  client: Users, property: MapPin, job: Briefcase, agreement: FileSignature, payment: CreditCard, lead: Contact,
  invoice: ReceiptText, quote: FileText, request: ClipboardList, team: UsersRound, event: CalendarDays,
};

// Bare icon color per entity — the four CRM sections keep their identity
// color (requests amber, quotes bordeaux, jobs green, invoices navy); the
// rest stay neutral. No chip, no background behind the icon.
const ENTITY_COLORS: Record<SearchEntityType, string> = {
  client: 'text-text-secondary',
  property: 'text-text-secondary',
  job: entityIconClass('job'),
  agreement: 'text-text-secondary',
  payment: entityIconClass('payment'),
  lead: 'text-text-secondary',
  invoice: entityIconClass('invoice'),
  quote: entityIconClass('quote'),
  request: entityIconClass('request'),
  team: 'text-text-secondary',
  event: 'text-text-secondary',
};

function parsePage(raw: string | null, fallback = 1) {
  const parsed = Number(raw || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function highlightText(text: string, query: string) {
  const normalized = query.trim();
  if (!normalized) return text;
  const tokens = normalized.split(/\s+/).map((tk) => tk.trim()).filter(Boolean).slice(0, 5);
  if (tokens.length === 0) return text;
  const matcher = new RegExp(`(${tokens.map((tk) => escapeRegExp(tk)).join('|')})`, 'ig');
  const parts = text.split(matcher);
  return parts.map((part, index) => {
    const isMatch = tokens.some((tk) => tk.toLowerCase() === part.toLowerCase());
    if (!isMatch) return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    return (
      <mark key={`${part}-${index}`} className="rounded bg-primary/15 px-0.5 text-inherit">{part}</mark>
    );
  });
}

function formatAmount(cents: number, currency?: string | null) {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function ResultsList({ items, query }: { items: SearchEntityItem[]; query: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (items.length === 0) {
    return <p className="text-[13px] text-text-secondary">{t.searchResults.noResultsInSection}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const Icon = ENTITY_ICONS[item.type] || SearchIcon;
        const colorClass = ENTITY_COLORS[item.type] || 'text-text-secondary';

        return (
          <button
            key={`${item.type}-${item.id}`}
            type="button"
            onClick={() => navigate(getSearchItemHref(item.type, item.id, { clientId: item.clientId, refId: item.refId }))}
            className="w-full rounded-xl border border-outline bg-surface px-3 py-3 text-left transition-colors hover:bg-surface-secondary"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center">
                <Icon size={16} strokeWidth={1.75} className={colorClass} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-text-primary">{highlightText(item.title, query)}</p>
                <div className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                  {item.subtitle ? (
                    <span className="truncate">{highlightText(item.subtitle, query)}</span>
                  ) : null}
                  {item.clientName && item.clientName !== item.subtitle ? (
                    <>
                      {item.subtitle ? <span>·</span> : null}
                      <span className="truncate">{item.clientName}</span>
                    </>
                  ) : null}
                  {item.amountCents != null && item.amountCents > 0 ? (
                    <>
                      <span>·</span>
                      <span className="font-medium">{formatAmount(item.amountCents, item.currency)}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {item.status ? <StatusBadge status={item.status} size="sm" /> : null}
                <p className="text-[10px] text-text-tertiary">
                  {new Date(item.createdAt).toLocaleDateString()}
                </p>
                {item.date ? (
                  <p className="text-[10px] text-text-tertiary">
                    {new Date(item.date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
                  </p>
                ) : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PaginationControls({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1} className="glass-button !px-2 !py-1 disabled:opacity-50">
        <ChevronLeft size={14} />
      </button>
      <p className="text-[11px] text-text-secondary">Page {page} / {totalPages}</p>
      <button type="button" onClick={() => onChange(page + 1)} disabled={page >= totalPages} className="glass-button !px-2 !py-1 disabled:opacity-50">
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

const TAB_ORDER: Array<{ key: SearchTab; labelKey: EntityGroupKey | 'all' }> = [
  { key: 'all', labelKey: 'all' },
  { key: 'clients', labelKey: 'clients' },
  { key: 'properties', labelKey: 'properties' },
  { key: 'jobs', labelKey: 'jobs' },
  { key: 'quotes', labelKey: 'quotes' },
  { key: 'agreements', labelKey: 'agreements' },
  { key: 'requests', labelKey: 'requests' },
  { key: 'invoices', labelKey: 'invoices' },
  { key: 'payments', labelKey: 'payments' },
  { key: 'leads', labelKey: 'leads' },
  { key: 'teams', labelKey: 'teams' },
  { key: 'events', labelKey: 'events' },
];

const GROUP_KEY_TO_ENTITY_TYPE: Record<string, SearchEntityType> = {
  clients: 'client', properties: 'property', jobs: 'job', agreements: 'agreement', payments: 'payment',
  leads: 'lead', invoices: 'invoice', quotes: 'quote', requests: 'request', teams: 'team', events: 'event',
};

export default function SearchResultsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawQuery = searchParams.get('q') || '';
  const query = rawQuery.trim();

  const rawTab = (searchParams.get('tab') || 'all').toLowerCase();
  const tab: SearchTab = ALL_ENTITY_GROUP_KEYS.includes(rawTab as EntityGroupKey) ? (rawTab as SearchTab) : 'all';

  const page = parsePage(searchParams.get('page'), 1);
  const entityPages: Record<EntityGroupKey, number> = {} as any;
  for (const key of ALL_ENTITY_GROUP_KEYS) {
    entityPages[key] = parsePage(searchParams.get(`${key}Page`), 1);
  }

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SearchResultsPayload | null>(null);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const options: any = { q: query, tab, page, pageSize: PAGE_SIZE };
        for (const key of ALL_ENTITY_GROUP_KEYS) {
          options[`${key}Page`] = entityPages[key];
        }
        const result = await fetchSearchResults(options);
        if (!cancelled) setPayload(result);
      } catch (err: any) {
        if (!cancelled) {
          setPayload(null);
          setError(err?.message || t.searchResults.failedLoad);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [query, tab, page, ...ALL_ENTITY_GROUP_KEYS.map((k) => entityPages[k])]);

  const counts = payload?.counts || { clients: 0, properties: 0, jobs: 0, agreements: 0, payments: 0, leads: 0, invoices: 0, quotes: 0, requests: 0, teams: 0, events: 0, all: 0 };

  const tabs = useMemo(
    () => TAB_ORDER.map((tab) => ({
      key: tab.key,
      label: tab.labelKey === 'all'
        ? `All (${counts.all})`
        : `${getSearchEntityLabel(GROUP_KEY_TO_ENTITY_TYPE[tab.key] || 'client')} (${counts[tab.labelKey as EntityGroupKey] || 0})`,
    })),
    [counts]
  );

  if (!query) return <Navigate to="/dashboard" replace />;

  function updateSearchParams(mutator: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams);
    mutator(next);
    setSearchParams(next);
  }

  function changeTab(nextTab: SearchTab) {
    updateSearchParams((next) => {
      next.set('tab', nextTab);
      if (nextTab === 'all') {
        next.delete('page');
      } else {
        next.set('page', '1');
      }
    });
  }

  function updateEntityPage(entity: EntityGroupKey, nextPage: number) {
    updateSearchParams((next) => {
      next.set(`${entity}Page`, String(Math.max(1, nextPage)));
      next.set('tab', 'all');
    });
  }

  function updateSingleTabPage(nextPage: number) {
    updateSearchParams((next) => {
      next.set('page', String(Math.max(1, nextPage)));
      next.set('tab', tab);
    });
  }

  const groups = payload?.groups;

  return (
    <div className="space-y-6">
      <PageHeader title={`${t.searchResults.title} '${query}'`} subtitle={t.searchResults.globalSearch} />

      {/* Tab bar */}
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tabOption) => (
          <button
            key={tabOption.key}
            type="button"
            onClick={() => changeTab(tabOption.key)}
            className={cn(
              'rounded-xl border px-3 py-1.5 text-[13px] transition-colors',
              tab === tabOption.key
                ? 'border-text-primary bg-primary text-white'
                : 'border-outline bg-surface text-text-secondary hover:bg-surface-secondary'
            )}
          >
            {tabOption.label}
          </button>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading ? (
        <div className="section-card p-6">
          <div className="h-10 w-56 rounded bg-surface-secondary" />
          <div className="mt-3 h-8 w-full rounded bg-surface-secondary" />
          <div className="mt-2 h-8 w-full rounded bg-surface-secondary" />
          <div className="mt-2 h-8 w-2/3 rounded bg-surface-secondary" />
        </div>
      ) : null}

      {/* Error */}
      {!loading && error ? (
        <div className="section-card border-danger/30 p-4 text-[13px] text-danger">{error}</div>
      ) : null}

      {/* Results */}
      {!loading && !error && groups ? (
        <div className="space-y-4">
          {tab === 'all' ? (
            ALL_ENTITY_GROUP_KEYS.map((groupKey) => {
              const group = groups[groupKey];
              if (!group || group.total === 0) return null;

              const entityType = (GROUP_KEY_TO_ENTITY_TYPE[groupKey] || 'client') as SearchEntityType;

              return (
                <section key={groupKey} className="section-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-[13px] font-bold text-text-primary">
                      {getSearchEntityLabel(entityType)} ({group.total})
                    </h2>
                    {group.total > group.items.length ? (
                      <button
                        type="button"
                        onClick={() => changeTab(groupKey as SearchTab)}
                        className="text-[11px] font-medium text-primary underline"
                      >
                        {t.searchResults.openTab.replace('{entity}', getSearchEntityLabel(entityType))}
                      </button>
                    ) : null}
                  </div>
                  <ResultsList items={group.items} query={query} />
                  <PaginationControls
                    page={group.page}
                    totalPages={group.totalPages}
                    onChange={(nextPage) => updateEntityPage(groupKey, nextPage)}
                  />
                </section>
              );
            })
          ) : (
            <section className="section-card p-4">
              <ResultsList items={groups[tab as EntityGroupKey]?.items || []} query={query} />
              <PaginationControls
                page={groups[tab as EntityGroupKey]?.page || 1}
                totalPages={groups[tab as EntityGroupKey]?.totalPages || 1}
                onChange={updateSingleTabPage}
              />
            </section>
          )}

          {counts.all === 0 ? (
            <div className="section-card p-8 text-center">
              <SearchIcon className="mx-auto h-8 w-8 text-text-tertiary" />
              <p className="mt-2 text-[13px] text-text-secondary">{t.searchResults.noMatchingResults}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
