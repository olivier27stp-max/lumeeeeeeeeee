import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Calendar, ChevronLeft, ChevronRight, FileText, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import CreateInvoiceModal from '../components/CreateInvoiceModal';
import {
  fetchInvoicesKpis30d,
  formatMoneyFromCents,
  getInvoiceRowUiStatus,
  InvoiceRangeFilter,
  InvoiceSortKey,
  InvoiceStatusFilter,
  listInvoices,
} from '../lib/invoicesApi';
import { cn, formatDate } from '../lib/utils';
import { PageHeader, StatCard, EmptyState } from '../components/ui';
import { FilterSelect } from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';

const PAGE_SIZE = 25;

const STATUS_OPTIONS: Array<{ value: InvoiceStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent_not_due', label: 'Sent (not due)' },
  { value: 'past_due', label: 'Past due' },
  { value: 'paid', label: 'Paid' },
];

const RANGE_OPTIONS: Array<{ value: InvoiceRangeFilter; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
];

function parseStatus(raw: string | null): InvoiceStatusFilter {
  const value = (raw || '').toLowerCase();
  if (value === 'draft' || value === 'sent_not_due' || value === 'past_due' || value === 'paid') return value;
  return 'all';
}

function parseRange(raw: string | null): InvoiceRangeFilter {
  const value = (raw || '').toLowerCase();
  if (value === '30d' || value === 'this_month' || value === 'custom') return value;
  return 'all';
}

function parseSort(raw: string | null): InvoiceSortKey {
  const allowed: InvoiceSortKey[] = [
    'client_asc', 'client_desc', 'invoice_number_asc', 'invoice_number_desc',
    'due_date_asc', 'due_date_desc', 'status_asc', 'status_desc',
    'total_asc', 'total_desc', 'balance_asc', 'balance_desc',
  ];
  if (raw && allowed.includes(raw as InvoiceSortKey)) return raw as InvoiceSortKey;
  return 'due_date_desc';
}

function parsePage(raw: string | null) {
  const value = Number(raw || '1');
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
}

