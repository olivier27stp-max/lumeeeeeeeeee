import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../d2d/card';
import { supabase } from '../../lib/supabase';
import {
  getCommissionEntries,
  getPayrollPreview,
} from '../../lib/commissionsApi';
import type { FsCommissionEntry, CommissionPayrollPreview } from '../../types';
import CommissionStatsCards, { type CommissionStat } from './CommissionStatsCards';
import CommissionFilters, { type CommissionFiltersValue } from './CommissionFilters';
import CommissionTable from './CommissionTable';
import UpcomingPayouts from './UpcomingPayouts';

interface Props {
  /**
   * userId to scope the data to. When omitted, the backend defaults to the
   * caller's own user (the rep view). Admins viewing another rep pass the rep's
   * id explicitly.
   */
  userId?: string;
  /** Optional title override (e.g. "John Smith's commissions" in admin drilldown). */
  title?: string;
  /** Subtitle override. */
  subtitle?: string;
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
 * Personal commission dashboard — used both for the sales_rep "My Commissions"
 * page AND for the admin/owner per-rep drilldown. Visually identical; the
 * scoping is controlled by the `userId` prop.
 */
export default function PersonalCommissionView({
  userId,
  title = 'My Commissions',
  subtitle = 'Your closes, commission, and next payouts',
}: Props) {
  const [filters, setFilters] = useState<CommissionFiltersValue>(() => {
    const { from, to } = defaultRange();
    return { status: 'all', from, to };
  });
  const [entries, setEntries] = useState<FsCommissionEntry[] | null>(null);
  const [payroll, setPayroll] = useState<CommissionPayrollPreview | null>(null);
  const [profileMap, setProfileMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [entriesData, payrollData] = await Promise.all([
        getCommissionEntries({
          userId,
          status: filters.status === 'all' ? undefined : filters.status,
          from: filters.from,
          to: filters.to,
        }),
        getPayrollPreview(filters.from, filters.to, userId),
      ]);
      setEntries(entriesData);
      setPayroll(payrollData);

      // Resolve rep names (only used when admin drills into a specific rep)
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
      console.error('[PersonalCommissionView] failed to load:', err);
      setError(err?.message || 'Failed to load commissions');
    } finally {
      setLoading(false);
    }
  }, [userId, filters.status, filters.from, filters.to]);

  useEffect(() => { void load(); }, [load]);

  const stats: CommissionStat[] = useMemo(() => {
    const totalEarned = entries?.reduce((s, e) => s + Number(e.amount || 0), 0) ?? 0;
    const pending = payroll?.pending ?? 0;
    const paid = payroll?.paid ?? 0;
    const next = entries
      ?.filter((e) => e.status === 'approved')
      .reduce((s, e) => s + Number(e.amount || 0), 0) ?? 0;
    return [
      { label: 'Total earned',  value: fmtMoney(totalEarned), subtitle: 'This period' },
      { label: 'Pending',       value: fmtMoney(pending),     subtitle: 'Awaiting approval' },
      { label: 'Paid',          value: fmtMoney(paid),        subtitle: 'This period' },
      { label: 'Next payout',   value: fmtMoney(next),        subtitle: 'Approved, awaiting payout' },
    ];
  }, [entries, payroll]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        <p className="text-xs text-text-tertiary">{subtitle}</p>
      </div>

      <CommissionFilters value={filters} onChange={setFilters} />

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

          <Card>
            <CardHeader>
              <CardTitle>Recent closes</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <CommissionTable
                entries={entries ?? []}
                profileMap={profileMap}
                showRep={false}
                showActions={false}
                emptyMessage="No closes for the selected period"
              />
            </CardContent>
          </Card>

          <UpcomingPayouts entries={entries ?? []} />
        </>
      )}
    </div>
  );
}
