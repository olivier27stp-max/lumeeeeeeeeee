import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../d2d/card';
import { supabase } from '../../lib/supabase';
import {
  getCommissionEntries,
  getPayrollPreview,
  approveCommission,
  reverseCommission,
} from '../../lib/commissionsApi';
import type { FsCommissionEntry, CommissionPayrollPreview } from '../../types';
import CommissionStatsCards, { type CommissionStat } from './CommissionStatsCards';
import CommissionFilters, { type CommissionFiltersValue } from './CommissionFilters';
import CommissionTable from './CommissionTable';
import UpcomingPayouts from './UpcomingPayouts';
import RepCommissionSummary from './RepCommissionSummary';

interface Props {
  /** Called when the admin clicks a rep — host page can open the drilldown view */
  onSelectRep?: (userId: string) => void;
}

function fmtMoney(n: number) {
  return '$' + Number(n || 0).toLocaleString('en-US');
}

function defaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * Admin/owner overview — KPIs across all reps, rep breakdown, deals table,
 * and upcoming payouts. The same building blocks as the personal view, so the
 * two experiences feel consistent.
 */
export default function AdminCommissionOverview({ onSelectRep }: Props) {
  const [filters, setFilters] = useState<CommissionFiltersValue>(() => {
    const { from, to } = defaultRange();
    return { status: 'all', from, to };
  });
  const [entries, setEntries] = useState<FsCommissionEntry[] | null>(null);
  const [payroll, setPayroll] = useState<CommissionPayrollPreview | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entriesData, payrollData] = await Promise.all([
        getCommissionEntries({
          userId: filters.repId, // backend treats undefined as "all reps" for admin/owner
          status: filters.status === 'all' ? undefined : filters.status,
          from: filters.from,
          to: filters.to,
        }),
        getPayrollPreview(filters.from, filters.to, filters.repId),
      ]);
      setEntries(entriesData);
      setPayroll(payrollData);

      const ids = [...new Set(entriesData.map((e) => e.user_id).filter(Boolean))];
      if (ids.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', ids);
        if (profiles) {
          const map: Record<string, string> = {};
          for (const p of profiles) map[p.id] = p.full_name ?? p.id;
          setProfileMap(map);
        }
      }
    } catch (err: any) {
      console.error('[AdminCommissionOverview] failed to load:', err);
      setError(err?.message || 'Failed to load commissions');
    } finally {
      setLoading(false);
    }
  }, [filters.repId, filters.status, filters.from, filters.to]);

  useEffect(() => { void load(); }, [load]);

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const updated = await approveCommission(id);
      setEntries((prev) => prev?.map((e) => (e.id === id ? updated : e)) ?? null);
    } catch (err: any) {
      setError(err?.message || 'Approve failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReverse = async (id: string) => {
    setActionLoading(id);
    try {
      const updated = await reverseCommission(id);
      setEntries((prev) => prev?.map((e) => (e.id === id ? updated : e)) ?? null);
    } catch (err: any) {
      setError(err?.message || 'Reverse failed');
    } finally {
      setActionLoading(null);
    }
  };

  const stats: CommissionStat[] = useMemo(() => {
    const totalCommissions = entries?.reduce((s, e) => s + Number(e.amount || 0), 0) ?? 0;
    const pendingPayouts = payroll?.pending ?? 0;
    const paid = payroll?.paid ?? 0;

    // Top rep this period
    const byRep = new Map<string, number>();
    for (const e of entries ?? []) {
      byRep.set(e.user_id, (byRep.get(e.user_id) ?? 0) + Number(e.amount || 0));
    }
    let topRepLabel = '—';
    let topRepValue = 0;
    for (const [uid, total] of byRep) {
      if (total > topRepValue) {
        topRepValue = total;
        topRepLabel = profileMap[uid] ?? uid;
      }
    }
    return [
      { label: 'Total commissions', value: fmtMoney(totalCommissions), subtitle: 'This period' },
      { label: 'Pending payouts',   value: fmtMoney(pendingPayouts),   subtitle: 'Awaiting approval' },
      { label: 'Paid this period',  value: fmtMoney(paid),             subtitle: 'Settled' },
      { label: 'Top earning rep',   value: topRepLabel,                subtitle: fmtMoney(topRepValue) },
    ];
  }, [entries, payroll, profileMap]);

  // Build rep list for the filter dropdown
  const repOptions = useMemo(() => {
    const ids = [...new Set((entries ?? []).map((e) => e.user_id).filter(Boolean))];
    return ids.map((id) => ({ id, label: profileMap[id] ?? id }));
  }, [entries, profileMap]);

  return (
    <div className="space-y-6">
      <CommissionFilters value={filters} onChange={setFilters} reps={repOptions} />

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
          <span className="ml-2 text-sm text-text-muted">Loading commissions...</span>
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-error/30 bg-error/5 px-5 py-4 text-sm text-error">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <CommissionStatsCards cards={stats} columns={4} />

          <RepCommissionSummary
            entries={entries ?? []}
            profileMap={profileMap}
            onSelectRep={onSelectRep}
          />

          <Card>
            <CardHeader>
              <CardTitle>Commission entries</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <CommissionTable
                entries={entries ?? []}
                profileMap={profileMap}
                showRep={true}
                showActions={true}
                actionLoading={actionLoading}
                onApprove={handleApprove}
                onReverse={handleReverse}
              />
            </CardContent>
          </Card>

          <UpcomingPayouts entries={entries ?? []} />
        </>
      )}
    </div>
  );
}