export default function Invoices() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const status = parseStatus(searchParams.get('status'));
  const range = parseRange(searchParams.get('range'));
  const sort = parseSort(searchParams.get('sort'));
  const page = parsePage(searchParams.get('page'));
  const q = (searchParams.get('q') || '').trim();
  const fromDate = searchParams.get('from') || '';
  const toDate = searchParams.get('to') || '';

  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  const kpisQuery = useQuery({
    queryKey: ['invoicesKpis30d'],
    queryFn: fetchInvoicesKpis30d,
  });

  const invoicesQuery = useQuery({
    queryKey: ['invoicesTable', status, range, sort, page, q, fromDate, toDate],
    queryFn: () =>
      listInvoices({
        status, range, sort, page, q,
        pageSize: PAGE_SIZE,
        fromDate: range === 'custom' ? fromDate || null : null,
        toDate: range === 'custom' ? toDate || null : null,
      }),
  });

  const rows = invoicesQuery.data?.rows || [];
  const total = invoicesQuery.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function updateParams(updater: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams);
    updater(next);
    setSearchParams(next);
  }

  function applyStatus(nextStatus: InvoiceStatusFilter) {
    updateParams((next) => {
      if (nextStatus === 'all') next.delete('status');
      else next.set('status', nextStatus);
      next.delete('page');
    });
  }

  function applyRange(nextRange: InvoiceRangeFilter) {
    updateParams((next) => {
      if (nextRange === 'all') next.delete('range');
      else next.set('range', nextRange);
      if (nextRange !== 'custom') { next.delete('from'); next.delete('to'); }
      next.delete('page');
    });
  }

  function applySort(column: 'client' | 'invoice_number' | 'due_date' | 'status' | 'total' | 'balance') {
    const prefix = `${column}_`;
    const isSameColumn = sort.startsWith(prefix);
    const nextSort = (isSameColumn
      ? sort.endsWith('_asc') ? `${column}_desc` : `${column}_asc`
      : `${column}_asc`) as InvoiceSortKey;
    updateParams((next) => {
      next.set('sort', nextSort);
      next.delete('page');
    });
  }

  function applySearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateParams((next) => {
      const trimmed = searchInput.trim();
      if (!trimmed) next.delete('q');
      else next.set('q', trimmed);
      next.delete('page');
    });
  }

  const kpis = kpisQuery.data;

  const overviewRows = useMemo(
    () => [
      { id: 'past_due' as const, label: 'Past due', count: kpis?.past_due_count || 0, amount: kpis?.past_due_total_cents || 0, dot: 'bg-danger' },
      { id: 'sent_not_due' as const, label: 'Sent but not due', count: kpis?.sent_not_due_count || 0, amount: kpis?.sent_not_due_total_cents || 0, dot: 'bg-warning' },
      { id: 'draft' as const, label: 'Draft', count: kpis?.draft_count || 0, amount: kpis?.draft_total_cents || 0, dot: 'bg-text-tertiary' },
    ],
    [kpis]
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Invoices" subtitle={`${total} total`} icon={FileText} iconColor="green">
        <button type="button" onClick={() => setIsCreateModalOpen(true)} className="glass-button-primary inline-flex items-center gap-1.5">
          <Plus size={14} />
          New Invoice
        </button>
      </PageHeader>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
        <div className="section-card p-4">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-3">Overview</h3>
          <div className="space-y-2">
            {overviewRows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => applyStatus(row.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors',
                  status === row.id ? 'bg-primary text-white' : 'hover:bg-surface-secondary text-text-secondary'
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <span className={cn('h-2 w-2 rounded-full', status === row.id ? 'bg-white' : row.dot)} />
                  {row.label} ({row.count})
                </span>
                <span className="font-semibold tabular-nums">{formatMoneyFromCents(row.amount)}</span>
              </button>
            ))}
          </div>
        </div>

        <StatCard label="Issued" subtitle="Past 30 days" value={kpis?.issued_30d_count ?? 0} iconColor="blue" />
        <StatCard label="Average invoice" subtitle="Past 30 days" value={formatMoneyFromCents(kpis?.avg_invoice_30d_cents || 0)} iconColor="green" />
        <StatCard
          label="Payment time"
          subtitle="Last 30 days"
          value={kpis?.avg_payment_time_days_30d == null ? '--' : `${kpis.avg_payment_time_days_30d.toFixed(1)} days`}
          iconColor="purple"
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            value={status}
            onChange={(v) => applyStatus(v as InvoiceStatusFilter)}
            options={STATUS_OPTIONS}
          />
          <FilterSelect
            value={range}
            onChange={(v) => applyRange(v as InvoiceRangeFilter)}
            icon={<Calendar size={13} />}
            options={RANGE_OPTIONS}
          />
          {range === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => updateParams((next) => {
                  if (!e.target.value) next.delete('from');
                  else next.set('from', e.target.value);
                  next.delete('page');
                })}
                className="glass-input !py-1.5 text-xs"
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => updateParams((next) => {
                  if (!e.target.value) next.delete('to');
                  else next.set('to', e.target.value);
                  next.delete('page');
                })}
                className="glass-input !py-1.5 text-xs"
              />
            </div>
          )}
        </div>

        <form onSubmit={applySearch} className="flex items-center gap-2 w-full max-w-xs">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search invoices..."
            className="glass-input w-full"
          />
          <button type="submit" className="glass-button text-xs">Search</button>
        </form>
      </div>

      {/* Table */}
      <div className="section-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                {([
                  { key: 'client', label: 'Client' },
                  { key: 'invoice_number', label: 'Invoice #' },
                  { key: 'due_date', label: 'Due date' },
                ] as const).map((col) => (
                  <th key={col.key} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                    <button type="button" onClick={() => applySort(col.key)} className="inline-flex items-center gap-1">
                      {col.label} <ArrowUpDown size={12} className="text-text-tertiary" />
                    </button>
                  </th>
                ))}
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Subject</th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  <button type="button" onClick={() => applySort('status')} className="inline-flex items-center gap-1">
                    Status <ArrowUpDown size={12} className="text-text-tertiary" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  <button type="button" onClick={() => applySort('total')} className="inline-flex items-center gap-1">
                    Total <ArrowUpDown size={12} className="text-text-tertiary" />
                  </button>
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  <button type="button" onClick={() => applySort('balance')} className="inline-flex items-center gap-1">
                    Balance <ArrowUpDown size={12} className="text-text-tertiary" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoicesQuery.isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b border-border">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-full max-w-[100px]" /></td>
                    ))}
                  </tr>
                ))}

              {!invoicesQuery.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10">
                    <EmptyState icon={FileText} title="No invoices found" description="Adjust your filters or create a new invoice." />
                  </td>
                </tr>
              )}

              {!invoicesQuery.isLoading &&
                rows.map((row) => {
                  const uiStatus = getInvoiceRowUiStatus(row);
                  return (
                    <tr
                      key={row.id}
                      className="table-row-hover cursor-pointer"
                      onClick={() => navigate(`/invoices/${row.id}`)}
                    >
                      <td className="px-4 py-3 text-[13px] font-medium text-text-primary">{row.client_name}</td>
                      <td className="px-4 py-3 text-[13px] text-text-secondary">{row.invoice_number}</td>
                      <td className="px-4 py-3 text-[13px] text-text-secondary tabular-nums">{row.due_date ? formatDate(row.due_date) : '--'}</td>
                      <td className="px-4 py-3 text-[13px] text-text-secondary">{row.subject || '--'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={uiStatus} />
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] font-medium text-text-primary tabular-nums">
                        {formatMoneyFromCents(row.total_cents)}
                      </td>
                      <td className="px-4 py-3 text-right text-[13px] font-medium text-text-primary tabular-nums">
                        {formatMoneyFromCents(row.balance_cents)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <p className="text-xs text-text-tertiary">Page {page} of {totalPages}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => updateParams((next) => {
                const p = Math.max(1, page - 1);
                if (p === 1) next.delete('page');
                else next.set('page', String(p));
              })}
              className="glass-button !px-2"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => updateParams((next) => next.set('page', String(Math.min(totalPages, page + 1))))}
              className="glass-button !px-2"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      <CreateInvoiceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
