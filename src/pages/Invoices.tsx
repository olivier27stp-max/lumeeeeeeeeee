/* ═══════════════════════════════════════════════════════════════
   Page — Invoices (Modern CRM-grade UI)
   Tab filters with counts, rich table with client avatar,
   actions menu, search, pagination, KPI cards.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown, Calendar, ChevronLeft, ChevronRight, Download, FileText,
  Plus, Eye, EyeOff, Search, MoreHorizontal, Send, CheckCircle2, Copy,
  Trash2, Pencil, User,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import CreateInvoiceModal from '../components/CreateInvoiceModal';
import InvoiceTemplatesTab from '../components/InvoiceTemplatesTab';
import {
  fetchInvoicesKpis30d,
  formatMoneyFromCents,
  getInvoiceRowUiStatus,
  type InvoiceRangeFilter,
  type InvoiceSortKey,
  type InvoiceStatusFilter,
  type InvoiceRow,
  listInvoices,
  createInvoiceDraft,
  sendInvoice,
} from '../lib/invoicesApi';
import { cn, formatDate } from '../lib/utils';
import { exportToCsv } from '../lib/exportCsv';
import { PageHeader, EmptyState } from '../components/ui';
import StatusBadge from '../components/ui/StatusBadge';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import BulkActionBar from '../components/BulkActionBar';
import type { InvoiceTemplate } from '../lib/invoiceTemplatesApi';

const PAGE_SIZE = 20;

// ─── URL param parsers ─────────────────────────────────────────

function parseStatus(raw: string | null): InvoiceStatusFilter {
  const v = (raw || '').toLowerCase();
  if (v === 'draft' || v === 'sent_not_due' || v === 'past_due' || v === 'paid') return v;
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
  const v = Number(raw || '1');
  return Number.isFinite(v) ? Math.max(1, Math.trunc(v)) : 1;
}

// ─── Status tab config ─────────────────────────────────────────

type TabDef = { key: InvoiceStatusFilter; label: string; labelFr: string; dot: string };
const TABS: TabDef[] = [
  { key: 'all',         label: 'All Invoices',    labelFr: 'Toutes',       dot: '' },
  { key: 'draft',       label: 'Draft',           labelFr: 'Brouillons',   dot: 'bg-gray-400' },
  { key: 'sent_not_due',label: 'Open',            labelFr: 'Ouvertes',     dot: 'bg-neutral-500' },
  { key: 'past_due',    label: 'Past Due',        labelFr: 'En retard',    dot: 'bg-red-500' },
  { key: 'paid',        label: 'Paid',            labelFr: 'Payées',       dot: 'bg-green-500' },
];

// ─── Main Component ────────────────────────────────────────────

type MainTab = 'invoices' | 'templates';

export default function Invoices() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('invoices');
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());

  const status = parseStatus(searchParams.get('status'));
  const sort = parseSort(searchParams.get('sort'));
  const page = parsePage(searchParams.get('page'));
  const q = (searchParams.get('q') || '').trim();

  const [searchInput, setSearchInput] = useState(q);
  useEffect(() => { setSearchInput(q); }, [q]);

  // Listen for command palette create event
  useEffect(() => {
    const handler = () => setIsCreateModalOpen(true);
    window.addEventListener('crm:open-new-invoice', handler);
    return () => window.removeEventListener('crm:open-new-invoice', handler);
  }, []);

  // ─── Data queries ──────────────────────────────────────────

  const kpisQuery = useQuery({
    queryKey: ['invoicesKpis30d'],
    queryFn: fetchInvoicesKpis30d,
  });

  const invoicesQuery = useQuery({
    queryKey: ['invoicesTable', status, sort, page, q],
    queryFn: () => listInvoices({
      status, range: 'all', sort, page, q,
      pageSize: PAGE_SIZE,
    }),
  });

  const rows = invoicesQuery.data?.rows || [];
  const total = invoicesQuery.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // View tracking
  const invoiceIds = rows.map((r) => r.id);
  const viewQuery = useQuery({
    queryKey: ['invoicesViewStatus', invoiceIds],
    queryFn: async () => {
      if (invoiceIds.length === 0) return {};
      const { data } = await supabase
        .from('invoices')
        .select('id, is_viewed, viewed_at, view_count')
        .in('id', invoiceIds);
      const map: Record<string, { is_viewed: boolean; viewed_at: string | null; view_count: number }> = {};
      for (const r of data || []) {
        map[r.id] = { is_viewed: !!r.is_viewed, viewed_at: r.viewed_at, view_count: Number(r.view_count || 0) };
      }
      return map;
    },
    enabled: invoiceIds.length > 0,
  });
  const viewMap = viewQuery.data || {};

  // Fetch client emails for display
  const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
  const clientsQuery = useQuery({
    queryKey: ['invoiceClients', clientIds],
    queryFn: async () => {
      if (clientIds.length === 0) return {};
      const { data } = await supabase
        .from('clients_active')
        .select('id, first_name, last_name, email, company')
        .in('id', clientIds);
      const map: Record<string, { email: string | null; initials: string }> = {};
      for (const c of data || []) {
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || '';
        const initials = name
          .split(' ')
          .slice(0, 2)
          .map((w: string) => w[0]?.toUpperCase() || '')
          .join('');
        map[c.id] = { email: c.email || null, initials: initials || '?' };
      }
      return map;
    },
    enabled: clientIds.length > 0,
  });
  const clientMap = clientsQuery.data || {};

  // ─── KPI counts per tab ────────────────────────────────────

  const kpis = kpisQuery.data;
  // Fetch paid count separately since the KPI RPC doesn't include it
  const paidCountQuery = useQuery({
    queryKey: ['invoices-paid-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .eq('status', 'paid');
      if (error) return 0;
      return count || 0;
    },
    staleTime: 30_000,
  });

  const tabCounts: Record<InvoiceStatusFilter, number> = useMemo(() => ({
    all: (kpis?.draft_count || 0) + (kpis?.sent_not_due_count || 0) + (kpis?.past_due_count || 0) + (paidCountQuery.data || 0),
    draft: kpis?.draft_count || 0,
    sent_not_due: kpis?.sent_not_due_count || 0,
    past_due: kpis?.past_due_count || 0,
    paid: paidCountQuery.data || 0,
  }), [kpis, paidCountQuery.data]);

  // ─── URL state helpers ─────────────────────────────────────

  function updateParams(updater: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams);
    updater(next);
    setSearchParams(next);
  }

  function applyStatus(s: InvoiceStatusFilter) {
    updateParams((next) => {
      if (s === 'all') next.delete('status'); else next.set('status', s);
      next.delete('page');
    });
  }

  function applySort(column: 'client' | 'invoice_number' | 'due_date' | 'status' | 'total' | 'balance') {
    const prefix = `${column}_`;
    const isSame = sort.startsWith(prefix);
    const nextSort = (isSame
      ? sort.endsWith('_asc') ? `${column}_desc` : `${column}_asc`
      : `${column}_asc`) as InvoiceSortKey;
    updateParams((next) => { next.set('sort', nextSort); next.delete('page'); });
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    updateParams((next) => {
      const trimmed = searchInput.trim();
      if (!trimmed) next.delete('q'); else next.set('q', trimmed);
      next.delete('page');
    });
  }

  function goToPage(p: number) {
    updateParams((next) => {
      if (p <= 1) next.delete('page'); else next.set('page', String(p));
    });
  }

  // ─── Actions ───────────────────────────────────────────────

  const handleExportCsv = async () => {
    try {
      const { data, error: fetchErr } = await supabase.rpc('rpc_list_invoices', {
        p_status: 'all', p_range: 'all', p_sort: 'due_date_desc',
        p_limit: 10000, p_offset: 0, p_q: null, p_from: null, p_to: null, p_org: null,
      });
      if (fetchErr) throw fetchErr;
      const csvRows = (data || []).map((inv: any) => [
        inv.invoice_number || '', inv.client_name || '',
        formatMoneyFromCents(inv.total_cents || 0), inv.status || '',
        inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '',
      ]);
      exportToCsv(
        `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
        ['Invoice #', 'Client', 'Amount', 'Status', 'Due Date'],
        csvRows,
      );
      toast.success(t.invoices.csvExported);
    } catch (err: any) {
      toast.error(err?.message || 'Export failed');
    }
  };

  const handleMarkPaid = async (row: InvoiceRow) => {
    try {
      await supabase
        .from('invoices')
        .update({
          paid_cents: row.total_cents,
          balance_cents: 0,
          status: 'paid',
          paid_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      // Sync: update linked job status to "billed" when invoice is fully paid
      if (row.job_id) {
        supabase
          .from('jobs')
          .update({ status: 'billed', updated_at: new Date().toISOString() })
          .eq('id', row.job_id)
          .in('status', ['completed', 'in_progress'])
          .then(({ error: jobErr }) => {
            if (jobErr) console.warn('Failed to sync job status after payment:', jobErr.message);
          });
      }

      queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
      queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] });
      queryClient.invalidateQueries({ queryKey: ['jobsTable'] });
      toast.success(t.invoices.invoiceMarkedAsPaid);
    } catch (err: any) {
      toast.error(err?.message || 'Error');
    }
  };

  const handleDuplicate = async (row: InvoiceRow) => {
    try {
      const draft = await createInvoiceDraft({
        clientId: row.client_id,
        subject: row.subject ? `${row.subject} (copy)` : null,
        dueDate: null,
      });
      toast.success(t.invoiceDetails.invoiceDuplicated);
      navigate(`/invoices/${draft.id}`);
    } catch (err: any) {
      toast.error(err?.message || 'Error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t.invoices.deleteThisInvoice)) return;
    try {
      await supabase.from('invoices').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
      queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] });
      toast.success(t.invoices.invoiceDeleted);
    } catch (err: any) {
      toast.error(err?.message || 'Error');
    }
  };

  const handleSend = async (row: InvoiceRow) => {
    const client = clientMap[row.client_id];
    if (!client?.email) {
      toast.error(t.invoices.noClientEmail);
      return;
    }
    try {
      await sendInvoice({ invoiceId: row.id, channels: ['email'], toEmail: client.email });
      queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
      toast.success(t.invoices.invoiceSent);
    } catch (err: any) {
      toast.error(err?.message || 'Error');
    }
  };

  // ─── Sort indicator helper ─────────────────────────────────

  const sortIcon = (col: string) => {
    if (!sort.startsWith(`${col}_`)) return <ArrowUpDown size={11} className="text-text-tertiary/50" />;
    return sort.endsWith('_asc')
      ? <ArrowUpDown size={11} className="text-text-secondary" />
      : <ArrowUpDown size={11} className="text-text-secondary rotate-180" />;
  };

  // ─── Pagination range ──────────────────────────────────────

  const pageNumbers = useMemo(() => {
    const pages: (number | '...')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  }, [page, totalPages]);

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <div className="space-y-5">
      {/* ─── Header ─── */}
      <PageHeader
        title={t.commandPalette.invoices}
        subtitle={t.invoices.totalInvoices}
        icon={FileText}
        iconColor="green"
      >
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void handleExportCsv()} className="btn-secondary text-[13px] inline-flex items-center gap-1.5">
            <Download size={14} />
            {t.invoices.export}
          </button>
          <button type="button" onClick={() => navigate('/invoices/new')} className="btn-primary text-[13px] inline-flex items-center gap-1.5">
            <Plus size={14} />
            {t.invoiceEdit.newInvoice}
          </button>
        </div>
      </PageHeader>

      {/* ─── Main Tabs: Invoices | Templates ─── */}
      <div className="flex items-center gap-1 border-b border-outline pb-0">
        <button
          onClick={() => setMainTab('invoices')}
          className={cn(
            'px-4 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px',
            mainTab === 'invoices'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-tertiary hover:text-text-secondary',
          )}
        >
          {t.commandPalette.invoices}
        </button>
        <button
          onClick={() => setMainTab('templates')}
          className={cn(
            'px-4 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px',
            mainTab === 'templates'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-tertiary hover:text-text-secondary',
          )}
        >
          {t.invoices.templates}
        </button>
      </div>

      {/* ─── Templates Tab Content ─── */}
      {mainTab === 'templates' && (
        <InvoiceTemplatesTab
          onUseTemplate={(template: InvoiceTemplate) => {
            setMainTab('invoices');
            setIsCreateModalOpen(true);
          }}
        />
      )}

      {/* ─── Invoices Tab Content ─── */}
      {mainTab === 'invoices' && <>

      {/* ─── Status Tabs + Search ─── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const isActive = status === tab.key;
            const count = tab.key === 'all' ? total : (tabCounts[tab.key] || 0);
            return (
              <button
                key={tab.key}
                onClick={() => applyStatus(tab.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all whitespace-nowrap',
                  isActive
                    ? 'bg-text-primary text-surface shadow-sm'
                    : 'text-text-secondary hover:bg-surface-secondary',
                )}
              >
                {tab.dot && <span className={cn('w-1.5 h-1.5 rounded-full', isActive ? 'bg-white' : tab.dot)} />}
                {language === 'fr' ? tab.labelFr : tab.label}
                <span className={cn(
                  'ml-0.5 px-1.5 py-0 rounded-full text-[10px] font-bold',
                  isActive ? 'bg-white/20 text-white' : 'bg-surface-secondary text-text-tertiary',
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <form onSubmit={applySearch} className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t.invoices.searchInvoices}
            className="input-field pl-8 w-full text-[13px]"
            onBlur={() => {
              if (searchInput.trim() !== q) {
                updateParams((next) => {
                  const trimmed = searchInput.trim();
                  if (!trimmed) next.delete('q'); else next.set('q', trimmed);
                  next.delete('page');
                });
              }
            }}
          />
        </form>
      </div>

      {/* ─── Table ─── */}
      <div className="card overflow-visible p-0">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-outline">
                <Th onClick={() => applySort('invoice_number')}>
                  {t.invoices.number} {sortIcon('invoice_number')}
                </Th>
                <Th onClick={() => applySort('client')}>
                  {t.invoices.client} {sortIcon('client')}
                </Th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  Email
                </th>
                <Th onClick={() => applySort('due_date')}>
                  {t.invoices.createEndDate} {sortIcon('due_date')}
                </Th>
                <Th onClick={() => applySort('total')} className="text-right">
                  {t.invoices.amount} {sortIcon('total')}
                </Th>
                <Th onClick={() => applySort('status')}>
                  {t.automations.status} {sortIcon('status')}
                </Th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                  {t.invoiceEdit.subject}
                </th>
                <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Loading skeleton */}
              {invoicesQuery.isLoading && Array.from({ length: 8 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-outline">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-4 py-3.5">
                      <div className="h-4 bg-surface-secondary rounded animate-pulse" style={{ width: `${60 + Math.random() * 40}%` }} />
                    </td>
                  ))}
                </tr>
              ))}

              {/* Empty state */}
              {!invoicesQuery.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16">
                    <EmptyState
                      icon={FileText}
                      iconColor="green"
                      title={t.invoices.noInvoicesFound}
                      description={t.invoices.adjustYourFiltersOrCreateANewInvoice}
                      action={
                        <button onClick={() => setIsCreateModalOpen(true)} className="btn-primary text-[13px] inline-flex items-center gap-1.5 mt-2">
                          <Plus size={14} />
                          {t.invoices.createInvoice}
                        </button>
                      }
                    />
                  </td>
                </tr>
              )}

              {/* Data rows */}
              {!invoicesQuery.isLoading && rows.map((row) => {
                const uiStatus = getInvoiceRowUiStatus(row);
                const client = clientMap[row.client_id];
                const view = viewMap[row.id];

                return (
                  <tr
                    key={row.id}
                    className="border-b border-outline hover:bg-surface-secondary/50 cursor-pointer transition-colors group"
                    onClick={() => navigate(`/invoices/${row.id}`)}
                  >
                    {/* Number */}
                    <td className="px-4 py-3">
                      <span className="text-[13px] font-semibold text-text-primary dark:text-neutral-400">
                        {row.invoice_number}
                      </span>
                    </td>

                    {/* Client with avatar */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-surface-tertiary flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-bold text-text-secondary">
                            {client?.initials || <User size={12} className="text-text-tertiary" />}
                          </span>
                        </div>
                        <span className="text-[13px] font-medium text-text-primary truncate max-w-[160px]">
                          {row.client_name}
                        </span>
                      </div>
                    </td>

                    {/* Email */}
                    <td className="px-4 py-3">
                      <span className="text-[12px] text-text-tertiary truncate block max-w-[160px]">
                        {client?.email || '--'}
                      </span>
                    </td>

                    {/* Dates */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-[12px] text-text-secondary tabular-nums">
                          {row.issued_at ? formatDate(row.issued_at) : formatDate(row.created_at)}
                        </span>
                        {row.due_date && (
                          <span className={cn(
                            'text-[11px] tabular-nums',
                            uiStatus === 'past_due' ? 'text-red-500 font-medium' : 'text-text-tertiary',
                          )}>
                            {t.invoices.due} {formatDate(row.due_date)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Amount */}
                    <td className="px-4 py-3 text-right">
                      <span className="text-[13px] font-semibold text-text-primary tabular-nums">
                        {formatMoneyFromCents(row.total_cents)}
                      </span>
                      {row.balance_cents > 0 && row.balance_cents !== row.total_cents && (
                        <span className="block text-[10px] text-orange-500 tabular-nums">
                          {t.invoices.bal} {formatMoneyFromCents(row.balance_cents)}
                        </span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={uiStatus} dot />
                        {row.status !== 'draft' && view && (
                          <span title={view.is_viewed
                            ? `${t.invoices.viewed} ${view.view_count}x`
                            : (t.invoices.notOpened)
                          }>
                            {view.is_viewed
                              ? <Eye size={12} className="text-green-500" />
                              : <EyeOff size={12} className="text-text-tertiary/40" />
                            }
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Subject */}
                    <td className="px-4 py-3">
                      <span className="text-[12px] text-text-secondary truncate block max-w-[180px]">
                        {row.subject || '--'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setActionMenuId(actionMenuId === row.id ? null : row.id)}
                          className="p-1.5 rounded-md text-text-tertiary hover:text-text-secondary hover:bg-surface-tertiary transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <MoreHorizontal size={15} />
                        </button>

                        <AnimatePresence>
                          {actionMenuId === row.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setActionMenuId(null)} />
                              <motion.div
                                initial={{ opacity: 0, scale: 0.95, y: -4 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -4 }}
                                transition={{ duration: 0.1 }}
                                className="absolute right-0 top-8 z-50 w-48 bg-surface border border-outline rounded-xl shadow-xl py-1.5"
                              >
                                <ActionItem
                                  icon={<Eye size={13} />}
                                  label={t.invoices.viewInvoice}
                                  onClick={() => { setActionMenuId(null); navigate(`/invoices/${row.id}`); }}
                                />
                                <ActionItem
                                  icon={<Pencil size={13} />}
                                  label={t.invoices.editInvoice}
                                  onClick={() => { setActionMenuId(null); navigate(`/invoices/${row.id}`); }}
                                />
                                {row.status === 'draft' && (
                                  <ActionItem
                                    icon={<Send size={13} />}
                                    label={t.invoices.sendInvoice}
                                    onClick={() => { setActionMenuId(null); handleSend(row); }}
                                  />
                                )}
                                {row.status !== 'paid' && row.balance_cents > 0 && (
                                  <ActionItem
                                    icon={<CheckCircle2 size={13} />}
                                    label={t.invoices.markAsPaid}
                                    onClick={() => { setActionMenuId(null); handleMarkPaid(row); }}
                                    className="text-green-600"
                                  />
                                )}
                                <ActionItem
                                  icon={<Copy size={13} />}
                                  label={t.invoiceDetails.duplicate}
                                  onClick={() => { setActionMenuId(null); handleDuplicate(row); }}
                                />
                                <div className="border-t border-outline my-1" />
                                <ActionItem
                                  icon={<Trash2 size={13} />}
                                  label={t.advancedNotes.delete}
                                  onClick={() => { setActionMenuId(null); handleDelete(row.id); }}
                                  className="text-red-600 hover:!bg-red-50 dark:hover:!bg-red-900/20"
                                />
                              </motion.div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ─── Pagination ─── */}
        <div className="flex items-center justify-between border-t border-outline px-4 py-3">
          <p className="text-[12px] text-text-tertiary">
            {language === 'fr'
              ? `${((page - 1) * PAGE_SIZE) + 1}–${Math.min(page * PAGE_SIZE, total)} sur ${total}`
              : `${((page - 1) * PAGE_SIZE) + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`
            }
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
              className="p-1.5 rounded-md text-text-tertiary hover:bg-surface-secondary disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>

            {pageNumbers.map((p, i) =>
              p === '...' ? (
                <span key={`dots-${i}`} className="px-1 text-[11px] text-text-tertiary">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => goToPage(p as number)}
                  className={cn(
                    'min-w-[28px] h-7 rounded-md text-[12px] font-medium transition-colors',
                    page === p
                      ? 'bg-text-primary text-surface'
                      : 'text-text-secondary hover:bg-surface-secondary',
                  )}
                >
                  {p}
                </button>
              )
            )}

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => goToPage(page + 1)}
              className="p-1.5 rounded-md text-text-tertiary hover:bg-surface-secondary disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Create Modal ─── */}
      <CreateInvoiceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={() => {
          setIsCreateModalOpen(false);
          queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
          queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] });
        }}
      />

      </>}

      {/* Bulk actions */}
      <AnimatePresence>
        {selectedInvoiceIds.size > 0 && (
          <BulkActionBar
            count={selectedInvoiceIds.size}
            actions={[
              { id: 'send', label: t.invoices.send, icon: Send, variant: 'primary' },
              { id: 'paid', label: t.invoices.markPaid, icon: CheckCircle2, variant: 'primary' },
              { id: 'delete', label: t.advancedNotes.delete, icon: Trash2, variant: 'danger' },
            ]}
            onAction={async (actionId) => {
              const ids = Array.from(selectedInvoiceIds);
              if (actionId === 'send') {
                for (const invId of ids) {
                  const row = invoicesQuery.data?.rows?.find((r: any) => r.id === invId);
                  if (row) await handleSend(row).catch(() => {});
                }
                toast.success(`${ids.length} invoices sent`);
              }
              if (actionId === 'paid') {
                for (const invId of ids) {
                  const row = invoicesQuery.data?.rows?.find((r: any) => r.id === invId);
                  if (row) await handleMarkPaid(row).catch(() => {});
                }
                toast.success(`${ids.length} invoices marked paid`);
              }
              if (actionId === 'delete') {
                if (!window.confirm(`Delete ${ids.length} invoices?`)) return;
                for (const invId of ids) await handleDelete(String(invId)).catch(() => {});
                toast.success(`${ids.length} invoices deleted`);
              }
              setSelectedInvoiceIds(new Set());
              queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
              queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] });
            }}
            onClear={() => setSelectedInvoiceIds(new Set())}
            language={language}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function KpiCard({ label, count, amount, color }: {
  label: string; count: number; amount: number;
  color: 'red' | 'blue' | 'gray' | 'green';
}) {
  const colorMap = {
    red:   'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/20',
    blue:  'border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/20',
    gray:  'border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/20',
    green: 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20',
  };
  const dotColor = { red: 'bg-red-500', blue: 'bg-neutral-500', gray: 'bg-gray-400', green: 'bg-green-500' };

  return (
    <div className={cn('rounded-xl border p-4 transition-colors', colorMap[color])}>
      <div className="flex items-center gap-2 mb-2">
        <span className={cn('w-2 h-2 rounded-full', dotColor[color])} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{label}</span>
      </div>
      <p className="text-[20px] font-bold text-text-primary tabular-nums">{formatMoneyFromCents(amount)}</p>
      <p className="text-[11px] text-text-tertiary mt-0.5">{count} invoice{count !== 1 ? 's' : ''}</p>
    </div>
  );
}

function Th({ children, onClick, className }: {
  children: React.ReactNode; onClick?: () => void; className?: string;
}) {
  return (
    <th className={cn('px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary', className)}>
      {onClick ? (
        <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-text-secondary transition-colors">
          {children}
        </button>
      ) : children}
    </th>
  );
}

function ActionItem({ icon, label, onClick, className }: {
  icon: React.ReactNode; label: string; onClick: () => void; className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-secondary transition-colors',
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}
