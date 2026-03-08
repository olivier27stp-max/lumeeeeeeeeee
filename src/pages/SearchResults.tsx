import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, ChevronLeft, ChevronRight, Search as SearchIcon, Users, Workflow } from 'lucide-react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { SearchEntityItem, SearchResultsPayload, SearchTab, fetchSearchResults } from '../lib/globalSearchApi';
import { cn } from '../lib/utils';
import { escapeRegExp, getSearchEntityLabel, getSearchItemHref } from '../lib/searchHelpers';
import PageHeader from '../components/ui/PageHeader';

const PAGE_SIZE = 20;

function parsePage(raw: string | null, fallback = 1) {
  const parsed = Number(raw || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

function highlightText(text: string, query: string) {
  const normalized = query.trim();
  if (!normalized) return text;

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (tokens.length === 0) return text;

  const matcher = new RegExp(`(${tokens.map((token) => escapeRegExp(token)).join('|')})`, 'ig');
  const parts = text.split(matcher);

  return parts.map((part, index) => {
    const isMatch = tokens.some((token) => token.toLowerCase() === part.toLowerCase());
    if (!isMatch) return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    return (
      <mark key={`${part}-${index}`} className="rounded bg-amber-200/70 px-0.5 text-inherit">
        {part}
      </mark>
    );
  });
}

function getEntityIcon(type: SearchEntityItem['type']) {
  if (type === 'client') return Users;
  if (type === 'job') return Briefcase;
  return Workflow;
}

function ResultsList({
  items,
  query,
}: {
  items: SearchEntityItem[];
  query: string;
}) {
  const navigate = useNavigate();

  if (items.length === 0) {
    return <p className="text-[13px] text-text-secondary">No results in this section.</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const Icon = getEntityIcon(item.type);
        return (
          <button
            key={`${item.type}-${item.id}`}
            type="button"
            onClick={() => navigate(getSearchItemHref(item.type, item.id))}
            className="w-full rounded-xl border-[1.5px] border-outline-subtle bg-white px-3 py-3 text-left transition-colors hover:bg-surface-secondary"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-black/[0.03]">
                <Icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-text-primary">{highlightText(item.title, query)}</p>
                {item.subtitle ? (
                  <p className="truncate text-[11px] text-text-secondary">{highlightText(item.subtitle, query)}</p>
                ) : null}
              </div>
              <p className="text-[11px] text-text-tertiary">{new Date(item.createdAt).toLocaleDateString()}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function PaginationControls({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (nextPage: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="mt-3 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="glass-button !px-2 !py-1 disabled:opacity-50"
      >
        <ChevronLeft size={14} />
      </button>
      <p className="text-[11px] text-text-secondary">
        Page {page} / {totalPages}
      </p>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="glass-button !px-2 !py-1 disabled:opacity-50"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

export default function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawQuery = searchParams.get('q') || '';
  const query = rawQuery.trim();

  const rawTab = (searchParams.get('tab') || 'all').toLowerCase();
  const tab: SearchTab = rawTab === 'clients' || rawTab === 'jobs' || rawTab === 'leads' ? rawTab : 'all';

  const page = parsePage(searchParams.get('page'), 1);
  const clientsPage = parsePage(searchParams.get('clientsPage'), 1);
  const jobsPage = parsePage(searchParams.get('jobsPage'), 1);
  const leadsPage = parsePage(searchParams.get('leadsPage'), 1);

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
        const result = await fetchSearchResults({
          q: query,
          tab,
          page,
          pageSize: PAGE_SIZE,
          clientsPage,
          jobsPage,
          leadsPage,
        });

        if (!cancelled) setPayload(result);
      } catch (err: any) {
        if (!cancelled) {
          setPayload(null);
          setError(err?.message || 'Failed to load search results.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [clientsPage, jobsPage, leadsPage, page, query, tab]);

  const counts = payload?.counts || { clients: 0, jobs: 0, leads: 0, all: 0 };

  const tabs = useMemo(
    () => [
      { key: 'all' as const, label: `All (${counts.all})` },
      { key: 'clients' as const, label: `Clients (${counts.clients})` },
      { key: 'jobs' as const, label: `Jobs (${counts.jobs})` },
      { key: 'leads' as const, label: `Leads (${counts.leads})` },
    ],
    [counts.all, counts.clients, counts.jobs, counts.leads]
  );

  if (!query) {
    return <Navigate to="/dashboard" replace />;
  }

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

  function updateEntityPage(entity: 'clients' | 'jobs' | 'leads', nextPage: number) {
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
      <PageHeader title={`Search results for '${query}'`} subtitle="Global search" />

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((tabOption) => (
          <button
            key={tabOption.key}
            type="button"
            onClick={() => changeTab(tabOption.key)}
            className={cn(
              'rounded-xl border px-3 py-1.5 text-[13px] transition-colors',
              tab === tabOption.key
                ? 'border-black bg-black text-white'
                : 'border-outline-subtle bg-white text-text-secondary hover:bg-surface-secondary'
            )}
          >
            {tabOption.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="section-card p-6">
          <div className="h-10 w-56 rounded bg-surface-secondary" />
          <div className="mt-3 h-8 w-full rounded bg-surface-secondary" />
          <div className="mt-2 h-8 w-full rounded bg-surface-secondary" />
          <div className="mt-2 h-8 w-2/3 rounded bg-surface-secondary" />
        </div>
      ) : null}

      {!loading && error ? (
        <div className="section-card border-rose-100 p-4 text-[13px] text-rose-700">{error}</div>
      ) : null}

      {!loading && !error && groups ? (
        <div className="space-y-4">
          {tab === 'all' ? (
            (['clients', 'jobs', 'leads'] as const).map((groupKey) => {
              const group = groups[groupKey];
              return (
                <section key={groupKey} className="section-card p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-[13px] font-bold text-text-primary">
                      {groupKey[0].toUpperCase()}
                      {groupKey.slice(1)} ({group.total})
                    </h2>
                    {group.total > group.items.length ? (
                      <button
                        type="button"
                        onClick={() => changeTab(groupKey)}
                        className="text-[11px] font-medium text-text-secondary underline"
                      >
                        Open {getSearchEntityLabel(groupKey === 'clients' ? 'client' : groupKey === 'jobs' ? 'job' : 'lead')} tab
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
              {tab === 'clients' ? <ResultsList items={groups.clients.items} query={query} /> : null}
              {tab === 'jobs' ? <ResultsList items={groups.jobs.items} query={query} /> : null}
              {tab === 'leads' ? <ResultsList items={groups.leads.items} query={query} /> : null}

              <PaginationControls
                page={tab === 'clients' ? groups.clients.page : tab === 'jobs' ? groups.jobs.page : groups.leads.page}
                totalPages={
                  tab === 'clients' ? groups.clients.totalPages : tab === 'jobs' ? groups.jobs.totalPages : groups.leads.totalPages
                }
                onChange={updateSingleTabPage}
              />
            </section>
          )}

          {counts.all === 0 ? (
            <div className="section-card p-8 text-center">
              <SearchIcon className="mx-auto h-8 w-8 text-text-tertiary" />
              <p className="mt-2 text-[13px] text-text-secondary">No matching clients, jobs, or leads found.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
