/* ═══════════════════════════════════════════════════════════════
   Page — Payments (Premium CRM — Invoices/Jobs pattern)
   CSS Grid table, KPI stat chips, status filter dropdown,
   search, toolbar, pagination, payout drawer, CSV export.
   ═══════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar, CreditCard, Download,
  Filter, X, DollarSign,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from '../i18n';
import { getCurrentOrgId } from '../lib/orgApi';
import {
  downloadPayoutCsv,
  fetchPaymentsOverview,
  fetchPayoutDetail,
  fetchPayoutList,
  fetchPayoutSummary,
  formatMoneyFromCents,
  listPayments,
  PaymentDateFilter,
  PaymentMethodFilter,
  PaymentStatusFilter,
  PayoutListItem,
} from '../lib/paymentsApi';
import { getAccountStatus } from '../lib/connectApi';
import { cn, formatDate } from '../lib/utils';
import StatusBadge from '../components/ui/StatusBadge';

const PAGE_SIZE = 25;
const PAYOUT_PAGE_SIZE = 20;

// ─── URL param parsers ─────────────────────────────────────────

function parseTab(raw: string | null) {
  if (raw === 'payouts') return 'payouts';
  return 'overview';
}
function parseStatus(raw: string | null): PaymentStatusFilter {
  return raw === 'succeeded' || raw === 'pending' || raw === 'failed' || raw === 'refunded' ? raw : 'all';
}
function parseMethod(raw: string | null): PaymentMethodFilter {
  return raw === 'card' || raw === 'e-transfer' || raw === 'cash' || raw === 'check' ? raw : 'all';
}
function parseDate(raw: string | null): PaymentDateFilter {
  return raw === '30d' || raw === 'this_month' || raw === 'custom' ? raw : 'all';
}
function normalizedDateRange(date: PaymentDateFilter, fromDate: string, toDate: string) {
  if (date === 'custom') return { from: fromDate || null, to: toDate || null };
  const now = new Date();
  if (date === '30d') {
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  if (date === 'this_month') {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: now.toISOString() };
  }
  return { from: null, to: null };
}

// ─── Status filter dropdown (Jobs/Invoices pattern) ────────────

function PaymentStatusDropdown({ value, onChange, fr }: { value: PaymentStatusFilter; onChange: (v: PaymentStatusFilter) => void; fr: boolean }) {
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

  const options: { value: PaymentStatusFilter; label: string }[] = [
    { value: 'all', label: fr ? 'Tous' : 'All' },
    { value: 'succeeded', label: fr ? 'Réussis' : 'Succeeded' },
    { value: 'pending', label: fr ? 'En attente' : 'Pending' },
    { value: 'failed', label: fr ? 'Échoués' : 'Failed' },
    { value: 'refunded', label: fr ? 'Remboursés' : 'Refunded' },
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

// ─── Method filter dropdown (same pattern) ─────────────────────

function PaymentMethodDropdown({ value, onChange, fr }: { value: PaymentMethodFilter; onChange: (v: PaymentMethodFilter) => void; fr: boolean }) {
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

  const options: { value: PaymentMethodFilter; label: string }[] = [
    { value: 'all', label: fr ? 'Toutes' : 'All' },
    { value: 'card', label: fr ? 'Carte' : 'Card' },
    { value: 'e-transfer', label: 'E-Transfer' },
    { value: 'cash', label: fr ? 'Comptant' : 'Cash' },
    { value: 'check', label: fr ? 'Chèque' : 'Check' },
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
        <CreditCard size={14} className={isActive ? 'text-white' : 'text-[#64748b]'} />
        {fr ? 'Méthode' : 'Method'}
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

// ─── Payment Badge (same pattern as InvoiceBadge) ──────────────

function PaymentBadge({ status, fr }: { status: string; fr: boolean }) {
  const s = (status || 'pending').toLowerCase();
  const map: Record<string, { label: string; badge: string }> = {
    succeeded: { label: fr ? 'Réussi' : 'Succeeded', badge: 'badge-success' },
    pending: { label: fr ? 'En attente' : 'Pending', badge: 'badge-warning' },
    failed: { label: fr ? 'Échoué' : 'Failed', badge: 'badge-danger' },
    refunded: { label: fr ? 'Remboursé' : 'Refunded', badge: 'badge-neutral' },
  };
  const v = map[s] || map.pending;
  return <span className={v.badge}>{v.label}</span>;
}

// ─── Main Component ────────────────────────────────────────────

export default function Payments() {
  const { t, language } = useTranslation();
  const fr = language === 'fr';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [selectedPayout, setSelectedPayout] = useState<PayoutListItem | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');

  const tab = parseTab(params.get('tab'));
  const status = parseStatus(params.get('status'));
  const method = parseMethod(params.get('method'));
  const date = parseDate(params.get('date'));
  const page = Math.max(1, Number(params.get('page') || '1'));
  const fromDate = params.get('from') || '';
  const toDate = params.get('to') || '';
  const payoutMethod = String(params.get('payout_method') || 'all');
  const payoutCursor = params.get('payout_cursor') || null;
  const range = useMemo(() => normalizedDateRange(date, fromDate, toDate), [date, fromDate, toDate]);

  const orgQuery = useQuery({ queryKey: ['currentOrgId', 'payments'], queryFn: getCurrentOrgId });
  const orgId = orgQuery.data || null;

  // Check Lume Payments (Connect) status
  const connectQuery = useQuery({
    queryKey: ['connectAccountStatus'],
    queryFn: getAccountStatus,
    enabled: Boolean(orgId),
  });
  const isConnected = connectQuery.data?.connected && connectQuery.data?.account?.charges_enabled;

  const overviewQuery = useQuery({ queryKey: ['paymentsOverview'], queryFn: fetchPaymentsOverview, enabled: Boolean(orgId) });
  const paymentsQuery = useQuery({
    queryKey: ['paymentsRows', status, method, date, page, fromDate, toDate],
    queryFn: () => listPayments({ status, method, date, q: '', page, pageSize: PAGE_SIZE, fromDate, toDate }),
    enabled: tab === 'overview' && Boolean(orgId),
  });

  const payoutSummary = useQuery({
    queryKey: ['payoutSummary', orgId, 'stripe'],
    queryFn: () => fetchPayoutSummary({ orgId: orgId || '', provider: 'stripe' }),
    enabled: tab === 'payouts' && Boolean(orgId) && Boolean(isConnected),
    retry: false,
  });
  const payoutList = useQuery({
    queryKey: ['payoutList', orgId, 'stripe', payoutMethod, range.from, range.to, payoutCursor],
    queryFn: () =>
      fetchPayoutList({
        orgId: orgId || '',
        provider: 'stripe',
        limit: PAYOUT_PAGE_SIZE,
        cursor: payoutCursor,
        dateFrom: range.from,
        dateTo: range.to,
        method: payoutMethod,
      }),
    enabled: tab === 'payouts' && Boolean(orgId) && Boolean(isConnected),
    retry: false,
  });
  const payoutDetail = useQuery({
    queryKey: ['payoutDetail', orgId, 'stripe', selectedPayout?.id],
    queryFn: () => fetchPayoutDetail({ orgId: orgId || '', provider: 'stripe', id: selectedPayout?.id || '', dateFrom: range.from, dateTo: range.to }),
    enabled: Boolean(selectedPayout && orgId),
  });

  const rows = useMemo(() => paymentsQuery.data?.rows || [], [paymentsQuery.data]);
  const payoutRows = useMemo(() => payoutList.data?.items || [], [payoutList.data]);
  const payoutError = payoutList.error as Error | null;
  const total = paymentsQuery.data?.total || 0;
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const overview = overviewQuery.data;

  // ─── URL state helpers ─────────────────────────────────────

  function updateParams(updater: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params);
    updater(next);
    setParams(next);
  }

  function applyStatus(s: PaymentStatusFilter) {
    updateParams((next) => {
      if (s === 'all') next.delete('status'); else next.set('status', s);
      next.delete('page');
    });
  }

  function applyMethod(m: PaymentMethodFilter) {
    updateParams((next) => {
      if (m === 'all') next.delete('method'); else next.set('method', m);
      next.delete('page');
    });
  }

  function goToPage(p: number) {
    updateParams((next) => {
      if (p <= 1) next.delete('page'); else next.set('page', String(p));
    });
  }

  const onCsv = async () => {
    try {
      const res = await downloadPayoutCsv({ orgId: orgId || '', provider: 'stripe', filters: { method: payoutMethod, date_from: range.from, date_to: range.to } });
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t.payments.csvReady);
    } catch (error: any) {
      toast.error(error?.message || t.payments.csvFailed);
    }
  };

  // ─── KPI stat chips (Invoices pattern — clickable) ─────────

  const kpiChips = useMemo(() => [
    { key: 'succeeded' as const, label: fr ? 'Réussis' : 'Succeeded', color: 'bg-success', filter: 'succeeded' as PaymentStatusFilter },
    { key: 'pending' as const, label: fr ? 'En attente' : 'Pending', color: 'bg-warning', filter: 'pending' as PaymentStatusFilter },
    { key: 'failed' as const, label: fr ? 'Échoués' : 'Failed', color: 'bg-danger', filter: 'failed' as PaymentStatusFilter },
    { key: 'refunded' as const, label: fr ? 'Remboursés' : 'Refunded', color: 'bg-text-tertiary', filter: 'refunded' as PaymentStatusFilter },
  ], [fr]);

  // ─── Sort icons (same as Invoices) ─────────────────────────

  const IconSort = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>;

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════

  return (
    <>
      {/* ── PAGE HEADER (Invoices pattern) ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-bold text-text-primary leading-tight">
          {t.commandPalette.payments}
        </h1>
        <button
          onClick={() => navigate('/settings/payments')}
          className="inline-flex items-center gap-2 h-10 px-5 bg-surface border border-outline text-text-primary rounded-md text-[14px] font-medium hover:bg-surface-secondary transition-all"
        >
          {fr ? 'Paramètres' : 'Settings'}
        </button>
      </div>

      {/* Not connected banner */}
      {!isConnected && !connectQuery.isLoading && (
        <div className="mt-4 border border-outline rounded-md bg-surface p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[14px] font-semibold text-text-primary">
              {t.payments.activateLumePaymentsToAcceptOnlinePaymen}
            </p>
            <p className="text-[12px] text-text-tertiary mt-0.5">
              {t.payments.yourClientsWillBeAbleToPayInvoicesByCred}
            </p>
          </div>
          <button className="inline-flex items-center h-9 px-4 bg-primary text-white rounded-md text-[13px] font-medium hover:bg-primary-hover active:scale-[0.98] transition-all shrink-0" onClick={() => navigate('/settings/payments')}>
            {t.payments.activate}
          </button>
        </div>
      )}

      {/* ── KPI STAT CHIPS (Invoices pattern — top metrics) ── */}
      <div className="flex items-center gap-1.5 mt-4 flex-wrap">
        {/* Available funds — always visible, not a filter */}
        <div className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-xs font-medium text-text-tertiary whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-success" />
          {t.payments.availableFunds}
          <span className="font-bold tabular-nums text-text-primary">{formatMoneyFromCents(overview?.available_funds_cents || 0)}</span>
        </div>
        <div className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-xs font-medium text-text-tertiary whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-info" />
          {t.payments.paymentTime30d}
          <span className="font-bold tabular-nums text-text-primary">{(overview?.invoice_payment_time_days_30d || 0).toFixed(1)} {t.payments.days}</span>
        </div>
        <div className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-xs font-medium text-text-tertiary whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-primary" />
          {t.payments.paidOnTime}
          <span className="font-bold tabular-nums text-text-primary">{(overview?.paid_on_time_global_pct_60d || 0).toFixed(1)}%</span>
        </div>

        {/* Separator */}
        <div className="w-px h-4 bg-outline mx-1" />

        {/* Status filter chips (Invoices pattern — clickable) */}
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
            </button>
          );
        })}
      </div>

      {/* ── TABS (Invoices pattern) ── */}
      <div className="tab-nav mt-4">
        <button className={tab === 'overview' ? 'tab-item-active' : 'tab-item'} onClick={() => updateParams((n) => n.delete('tab'))}>
          {t.payments.overview}
        </button>
        <button className={tab === 'payouts' ? 'tab-item-active' : 'tab-item'} onClick={() => updateParams((n) => n.set('tab', 'payouts'))}>
          {t.payments.payouts}
        </button>
      </div>

      {tab === 'overview' ? (
        <>
          {/* ── TOOLBAR (Invoices pattern) ── */}
          <div className="flex items-center gap-2 mt-4 mb-4">
            <form onSubmit={(e) => { e.preventDefault(); }} className="relative">
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={fr ? 'Rechercher paiements...' : 'Search payments...'}
                className="h-9 w-[200px] px-3 text-[14px] bg-surface border border-outline rounded-md text-text-primary placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-[#94a3b8] focus:border-[#94a3b8] transition-all"
              />
            </form>
            <PaymentStatusDropdown value={status} onChange={applyStatus} fr={fr} />
            <PaymentMethodDropdown value={method} onChange={applyMethod} fr={fr} />
          </div>

          {/* ── TABLE (CSS Grid — identical pattern to Invoices) ── */}
          <div className="border border-outline rounded-md overflow-hidden bg-surface">
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 120px 110px 130px' }}>
              {/* HEADER */}
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                {t.payments.client || (fr ? 'Client' : 'Client')}
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                {t.payments.date || (fr ? 'Date' : 'Date')}
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                {fr ? 'Méthode' : 'Method'}
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                {fr ? 'Statut' : 'Status'}
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center justify-end text-[14px] font-medium text-text-primary">
                {t.payments.amount || (fr ? 'Montant' : 'Amount')}
              </div>

              {/* LOADING — Skeleton (Invoices pattern) */}
              {paymentsQuery.isLoading && Array.from({ length: 8 }).map((_, i) => (
                <React.Fragment key={`sk-${i}`}>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-28 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-20 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-14 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse ml-auto" /></div>
                </React.Fragment>
              ))}

              {/* EMPTY STATE (Invoices pattern) */}
              {!paymentsQuery.isLoading && rows.length === 0 && (
                <div className="col-span-5 py-20">
                  <div className="flex flex-col items-center justify-center text-center">
                    <div className="w-12 h-12 rounded-xl bg-surface-secondary flex items-center justify-center mb-4">
                      <DollarSign size={22} className="text-text-muted/60" />
                    </div>
                    <p className="text-sm font-medium text-text-secondary mb-1">
                      {t.payments.noPaymentsYet}
                    </p>
                    <p className="text-xs text-text-muted mb-4 max-w-[280px]">
                      {t.payments.paymentsWillAppearHere}
                    </p>
                  </div>
                </div>
              )}

              {/* DATA ROWS */}
              {!paymentsQuery.isLoading && rows.map((r) => {
                const rowCls = 'border-b border-outline/30 transition-colors hover:bg-surface-secondary cursor-pointer';
                const methodLabel = r.method ? (r.method === 'e-transfer' ? 'E-Transfer' : r.method.charAt(0).toUpperCase() + r.method.slice(1)) : '—';
                const click = () => {
                  if (r.invoice_id) navigate(`/invoices/${r.invoice_id}`);
                  else if (r.client_id) navigate(`/clients/${r.client_id}`);
                };
                return (
                  <React.Fragment key={r.id}>
                    {/* Client */}
                    <div className={`py-3 px-4 flex items-center ${rowCls}`} onClick={click}>
                      <span className="text-[14px] text-text-primary truncate">{r.client_name || '—'}</span>
                    </div>
                    {/* Date */}
                    <div className={`py-3 px-4 flex items-center ${rowCls}`} onClick={click}>
                      <span className="text-[13px] text-text-muted tabular-nums font-medium">{formatDate(r.payment_date)}</span>
                    </div>
                    {/* Method */}
                    <div className={`py-3 px-4 flex items-center ${rowCls}`} onClick={click}>
                      <span className="text-[13px] text-text-secondary">{methodLabel}</span>
                    </div>
                    {/* Status */}
                    <div className={`py-3 px-4 flex items-center ${rowCls}`} onClick={click}>
                      <PaymentBadge status={r.status} fr={fr} />
                    </div>
                    {/* Amount */}
                    <div className={`py-3 px-4 flex items-center justify-end ${rowCls}`} onClick={click}>
                      <span className="text-[14px] font-semibold text-text-primary tabular-nums">{formatMoneyFromCents(r.amount_cents, r.currency)}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* ── FOOTER / PAGINATION (Invoices pattern) ── */}
          <div className="flex items-center justify-between mt-3">
            <span className="text-[14px] text-text-secondary">
              {total} {fr ? 'paiement(s)' : 'payment(s)'}
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
      ) : (
        /* ═══════════════════════════════════════════════════════
           PAYOUTS TAB (same grid pattern)
           ═══════════════════════════════════════════════════════ */
        <>
          {/* Not connected banner */}
          {!isConnected && (
            <div className="mt-4 border border-outline rounded-md bg-surface p-4 flex items-center justify-between gap-4">
              <p className="text-[14px] text-text-secondary">
                {t.payments.activateLumePaymentsToSeeYourPayouts}
              </p>
              <button className="inline-flex items-center h-9 px-4 bg-surface border border-outline text-text-primary rounded-md text-[14px] font-normal hover:bg-surface-secondary transition-all shrink-0" onClick={() => navigate('/settings/payments')}>
                {t.payments.openSettings}
              </button>
            </div>
          )}

          {payoutError && (
            <div className="mt-4 rounded-md border border-danger/30 bg-danger/5 p-4">
              <p className="text-[13px] text-danger">{payoutError.message}</p>
            </div>
          )}

          {/* ── Payout KPI chips (same row pattern) ── */}
          <div className="flex items-center gap-1.5 mt-4 flex-wrap">
            <div className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-xs font-medium text-text-tertiary whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-success" />
              {t.payments.available}
              <span className="font-bold tabular-nums text-text-primary">{formatMoneyFromCents(payoutSummary.data?.available || 0, payoutSummary.data?.currency || 'CAD')}</span>
            </div>
            <div className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-xs font-medium text-text-tertiary whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-warning" />
              {t.payments.onTheWay}
              <span className="font-bold tabular-nums text-text-primary">{formatMoneyFromCents(payoutSummary.data?.on_the_way || 0, payoutSummary.data?.currency || 'CAD')}</span>
            </div>
            <div className="inline-flex items-center gap-2 h-8 px-3.5 rounded-full text-xs font-medium text-text-tertiary whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-info" />
              {t.payments.deposited}
              <span className="font-bold tabular-nums text-text-primary">{formatMoneyFromCents(payoutSummary.data?.deposited_month || 0, payoutSummary.data?.currency || 'CAD')}</span>
              <span className="text-[10px] tabular-nums text-text-muted">({t.payments.thisWeek}: {formatMoneyFromCents(payoutSummary.data?.deposited_week || 0, payoutSummary.data?.currency || 'CAD')})</span>
            </div>
          </div>

          {/* ── TOOLBAR (Invoices pattern) ── */}
          <div className="flex items-center gap-2 mt-4 mb-4">
            <PayoutTypeDropdown
              value={payoutMethod}
              onChange={(v) => updateParams((n) => { if (v === 'all') n.delete('payout_method'); else n.set('payout_method', v); n.delete('payout_cursor'); })}
              fr={fr}
            />
            <PayoutDateDropdown
              value={date}
              onChange={(v) => updateParams((n) => { if (v === 'all') n.delete('date'); else n.set('date', v); if (v !== 'custom') { n.delete('from'); n.delete('to'); } n.delete('payout_cursor'); })}
              fr={fr}
            />
            <button
              type="button"
              onClick={() => void onCsv()}
              className="inline-flex items-center gap-1.5 h-9 px-3 border border-outline rounded-md text-[14px] font-normal bg-surface text-text-primary hover:bg-surface-secondary transition-colors"
            >
              <Download size={14} className="text-[#64748b]" /> CSV
            </button>
          </div>

          {/* ── TABLE (CSS Grid — same as overview) ── */}
          <div className="border border-outline rounded-md overflow-hidden bg-surface">
            <div className="grid" style={{ gridTemplateColumns: '1fr 120px 120px 130px' }}>
              {/* HEADER */}
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                Date
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                Type
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center text-[14px] font-medium text-text-primary">
                {fr ? 'Statut' : 'Status'}
              </div>
              <div className="py-3 px-4 border-b border-outline flex items-center justify-end text-[14px] font-medium text-text-primary">
                Net
              </div>

              {/* LOADING — Skeleton */}
              {payoutList.isLoading && Array.from({ length: 6 }).map((_, i) => (
                <React.Fragment key={`psk-${i}`}>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-24 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-16 bg-surface-tertiary rounded animate-pulse" /></div>
                  <div className="py-3 px-4 border-b border-outline/30"><div className="h-5 w-20 bg-surface-tertiary rounded animate-pulse ml-auto" /></div>
                </React.Fragment>
              ))}

              {/* EMPTY STATE */}
              {!payoutList.isLoading && payoutRows.length === 0 && (
                <div className="col-span-4 py-20">
                  <div className="flex flex-col items-center justify-center text-center">
                    <div className="w-12 h-12 rounded-xl bg-surface-secondary flex items-center justify-center mb-4">
                      <DollarSign size={22} className="text-text-muted/60" />
                    </div>
                    <p className="text-sm font-medium text-text-secondary mb-1">
                      {t.payments.noPayoutsYet}
                    </p>
                    <p className="text-xs text-text-muted mb-4 max-w-[280px]">
                      {t.payments.payoutsWillAppearHereOncePaymentsAreProc}
                    </p>
                  </div>
                </div>
              )}

              {/* DATA ROWS */}
              {!payoutList.isLoading && payoutRows.map((i) => {
                const rowCls = 'border-b border-outline/30 transition-colors hover:bg-surface-secondary cursor-pointer';
                return (
                  <React.Fragment key={i.id}>
                    <div className={`py-3 px-4 flex items-center ${rowCls}`} onClick={() => setSelectedPayout(i)}>
                      <span className="text-[13px] text-text-muted tabular-nums font-medium">{formatDate(i.date)}</span>
                    </div>
                    <div className={`py-3 px-4 flex items-center ${rowCls}`} onClick={() => setSelectedPayout(i)}>
                      <span className="text-[13px] text-text-secondary">{i.type}</span>
                    </div>
                    <div className={`py-3 px-4 flex items-center ${rowCls}`} onClick={() => setSelectedPayout(i)}>
                      <StatusBadge status={i.status} />
                    </div>
                    <div className={`py-3 px-4 flex items-center justify-end ${rowCls}`} onClick={() => setSelectedPayout(i)}>
                      <span className="text-[14px] font-semibold text-text-primary tabular-nums">{formatMoneyFromCents(i.net, i.currency)}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* ── FOOTER / PAGINATION (Invoices pattern) ── */}
          <div className="flex items-center justify-between mt-3">
            <span className="text-[14px] text-text-secondary">
              {fr ? 'Page' : 'Page'} {cursorHistory.length + 1}
            </span>
            <div className="flex items-center gap-2">
              <button disabled={cursorHistory.length === 0} onClick={() => updateParams((n) => { const h = [...cursorHistory]; h.pop(); setCursorHistory(h); const prev = h[h.length - 1]; if (!prev) n.delete('payout_cursor'); else n.set('payout_cursor', prev); })}
                className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">
                {fr ? 'Précédent' : 'Previous'}
              </button>
              <button disabled={!payoutList.data?.has_more || !payoutList.data?.next_cursor} onClick={() => updateParams((n) => { const next = payoutList.data?.next_cursor; if (!next) return; setCursorHistory((h) => [...h, next]); n.set('payout_cursor', next); })}
                className="h-9 px-4 bg-surface border border-outline rounded-md text-[14px] text-text-primary font-normal disabled:opacity-40 disabled:cursor-default hover:bg-surface-secondary transition-colors cursor-pointer">
                {fr ? 'Suivant' : 'Next'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
         PAYOUT DETAIL DRAWER
         ═══════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {selectedPayout && (
          <>
            <motion.div
              className="fixed inset-0 z-[80] bg-black/20 backdrop-blur-[2px]"
              onClick={() => setSelectedPayout(null)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.aside
              className="fixed right-0 top-0 z-[90] h-screen w-full max-w-md bg-surface border-l border-outline p-6 overflow-y-auto"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-xl font-bold text-text-primary">{t.payments.payoutDetails}</h3>
                <button className="p-2 rounded-xl hover:bg-surface-secondary text-text-tertiary transition-colors" onClick={() => setSelectedPayout(null)}><X size={14} /></button>
              </div>
              {payoutDetail.isLoading && (
                <div className="space-y-3 mt-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex justify-between">
                      <div className="h-4 w-20 bg-surface-tertiary rounded animate-pulse" />
                      <div className="h-4 w-24 bg-surface-tertiary rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              )}
              {payoutDetail.error && <p className="mt-4 text-[13px] text-danger">{(payoutDetail.error as Error).message}</p>}
              {!payoutDetail.isLoading && payoutDetail.data?.detail && (() => {
                const d = payoutDetail.data.detail as { amount: number; currency: string; status: string; created: string; arrival_date: string; fee_total: number; id: string };
                return (
                  <div className="mt-4 space-y-3">
                    <div className="flex justify-between text-[13px]">
                      <span className="text-text-secondary">{t.payments.amount || 'Amount'}</span>
                      <span className="font-semibold text-text-primary">{formatMoneyFromCents(d.amount, d.currency)}</span>
                    </div>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-text-secondary">{fr ? 'Statut' : 'Status'}</span>
                      <StatusBadge status={d.status} />
                    </div>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-text-secondary">{t.payments.created}</span>
                      <span className="text-text-primary">{formatDate(d.created)}</span>
                    </div>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-text-secondary">{fr ? "Date d'arrivée" : 'Arrival date'}</span>
                      <span className="text-text-primary">{formatDate(d.arrival_date)}</span>
                    </div>
                    {d.fee_total > 0 && (
                      <div className="flex justify-between text-[13px]">
                        <span className="text-text-secondary">{t.paymentSettings?.fees || 'Fees'}</span>
                        <span className="text-text-primary">{formatMoneyFromCents(d.fee_total, d.currency)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[13px]">
                      <span className="text-text-secondary">ID</span>
                      <span className="text-text-tertiary font-mono text-[11px]">{d.id}</span>
                    </div>
                  </div>
                );
              })()}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Sub-components: Payout filter dropdowns ───────────────────

function PayoutTypeDropdown({ value, onChange, fr }: { value: string; onChange: (v: string) => void; fr: boolean }) {
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

  const options = [
    { value: 'all', label: fr ? 'Tous' : 'All' },
    { value: 'standard', label: 'Standard' },
    { value: 'instant', label: 'Instant' },
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
        Type
        {isActive && <span className="ml-0.5 text-[11px] opacity-80">({activeLabel})</span>}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-40 bg-surface-elevated border border-outline rounded-md shadow-dropdown z-50 py-1">
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

function PayoutDateDropdown({ value, onChange, fr }: { value: string; onChange: (v: string) => void; fr: boolean }) {
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

  const options = [
    { value: 'all', label: fr ? 'Tout' : 'All time' },
    { value: '30d', label: fr ? '30 derniers jours' : 'Last 30 days' },
    { value: 'this_month', label: fr ? 'Ce mois' : 'This month' },
    { value: 'custom', label: fr ? 'Personnalisé' : 'Custom range' },
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
        <Calendar size={14} className={isActive ? 'text-white' : 'text-[#64748b]'} />
        {fr ? 'Période' : 'Period'}
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
