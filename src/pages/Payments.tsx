import React, { useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, CreditCard, Download, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import { PageHeader, StatCard, EmptyState } from '../components/ui';
import { FilterSelect } from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';

const PAGE_SIZE = 25;
const PAYOUT_PAGE_SIZE = 20;

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

export default function Payments() {
  const { t, language } = useTranslation();
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
  const payoutMethod = String(params.get('payout_method') || 'all');
  const payoutCursor = String(params.get('payout_cursor') || '') || null;
  const range = normalizedDateRange(date, fromDate, toDate);

  const orgQuery = useQuery({ queryKey: ['currentOrgId', 'payments'], queryFn: getCurrentOrgId });
  const orgId = orgQuery.data || null;

  // Check Lume Payments (Connect) status
  const connectQuery = useQuery({
    queryKey: ['connectAccountStatus'],
    queryFn: getAccountStatus,
    enabled: Boolean(orgId),
  });
  const isConnected = connectQuery.data?.connected && connectQuery.data?.account?.charges_enabled;

  const overviewQuery = useQuery({ queryKey: ['paymentsOverview'], queryFn: fetchPaymentsOverview });
  const paymentsQuery = useQuery({
    queryKey: ['paymentsRows', status, method, date, page, fromDate, toDate],
    queryFn: () => listPayments({ status, method, date, q: '', page, pageSize: PAGE_SIZE, fromDate, toDate }),
    enabled: tab === 'overview',
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

  return (
    <div className="space-y-5">
      <PageHeader
        title={language === 'fr' ? 'Paiements' : 'Payments'}
        subtitle={language === 'fr' ? 'Suivi des paiements et versements' : 'Track payments and payouts'}
        icon={CreditCard}
        iconColor="amber"
      >
        <button className="glass-button" onClick={() => navigate('/settings/payments')}>
          {language === 'fr' ? 'Parametres' : 'Settings'}
        </button>
      </PageHeader>

      {/* Not connected banner */}
      {!isConnected && !connectQuery.isLoading && (
        <div className="section-card border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/30 p-4 flex items-center justify-between">
          <div>
            <p className="text-[14px] font-medium text-neutral-800 dark:text-neutral-200">
              {language === 'fr' ? 'Activez Lume Payments pour accepter les paiements en ligne' : 'Activate Lume Payments to accept online payments'}
            </p>
            <p className="text-[12px] text-text-primary dark:text-neutral-400 mt-0.5">
              {language === 'fr' ? 'Vos clients pourront payer leurs factures par carte de credit.' : 'Your clients will be able to pay invoices by credit card.'}
            </p>
          </div>
          <button className="glass-button bg-neutral-900 text-white hover:bg-neutral-800 shrink-0" onClick={() => navigate('/settings/payments')}>
            {language === 'fr' ? 'Activer' : 'Activate'}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="tab-nav">
        <button className={tab === 'overview' ? 'tab-item-active' : 'tab-item'} onClick={() => setQuery((n) => n.delete('tab'))}>
          {language === 'fr' ? 'Apercu' : 'Overview'}
        </button>
        <button className={tab === 'payouts' ? 'tab-item-active' : 'tab-item'} onClick={() => setQuery((n) => n.set('tab', 'payouts'))}>
          {language === 'fr' ? 'Versements' : 'Payouts'}
        </button>
      </div>

      {tab === 'overview' ? (
        <>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <StatCard label={language === 'fr' ? 'Fonds disponibles' : 'Available funds'} value={formatMoneyFromCents(overviewQuery.data?.available_funds_cents || 0)} iconColor="green" />
            <StatCard label={language === 'fr' ? 'Delai de paiement (30j)' : 'Payment time (30d)'} value={`${(overviewQuery.data?.invoice_payment_time_days_30d || 0).toFixed(1)} ${language === 'fr' ? 'jours' : 'days'}`} iconColor="blue" />
            <StatCard label={language === 'fr' ? 'Payees a temps' : 'Paid on time'} value={`${(overviewQuery.data?.paid_on_time_global_pct_60d || 0).toFixed(1)}%`} iconColor="purple" />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <FilterSelect
              value={status}
              onChange={(v) => setQuery((n) => { if (v === 'all') n.delete('status'); else n.set('status', v); n.set('page', '1'); })}
              options={[
                { value: 'all', label: language === 'fr' ? 'Tous les statuts' : 'All statuses' },
                { value: 'succeeded', label: language === 'fr' ? 'Reussi' : 'Succeeded' },
                { value: 'pending', label: language === 'fr' ? 'En attente' : 'Pending' },
                { value: 'failed', label: language === 'fr' ? 'Echoue' : 'Failed' },
                { value: 'refunded', label: language === 'fr' ? 'Rembourse' : 'Refunded' },
              ]}
            />
            <FilterSelect
              value={method}
              onChange={(v) => setQuery((n) => { if (v === 'all') n.delete('method'); else n.set('method', v); n.set('page', '1'); })}
              options={[
                { value: 'all', label: language === 'fr' ? 'Toutes methodes' : 'All methods' },
                { value: 'card', label: language === 'fr' ? 'Carte' : 'Card' },
                { value: 'e-transfer', label: 'E-Transfer' },
                { value: 'cash', label: language === 'fr' ? 'Comptant' : 'Cash' },
                { value: 'check', label: language === 'fr' ? 'Cheque' : 'Check' },
              ]}
            />
          </div>

          <div className="section-card overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Client' : 'Client'}</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Date' : 'Date'}</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Statut' : 'Status'}</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Montant' : 'Amount'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !paymentsQuery.isLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10">
                      <EmptyState
                        icon={CreditCard}
                        title={language === 'fr' ? 'Aucun paiement' : 'No payments yet'}
                        description={language === 'fr' ? 'Les paiements apparaitront ici.' : 'Payments will appear here.'}
                      />
                    </td>
                  </tr>
                )}
                {paymentsQuery.isLoading && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-[13px] text-text-tertiary">{language === 'fr' ? 'Chargement...' : 'Loading...'}</td></tr>
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
              <p className="text-xs text-text-tertiary">{language === 'fr' ? 'Page' : 'Page'} {page} / {totalPages}</p>
              <div className="flex gap-2">
                <button className="glass-button !px-2" disabled={page <= 1} onClick={() => setQuery((n) => { const p = Math.max(1, page - 1); if (p === 1) n.delete('page'); else n.set('page', String(p)); })}><ChevronLeft size={14} /></button>
                <button className="glass-button !px-2" disabled={page >= totalPages} onClick={() => setQuery((n) => n.set('page', String(page + 1)))}><ChevronRight size={14} /></button>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* ── Payouts tab ── */
        <div className="space-y-5">
          {!isConnected && (
            <div className="section-card border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4">
              <p className="text-[13px] text-amber-800 dark:text-amber-200">
                {language === 'fr' ? 'Activez Lume Payments pour voir vos versements.' : 'Activate Lume Payments to see your payouts.'}
              </p>
              <button className="glass-button mt-2 text-xs" onClick={() => navigate('/settings/payments')}>
                {language === 'fr' ? 'Ouvrir les parametres' : 'Open Settings'}
              </button>
            </div>
          )}

          {payoutError && (
            <div className="section-card border-danger-light bg-danger-light/10 p-4">
              <p className="text-[13px] text-danger">{payoutError.message}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <StatCard label={language === 'fr' ? 'Disponible' : 'Available'} value={formatMoneyFromCents(payoutSummary.data?.available || 0, payoutSummary.data?.currency || 'CAD')} iconColor="green" />
            <StatCard label={language === 'fr' ? 'En transit' : 'On the way'} value={formatMoneyFromCents(payoutSummary.data?.on_the_way || 0, payoutSummary.data?.currency || 'CAD')} iconColor="amber" />
            <div className="section-card p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary mb-2">{language === 'fr' ? 'Depose' : 'Deposited'}</p>
              <p className="text-[13px] text-text-secondary">{language === 'fr' ? 'Cette semaine' : 'This week'}: <span className="font-semibold text-text-primary tabular-nums">{formatMoneyFromCents(payoutSummary.data?.deposited_week || 0, payoutSummary.data?.currency || 'CAD')}</span></p>
              <p className="text-[13px] text-text-secondary">{language === 'fr' ? 'Ce mois-ci' : 'This month'}: <span className="font-semibold text-text-primary tabular-nums">{formatMoneyFromCents(payoutSummary.data?.deposited_month || 0, payoutSummary.data?.currency || 'CAD')}</span></p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-text-primary">
              {language === 'fr' ? 'Tous les versements' : 'All payouts'} ({payoutList.data?.total_estimate ?? payoutRows.length})
            </h2>
            <button className="glass-button inline-flex items-center gap-1.5" onClick={() => void onCsv()}>
              <Download size={13} /> CSV
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <FilterSelect
              value={payoutMethod}
              onChange={(v) => setQuery((n) => { if (v === 'all') n.delete('payout_method'); else n.set('payout_method', v); n.delete('payout_cursor'); })}
              options={[
                { value: 'all', label: language === 'fr' ? 'Tous' : 'All' },
                { value: 'standard', label: 'Standard' },
                { value: 'instant', label: 'Instant' },
              ]}
            />
            <FilterSelect
              value={date}
              onChange={(v) => setQuery((n) => { if (v === 'all') n.delete('date'); else n.set('date', v); if (v !== 'custom') { n.delete('from'); n.delete('to'); } n.delete('payout_cursor'); })}
              icon={<Calendar size={13} />}
              options={[
                { value: 'all', label: language === 'fr' ? 'Tout' : 'All time' },
                { value: '30d', label: language === 'fr' ? '30 derniers jours' : 'Last 30 days' },
                { value: 'this_month', label: language === 'fr' ? 'Ce mois-ci' : 'This month' },
                { value: 'custom', label: language === 'fr' ? 'Personnalise' : 'Custom range' },
              ]}
            />
          </div>

          <div className="section-card overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Date</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Type</th>
                  <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">{language === 'fr' ? 'Statut' : 'Status'}</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">Net</th>
                </tr>
              </thead>
              <tbody>
                {payoutRows.length === 0 && !payoutList.isLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10">
                      <EmptyState
                        icon={CreditCard}
                        title={language === 'fr' ? 'Aucun versement' : 'No payouts yet'}
                        description={language === 'fr' ? 'Les versements apparaitront ici une fois les paiements traites.' : 'Payouts will appear here once payments are processed.'}
                      />
                    </td>
                  </tr>
                )}
                {payoutList.isLoading && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-[13px] text-text-tertiary">{language === 'fr' ? 'Chargement...' : 'Loading...'}</td></tr>
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
              <p className="text-xs text-text-tertiary">{language === 'fr' ? 'Page' : 'Page'} {cursorHistory.length + 1}</p>
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
              <h3 className="text-[15px] font-bold text-text-primary">{language === 'fr' ? 'Details du versement' : 'Payout details'}</h3>
              <button className="p-1.5 rounded hover:bg-surface-secondary text-text-tertiary" onClick={() => setSelectedPayout(null)}><X size={14} /></button>
            </div>
            {payoutDetail.isLoading && <div className="skeleton h-40 mt-4" />}
            {payoutDetail.error && <p className="mt-4 text-[13px] text-danger">{(payoutDetail.error as Error).message}</p>}
            {!payoutDetail.isLoading && payoutDetail.data?.detail && (() => {
              const d = payoutDetail.data.detail as { amount: number; currency: string; status: string; created: string; arrival_date: string; fee_total: number; id: string };
              return (
              <div className="mt-4 space-y-3">
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">{language === 'fr' ? 'Montant' : 'Amount'}</span>
                  <span className="font-semibold text-text-primary">{formatMoneyFromCents(d.amount, d.currency)}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">{language === 'fr' ? 'Statut' : 'Status'}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">{language === 'fr' ? 'Date de creation' : 'Created'}</span>
                  <span className="text-text-primary">{formatDate(d.created)}</span>
                </div>
                <div className="flex justify-between text-[13px]">
                  <span className="text-text-secondary">{language === 'fr' ? 'Date d\'arrivee' : 'Arrival date'}</span>
                  <span className="text-text-primary">{formatDate(d.arrival_date)}</span>
                </div>
                {d.fee_total > 0 && (
                  <div className="flex justify-between text-[13px]">
                    <span className="text-text-secondary">{language === 'fr' ? 'Frais' : 'Fees'}</span>
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
          </aside>
        </>
      )}
    </div>
  );
}
