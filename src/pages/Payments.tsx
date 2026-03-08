import React, { useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, CreditCard, Download, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { getCurrentOrgId } from '../lib/orgApi';
import {
  downloadPayoutCsv,
  fetchPaymentSettings,
  fetchPaymentsOverview,
  fetchPayoutDetail,
  fetchPayoutList,
  fetchPayoutSummary,
  formatMoneyFromCents,
  listPayments,
  PaymentDateFilter,
  paymentMethodLabel,
  PaymentMethodFilter,
  PaymentStatusFilter,
  paymentStatusLabel,
  PayoutListItem,
  PayoutProvider,
} from '../lib/paymentsApi';
import { cn, formatDate } from '../lib/utils';
import { PageHeader, StatCard, EmptyState } from '../components/ui';
import { FilterSelect } from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';

const PAGE_SIZE = 25;
const PAYOUT_PAGE_SIZE = 20;

function parseTab(raw: string | null) {
  return raw === 'payouts' ? 'payouts' : 'overview';
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
function parseProvider(raw: string | null): PayoutProvider | null {
  return raw === 'stripe' || raw === 'paypal' ? raw : null;
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

export default function Payments() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [selectedPayout, setSelectedPayout] = useState<PayoutListItem | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);

  const tab = parseTab(params.get('tab'));
  const status = parseStatus(params.get('status'));
  const method = parseMethod(params.get('method'));
  const date = parseDate(params.get('date'));
  const page = Math.max(1, Number(params.get('page') || '1'));
  const fromDate = params.get('from') || '';
  const toDate = params.get('to') || '';
  const payoutProvider = parseProvider(params.get('provider'));
  const payoutMethod = String(params.get('payout_method') || 'all');
  const payoutCursor = String(params.get('payout_cursor') || '') || null;
  const range = normalizedDateRange(date, fromDate, toDate);

  const orgQuery = useQuery({ queryKey: ['currentOrgId', 'payments'], queryFn: getCurrentOrgId });
  const orgId = orgQuery.data || null;
  const settingsQuery = useQuery({
    queryKey: ['paymentsSettings', orgId],
    queryFn: () => fetchPaymentSettings(orgId || undefined),
    enabled: Boolean(orgId),
  });
  const connected = useMemo(() => {
    const s = settingsQuery.data?.settings;
    return {
      stripe: Boolean(s?.stripe_enabled && s?.stripe_keys_present),
      paypal: Boolean(s?.paypal_enabled && s?.paypal_keys_present),
    };
  }, [settingsQuery.data]);
  const activeProvider = useMemo<PayoutProvider | null>(() => {
    if (payoutProvider && connected[payoutProvider]) return payoutProvider;
    const s = settingsQuery.data?.settings;
    if (s?.default_provider === 'stripe' && connected.stripe) return 'stripe';
    if (s?.default_provider === 'paypal' && connected.paypal) return 'paypal';
    if (connected.stripe) return 'stripe';
    if (connected.paypal) return 'paypal';
    return null;
  }, [payoutProvider, settingsQuery.data, connected]);

  const overviewQuery = useQuery({ queryKey: ['paymentsOverview'], queryFn: fetchPaymentsOverview });
  const paymentsQuery = useQuery({
    queryKey: ['paymentsRows', status, method, date, page, fromDate, toDate],
    queryFn: () => listPayments({ status, method, date, q: '', page, pageSize: PAGE_SIZE, fromDate, toDate }),
    enabled: tab === 'overview',
  });
  const payoutSummary = useQuery({
    queryKey: ['payoutSummary', orgId, activeProvider],
    queryFn: () => fetchPayoutSummary({ orgId: orgId || '', provider: activeProvider }),
    enabled: tab === 'payouts' && Boolean(orgId),
    retry: false,
  });
  const payoutList = useQuery({
    queryKey: ['payoutList', orgId, activeProvider, payoutMethod, range.from, range.to, payoutCursor],
    queryFn: () =>
      fetchPayoutList({
        orgId: orgId || '',
        provider: activeProvider,
        limit: PAYOUT_PAGE_SIZE,
        cursor: payoutCursor,
        dateFrom: range.from,
        dateTo: range.to,
        method: payoutMethod,
      }),
    enabled: tab === 'payouts' && Boolean(orgId),
    retry: false,
  });
  const payoutDetail = useQuery({
    queryKey: ['payoutDetail', orgId, activeProvider, selectedPayout?.id],
    queryFn: () => fetchPayoutDetail({ orgId: orgId || '', provider: activeProvider, id: selectedPayout?.id || '', dateFrom: range.from, dateTo: range.to }),
    enabled: Boolean(selectedPayout && orgId),
  });

  const rows = paymentsQuery.data?.rows || [];
  const payoutRows = payoutList.data?.items || [];
  const payoutError = payoutList.error as Error | null;
  const totalPages = Math.max(1, Math.ceil((paymentsQuery.data?.total || 0) / PAGE_SIZE));

  const setQuery = (cb: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    cb(next);
    setParams(next);
  };

  const onCsv = async () => {
    try {
      const res = await downloadPayoutCsv({ orgId: orgId || '', provider: activeProvider, filters: { method: payoutMethod, date_from: range.from, date_to: range.to } });
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV ready');
    } catch (error: any) {
      toast.error(error?.message || 'CSV failed');
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" subtitle="Track payments and payouts" icon={CreditCard} iconColor="amber">
        <button className="glass-button" onClick={() => navigate('/payments/settings')}>Settings</button>
      </PageHeader>

      {/* Tabs */}
      <div className="tab-nav">
        <button className={tab === 'overview' ? 'tab-item-active' : 'tab-item'} onClick={() => setQuery((n) => n.delete('tab'))}>Overview</button>
        <button className={tab === 'payouts' ? 'tab-item-active' : 'tab-item'} onClick={() => setQuery((n) => n.set('tab', 'payouts'))}>Payouts</button>
      </div>

      {tab === 'overview' ? (
        <>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <StatCard label="Available funds" value={formatMoneyFromCents(overviewQuery.data?.available_funds_cents || 0)} iconColor="green" />
            <StatCard label="Invoice payment time" value={`${(overviewQuery.data?.invoice_payment_time_days_30d || 0).toFixed(1)} days`} iconColor="blue" />
            <StatCard label="Invoices paid on time" value={`${(overviewQuery.data?.paid_on_time_global_pct_60d || 0).toFixed(1)}%`} iconColor="purple" />
          </div>

          <div className="section-card overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Client</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Payment date</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Status</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !paymentsQuery.isLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10">
                      <EmptyState icon={CreditCard} title="No payments found" description="Payments will appear here once recorded." />
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="table-row-hover">
                    <td className="px-4 py-3 text-[13px] font-medium text-text-primary">{r.client_name}</td>
                    <td className="px-4 py-3 text-[13px] text-text-secondary tabular-nums">{formatDate(r.payment_date)}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-right text-[13px] font-medium text-text-primary tabular-nums">{formatMoneyFromCents(r.amount_cents, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-xs text-text-tertiary">Page {page} / {totalPages}</p>
              <div className="flex gap-2">
                <button className="glass-button !px-2" disabled={page <= 1} onClick={() => setQuery((n) => { const p = Math.max(1, page - 1); if (p === 1) n.delete('page'); else n.set('page', String(p)); })}><ChevronLeft size={14} /></button>
                <button className="glass-button !px-2" disabled={page >= totalPages} onClick={() => setQuery((n) => n.set('page', String(page + 1)))}><ChevronRight size={14} /></button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">Provider</span>
            <select className="glass-input !py-1.5 text-xs" value={activeProvider || ''} onChange={(e) => setQuery((n) => { n.set('provider', e.target.value); n.delete('payout_cursor'); })}>
              {connected.stripe ? <option value="stripe">Stripe</option> : null}
              {connected.paypal ? <option value="paypal">PayPal</option> : null}
              {!connected.stripe && !connected.paypal ? <option value="">No provider connected</option> : null}
            </select>
          </div>

          {payoutError && /connect/i.test(payoutError.message) && (
            <div className="section-card border-warning/20 bg-warning-light p-4">
              <p className="text-[13px] text-warning">{payoutError.message}</p>
              <button className="glass-button mt-2 text-xs" onClick={() => navigate('/payments/settings')}>Open settings</button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <StatCard label="Available funds" value={formatMoneyFromCents(payoutSummary.data?.available || 0, payoutSummary.data?.currency || 'USD')} iconColor="green" />
            <StatCard label="On the way" value={formatMoneyFromCents(payoutSummary.data?.on_the_way || 0, payoutSummary.data?.currency || 'USD')} iconColor="amber" />
            <div className="section-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-2">Deposited</p>
              <p className="text-[13px] text-text-secondary">This week: <span className="font-semibold text-text-primary tabular-nums">{formatMoneyFromCents(payoutSummary.data?.deposited_week || 0, payoutSummary.data?.currency || 'USD')}</span></p>
              <p className="text-[13px] text-text-secondary">This month: <span className="font-semibold text-text-primary tabular-nums">{formatMoneyFromCents(payoutSummary.data?.deposited_month || 0, payoutSummary.data?.currency || 'USD')}</span></p>
            </div>
          </div>

          {payoutSummary.data?.meta?.note && (
            <p className="rounded-xl bg-surface-secondary px-3 py-2 text-xs text-text-tertiary">{payoutSummary.data.meta.note}</p>
          )}

          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-text-primary">All payouts ({payoutList.data?.total_estimate ?? payoutRows.length})</h2>
            <button className="glass-button inline-flex items-center gap-1.5" onClick={() => void onCsv()}>
              <Download size={13} /> CSV
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <FilterSelect
              value={payoutMethod}
              onChange={(v) => setQuery((n) => { if (v === 'all') n.delete('payout_method'); else n.set('payout_method', v); n.delete('payout_cursor'); })}
              options={activeProvider === 'paypal'
                ? [{ value: 'all', label: 'All' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'other', label: 'Other' }]
                : [{ value: 'all', label: 'All' }, { value: 'standard', label: 'Standard' }, { value: 'instant', label: 'Instant' }]
              }
            />
            <FilterSelect
              value={date}
              onChange={(v) => setQuery((n) => { if (v === 'all') n.delete('date'); else n.set('date', v); if (v !== 'custom') { n.delete('from'); n.delete('to'); } n.delete('payout_cursor'); })}
              icon={<Calendar size={13} />}
              options={[
                { value: 'all', label: 'All time' },
                { value: '30d', label: 'Last 30 days' },
                { value: 'this_month', label: 'This month' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </div>

          <div className="section-card overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Date</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Type</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Status</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Net</th>
                </tr>
              </thead>
              <tbody>
                {payoutRows.length === 0 && !payoutList.isLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10">
                      <EmptyState icon={CreditCard} title="No payouts found" description="Payouts will appear here from your provider." />
                    </td>
                  </tr>
                )}
                {payoutRows.map((i) => (
                  <tr key={i.id} className="table-row-hover cursor-pointer" onClick={() => setSelectedPayout(i)}>
                    <td className="px-4 py-3 text-[13px] text-text-secondary tabular-nums">{formatDate(i.date)}</td>
                    <td className="px-4 py-3 text-[13px] text-text-secondary">{i.type}</td>
                    <td className="px-4 py-3"><StatusBadge status={i.status} /></td>
                    <td className="px-4 py-3 text-right text-[13px] font-medium text-text-primary tabular-nums">{formatMoneyFromCents(i.net, i.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-xs text-text-tertiary">Page {cursorHistory.length + 1}</p>
              <div className="flex gap-2">
                <button className="glass-button !px-2" disabled={cursorHistory.length === 0} onClick={() => setQuery((n) => { const h = [...cursorHistory]; h.pop(); setCursorHistory(h); const prev = h[h.length - 1]; if (!prev) n.delete('payout_cursor'); else n.set('payout_cursor', prev); })}><ChevronLeft size={14} /></button>
                <button className="glass-button !px-2" disabled={!payoutList.data?.has_more || !payoutList.data?.next_cursor} onClick={() => setQuery((n) => { const next = payoutList.data?.next_cursor; if (!next) return; setCursorHistory((h) => [...h, next]); n.set('payout_cursor', next); })}><ChevronRight size={14} /></button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payout detail drawer */}
      {selectedPayout && (
        <>
          <div className="fixed inset-0 z-[80] bg-black/20 backdrop-blur-[2px]" onClick={() => setSelectedPayout(null)} />
          <aside className="fixed right-0 top-0 z-[90] h-screen w-full max-w-md bg-surface border-l border-outline p-5 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[15px] font-bold text-text-primary">Payout details</h3>
              <button className="p-1.5 rounded hover:bg-surface-secondary text-text-tertiary" onClick={() => setSelectedPayout(null)}><X size={14} /></button>
            </div>
            {payoutDetail.isLoading && <div className="skeleton h-40 mt-4" />}
            {payoutDetail.error && <p className="mt-4 text-[13px] text-danger">{(payoutDetail.error as Error).message}</p>}
            {!payoutDetail.isLoading && (
              <pre className="mt-4 rounded-xl bg-surface-secondary p-3 text-xs overflow-x-auto text-text-secondary">{JSON.stringify(payoutDetail.data?.detail || {}, null, 2)}</pre>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
