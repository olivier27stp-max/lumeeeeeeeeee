import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../d2d/card';
import { supabase } from '../../lib/supabase';
import {
  getCommissionEntries,
  getPayrollPreview,
  approveCommission,
  reverseCommission,
  markCommissionPaid,
} from '../../lib/commissionsApi';
import type { FsCommissionEntry, CommissionPayrollPreview } from '../../types';
import CommissionFilters, { type CommissionFiltersValue } from './CommissionFilters';
import CommissionTable from './CommissionTable';
import UpcomingPayouts from './UpcomingPayouts';
import { CommissionHero, RepLeaderboard, StatusDonut, KpiCard, fmtMoney, type LeaderRep } from './CommissionCharts';
import { useTranslation } from '../../i18n';

interface Props {
  /** Called when the admin clicks a rep — host page can open the drilldown view */
  onSelectRep?: (userId: string) => void;
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
  const { language } = useTranslation();
  const isFr = language === 'fr';
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

  const handleMarkPaid = async (id: string) => {
    setActionLoading(id);
    try {
      const updated = await markCommissionPaid(id);
      setEntries((prev) => prev?.map((e) => (e.id === id ? updated : e)) ?? null);
      // Reflète le versement dans les totaux (payé/en attente).
      const p = await getPayrollPreview(filters.from, filters.to, filters.repId);
      setPayroll(p);
    } catch (err: any) {
      setError(err?.message || (isFr ? 'Échec du versement' : 'Mark paid failed'));
    } finally {
      setActionLoading(null);
    }
  };

  // Dashboard derivations — total + cumulative time series + leaderboard + split.
  const dash = useMemo(() => {
    const list = entries ?? [];
    const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
    const paid = payroll?.paid ?? 0;
    const pending = payroll?.pending ?? 0;
    const reversed = payroll?.reversed ?? 0;

    // Cumulative amount over the selected range (bucketed by day of the period).
    const from = new Date(filters.from + 'T00:00:00');
    const to = new Date(filters.to + 'T00:00:00');
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
    const buckets = new Array(days).fill(0);
    for (const e of list) {
      const d = new Date(e.triggered_at || e.created_at);
      const idx = Math.floor((d.getTime() - from.getTime()) / 86_400_000);
      if (idx >= 0 && idx < days) buckets[idx] += Number(e.amount || 0);
    }
    let run = 0;
    const series = buckets.map((v) => (run += v));
    // ~7 evenly spaced x labels (day-of-month).
    const step = Math.max(1, Math.floor(days / 6));
    const xLabels: string[] = [];
    for (let i = 0; i < days; i += step) xLabels.push(String(new Date(from.getTime() + i * 86_400_000).getDate()));

    // Per-rep totals → leaderboard.
    const byRep = new Map<string, { amount: number; deals: number }>();
    for (const e of list) {
      const r = byRep.get(e.user_id) ?? { amount: 0, deals: 0 };
      r.amount += Number(e.amount || 0);
      r.deals += 1;
      byRep.set(e.user_id, r);
    }
    const leaderboard: LeaderRep[] = [...byRep.entries()]
      .map(([userId, v]) => ({ userId, name: profileMap[userId] ?? userId, amount: v.amount, deals: v.deals }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const avgPerDeal = list.length ? total / list.length : 0;
    return { total, paid, pending, reversed, series, xLabels, leaderboard, deals: list.length, avgPerDeal, repCount: byRep.size };
  }, [entries, payroll, profileMap, filters.from, filters.to]);

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
          {/* Hero (total + trend + evolution) beside quick facts */}
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.5fr_1fr]">
            <CommissionHero
              label={isFr ? 'Commissions totales' : 'Total commissions'}
              value={dash.total}
              deltaPct={null}
              series={dash.series}
              xLabels={dash.xLabels}
              note={isFr ? 'Sur la période' : 'Selected period'}
            />
            <div className="rounded-2xl border border-border bg-surface-card p-4 shadow-card">
              <div className="px-1 pb-1 text-[14px] font-bold tracking-tight text-text-primary">{isFr ? 'En bref' : 'At a glance'}</div>
              <div className="mt-1 flex flex-col">
                {[
                  { l: isFr ? 'Ventes conclues' : 'Deals closed', v: String(dash.deals) },
                  { l: isFr ? 'Commission moyenne / vente' : 'Avg. per deal', v: fmtMoney(dash.avgPerDeal), money: true },
                  { l: isFr ? 'Représentants actifs' : 'Active reps', v: String(dash.repCount) },
                  { l: isFr ? 'Versé sur la période' : 'Paid this period', v: fmtMoney(dash.paid), money: true },
                ].map((r) => (
                  <div key={r.l} className="flex items-center justify-between border-b border-border-light py-2.5 last:border-b-0">
                    <span className="text-[12px] text-text-secondary">{r.l}</span>
                    <span className="text-[14px] font-bold tabular-nums text-text-primary">{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={isFr ? 'En attente' : 'Pending'} value={fmtMoney(dash.pending)} money note={isFr ? "en attente d'approbation" : 'awaiting approval'} />
            <KpiCard label={isFr ? 'Versé' : 'Paid'} value={fmtMoney(dash.paid)} money note={isFr ? 'réglé' : 'settled'} />
            <KpiCard label={isFr ? 'Reversé' : 'Reversed'} value={fmtMoney(dash.reversed)} note={isFr ? 'annulé' : 'clawed back'} />
            <KpiCard label={isFr ? 'Meilleur rep' : 'Top rep'} value={dash.leaderboard[0]?.name ?? '—'} note={dash.leaderboard[0] ? fmtMoney(dash.leaderboard[0].amount) : ''} />
          </div>

          {/* Leaderboard + status donut */}
          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader><CardTitle>{isFr ? 'Classement des représentants' : 'Rep leaderboard'}</CardTitle></CardHeader>
              <CardContent><RepLeaderboard reps={dash.leaderboard} onSelect={onSelectRep} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{isFr ? 'Répartition' : 'Breakdown'}</CardTitle></CardHeader>
              <CardContent>
                <StatusDonut
                  centerLabel={isFr ? 'Total' : 'Total'}
                  segments={[
                    { label: isFr ? 'Versé' : 'Paid', value: dash.paid, color: 'var(--color-success)' },
                    { label: isFr ? 'En attente' : 'Pending', value: dash.pending, color: 'var(--color-warning)' },
                    { label: isFr ? 'Reversé' : 'Reversed', value: dash.reversed, color: 'var(--color-danger)' },
                  ]}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{isFr ? 'Entrées de commission' : 'Commission entries'}</CardTitle>
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
                onMarkPaid={handleMarkPaid}
              />
            </CardContent>
          </Card>

          <UpcomingPayouts entries={entries ?? []} />
        </>
      )}
    </div>
  );
}
