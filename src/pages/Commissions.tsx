import { useState, useEffect, useCallback } from 'react';
import { StatCard } from '../components/d2d/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '../components/d2d/card';
import { Button } from '../components/d2d/button';
import { Avatar } from '../components/d2d/avatar';
import { getRepAvatar } from '../lib/constants/avatars';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase';
import {
  getCommissionEntries,
  getPayrollPreview,
  approveCommission,
  reverseCommission,
} from '../lib/commissionsApi';
import type { FsCommissionEntry, CommissionPayrollPreview } from '../types';
import {
  DollarSign,
  Percent,
  TrendingUp,
  CalendarClock,
  FileText,
  Wrench,
  CreditCard,
  Filter,
  Download,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react';

type Tab = 'commissions' | 'payout';

// No fallback data — empty state shown when API returns no results

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusStyles: Record<string, string> = {
  pending: 'bg-warning text-white',
  approved: 'bg-info text-white',
  paid: 'bg-success text-white',
  reversed: 'bg-error text-white',
};

const payoutStatusStyles: Record<string, string> = {
  future: 'bg-info text-white',
  invoiced: 'bg-warning text-white',
  serviced: 'bg-brand text-white',
  paid: 'bg-success text-white',
};

function fmtCurrency(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getCurrentMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function D2DCommissions() {
  const [activeTab, setActiveTab] = useState<Tab>('commissions');

  // API state
  const [entries, setEntries] = useState<FsCommissionEntry[] | null>(null);
  const [payroll, setPayroll] = useState<CommissionPayrollPreview | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch profile names for a set of user_ids
  const fetchProfiles = useCallback(async (userIds: string[]) => {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (unique.length === 0) return;
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', unique);
    if (profiles) {
      const map: Record<string, string> = {};
      for (const p of profiles) {
        map[p.id] = p.full_name ?? p.id;
      }
      setProfileMap((prev) => ({ ...prev, ...map }));
    }
  }, []);

  // Main data fetch
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { from, to } = getCurrentMonthRange();
      const [entriesData, payrollData] = await Promise.all([
        getCommissionEntries(),
        getPayrollPreview(from, to),
      ]);
      setEntries(entriesData);
      setPayroll(payrollData);

      // Resolve user names
      const allUserIds = entriesData.map((e) => e.user_id);
      await fetchProfiles(allUserIds);
    } catch (err) {
      console.error('Failed to load commission data:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [fetchProfiles]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- Approve / Reverse actions ---
  const handleApprove = async (entryId: string) => {
    setActionLoading(entryId);
    try {
      const updated = await approveCommission(entryId);
      setEntries((prev) => prev?.map((e) => (e.id === entryId ? updated : e)) ?? null);
    } catch (err) {
      console.error('Approve failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReverse = async (entryId: string) => {
    setActionLoading(entryId);
    try {
      const updated = await reverseCommission(entryId);
      setEntries((prev) => prev?.map((e) => (e.id === entryId ? updated : e)) ?? null);
    } catch (err) {
      console.error('Reverse failed:', err);
    } finally {
      setActionLoading(null);
    }
  };

  // --- Derive display data ---
  // Commission summary cards (computed from real data)
  const commissionCards = (() => {
    if (!entries || entries.length === 0) {
      return [
        { label: 'Total Revenue', value: '$0', subtitle: 'This period' },
        { label: 'Total Earned', value: '$0', subtitle: 'Commission earned' },
        { label: 'Commission %', value: '0%', subtitle: 'Current rate' },
      ];
    }
    const totalRevenue = entries.reduce((sum, e) => sum + e.base_amount, 0);
    const totalEarned = entries.reduce((sum, e) => sum + e.amount, 0);
    const avgPercent = totalRevenue > 0 ? Math.round((totalEarned / totalRevenue) * 100) : 0;
    return [
      { label: 'Total Revenue', value: fmtCurrency(totalRevenue), subtitle: 'This period' },
      { label: 'Total Earned', value: fmtCurrency(totalEarned), subtitle: 'Commission earned' },
      { label: 'Commission %', value: `${avgPercent}%`, subtitle: 'Current rate' },
    ];
  })();

  // Payout summary cards (computed from payroll preview)
  const payoutCards = (() => {
    if (!payroll) return [
      { label: 'Pending', value: '$0', subtitle: 'No data' },
      { label: 'Approved', value: '$0', subtitle: 'No data' },
      { label: 'Paid', value: '$0', subtitle: 'No data' },
      { label: 'Total', value: '$0', subtitle: 'No data' },
    ];
    return [
      { label: 'Pending', value: fmtCurrency(payroll.pending), subtitle: `Part of ${payroll.count} entries` },
      { label: 'Approved', value: fmtCurrency(payroll.approved), subtitle: 'Awaiting payout' },
      { label: 'Paid', value: fmtCurrency(payroll.paid), subtitle: 'This month' },
      { label: 'Total', value: fmtCurrency(payroll.total), subtitle: `${payroll.count} entries total` },
    ];
  })();

  // Table rows for commissions
  const commissionRows = (() => {
    if (!entries) return [];
    return entries.map((e) => ({
      id: e.id,
      lead: e.description ?? e.lead_id ?? '—',
      rep: profileMap[e.user_id] ?? e.user_id,
      rule: e.rule_id ?? '—',
      base: e.base_amount,
      amount: e.amount,
      status: e.status,
      date: fmtDate(e.created_at),
      _raw: e,
    }));
  })();

  // Table rows for payout (from payroll preview entries)
  const payoutRows = (() => {
    if (!payroll) return [];
    return payroll.entries.map((e) => ({
      id: e.id,
      service: e.description ?? e.lead_id ?? '—',
      status: e.status === 'pending' ? 'invoiced' : e.status === 'approved' ? 'serviced' : e.status,
      date: fmtDate(e.created_at),
      amount: e.amount,
    }));
  })();

  // Show action buttons when we have real data
  const showActions = !error && entries !== null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Commissions</h2>
          <p className="text-xs text-text-tertiary">
            Track earnings, approvals, and payouts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="h-3 w-3" />
            Export
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Filter className="h-3 w-3" />
            Filters
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-3">
        {([
          { key: 'commissions' as Tab, label: 'Commissions' },
          { key: 'payout' as Tab, label: 'Payout' },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'rounded-lg border px-5 py-2.5 text-sm font-semibold transition-all duration-200',
              activeTab === tab.key
                ? 'bg-white text-text-primary border-border shadow-md scale-105'
                : 'bg-transparent text-text-muted border-transparent hover:text-text-secondary hover:bg-white/50'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
          <span className="ml-2 text-sm text-text-muted">Loading commissions...</span>
        </div>
      )}

      {/* === COMMISSIONS TAB === */}
      {!loading && activeTab === 'commissions' && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {commissionCards.map((card) => (
              <StatCard key={card.label} {...card} />
            ))}
          </div>

          {/* Commission entries table */}
          <Card>
            <CardHeader>
              <CardTitle>Commission Entries</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border-subtle">
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Lead</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Rep</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Rule</th>
                      <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Base</th>
                      <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Commission</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Status</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commissionRows.map((entry) => (
                      <tr key={entry.id} className="border-b border-border-subtle last:border-b-0 table-row-hover">
                        <td className="px-5 py-2.5 text-sm font-medium text-text-primary">{entry.lead}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <Avatar name={entry.rep} src={getRepAvatar(entry.rep)} size="sm" className="!h-5 !w-5 !text-[8px]" />
                            <span className="text-sm text-text-secondary">{entry.rep}</span>
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-sm text-text-muted">{entry.rule}</td>
                        <td className="px-5 py-2.5 text-right text-sm text-text-secondary">${entry.base.toLocaleString('en-US')}</td>
                        <td className="px-5 py-2.5 text-right text-sm font-medium text-text-primary">${entry.amount.toLocaleString('en-US')}</td>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize', statusStyles[entry.status] ?? 'bg-surface-elevated text-text-muted')}>
                              {entry.status}
                            </span>
                            {showActions && entry.status === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleApprove(entry.id)}
                                  disabled={actionLoading === entry.id}
                                  className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-success hover:bg-success/10 transition-colors disabled:opacity-50"
                                  title="Approve"
                                >
                                  {actionLoading === entry.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <CheckCircle className="h-3 w-3" />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleReverse(entry.id)}
                                  disabled={actionLoading === entry.id}
                                  className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                                  title="Reverse"
                                >
                                  <XCircle className="h-3 w-3" />
                                </button>
                              </>
                            )}
                            {showActions && entry.status === 'approved' && (
                              <button
                                onClick={() => handleReverse(entry.id)}
                                disabled={actionLoading === entry.id}
                                className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-error hover:bg-error/10 transition-colors disabled:opacity-50"
                                title="Reverse"
                              >
                                {actionLoading === entry.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <XCircle className="h-3 w-3" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-2.5 text-sm text-text-muted">{entry.date}</td>
                      </tr>
                    ))}
                    {commissionRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-5 py-8 text-center text-sm text-text-muted">
                          No commission entries found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* === PAYOUT TAB === */}
      {!loading && activeTab === 'payout' && (
        <>
          {/* Payout summary cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {payoutCards.map((card) => (
              <StatCard key={card.label} {...card} />
            ))}
          </div>

          {/* Payout entries table */}
          <Card>
            <CardHeader>
              <CardTitle>Payout Details</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border-subtle">
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Service</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Status</th>
                      <th className="px-5 py-2.5 text-left text-xs font-medium text-text-muted">Date</th>
                      <th className="px-5 py-2.5 text-right text-xs font-medium text-text-muted">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payoutRows.map((entry) => (
                      <tr key={entry.id} className="border-b border-border-subtle last:border-b-0 table-row-hover">
                        <td className="px-5 py-2.5 text-sm font-medium text-text-primary">{entry.service}</td>
                        <td className="px-5 py-2.5">
                          <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize', payoutStatusStyles[entry.status] ?? 'bg-surface-elevated text-text-muted')}>
                            {entry.status}
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-sm text-text-muted">{entry.date}</td>
                        <td className="px-5 py-2.5 text-right text-sm font-medium text-text-primary">${entry.amount.toLocaleString('en-US')}</td>
                      </tr>
                    ))}
                    {payoutRows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-5 py-8 text-center text-sm text-text-muted">
                          No payout entries found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
