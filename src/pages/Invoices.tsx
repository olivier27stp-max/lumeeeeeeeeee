/* ═══════════════════════════════════════════════════════════════
   Page — Invoices (Premium CRM — Jobs/Clients pattern)
   Grid-based table, KPI stat chips, status filter dropdown,
   checkboxes, bulk actions, action menu, pagination.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown, ChevronLeft, ChevronRight, Download,
  Plus, Search, MoreHorizontal, Send, CheckCircle2, Copy,
  Trash2, Eye, FileText, DollarSign, Clock, AlertCircle,
  Filter, X, Receipt,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import CreateInvoiceModal from '../components/CreateInvoiceModal';
// InvoiceTemplatesTab removed — no more invoice template system
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
  markInvoicePaidManually,
  deleteInvoice,
} from '../lib/invoicesApi';
import { cn, formatDate } from '../lib/utils';
import { exportToCsv } from '../lib/exportCsv';
import { useTranslation } from '../i18n';
import { supabase } from '../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../lib/orgApi';
import UnifiedAvatar from '../components/ui/UnifiedAvatar';
import BulkActionBar from '../components/BulkActionBar';
// InvoiceTemplate type removed — no more invoice template system

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

// ─── Status filter dropdown (Jobs pattern) ─────────────────────

function InvoiceStatusDropdown({ value, onChange, fr }: { value: InvoiceStatusFilter; onChange: (v: InvoiceStatusFilter) => void; fr: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isActive = value !== 'all';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const options: { value: InvoiceStatusFilter; label: string }[] = [
    { value: 'all', label: fr ? 'Toutes' : 'All' },
    { value: 'draft', label: fr ? 'Brouillons' : 'Draft' },
    { value: 'sent_not_due', label: fr ? 'Envoyées' : 'Open' },
    { value: 'past_due', label: fr ? 'En retard' : 'Past Due' },
    { value: 'paid', label: fr ? 'Payées' : 'Paid' },
  ];

  const activeLabel = options.find(o => o.value === value)?.label;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 h-9 px-3 border rounded-md text-[14px] font-normal transition-colors',
          isActive
            ? 'bg-primary text-white border-primary'
            : 'bg-surface text-text-primary border-outline hover:bg-surface-secondary'
        )}
      >
        <Filter size={14} className={isActive ? 'text-white' : 'text-[#64748b]'} />
        {fr ? 'Statut' : 'Status'}
        {isActive && <span className="ml-0.5 text-[11px] opacity-80">({activeLabel})</span>}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-48 bg-surface-elevated border border-outline rounded-md shadow-dropdown z-50 py-1">
          {options.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-[13px] transition-colors',
                value === opt.value
                  ? 'bg-primary-light text-text-primary font-medium'
                  : 'text-text-secondary hover:bg-surface-secondary'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Invoice Badge (same pattern as Jobs/Clients) ──────────────

function InvoiceBadge({ status, fr }: { status: string; fr: boolean }) {
  const s = (status || 'draft').toLowerCase();
  const map: Record<string, { label: string; badge: string }> = {
    paid:        { label: fr ? 'Payée' : 'Paid',        badge: 'badge-success' },
    sent_not_due:{ label: fr ? 'Envoyée' : 'Sent',      badge: 'badge-info' },
    past_due:    { label: fr ? 'En retard' : 'Overdue',  badge: 'badge-danger' },
    draft:       { label: fr ? 'Brouillon' : 'Draft',    badge: 'badge-neutral' },
    partial:     { label: fr ? 'Partiel' : 'Partial',    badge: 'badge-warning' },
    void:        { label: fr ? 'Annulée' : 'Void',       badge: 'badge-danger' },
    sent:        { label: fr ? 'Envoyée' : 'Sent',       badge: 'badge-info' },
  };
  const v = map[s] || map.draft;
  return (
    <span className={v.badge}>
      {v.label}
    </span>
  );
}

// ─── Main Component ────────────────────────────────────────────

type MainTab = 'invoices';

export default function Invoices() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('invoices');
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [invoiceToDelete, setInvoiceToDelete] = useState<InvoiceRow | null>(null);
  const [isDeletingInvoice, setIsDeletingInvoice] = useState(false);

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

  // Close action menu on outside click
  useEffect(() => {
    if (!actionMenuId) return;
    const handler = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [actionMenuId]);

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

  // Fetch client emails via backend
  const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];
  const clientsQuery = useQuery({
    queryKey: ['invoiceClients', clientIds],
    queryFn: async () => {
      if (clientIds.length === 0) return {};
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return {};

      const res = await fetch('/api/clients/by-ids', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: clientIds }),
      });
      if (!res.ok) return {};
      const json = await res.json();
      const map: Record<string, { email: string | null; name: string; initials: string }> = {};
      for (const c of json.clients || []) {
        const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.company || '';
        const initials = name.split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() || '').join('');
        map[c.id] = { email: c.email || null, name, initials: initials || '?' };
      }
      return map;
    },
    enabled: clientIds.length > 0,
  });
  const clientMap = clientsQuery.data || {};

  // ─── KPI counts per tab ────────────────────────────────────

  const kpis = kpisQuery.data;
  const paidCountQuery = useQuery({
    queryKey: ['invoices-paid-count'],
    queryFn: async () => {
      const orgId = await getCurrentOrgIdOrThrow();
      const { count } = await supabase
        .from('invoices')
        .select('status', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .eq('status', 'paid');
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

  // ─── Selection helpers ─────────────────────────────────────

  const allSel = rows.length > 0 && selectedIds.size === rows.length;
  const toggleAll = () => { allSel ? setSelectedIds(new Set()) : setSelectedIds(new Set(rows.map(r => r.id))); };
  const toggleOne = (id: string) => { const n = new Set(selectedIds); n.has(id) ? n.delete(id) : n.add(id); setSelectedIds(n); };

  // ─── Invalidate helper ────────────────────────────────────

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ['invoicesTable'] });
    queryClient.invalidateQueries({ queryKey: ['invoicesKpis30d'] });
    queryClient.invalidateQueries({ queryKey: ['invoices-paid-count'] });
  }

  // ─── Actions ───────────────────────────────────────────────

  const handleExportCsv = async () => {
    try {
      const { data, error: fetchErr } = await supabase.rpc('rpc_list_invoices', {
        p_status: status === 'all' ? 'all' : status,
        p_range: 'all', p_sort: 'due_date_desc',
        p_limit: 10000, p_offset: 0, p_q: q || null, p_from: null, p_to: null, p_org: null,
      });
      if (fetchErr) throw fetchErr;
      const csvRows = (data || []).map((inv: any) => {
        const email = clientMap[inv.client_id]?.email || '';
        return [
          inv.invoice_number || '',
          inv.client_name || '',
          email,
          inv.status || '',
          formatMoneyFromCents(inv.total_cents || 0),
          inv.due_date ? new Date(inv.due_date).toLocaleDateString('fr-CA') : '',
        ];
      });
      exportToCsv(
        `factures-${new Date().toISOString().slice(0, 10)}.csv`,
        ['#', 'Client', 'Email', fr ? 'Statut' : 'Status', fr ? 'Montant' : 'Amount', fr ? 'Échéance' : 'Due Date'],
        csvRows,
      );
      toast.success(fr ? 'Export CSV terminé' : 'CSV exported');
    } catch (err: any) {
      toast.error(err?.message || 'Export failed');
    }
  };

  const handleMarkPaid = async (row: InvoiceRow) => {
    try {
      await markInvoicePaidManually(row.id);
      if (row.job_id) {
        const { error: jobErr } = await supabase.from('jobs')
          .update({ status: 'billed', updated_at: new Date().toISOString() })
          .eq('id', row.job_id)
          .in('status', ['completed', 'in_progress']);
        if (jobErr) console.error('[Invoices] Failed to update job status:', jobErr.message);
      }
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['jobsTable'] });
      toast.success(fr ? 'Facture marquée payée' : 'Invoice marked as paid');
    } catch (err: any) {
      toast.error(err?.message || 'Error');
    }
    setActionMenuId(null);
  };

  const handleDuplicate = async (row: InvoiceRow) => {
    try {
      const draft = await createInvoiceDraft({
        clientId: row.client_id,
        subject: row.subject ? `${row.subject} (copy)` : null,
        dueDate: null,
      });
      toast.success(fr ? 'Facture dupliquée' : 'Invoice duplicated');
      navigate(`/invoices/${draft.id}`);
    } catch (err: any) {
      toast.error(err?.message || 'Error');
    }
    setActionMenuId(null);
  };

  const handleDelete = async (row: InvoiceRow) => {
    setInvoiceToDelete(row);
    setActionMenuId(null);
  };

  const confirmDelete = async () => {
    if (!invoiceToDelete || isDeletingInvoice) return;
    setIsDeletingInvoice(true);
    try {
      await deleteInvoice(invoiceToDelete.id);
      invalidateAll();
      setInvoiceToDelete(null);
      toast.success(fr ? 'Facture supprimée définitivement' : 'Invoice permanently deleted');
    } catch (err: any) {
      toast.error(err?.message || 'Error');
    } finally { setIsDeletingInvoice(false); }
  };

  const handleSend = async (row: InvoiceRow) => {
    const client = clientMap[row.client_id];
    if (!client?.email) {
      toast.error(fr ? 'Aucun email pour ce client' : 'Client has no email address', {
        action: { label: fr ? 'Ouvrir le client' : 'Open Client', onClick: () => navigate(`/clients/${row.client_id}`) },
        duration: 6000,
      });
      return;
    }
    try {
      await sendInvoice({ invoiceId: row.id, channels: ['email'], toEmail: client.email });
      invalidateAll();
      toast.success(fr ? 'Facture envoyée' : 'Invoice sent');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send invoice');
    }
    setActionMenuId(null);
  };

  // ─── KPI stat chips ────────────────────────────────────────

  const kpiChips = useMemo(() => [
    { key: 'past_due' as const, label: fr ? 'En retard' : 'Overdue', value: kpis?.past_due_count || 0, amount: kpis?.past_due_total_cents || 0, color: 'bg-danger', filter: 'past_due' as InvoiceStatusFilter },
    { key: 'sent_not_due' as const, label: fr ? 'Ouvertes' : 'Open', value: kpis?.sent_not_due_count || 0, amount: kpis?.sent_not_due_total_cents || 0, color: 'bg-info', filter: 'sent_not_due' as InvoiceStatusFilter },
    { key: 'draft' as const, label: fr ? 'Brouillons' : 'Drafts', value: kpis?.draft_count || 0, amount: kpis?.draft_total_cents || 0, color: 'bg-text-tertiary', filter: 'draft' as InvoiceStatusFilter },
    { key: 'paid' as const, label: fr ? 'Payées' : 'Paid', value: paidCountQuery.data || 0, amount: 0, color: 'bg-success', filter: 'paid' as InvoiceStatusFilter },
  ], [kpis, paidCountQuery.data, fr]);

  // ─── Sort icons ────────────────────────────────────────────

  const IconSort = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>;
  const IconPlus = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>;
  const IconDots = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>;

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <>
      {/* ── PAGE HEADER (Jobs/Clients pattern) ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-text-primary leading-tight">
          {fr ? 'Factures' : 'Invoices'}
        </h1>
        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white rounded-md text-[14px] font-medium hover:bg-primary-hover active:scale-[0.98] transition-all"
        >
          {IconPlus} {fr ? 'Nouvelle facture' : 'New Invoice'}
        </button>
      </div>

      {/* ── KPI STAT CHIPS ── */}
      <div className="flex items-center gap-1.5 mt-4 flex-wrap">
        {kpiChips.map(chip => {
          const isActive = status === chip.filter;
          return (
            <button
              key={chip.key}
              onClick={() => applyStatus(isActive ? 'all' : chip.filter)}
              className={cn(
                'inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-xs font-medium transition-all whitespace-nowrap',
                isActive
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-text-tertiary hover:text-text-primary hover:bg-surface-secondary'
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', chip.color, isActive && 'bg-surface/60')} />
              {chip.label}
              <span className={cn('font-bold tabular-nums', isActive ? 'text-white' : 'text-text-primary')}>
                {chip.value}
              </span>
              {chip.amount > 0 && (
                <span className={cn('text-[10px] tabular-nums', isActive ? 'text-white/70' : 'text-text-muted')}>
                  {formatMoneyFromCents(chip.amount)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── TOOLBAR (Jobs/Clients pattern) ── */}
      <div className="flex items-center gap-2 mt-4 mb-4">
        <form onSubmit={applySearch} className="relative">
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder={fr ? 'Rechercher factures...' : 'Search invoices...'}
            className="h-9 w-[200px] px-3 text-[14px] bg-surface border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-[#94a3b8] focus:border-[#94a3b8] transition-all"
            onBlur={() => {
              if (searchInput.trim() !== q) {
                updateParams(next => { const v = searchInput.trim(); if (!v) next.delete('q'); else next.set('q', v); next.delete('page'); });
              }
            }}
          />
        </form>
        <InvoiceStatusDropdown
          value={status}
          onChange={(v) => applyStatus(v)}
          fr={fr}
        />
        <button type="button" onClick={() => void handleExportCsv()}
          className="inline-flex items-center gap-1.5 h-9 px-3 border border-outline rounded-md text-[14px] font-normal bg-surface text-text-primary hover:bg-surface-secondary transition-colors">
          <Download size={14} className="text-[#64748b]" /> CSV
        </button>
      </div>

      {/* ── Invoices Content ── */}
      {(
        <>
          {/* ── TABLE (CSS Grid — identical pattern to Jobs & Clients) ── */}
          <div className="border border-outline rounded-md overflow-hidden bg-surface">
            <div className="grid" style={{ gridTemplateColumns: '40px 80px 1fr 1fr 100px 110px 100px 110px 48px' }}>
              {/* HEADER */}
              <div className="py-3 pl-4 border-b border-outline flex items-center">
                <input type="checkbox" checked={allSel} onChange={toggleAll} className="rounded-[3px] border-outline w-4 h-4 accent-primary cursor-pointer" />
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                <button onClick={() => applySort('invoice_number')} className="inline-flex items-center gap-1"># {IconSort}</button>
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                <button onClick={() => applySort('client')} className="inline-flex items-center gap-1">Client {IconSort}</button>
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                {fr ? 'Sujet' : 'Subject'}
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                <button onClick={() => applySort('status')} className="inline-flex items-center gap-1">{fr ? 'Statut' : 'Status'} {IconSort}</button>
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center justify-end text-[14px] font-medium text-text-primary">
                <button onClick={() => applySort('total')} className="inline-flex items-center gap-1">Total {IconSort}</button>
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center justify-end text-[14px] font-medium text-text-primary">
                <button onClick={() => applySort('balance')} className="inline-flex items-center gap-1">{fr ? 'Solde' : 'Balance'} {IconSort}</button>
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                <button onClick={() => applySort('due_date')} className="inline-flex items-center gap-1">{fr ? 'Échéance' : 'Due'} {IconSort}</button>
              </div>
              <div className="py-3 border-b border-outline" />

              {/* LOADING */}
              {invoicesQuery.isLoading && Array.from({ length: 10 }).map((_, i) => (
                <React.Fragment key={`sk-${i}`}>
                  <div className="py-3 pl-4 border-b border-outline/30 flex items-center"><div className="w-4 h-4 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-10 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-24 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-28 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-14 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse ml-auto" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-14 bg-surface-tertiary rounded animate-pulse ml-auto" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 border-b border-outline/30" />
                </React.Fragment>
              ))}

              {/* EMPTY STATE */}
              {!invoicesQuery.isLoading && rows.length === 0 && (
                <div className="col-span-9 py-20">
                  <div className="flex flex-col items-center justify-center text-center">
                    <div className="w-12 h-12 rounded-xl bg-surface-secondary flex items-center justify-center mb-4">
                      <FileText size={22} className="text-text-muted/60" />
                    </div>
                    <p className="text-sm font-medium text-text-secondary mb-1">
                      {fr ? 'Aucune facture trouvée' : 'No invoices found'}
                    </p>
                    <p className="text-xs text-text-muted mb-4 max-w-[280px]">
                      {q
                        ? (fr ? `Aucun résultat pour "${q}"` : `No results for "${q}"`)
                        : (fr ? 'Créez votre première facture pour commencer' : 'Create your first invoice to get started')
                      }
                    </p>
                    {!q && (
                      <button onClick={() => setIsCreateModalOpen(true)}
                        className="inline-flex items-center gap-2 h-9 px-4 bg-primary text-white rounded-md text-[13px] font-medium hover:bg-primary-hover transition-colors">
                        <Plus size={14} /> {fr ? 'Nouvelle facture' : 'New Invoice'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* DATA ROWS */}
              {!invoicesQuery.isLoading && rows.map((row) => {
                const uiStatus = getInvoiceRowUiStatus(row);
                const client = clientMap[row.client_id];
                const isMenuOpen = actionMenuId === row.id;
                const isSelected = selectedIds.has(row.id);
                const rowCls = `border-b border-outline/30 transition-colors ${isSelected ? 'bg-[#f0f4ff]' : 'hover:bg-surface-secondary'}`;
                const click = () => navigate(`/invoices/${row.id}`);
                const isPastDue = uiStatus === 'past_due';

                return (
                  <React.Fragment key={row.id}>
                    {/* Checkbox */}
                    <div className={`py-3 pl-4 flex items-center ${rowCls}`} onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(row.id)} className="rounded-[3px] border-outline w-4 h-4 accent-primary cursor-pointer" />
                    </div>
                    {/* Invoice # */}
                    <div className={`py-3 px-4 flex items-center cursor-pointer ${rowCls}`} onClick={click}>
                      <span className="text-[13px] text-text-muted tabular-nums font-medium">{row.invoice_number}</span>
                    </div>
                    {/* Client */}
                    <div className={`py-3 px-4 flex items-center min-w-0 cursor-pointer ${rowCls}`} onClick={click}>
                      <div className="flex items-center gap-3 min-w-0">
                        <UnifiedAvatar id={row.client_id || row.id} name={row.client_name || '?'} />
                        <div className="min-w-0">
                          <span className="text-[14px] text-text-primary truncate block">{row.client_name || '—'}</span>
                          {client?.email && (
                            <span className="text-[11px] text-text-muted truncate block">{client.email}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Subject */}
                    <div className={`py-3 px-4 flex items-center overflow-hidden cursor-pointer ${rowCls}`} onClick={click}>
                      <span className="text-[13px] text-text-secondary truncate">{row.subject || '—'}</span>
                    </div>
                    {/* Status */}
                    <div className={`py-3 px-4 flex items-center cursor-pointer ${rowCls}`} onClick={click}>
                      <InvoiceBadge status={uiStatus} fr={fr} />
                    </div>
                    {/* Total */}
                    <div className={`py-3 px-4 flex items-center justify-end cursor-pointer ${rowCls}`} onClick={click}>
                      <span className="text-[14px] font-semibold text-text-primary tabular-nums">{formatMoneyFromCents(row.total_cents)}</span>
                    </div>
                    {/* Balance */}
                    <div className={`py-3 px-4 flex items-center justify-end cursor-pointer ${rowCls}`} onClick={click}>
                      <span className={cn(
                        'text-[13px] font-medium tabular-nums',
                        row.balance_cents === 0 ? 'text-text-muted' : isPastDue ? 'text-[#dc2626]' : 'text-text-primary'
                      )}>
                        {row.balance_cents === 0 ? '—' : formatMoneyFromCents(row.balance_cents)}
                      </span>
                    </div>
                    {/* Due date */}
                    <div className={`py-3 px-4 flex items-center cursor-pointer ${rowCls}`} onClick={click}>
                      <span className={cn(
                        'text-[13px] tabular-nums font-medium',
                        isPastDue ? 'text-[#dc2626]' : 'text-text-muted'
                      )}>
                        {row.due_date ? formatDate(row.due_date) : '—'}
                      </span>
                    </div>
                    {/* Actions */}
                    <div className={`py-3 pr-4 flex items-center justify-center relative ${rowCls}`}>
                      <button
                        className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-tertiary transition-colors"
                        onClick={e => { e.stopPropagation(); setActionMenuId(isMenuOpen ? null : row.id); }}
                      >
                        {IconDots}
                      </button>

                      {/* Action dropdown */}
                      {isMenuOpen && (
                        <div
                          ref={actionMenuRef}
                          className="absolute right-0 top-full mt-1 z-50 w-48 bg-surface border border-outline rounded-md shadow-lg py-1"
                          onClick={e => e.stopPropagation()}
                        >
                          <ActionMenuItem icon={<Eye size={14} />} label={fr ? 'Voir' : 'View'}
                            onClick={() => { navigate(`/invoices/${row.id}`); setActionMenuId(null); }} />
                          {uiStatus !== 'paid' && uiStatus !== 'void' && (
                            <ActionMenuItem icon={<Send size={14} />} label={fr ? 'Envoyer' : 'Send'}
                              onClick={() => handleSend(row)} />
                          )}
                          {row.balance_cents > 0 && (
                            <ActionMenuItem icon={<CheckCircle2 size={14} />} label={fr ? 'Marquer payée' : 'Mark Paid'}
                              onClick={() => handleMarkPaid(row)} />
                          )}
                          <ActionMenuItem icon={<Copy size={14} />} label={fr ? 'Dupliquer' : 'Duplicate'}
                            onClick={() => handleDuplicate(row)} />
                          <div className="my-1 border-t border-outline/30" />
                          <ActionMenuItem icon={<Trash2 size={14} />} label={fr ? 'Supprimer' : 'Delete'}
                            onClick={() => handleDelete(row)} danger />
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* ── FOOTER (Jobs/Clients pattern) ── */}
          <div className="flex items-center justify-between mt-3">
            <span className="text-[14px] text-text-secondary">
              {selectedIds.size} {fr ? 'sur' : 'of'} {total} {fr ? 'ligne(s) sélectionnée(s).' : 'row(s) selected.'}
            </span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => goToPage(page - 1)}
                className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">
                {fr ? 'Précédent' : 'Previous'}
              </button>
              {totalPages > 1 && (
                <span className="text-[13px] text-text-muted tabular-nums px-2">{page} / {totalPages}</span>
              )}
              <button disabled={page >= totalPages} onClick={() => goToPage(page + 1)}
                className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">
                {fr ? 'Suivant' : 'Next'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ─── Delete Confirmation Modal (Jobs pattern) ─── */}
      <AnimatePresence>
        {invoiceToDelete && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => !isDeletingInvoice && setInvoiceToDelete(null)}>
            <motion.div
              className="bg-surface rounded-2xl border border-outline/40 shadow-2xl max-w-sm w-full mx-4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <h3 className="text-[15px] font-bold text-text-primary">
                  {fr ? 'Supprimer cette facture ?' : 'Delete this invoice?'}
                </h3>
                <p className="mt-2 text-[13px] text-text-secondary leading-relaxed">
                  {fr
                    ? `Vous êtes sur le point de supprimer la facture ${invoiceToDelete.invoice_number}. Cette action peut être annulée.`
                    : `You're about to delete invoice ${invoiceToDelete.invoice_number}. This action can be undone.`
                  }
                </p>
                <div className="mt-5 flex justify-end gap-3">
                  <button className="glass-button" onClick={() => setInvoiceToDelete(null)} disabled={isDeletingInvoice}>
                    {fr ? 'Annuler' : 'Cancel'}
                  </button>
                  <button className="glass-button-danger" onClick={() => void confirmDelete()} disabled={isDeletingInvoice}>
                    {isDeletingInvoice ? (fr ? 'Suppression...' : 'Deleting...') : (fr ? 'Supprimer' : 'Delete')}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── Bulk Actions (reusable component from Jobs) ─── */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <BulkActionBar
            count={selectedIds.size}
            actions={[
              { id: 'send', label: fr ? 'Envoyer' : 'Send', icon: Send, variant: 'default' as any },
              { id: 'mark_paid', label: fr ? 'Marquer payée' : 'Mark Paid', icon: CheckCircle2, variant: 'primary' },
              { id: 'delete', label: fr ? 'Supprimer' : 'Delete', icon: Trash2, variant: 'danger' },
            ]}
            onAction={async (actionId) => {
              const ids = Array.from(selectedIds);
              if (actionId === 'delete') {
                if (!window.confirm(fr ? `Supprimer ${ids.length} facture(s) ?` : `Delete ${ids.length} invoice(s)?`)) return;
                let failed = 0;
                for (const id of ids) {
                  try {
                    await deleteInvoice(id);
                  } catch { failed++; }
                }
                invalidateAll();
                if (failed > 0) toast.error(`${failed} invoice(s) failed to delete`);
                else toast.success(fr ? `${ids.length} facture(s) supprimée(s)` : `${ids.length} invoice(s) deleted`);
              }
              if (actionId === 'mark_paid') {
                let failed = 0;
                for (const id of ids) {
                  try { await markInvoicePaidManually(id); } catch { failed++; }
                }
                invalidateAll();
                if (failed > 0) toast.error(`${failed} invoice(s) failed`);
                else toast.success(fr ? `${ids.length} facture(s) marquée(s) payée(s)` : `${ids.length} invoice(s) marked as paid`);
              }
              if (actionId === 'send') {
                let sent = 0; let failed = 0;
                for (const id of ids) {
                  const row = rows.find(r => r.id === id);
                  if (!row) continue;
                  const client = clientMap[row.client_id];
                  if (!client?.email) { failed++; continue; }
                  try {
                    await sendInvoice({ invoiceId: row.id, channels: ['email'], toEmail: client.email });
                    sent++;
                  } catch { failed++; }
                }
                invalidateAll();
                if (sent > 0) toast.success(fr ? `${sent} facture(s) envoyée(s)` : `${sent} invoice(s) sent`);
                if (failed > 0) toast.error(fr ? `${failed} facture(s) non envoyée(s)` : `${failed} invoice(s) failed to send`);
              }
              setSelectedIds(new Set());
            }}
            onClear={() => setSelectedIds(new Set())}
            language={language}
          />
        )}
      </AnimatePresence>

      {/* ─── Create Modal ─── */}
      <CreateInvoiceModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={() => {
          setIsCreateModalOpen(false);
          invalidateAll();
        }}
      />
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────

function ActionMenuItem({ icon, label, onClick, danger }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-[13px] transition-colors',
        danger
          ? 'text-[#dc2626] hover:bg-[#fef2f2]'
          : 'text-text-secondary hover:bg-surface-secondary'
      )}>
      {icon}
      {label}
    </button>
  );
}
